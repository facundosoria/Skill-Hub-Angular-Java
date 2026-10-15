"""Docker-only reader and isolated writer connected by a private Unix stream pipe."""
import base64
from collections import deque
import json
import grp
import os
from pathlib import Path
import re
import selectors
import signal
import socket
import subprocess
import threading
import time

from .sanitize import MAX_LINE_BYTES
from .schema import encode
from .store import Store

QUEUE_BYTES = 1024 * 1024
FRAME_BYTES = 32768


class Framer:
    """Bounded physical lines; an oversize suffix can never become a new line."""
    def __init__(self):
        self.buffer = bytearray()
        self.dropping = False

    def feed(self, chunk):
        result = []
        pieces = chunk.split(b"\n")
        for index, piece in enumerate(pieces):
            if index < len(pieces) - 1:
                self._piece(piece + b"\n", result)
            elif piece:
                self._piece(piece, result)
        return result

    def _piece(self, piece, result):
        complete = piece.endswith(b"\n")
        if self.dropping:
            if complete:
                self.dropping = False
            return
        if len(self.buffer) + len(piece) > MAX_LINE_BYTES:
            self.buffer.clear()
            self.dropping = not complete
            result.append(None)
            return
        self.buffer.extend(piece)
        if complete:
            result.append(bytes(self.buffer))
            self.buffer.clear()


def stop_process(process):
    if process and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
    if process:
        for pipe in (process.stdout, process.stderr):
            if pipe:
                pipe.close()


def container_id(docker, container):
    # Never request, log, or serialize the full inspect document (which has env).
    process = subprocess.Popen([docker, "inspect", "--format", "{{.Id}}", container],
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        value, _ = process.communicate(timeout=5)
        if process.returncode or not re.fullmatch(rb"[0-9a-f]{64}\n?", value):
            raise OSError("Source inspection unavailable")
        return value.decode().strip()
    finally:
        stop_process(process)


def receive_reply(connection):
    data = bytearray()
    while b"\n" not in data:
        chunk = connection.recv(1024)
        if not chunk or len(data) + len(chunk) > 2048:
            raise OSError("Invalid source handshake")
        data.extend(chunk)
    reply = json.loads(data)
    if set(reply) != {"since"} or not isinstance(reply["since"], str):
        raise OSError("Invalid source handshake")
    return reply["since"]


def follow(docker, container, identity, connection, since, stop):
    process = subprocess.Popen([docker, "logs", "--follow", "--timestamps", "--since", since, container],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
    selector = selectors.DefaultSelector()
    queue = deque()
    pending = 0
    framers = {}
    for name, pipe in (("stdout", process.stdout), ("stderr", process.stderr)):
        os.set_blocking(pipe.fileno(), False)
        selector.register(pipe, selectors.EVENT_READ, name)
        framers[name] = Framer()
    connection.setblocking(False)
    connection.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 65536)
    next_check = time.monotonic() + 15
    next_ping = time.monotonic() + 1
    pipes = 2
    last_progress = time.monotonic()

    def enqueue(frame):
        nonlocal pending
        payload = encode(frame)
        if pending + len(payload) > QUEUE_BYTES:
            raise OSError("Source pipe capacity exceeded")
        queue.append(memoryview(payload))
        pending += len(payload)

    try:
        while not stop.is_set() and (pipes or queue):
            if queue:
                try:
                    sent = connection.send(queue[0])
                    if not sent:
                        raise OSError("Source pipe disconnected")
                    pending -= sent
                    last_progress = time.monotonic()
                    if sent == len(queue[0]):
                        queue.popleft()
                    else:
                        queue[0] = queue[0][sent:]
                except BlockingIOError:
                    if time.monotonic() - last_progress > 5:
                        raise OSError("Source pipe stalled")
            for key, _ in selector.select(0.01 if queue else 0.25):
                chunk = os.read(key.fd, 16384)
                if not chunk:
                    if framers[key.data].buffer or framers[key.data].dropping:
                        enqueue({"kind": "omit"})
                    selector.unregister(key.fileobj)
                    pipes -= 1
                    continue
                for raw in framers[key.data].feed(chunk):
                    if raw is None:
                        enqueue({"kind": "omit"})
                    else:
                        enqueue({"kind": "line", "stream": key.data,
                                 "data": base64.b64encode(raw).decode("ascii")})
            now = time.monotonic()
            if now >= next_ping:
                enqueue({"kind": "contact"})
                next_ping = now + 1
            if now >= next_check:
                if container_id(docker, container) != identity:
                    raise OSError("Source container changed")
                next_check = now + 15
    finally:
        selector.close()
        stop_process(process)


def read_source(socket_path, docker="/usr/bin/docker", container="api-gateway", stop=None):
    stop = stop or threading.Event()
    delay = 1
    while not stop.is_set():
        connection = None
        started = time.monotonic()
        try:
            connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            connection.settimeout(5)
            connection.connect(str(socket_path))
            identity = container_id(docker, container)
            connection.sendall(encode({"kind": "hello", "container": identity}))
            since = receive_reply(connection)
            follow(docker, container, identity, connection, since, stop)
        except (OSError, ValueError, subprocess.SubprocessError):
            # Deliberately no exception text: Docker diagnostics can contain raw values.
            pass
        finally:
            if connection:
                connection.close()
        if time.monotonic() - started >= 30:
            delay = 1
        if stop.wait(delay):
            break
        delay = min(delay * 2, 30)


def write_store(directory, socket_path, stop=None, socket_group=None):
    stop = stop or threading.Event()
    store = Store(directory)
    socket_path = Path(socket_path)
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    selector = selectors.DefaultSelector()
    connection = None
    buffer = bytearray()
    ready = False
    last_frame = time.monotonic()
    try:
        if socket_group:
            pipe_gid = grp.getgrnam(socket_group).gr_gid
            os.chown(socket_path.parent, -1, pipe_gid)
            os.chmod(socket_path.parent, 0o710)
        socket_path.unlink(missing_ok=True)
        listener.bind(str(socket_path))
        if socket_group:
            os.chown(socket_path, -1, pipe_gid)
        os.chmod(socket_path, 0o620)
        listener.listen(1)
        listener.setblocking(False)
        selector.register(listener, selectors.EVENT_READ, "listen")
        next_tick = time.monotonic() + 1
        while not stop.is_set():
            for key, _ in selector.select(0.25):
                if key.data == "listen":
                    candidate, _ = listener.accept()
                    if connection:
                        candidate.close()
                        continue
                    connection = candidate
                    connection.setblocking(False)
                    selector.register(connection, selectors.EVENT_READ, "source")
                    buffer.clear()
                    ready = False
                    last_frame = time.monotonic()
                    continue
                try:
                    chunk = connection.recv(FRAME_BYTES)
                    if not chunk:
                        raise OSError("Source pipe disconnected")
                    last_frame = time.monotonic()
                    buffer.extend(chunk)
                    while b"\n" in buffer:
                        line, _, rest = buffer.partition(b"\n")
                        buffer[:] = rest
                        if len(line) > FRAME_BYTES:
                            raise ValueError("Oversize source frame")
                        frame = json.loads(line)
                        kind = frame["kind"]
                        if not ready:
                            if kind != "hello" or not re.fullmatch(r"[0-9a-f]{64}", frame["container"]):
                                raise ValueError("Invalid source handshake")
                            since = store.connect(frame["container"])
                            connection.sendall(encode({"since": since}))
                            ready = True
                        elif kind == "line" and frame["stream"] in {"stdout", "stderr"}:
                            raw = base64.b64decode(frame["data"], validate=True)
                            if len(raw) > MAX_LINE_BYTES:
                                raise ValueError("Oversize source line")
                            store.process(raw, frame["stream"])
                        elif kind == "omit":
                            store.omit()
                        elif kind == "contact":
                            from .store import stamp
                            store.last_contact = stamp(store.clock())
                        else:
                            raise ValueError("Invalid source frame")
                    if len(buffer) > FRAME_BYTES:
                        raise ValueError("Oversize source frame")
                except (OSError, ValueError, KeyError, TypeError):
                    selector.unregister(connection)
                    connection.close()
                    connection = None
                    buffer.clear()
                    store.disconnect()
            now = time.monotonic()
            if connection and now - last_frame > 10:
                selector.unregister(connection)
                connection.close()
                connection = None
                buffer.clear()
                store.disconnect()
            if now >= next_tick:
                store.tick()
                next_tick = now + 1
    finally:
        if connection:
            connection.close()
        listener.close()
        selector.close()
        socket_path.unlink(missing_ok=True)
        store.close()


def install_signals(stop):
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda _signum, _frame: stop.set())

"""Run with python3 -B -m gateway_log_collector {writer,reader,validate}."""
import argparse
import sys
import threading

from .runtime import install_signals, read_source, write_store
from .schema import validate_directory


def main():
    parser = argparse.ArgumentParser(description="Collect only sanitized api-gateway logs")
    commands = parser.add_subparsers(dest="command", required=True)
    writer = commands.add_parser("writer")
    writer.add_argument("--out-dir", default="/var/lib/tpi-log-view/sanitized")
    writer.add_argument("--socket", default="/run/gateway-log-collector/source.sock")
    writer.add_argument("--socket-group")
    reader = commands.add_parser("reader")
    reader.add_argument("--socket", default="/run/gateway-log-collector/source.sock")
    reader.add_argument("--docker", default="/usr/bin/docker")
    reader.add_argument("--container", default="api-gateway")
    validate = commands.add_parser("validate")
    validate.add_argument("directory")
    args = parser.parse_args()
    stop = threading.Event()
    install_signals(stop)
    try:
        if args.command == "writer":
            write_store(args.out_dir, args.socket, stop, args.socket_group)
        elif args.command == "reader":
            read_source(args.socket, args.docker, args.container, stop)
        else:
            result = validate_directory(args.directory)
            print(f'Valid Layer 1 store: {len(result["segments"])} segments')
    except (OSError, ValueError):
        print("Collector operation failed; inspect permissions and sanitized store integrity", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

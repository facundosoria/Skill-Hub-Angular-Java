import { vi } from 'vitest';
import { EMPTY_FILTERS } from './infra-logs.models';
import { GatewayLogStream, LogStreamCallbacks } from './infra-logs.stream';
import { coldLogStatus, FakeLogSource, logEntry, logStatus } from './infra-logs.fixtures';

describe('Gateway log SSE wrapper', () => {
  let sources: FakeLogSource[];
  let callbacks: LogStreamCallbacks;
  let cursor: string;
  let stream: GatewayLogStream;
  beforeEach(() => {
    vi.useFakeTimers(); sources = []; cursor = 'g7:150';
    callbacks = { cursor: () => cursor, logs: vi.fn((_entries, id) => { cursor = id; }),
      checkpoint: vi.fn(id => { cursor = id; }), status: vi.fn(), gap: vi.fn(), reset: vi.fn(), revoked: vi.fn(),
      recover: vi.fn(async () => 0), retry: vi.fn() };
    stream = new GatewayLogStream(url => { const source = new FakeLogSource(url); sources.push(source); return source; }, EMPTY_FILTERS, callbacks, () => 0.5);
    stream.start();
  });
  afterEach(() => { stream.stop(); vi.useRealTimers(); });

  it('passes cold nullable status to the store without confirming its inherited ID', () => {
    sources[0].emit('status', coldLogStatus(), 'g7:999');
    expect(callbacks.status).toHaveBeenCalledWith(coldLogStatus()); expect(cursor).toBe('g7:150');
    expect(callbacks.recover).not.toHaveBeenCalled();
  });
  it('passes unknown source status to the view without triggering transport recovery', () => {
    const status = { ...logStatus(), ...JSON.parse('{"sourceStatus":"unexpected"}') };
    sources[0].emit('status', status);
    expect(callbacks.status).toHaveBeenCalledWith(status); expect(callbacks.recover).not.toHaveBeenCalled();
  });
  it('reopens a new source with the last applied checkpoint, never inherited status IDs', async () => {
    sources[0].emit('logs', { entries: [logEntry(151)] }, 'g7:151');
    sources[0].emit('checkpoint', '', 'g7:160');
    sources[0].emit('status', logStatus(), 'g7:999');
    sources[0].emit('error');
    expect(sources[0].closed).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(sources[1].url).toContain('after=g7%3A160');
    expect(cursor).toBe('g7:160');
  });
  it('uses the 3/6/12/30 second backoff and stops pending reconnects', async () => {
    for (const delay of [3000, 6000, 12000, 30000]) {
      const count = sources.length;
      sources[count - 1].emit('error');
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(sources).toHaveLength(count);
      await vi.advanceTimersByTimeAsync(1);
      expect(sources).toHaveLength(count + 1);
    }
    sources.at(-1)!.emit('error'); stream.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sources).toHaveLength(5);
  });
  it('recovers after 45 seconds without status even when logs arrive', async () => {
    await vi.advanceTimersByTimeAsync(44_000);
    sources[0].emit('logs', { entries: [logEntry(151)] }, 'g7:151');
    await vi.advanceTimersByTimeAsync(1000);
    expect(sources[0].closed).toBe(true);
    expect(callbacks.recover).toHaveBeenCalledOnce();
  });
  it('renews the watchdog on status and resets backoff after a healthy heartbeat', async () => {
    sources[0].emit('error'); await vi.advanceTimersByTimeAsync(3000);
    sources[1].emit('status', logStatus()); await vi.advanceTimersByTimeAsync(44_000);
    sources[1].emit('status', logStatus()); await vi.advanceTimersByTimeAsync(2000);
    expect(sources[1].closed).toBe(false);
    sources[1].emit('error'); await vi.advanceTimersByTimeAsync(3000);
    expect(sources).toHaveLength(3);
  });
  it('does not confirm malformed or unapplied batches', async () => {
    sources[0].emit('logs', { entries: [{ id: 'g7:151' }] }, 'g7:151');
    await vi.advanceTimersByTimeAsync(3000);
    expect(callbacks.logs).not.toHaveBeenCalled();
    expect(sources[1].url).toContain('after=g7%3A150');
  });
  it.each(['gap', 'reset', 'access-revoked'])('closes on %s without confirming its ID', type => {
    sources[0].emit(type, { after: 'g7:150', through: 'g7:200' }, 'g7:999');
    expect(sources[0].closed).toBe(true);
    expect(cursor).toBe('g7:150');
    expect(type === 'gap' ? callbacks.gap : type === 'reset' ? callbacks.reset : callbacks.revoked).toHaveBeenCalledOnce();
  });
  it.each([[0, 2400], [1, 3600]])('keeps reconnect jitter within twenty percent (%s)', async (random, delay) => {
    stream.stop();
    stream = new GatewayLogStream(url => { const source = new FakeLogSource(url); sources.push(source); return source; }, EMPTY_FILTERS, callbacks, () => random);
    stream.start(); sources.at(-1)!.emit('error');
    await vi.advanceTimersByTimeAsync(delay - 1); expect(sources).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1); expect(sources).toHaveLength(3);
  });
  it('respects recovery admission delays and never retries after stop', async () => {
    callbacks.recover = vi.fn(async () => 60_000);
    sources[0].emit('error'); await vi.advanceTimersByTimeAsync(59_999);
    expect(sources).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); expect(sources).toHaveLength(2);
  });
  it('encodes literal filters without regex or router state', () => {
    stream.stop();
    stream = new GatewayLogStream(url => { sources.push(new FakeLogSource(url)); return sources.at(-1)!; },
      { ...EMPTY_FILTERS, levels: ['ERROR', 'WARN'], q: '<b>&text', traceId: 'A'.repeat(32),
        route: '/api/example', methods: ['GET', 'POST'], statuses: ['4xx'], minDurationMs: 501 }, callbacks);
    stream.start();
    const query = new URL(sources.at(-1)!.url, 'http://fixture.invalid').searchParams;
    expect(query.get('q')).toBe('<b>&text'); expect(query.get('traceId')).toBe('A'.repeat(32));
    expect(query.get('levels')).toBe('ERROR,WARN');
    expect(query.get('route')).toBe('/api/example'); expect(query.get('method')).toBe('GET,POST');
    expect(query.get('status')).toBe('4xx'); expect(query.get('minDurationMs')).toBe('501');
  });
});

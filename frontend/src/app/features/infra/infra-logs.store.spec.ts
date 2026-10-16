import { HttpErrorResponse, HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { coldLogPage, coldLogStatus, FakeLogSource, logEntry, logPage, logStatus } from './infra-logs.fixtures';
import { InfraLogsStore, retryAfter } from './infra-logs.store';
import { LOG_EVENT_SOURCE } from './infra-logs.stream';
import { EMPTY_FILTERS } from './infra-logs.models';

const BASE = '/api/infra/logs/api-gateway';
async function settle() { for (let index = 0; index < 12; index++) await Promise.resolve(); }

describe('Gateway log data store', () => {
  let store: InfraLogsStore;
  let http: HttpTestingController;
  let sources: FakeLogSource[];
  beforeEach(() => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0.5); sources = [];
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), InfraLogsStore,
      { provide: LOG_EVENT_SOURCE, useValue: (url: string) => { const source = new FakeLogSource(url); sources.push(source); return source; } }] });
    store = TestBed.inject(InfraLogsStore); http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { store.destroy(); http.verify(); vi.restoreAllMocks(); vi.useRealTimers(); });
  async function start() {
    store.open(); const request = http.expectOne(req => req.url === BASE);
    expect(request.request.params.get('limit')).toBe('150'); expect(request.request.withCredentials).toBe(true);
    request.flush(logPage()); await settle();
  }
  it('accepts a cold JSON snapshot without errors or SSE and retries until a healthy snapshot', async () => {
    store.open(); http.expectOne(req => req.url === BASE).flush(coldLogPage()); await settle();
    expect(store.status()).toEqual(coldLogStatus()); expect(store.errorCode()).toBeNull();
    expect(store.connection()).toBe('starting'); expect(sources).toHaveLength(0);
    await store.loadOlder(); http.expectNone(req => req.url.startsWith(BASE));
    await vi.advanceTimersByTimeAsync(5000);
    let request = http.expectOne(req => req.url === BASE);
    expect(request.request.params.has('after')).toBe(false); expect(request.request.params.has('through')).toBe(false);
    request.flush(coldLogPage()); await settle(); expect(store.errorCode()).toBeNull(); expect(sources).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5000);
    request = http.expectOne(req => req.url === BASE); request.flush(logPage()); await settle();
    expect(store.status()?.sourceStatus).toBe('healthy'); expect(store.entries()).toHaveLength(1);
    expect(sources).toHaveLength(1); expect(sources[0].url).toContain('after=g7%3A150');
  });
  it.each(['recovery', 'resume', 'polling', 'heartbeat'])('waits for a fresh snapshot on cold status during %s', async path => {
    await start();
    if (path === 'polling') {
      for (const delay of [3000, 6000, 12000, 30000]) {
        sources.at(-1)!.emit('error'); http.expectOne(BASE + '/status').flush(logStatus()); await settle();
        await vi.advanceTimersByTimeAsync(delay);
      }
      sources.at(-1)!.emit('error'); http.expectOne(BASE + '/status').flush(logStatus()); await settle();
      await vi.advanceTimersByTimeAsync(5000);
    } else if (path === 'resume') { store.pause(); store.resume(); }
    else if (path === 'heartbeat') { sources[0].emit('status', coldLogStatus()); }
    else { sources[0].emit('error'); }
    if (path !== 'heartbeat') { http.expectOne(BASE + '/status').flush(coldLogStatus()); await settle(); }
    const count = sources.length;
    expect(store.status()?.sourceStatus).toBe('starting'); expect(store.errorCode()).toBeNull();
    expect(store.connection()).toBe('starting'); expect(sources.at(-1)!.closed).toBe(true);
    http.expectNone(req => req.url === BASE);
    await vi.advanceTimersByTimeAsync(5000);
    const request = http.expectOne(req => req.url === BASE);
    expect(request.request.params.has('after')).toBe(false);
    request.flush(logPage()); await settle(); expect(sources).toHaveLength(count + 1);
    expect(sources.at(-1)!.url).toContain('after=g7%3A150'); expect(store.errorCode()).toBeNull();
  });
  it.each(['history', 'catch-up', 'paused history'])('handles a cold JSON page during %s without confirming a null cursor', async path => {
    await start();
    if (path === 'paused history') store.pause();
    let history: Promise<void> | undefined;
    if (path === 'catch-up') {
      sources[0].emit('gap', { code: 'REPLAY_LIMIT', after: 'g7:150', through: 'g7:200' });
    } else history = store.loadOlder();
    http.expectOne(req => req.url === BASE).flush(coldLogPage()); await history; await settle();
    expect(store.status()?.headCursor).toBeNull(); expect(store.errorCode()).toBeNull();
    expect(store.hasMoreBefore()).toBe(false); expect(sources).toHaveLength(1); expect(sources[0].closed).toBe(true);
    if (path === 'paused history') {
      expect(store.connection()).toBe('paused');
      await vi.advanceTimersByTimeAsync(5000); http.expectNone(req => req.url.startsWith(BASE));
      await vi.advanceTimersByTimeAsync(10_000);
      http.expectOne(BASE + '/status').flush(coldLogStatus()); await settle();
      expect(store.connection()).toBe('paused');
    } else {
      expect(store.connection()).toBe('starting'); await vi.advanceTimersByTimeAsync(5000);
      const request = http.expectOne(req => req.url === BASE);
      expect(request.request.params.has('after')).toBe(false); expect(request.request.params.has('through')).toBe(false);
      request.flush(logPage()); await settle(); expect(sources).toHaveLength(2);
    }
  });
  it('cancels cold snapshot retries while hidden, paused or destroyed', async () => {
    store.open(); http.expectOne(req => req.url === BASE).flush(coldLogPage()); await settle();
    store.setVisible(false); await vi.advanceTimersByTimeAsync(60_000); http.expectNone(req => req.url.startsWith(BASE));
    store.setVisible(true); http.expectOne(BASE + '/status').flush(coldLogStatus()); await settle();
    store.pause(); await vi.advanceTimersByTimeAsync(15_000);
    http.expectOne(BASE + '/status').flush(coldLogStatus()); await settle();
    expect(store.connection()).toBe('paused'); expect(store.errorCode()).toBeNull(); expect(sources).toHaveLength(0);
    store.resume(); http.expectOne(BASE + '/status').flush(coldLogStatus()); await settle();
    store.destroy(); await vi.advanceTimersByTimeAsync(60_000); http.expectNone(req => req.url.startsWith(BASE));
  });
  it('opens SSE strictly after the snapshot head and deduplicates replayed IDs', async () => {
    await start(); expect(sources[0].url).toContain('after=g7%3A150');
    sources[0].emit('logs', { entries: [logEntry(150), logEntry(151)] }, 'g7:151');
    sources[0].emit('logs', { entries: [logEntry(151)] }, 'g7:151');
    expect(store.entries().map(entry => entry.id)).toEqual(['g7:150', 'g7:151']);
  });
  it('jumps to a timestamp without opening SSE and returns to live with a fresh head snapshot', async () => {
    store.jumpTo('2026-10-14T06:50:58.000Z');
    const historical = http.expectOne(req => req.url === BASE);
    expect(historical.request.params.get('at')).toBe('2026-10-14T06:50:58.000Z');
    historical.flush(logPage({ entries: [logEntry(149), logEntry(150)], hasMoreAfter: true })); await settle();
    expect(store.historyAt()).toBe('2026-10-14T06:50:58.000Z'); expect(store.connection()).toBe('paused');
    expect(store.hasMoreAfter()).toBe(true); expect(sources).toHaveLength(0);
    store.goLive(); http.expectOne(req => req.url === BASE).flush(logPage()); await settle();
    expect(store.historyAt()).toBeNull(); expect(sources).toHaveLength(1); expect(sources[0].url).toContain('after=g7%3A150');
  });
  it('keeps history before/through independent of live checkpoints and deduplicates history', async () => {
    await start(); sources[0].emit('checkpoint', '', 'g7:180');
    const load = store.loadOlder(); const request = http.expectOne(req => req.url === BASE);
    expect(request.request.params.get('before')).toBe('g7:150'); expect(request.request.params.get('through')).toBe('g7:150');
    request.flush(logPage({ entries: [logEntry(149), logEntry(150)], nextBefore: 'g7:149' }));
    await load; expect(store.entries().map(entry => entry.id)).toEqual(['g7:149', 'g7:150']);
  });
  it('reconnects from the applied checkpoint after diagnosing a native SSE failure', async () => {
    await start(); sources[0].emit('checkpoint', '', 'g7:160'); sources[0].emit('error');
    http.expectOne(BASE + '/status').flush(logStatus({ headCursor: 'g7:160' })); await settle();
    await vi.advanceTimersByTimeAsync(3000);
    expect(sources[0].closed).toBe(true); expect(sources[1].url).toContain('after=g7%3A160');
  });
  it('fills a replay gap with forward pages and a fixed through cursor before reopening', async () => {
    await start(); sources[0].emit('gap', { code: 'REPLAY_LIMIT', after: 'g7:150', through: 'g7:200' });
    let request = http.expectOne(req => req.url === BASE);
    expect(request.request.params.get('after')).toBe('g7:150'); expect(request.request.params.get('through')).toBe('g7:200');
    request.flush(logPage({ entries: [logEntry(151)], nextAfter: 'g7:180', hasMoreAfter: true })); await settle();
    request = http.expectOne(req => req.url === BASE);
    expect(request.request.params.get('after')).toBe('g7:180'); expect(request.request.params.get('through')).toBe('g7:200');
    request.flush(logPage({ entries: [logEntry(200)], nextAfter: 'g7:200' })); await settle();
    expect(sources[1].url).toContain('after=g7%3A200'); expect(store.discontinuity()).toBe('gap');
    expect(store.entries().map(entry => entry.id)).toEqual(['g7:150', 'g7:151', 'g7:200']);
  });
  it('replaces the window after a reset with a new generation', async () => {
    await start(); sources[0].emit('reset', { code: 'CURSOR_EXPIRED' });
    http.expectOne(req => req.url === BASE).flush(logPage({ generation: 'g8', headCursor: 'g8:1', oldestCursor: 'g8:1',
      nextAfter: 'g8:1', nextBefore: 'g8:1', entries: [logEntry(1, { id: 'g8:1' })] })); await settle();
    expect(store.entries().map(entry => entry.id)).toEqual(['g8:1']); expect(store.discontinuity()).toBe('reset');
    expect(sources[1].url).toContain('after=g8%3A1');
  });
  it('gets a recent snapshot when a history cursor expires with HTTP 409', async () => {
    await start(); const load = store.loadOlder();
    http.expectOne(req => req.url === BASE).flush({ code: 'CURSOR_EXPIRED' }, { status: 409, statusText: 'Conflict' }); await settle();
    http.expectOne(req => req.url === BASE).flush(logPage()); await load; await settle();
    expect(store.discontinuity()).toBe('reset'); expect(sources).toHaveLength(2);
  });
  it('cancels obsolete filter requests and sends only validated literal filters', async () => {
    store.open(); const previous = http.expectOne(req => req.url === BASE);
    store.open({ ...EMPTY_FILTERS, levels: ['WARN', 'ERROR'], q: '<b>literal</b>', traceId: 'A'.repeat(32) });
    expect(previous.cancelled).toBe(true);
    const request = http.expectOne(req => req.url === BASE);
    expect(request.request.params.get('q')).toBe('<b>literal</b>'); expect(request.request.params.get('traceId')).toBe('A'.repeat(32));
    expect(request.request.params.get('levels')).toBe('WARN,ERROR');
    request.flush(logPage({ entries: [] })); await settle();
    expect(store.entries()).toEqual([]); expect(sources).toHaveLength(1);
    store.open({ ...EMPTY_FILTERS, q: 'x'.repeat(121) }); http.expectNone(req => req.url === BASE);
    expect(store.errorCode()).toBe('invalid');
  });
  it('closes SSE while paused, counts pending ingestion and catches up on resume', async () => {
    await start(); store.pause(); expect(sources[0].closed).toBe(true);
    await vi.advanceTimersByTimeAsync(15_000);
    http.expectOne(BASE + '/status').flush(logStatus({ headCursor: 'g7:153' })); await settle();
    expect(store.connection()).toBe('paused'); expect(store.newCount()).toBe(3); expect(store.entries()).toHaveLength(1);
    store.resume(); http.expectOne(BASE + '/status').flush(logStatus({ headCursor: 'g7:153' })); await settle();
    http.expectOne(req => req.url === BASE).flush(logPage({ entries: [logEntry(151), logEntry(152), logEntry(153)], nextAfter: 'g7:153' })); await settle();
    expect(sources[1].url).toContain('after=g7%3A153'); expect(store.entries()).toHaveLength(4);
  });
  it('closes connections while hidden and recovers when visible', async () => {
    await start(); store.setVisible(false); expect(sources[0].closed).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000); http.expectNone(BASE + '/status');
    store.setVisible(true); http.expectOne(BASE + '/status').flush(logStatus()); await settle();
    expect(sources).toHaveLength(2);
  });
  it('respects Retry-After on HTTP 429 without polling or early retries', async () => {
    store.open(); http.expectOne(req => req.url === BASE).flush({ code: 'STREAM_LIMIT' },
      { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '15' } }); await settle();
    expect(store.connection()).toBe('blocked'); expect(store.retrySeconds()).toBe(15);
    await vi.advanceTimersByTimeAsync(14_999); http.expectNone(req => req.url.startsWith(BASE)); expect(sources).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); http.expectOne(req => req.url === BASE).flush(logPage()); await settle();
    expect(sources).toHaveLength(1);
  });
  it('uses accountBlockedUntil to classify SSE admission failures without bypassing quotas', async () => {
    await start(); sources[0].emit('error');
    http.expectOne(BASE + '/status').flush(logStatus({ accountBlockedUntil: new Date(Date.now() + 20_000).toISOString() })); await settle();
    expect(store.connection()).toBe('blocked'); await vi.advanceTimersByTimeAsync(19_999);
    http.expectNone(req => req.url.startsWith(BASE)); expect(sources).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); http.expectOne(BASE + '/status').flush(logStatus()); await settle();
    expect(sources).toHaveLength(2);
  });
  it('cancels concurrent history when stream admission returns HTTP 429', async () => {
    await start(); const load = store.loadOlder(); const history = http.expectOne(req => req.url === BASE);
    sources[0].emit('error'); http.expectOne(BASE + '/status').flush({},
      { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '15' } }); await settle();
    expect(history.cancelled).toBe(true); await load;
    expect(store.connection()).toBe('blocked'); await vi.advanceTimersByTimeAsync(14_999);
    http.expectNone(req => req.url.startsWith(BASE));
    await vi.advanceTimersByTimeAsync(1); http.expectOne(BASE + '/status').flush(logStatus()); await settle();
    expect(sources).toHaveLength(2);
  });
  it('accepts HTTP-date Retry-After and applies a conservative default', () => {
    const date = new Date(Date.now() + 15_000).toUTCString();
    const delay = retryAfter(new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': date }) }));
    expect(delay).toBeGreaterThanOrEqual(14_000); expect(delay).toBeLessThanOrEqual(15_000);
    expect(retryAfter(new HttpErrorResponse({ status: 429 }))).toBe(30_000);
  });
  it('falls back to incremental polling with jitter after repeated transport failures', async () => {
    await start();
    for (const delay of [3000, 6000, 12000, 30000]) {
      sources.at(-1)!.emit('error'); http.expectOne(BASE + '/status').flush(logStatus()); await settle();
      await vi.advanceTimersByTimeAsync(delay);
    }
    sources.at(-1)!.emit('error'); http.expectOne(BASE + '/status').flush(logStatus()); await settle();
    expect(store.connection()).toBe('polling'); await vi.advanceTimersByTimeAsync(5000);
    http.expectOne(BASE + '/status').flush(logStatus({ headCursor: 'g7:151' })); await settle();
    const request = http.expectOne(req => req.url === BASE);
    expect(request.request.params.get('after')).toBe('g7:150');
    request.flush(logPage({ entries: [logEntry(151)], nextAfter: 'g7:151' })); await settle();
    expect(store.entries()).toHaveLength(2); expect(store.connection()).toBe('polling');
  });
  it.each([401, 403])('clears retained data and stops retries on HTTP %s', async status => {
    await start(); sources[0].emit('error');
    http.expectOne(BASE + '/status').flush({}, { status, statusText: 'Denied' }); await settle();
    expect(store.connection()).toBe('revoked'); expect(store.entries()).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000); http.expectNone(req => req.url.startsWith(BASE));
  });
  it('does not restart revoked connections on visibility changes', async () => {
    await start(); sources[0].emit('access-revoked', { code: 'SESSION_INVALID' });
    store.setVisible(false); store.setVisible(true);
    expect(store.connection()).toBe('revoked');
    await vi.advanceTimersByTimeAsync(60_000); http.expectNone(req => req.url.startsWith(BASE));
  });
  it('recovers a changed generation detected through status with a recent snapshot', async () => {
    await start(); sources[0].emit('error');
    http.expectOne(BASE + '/status').flush(logStatus({ generation: 'g8', headCursor: 'g8:1', oldestCursor: 'g8:1' })); await settle();
    http.expectOne(req => req.url === BASE).flush(logPage({ generation: 'g8', headCursor: 'g8:1', oldestCursor: 'g8:1',
      nextAfter: 'g8:1', nextBefore: 'g8:1', entries: [logEntry(1, { id: 'g8:1' })] })); await settle();
    expect(store.discontinuity()).toBe('reset'); expect(sources[1].url).toContain('after=g8%3A1');
  });
  it('clears retained data and stops on access-revoked', async () => {
    await start(); sources[0].emit('access-revoked', { code: 'SESSION_INVALID' });
    expect(store.entries()).toEqual([]); expect(store.errorCode()).toBe('session');
    await vi.advanceTimersByTimeAsync(60_000); http.expectNone(req => req.url.startsWith(BASE));
  });
  it('marks unavailable logs on HTTP 404 without impacting the state API', async () => {
    store.open(); http.expectOne(req => req.url === BASE).flush({}, { status: 404, statusText: 'Not Found' }); await settle();
    expect(store.unavailable()).toBe(true); expect(sources).toHaveLength(0);
  });
  it('reports HTTP 503 and exposes source, capacity, retention and empty states', async () => {
    store.open(); http.expectOne(req => req.url === BASE).flush({}, { status: 503, statusText: 'Unavailable' }); await settle();
    expect(store.connection()).toBe('error'); expect(store.errorCode()).toBe('unavailable');
    store.refresh(); http.expectOne(req => req.url === BASE).flush(logPage({ entries: [], sourceStatus: 'starting', capacityLimited: true })); await settle();
    sources[0].emit('status', logStatus({ sourceStatus: 'disconnected', retentionTruncated: true }));
    expect(store.entries()).toEqual([]); expect(store.status()?.sourceStatus).toBe('disconnected');
    expect(store.status()?.retentionTruncated).toBe(true); expect(store.capacityLimited()).toBe(true); expect(store.connection()).toBe('live');
  });
  it('prunes six-hour-old browser entries on status even if coverage is stale', async () => {
    await start(); await vi.advanceTimersByTimeAsync(1000);
    sources[0].emit('status', logStatus({ coverageStart: new Date(Date.now() + 1000).toISOString() }));
    expect(store.entries()).toEqual([]);
  });
});

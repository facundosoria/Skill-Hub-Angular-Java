import { LogEntry, LogPage, LogStatus } from './infra-logs.models';
import { LogEventSource } from './infra-logs.stream';

/** Synthetic fixtures for tests only; never imported by production code. */
export function logEntry(seq = 150, overrides: Partial<LogEntry> = {}): LogEntry {
  return { id: `g7:${seq}`, timestamp: new Date().toISOString(), level: 'INFO', logger: 'LoggingFilter',
    event: 'REQUEST_COMPLETED', traceId: '11111111111111111111111111111111', spanId: '2222222222222222',
    method: 'GET', route: '/api/example/{id}', status: 200, durationMs: 18, reason: null,
    lines: ['GET /api/example/{id} -> 200 (18 ms)'], redacted: true, ...overrides };
}
export function logStatus(overrides: Partial<LogStatus> = {}): LogStatus {
  return { sourceStatus: 'healthy', generation: 'g7', coverageStart: new Date(Date.now() - 3600_000).toISOString(),
    headCursor: 'g7:150', oldestCursor: 'g7:1', omittedCount: 2, retentionTruncated: false,
    activeStreams: 1, accountBlockedUntil: null, ...overrides };
}
export function logPage(overrides: Partial<LogPage> = {}): LogPage {
  return { service: 'api-gateway', generation: 'g7', generatedAt: new Date().toISOString(), retentionSeconds: 21600,
    coverageStart: new Date(Date.now() - 3600_000).toISOString(), sourceStatus: 'healthy',
    lastSourceContactAt: new Date().toISOString(), lastEventAt: new Date().toISOString(), policyVersion: 'r2-v1',
    capacityLimited: false, omittedCount: 2, headCursor: 'g7:150', oldestCursor: 'g7:1',
    nextBefore: 'g7:150', nextAfter: 'g7:150', hasMoreBefore: true, hasMoreAfter: false,
    entries: [logEntry()], ...overrides };
}
// Cold HTTP bodies follow the backend response shape with the clarified starting status.
export function coldLogStatus(): LogStatus {
  return JSON.parse('{"sourceStatus":"starting","generation":null,"coverageStart":null,"headCursor":null,"oldestCursor":null,"omittedCount":0,"retentionTruncated":false,"activeStreams":0,"accountBlockedUntil":null}');
}
export function coldLogPage(): LogPage {
  return JSON.parse('{"service":"api-gateway","generation":null,"generatedAt":"2026-10-14T06:51:00Z","retentionSeconds":21600,"coverageStart":null,"sourceStatus":"starting","lastSourceContactAt":null,"lastEventAt":null,"policyVersion":null,"capacityLimited":false,"omittedCount":0,"headCursor":null,"oldestCursor":null,"nextBefore":null,"nextAfter":null,"hasMoreBefore":false,"hasMoreAfter":false,"entries":[]}');
}
export class FakeLogSource implements LogEventSource {
  private listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();
  closed = false;
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close(): void { this.closed = true; }
  emit(type: string, data: unknown = {}, id = ''): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data: typeof data === 'string' ? data : JSON.stringify(data), lastEventId: id }));
    }
  }
}

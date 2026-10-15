import { InjectionToken } from '@angular/core';
import { decodeEntries, isCursor, LogEntry, LogFilters, LogStatus } from './infra-logs.models';

export interface LogEventSource {
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}
export const LOG_EVENT_SOURCE = new InjectionToken<(url: string) => LogEventSource>('Gateway log event source', {
  providedIn: 'root', factory: () => url => new EventSource(url, { withCredentials: true }),
});
export interface LogStreamCallbacks {
  cursor(): string;
  logs(entries: LogEntry[], cursor: string): void;
  checkpoint(cursor: string): void;
  status(status: LogStatus): void;
  gap(after: string, through: string): void;
  reset(): void;
  revoked(): void;
  recover(attempt: number): Promise<number | null>;
  retry(delayMs: number): void;
}

/** Always closes failed sources; native reconnect must never confirm unapplied IDs. */
export class GatewayLogStream {
  private source?: LogEventSource;
  private timer?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private attempt = 0;
  private revision = 0;
  constructor(private factory: (url: string) => LogEventSource, private filters: LogFilters,
    private callbacks: LogStreamCallbacks, private random = Math.random) {}

  start(): void {
    if (this.stopped) return;
    const params = new URLSearchParams({ after: this.callbacks.cursor() });
    if (this.filters.levels.length) params.set('levels', this.filters.levels.join(','));
    if (this.filters.q) params.set('q', this.filters.q);
    if (this.filters.traceId) params.set('traceId', this.filters.traceId);
    const revision = ++this.revision;
    try {
      const source = this.factory(`/api/infra/logs/api-gateway/stream?${params}`);
      this.source = source;
      const listen = (type: string, handler: (event: MessageEvent<string>) => void) => {
        source.addEventListener(type, event => {
          if (this.stopped || this.source !== source || revision !== this.revision) return;
          try { handler(event); } catch { void this.fail(); }
        });
      };
      listen('logs', event => {
        if (!isCursor(event.lastEventId)) throw new Error('Invalid stream cursor');
        this.callbacks.logs(decodeEntries(JSON.parse(event.data).entries), event.lastEventId);
      });
      listen('checkpoint', event => {
        if (!isCursor(event.lastEventId)) throw new Error('Invalid checkpoint');
        this.callbacks.checkpoint(event.lastEventId);
      });
      listen('status', event => {
        const status = JSON.parse(event.data) as LogStatus;
        if (typeof status.sourceStatus !== 'string' || (status.headCursor !== null && !isCursor(status.headCursor))) {
          throw new Error('Invalid stream status');
        }
        this.callbacks.status(status);
        this.attempt = 0;
        this.armWatchdog();
      });
      listen('gap', event => {
        const gap = JSON.parse(event.data);
        if (!isCursor(gap.after) || !isCursor(gap.through)) throw new Error('Invalid gap');
        this.stop(); this.callbacks.gap(gap.after, gap.through);
      });
      listen('reset', () => { this.stop(); this.callbacks.reset(); });
      listen('access-revoked', () => { this.stop(); this.callbacks.revoked(); });
      listen('error', () => { void this.fail(); });
      this.armWatchdog();
    } catch { void this.fail(); }
  }
  private armWatchdog(): void {
    if (this.stopped) return;
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => void this.fail(), 45_000);
  }
  private closeSource(): void {
    this.source?.close(); this.source = undefined;
    clearTimeout(this.watchdog);
  }
  private async fail(): Promise<void> {
    if (this.stopped) return;
    this.closeSource();
    const revision = ++this.revision;
    const attempt = ++this.attempt;
    const backoff = [3000, 6000, 12000, 30000][Math.min(attempt - 1, 3)] * (0.8 + this.random() * 0.4);
    this.callbacks.retry(Math.round(backoff));
    try {
      const minimum = await this.callbacks.recover(attempt);
      if (this.stopped || revision !== this.revision || minimum === null) return;
      const delay = Math.max(Math.round(backoff), minimum);
      this.callbacks.retry(delay);
      this.timer = setTimeout(() => this.start(), delay);
    } catch {
      if (!this.stopped && revision === this.revision) this.timer = setTimeout(() => this.start(), backoff);
    }
  }
  stop(): void {
    this.stopped = true; ++this.revision;
    this.closeSource(); clearTimeout(this.timer);
  }
}

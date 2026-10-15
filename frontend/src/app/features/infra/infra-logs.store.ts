import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom, Observable, Subject, takeUntil } from 'rxjs';
import { InfraLogsApi } from './infra-logs.api';
import { LogBuffer } from './infra-logs.buffer';
import { compareCursors, decodeEntries, EMPTY_FILTERS, isCursor, LogConnection, LogEntry, LogFilters, LogPage, LogStatus, validFilters } from './infra-logs.models';
import { GatewayLogStream, LOG_EVENT_SOURCE } from './infra-logs.stream';

class StaleLogRequest extends Error {}

@Injectable()
export class InfraLogsStore {
  private api = inject(InfraLogsApi);
  private factory = inject(LOG_EVENT_SOURCE);
  private buffer = new LogBuffer();
  private cancel = new Subject<void>();
  private revision = 0;
  private stream?: GatewayLogStream;
  private timer?: ReturnType<typeof setTimeout>;
  private visible = true;
  private userPaused = false;
  private cursor = '';
  private through = '';
  private before: string | null = null;
  private filters: LogFilters = EMPTY_FILTERS;
  readonly entries = signal<LogEntry[]>([]);
  readonly connection = signal<LogConnection>('loading');
  readonly status = signal<LogStatus | null>(null);
  readonly lastEventAt = signal<string | null>(null);
  readonly capacityLimited = signal(false);
  readonly browserTruncated = signal(false);
  readonly discontinuity = signal<'gap' | 'reset' | null>(null);
  readonly newCount = signal(0);
  readonly retrySeconds = signal(0);
  readonly loadingHistory = signal(false);
  readonly hasMoreBefore = signal(false);
  readonly hasMoreAfter = signal(false);
  readonly historyAt = signal<string | null>(null);
  readonly unavailable = signal(false);
  readonly errorCode = signal<'unavailable' | 'session' | 'access' | 'invalid' | null>(null);

  open(filters: LogFilters = EMPTY_FILTERS): void {
    if (!validFilters(filters)) { this.errorCode.set('invalid'); return; }
    this.filters = { ...filters, levels: [...filters.levels], methods: [...filters.methods], statuses: [...filters.statuses] };
    this.historyAt.set(null); this.hasMoreAfter.set(false);
    this.userPaused = false;
    const revision = this.stopTransport();
    this.buffer.clear(); this.entries.set([]); this.cursor = ''; this.before = null;
    this.status.set(null); this.lastEventAt.set(null); this.newCount.set(0);
    this.capacityLimited.set(false); this.browserTruncated.set(false);
    this.hasMoreBefore.set(false); this.errorCode.set(null);
    this.connection.set('loading');
    void this.snapshot(revision).catch(error => this.handleError(error, revision));
  }
  refresh(): void { this.open(this.filters); }
  jumpTo(at: string): void {
    const revision = this.stopTransport();
    this.userPaused = true; this.historyAt.set(at); this.buffer.clear(); this.entries.set([]);
    this.cursor = ''; this.before = null; this.hasMoreBefore.set(false); this.hasMoreAfter.set(false);
    this.status.set(null); this.errorCode.set(null); this.connection.set('loading');
    void this.snapshot(revision, at).catch(error => this.handleError(error, revision));
  }
  goLive(): void { this.historyAt.set(null); this.userPaused = false; this.open(this.filters); }
  private async request<T>(request: Observable<T>, revision: number): Promise<T> {
    this.assertCurrent(revision);
    const value = await firstValueFrom(request.pipe(takeUntil(this.cancel)));
    if (revision !== this.revision) throw new StaleLogRequest();
    return value;
  }
  private assertCurrent(revision: number): void {
    if (revision !== this.revision) throw new StaleLogRequest();
  }
  private validatePage(page: LogPage): void {
    decodeEntries(page.entries);
    if (page.headCursor === null && page.oldestCursor === null && page.nextAfter === null &&
      page.nextBefore === null && !page.entries.length && !page.hasMoreBefore && !page.hasMoreAfter) return;
    if (!isCursor(page.headCursor) || !isCursor(page.nextAfter) || !isCursor(page.oldestCursor) ||
      (page.nextBefore !== null && !isCursor(page.nextBefore))) throw new Error('Invalid log page');
    for (const entry of page.entries) compareCursors(entry.id, page.headCursor);
  }
  private async snapshot(revision: number, at?: string): Promise<void> {
    const page = await this.request(this.api.page(this.filters, at ? { at } : {}), revision);
    this.assertCurrent(revision); this.validatePage(page);
    this.buffer.clear(); this.applyPage(page);
    this.cursor = page.headCursor ?? ''; this.through = page.headCursor ?? ''; this.before = page.nextBefore;
    this.hasMoreBefore.set(page.hasMoreBefore);
    this.hasMoreAfter.set(page.hasMoreAfter);
    if (page.headCursor === null) { this.waitForCollector(revision); return; }
    if (at) { this.cursor = page.nextAfter ?? page.headCursor; this.connection.set('paused'); }
    else if (this.visible && !this.userPaused) this.openStream();
  }
  private waitForCollector(revision: number): void {
    if (revision !== this.revision) return;
    revision = this.stopTransport();
    this.cursor = ''; this.through = ''; this.before = null; this.hasMoreBefore.set(false);
    this.errorCode.set(null); this.connection.set(this.userPaused ? 'paused' : this.visible ? 'starting' : 'hidden');
    if (this.userPaused) { this.watchPaused(revision); return; }
    if (!this.visible) return;
    this.timer = setTimeout(() => {
      void this.snapshot(revision).catch(error => this.handleError(error, revision));
    }, Math.round(5000 * (0.8 + Math.random() * 0.4)));
  }
  private applyPage(page: LogPage): void {
    const previous = this.status();
    this.status.set({ sourceStatus: page.sourceStatus, generation: page.generation,
      coverageStart: page.coverageStart, headCursor: page.headCursor, oldestCursor: page.oldestCursor,
      omittedCount: page.omittedCount, retentionTruncated: previous?.retentionTruncated ?? false,
      activeStreams: previous?.activeStreams ?? 0, accountBlockedUntil: previous?.accountBlockedUntil ?? null });
    this.capacityLimited.set(page.capacityLimited);
    this.lastEventAt.set(page.lastEventAt);
    this.merge(page.entries);
  }
  private merge(entries: LogEntry[]): void {
    const added = this.buffer.merge(entries, new Date(Math.max(Date.parse(this.status()?.coverageStart ?? '') || 0, Date.now() - 21600_000)).toISOString());
    this.entries.set(this.buffer.values()); this.browserTruncated.set(this.buffer.truncated);
    this.newCount.update(count => count + added);
  }
  private applyStatus(status: LogStatus): void {
    this.status.set(status);
    this.merge([]);
    if (this.userPaused && this.cursor && isCursor(status.headCursor)) {
      try {
        const delta = BigInt(status.headCursor.split(':')[1]) - BigInt(this.cursor.split(':')[1]);
        if (status.generation === this.cursor.split(':')[0]) this.newCount.set(Number(delta > 0n ? delta : 0n));
        else this.discontinuity.set('reset');
      } catch { this.discontinuity.set('reset'); }
    }
  }
  private confirmCursor(cursor: string): void {
    if (compareCursors(cursor, this.cursor) >= 0) this.cursor = cursor;
  }
  private openStream(revision = this.revision): void {
    if (revision !== this.revision || !this.visible || this.userPaused || this.connection() === 'revoked' || !isCursor(this.cursor)) return;
    this.stream?.stop();
    clearTimeout(this.timer);
    this.connection.set('connecting'); this.errorCode.set(null);
    this.stream = new GatewayLogStream(this.factory, this.filters, {
      cursor: () => this.cursor,
      logs: (entries, cursor) => {
        compareCursors(cursor, this.cursor);
        for (const entry of entries) {
          if (compareCursors(entry.id, cursor) > 0) throw new Error('Entry exceeds batch cursor');
        }
        this.merge(entries); this.confirmCursor(cursor);
        if (entries.length) this.lastEventAt.set(entries[entries.length - 1].timestamp);
      },
      checkpoint: cursor => this.confirmCursor(cursor),
      status: status => {
        if (status.headCursor === null) { this.applyStatus(status); this.waitForCollector(revision); return; }
        if (status.generation !== this.cursor.split(':')[0]) { this.discontinuity.set('reset'); this.refresh(); return; }
        this.applyStatus(status); this.connection.set('live');
      },
      gap: (_after, through) => {
        this.discontinuity.set('gap');
        void this.catchUp(revision, through).then(() => this.openStream(revision)).catch(error => this.handleError(error, revision));
      },
      reset: () => { this.discontinuity.set('reset'); this.refresh(); },
      revoked: () => this.revoke('session'),
      retry: delay => { if (this.connection() !== 'blocked') this.connection.set('reconnecting'); this.retrySeconds.set(Math.ceil(delay / 1000)); },
      recover: attempt => this.recoverStream(revision, attempt),
    });
    this.stream.start();
  }
  private async recoverStream(revision: number, attempt: number): Promise<number | null> {
    try {
      const status = await this.request(this.api.status(), revision);
      this.assertCurrent(revision); this.applyStatus(status);
      const blocked = this.blockedDelay(status);
      if (blocked > 0) { this.wait(revision, blocked); return null; }
      await this.catchUp(revision, status.headCursor);
      if (revision !== this.revision) return null;
      if (attempt >= 5) { this.startPolling(revision); return null; }
      return 0;
    } catch (error) {
      if (revision !== this.revision) return null;
      if (error instanceof HttpErrorResponse && error.status === 429) {
        this.wait(revision, retryAfter(error)); return null;
      }
      if (error instanceof HttpErrorResponse && [401, 403, 404, 409, 400].includes(error.status)) {
        this.handleError(error, revision); return null;
      }
      if (attempt >= 5) { this.startPolling(revision); return null; }
      return 0;
    }
  }
  private blockedDelay(status: LogStatus): number {
    return status.accountBlockedUntil ? Math.max(0, Date.parse(status.accountBlockedUntil) - Date.now()) : 0;
  }
  private async catchUp(revision: number, through: string | null): Promise<void> {
    if (through === null) { this.waitForCollector(revision); return; }
    if (!isCursor(through)) throw new Error('Invalid recovery cursor');
    if (this.cursor.split(':')[0] !== through.split(':')[0]) throw new HttpErrorResponse({ status: 409 });
    if (compareCursors(this.cursor, through) >= 0) return;
    let more = true;
    while (more) {
      const page = await this.request(this.api.page(this.filters, { after: this.cursor, through }), revision);
      this.assertCurrent(revision); this.validatePage(page);
      if (page.nextAfter === null) { this.applyPage(page); this.waitForCollector(revision); return; }
      if (compareCursors(page.nextAfter, this.cursor) <= 0 || compareCursors(page.nextAfter, through) > 0) {
        throw new Error('Recovery cursor did not advance');
      }
      this.applyPage(page); this.confirmCursor(page.nextAfter); more = page.hasMoreAfter;
    }
    this.confirmCursor(through);
  }
  private startPolling(revision: number): void {
    if (revision !== this.revision || !this.visible || this.userPaused) return;
    this.stream?.stop(); this.errorCode.set(null); this.connection.set('polling');
    this.timer = setTimeout(() => {
      void this.poll(revision).catch(error => this.handleError(error, revision));
    }, Math.round(5000 * (0.8 + Math.random() * 0.4)));
  }
  private async poll(revision: number): Promise<void> {
    const status = await this.request(this.api.status(), revision);
    this.assertCurrent(revision); this.applyStatus(status);
    const blocked = this.blockedDelay(status);
    if (blocked > 0) { this.wait(revision, blocked); return; }
    await this.catchUp(revision, status.headCursor);
    this.startPolling(revision);
  }
  loadOlder(): Promise<void> {
    if (this.loadingHistory() || !this.hasMoreBefore() || !this.before) return Promise.resolve();
    const revision = this.revision;
    this.loadingHistory.set(true);
    return this.request(this.api.page(this.filters, { before: this.before, through: this.through }), revision)
      .then(page => {
        this.assertCurrent(revision); this.validatePage(page);
        if (page.headCursor === null) { this.applyPage(page); this.waitForCollector(revision); return; }
        const previousCount = this.newCount();
        this.merge(page.entries); this.newCount.set(previousCount);
        this.before = page.nextBefore; this.hasMoreBefore.set(page.hasMoreBefore);
      })
      .catch(error => this.handleError(error, revision))
      .finally(() => { if (revision === this.revision) this.loadingHistory.set(false); });
  }
  loadNewer(): Promise<void> {
    if (this.loadingHistory() || !this.hasMoreAfter() || !this.cursor) return Promise.resolve();
    const revision = this.revision; this.loadingHistory.set(true);
    return this.request(this.api.page(this.filters, { after: this.cursor, through: this.status()?.headCursor ?? undefined }), revision)
      .then(page => {
        this.assertCurrent(revision); this.validatePage(page); this.merge(page.entries);
        this.cursor = page.nextAfter ?? this.cursor; this.hasMoreAfter.set(page.hasMoreAfter);
      })
      .catch(error => this.handleError(error, revision))
      .finally(() => { if (revision === this.revision) this.loadingHistory.set(false); });
  }
  pause(): void {
    this.userPaused = true; const revision = this.stopTransport();
    this.newCount.set(0); this.connection.set('paused');
    this.watchPaused(revision);
  }
  private watchPaused(revision: number): void {
    if (!this.visible) return;
    this.timer = setTimeout(() => {
      void this.request(this.api.status(), revision).then(status => {
        this.assertCurrent(revision); this.applyStatus(status);
        const blocked = this.blockedDelay(status);
        if (blocked > 0) { this.wait(revision, blocked); return; }
        this.connection.set('paused'); this.watchPaused(revision);
      }).catch(error => this.handleError(error, revision));
    }, 15_000);
  }
  resume(): void {
    if (this.userPaused) this.newCount.set(0);
    this.userPaused = false; const revision = this.stopTransport();
    this.connection.set('connecting');
    void this.request(this.api.status(), revision).then(async status => {
      this.assertCurrent(revision); this.applyStatus(status);
      const blocked = this.blockedDelay(status);
      if (blocked > 0) { this.wait(revision, blocked); return; }
      if (status.headCursor === null) this.waitForCollector(revision);
      else if (!this.cursor) await this.snapshot(revision);
      else { await this.catchUp(revision, status.headCursor); this.openStream(revision); }
    }).catch(error => this.handleError(error, revision));
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.connection() === 'revoked' || this.unavailable()) return;
    if (!visible) { this.stopTransport(); this.connection.set(this.userPaused ? 'paused' : 'hidden'); }
    else if (this.userPaused) { this.watchPaused(this.revision); }
    else if (this.connection() !== 'revoked') this.resume();
  }
  acknowledgeNew(): void { this.newCount.set(0); }
  private wait(revision: number, delay: number): void {
    if (revision !== this.revision) return;
    revision = this.stopTransport();
    this.connection.set('blocked'); this.retrySeconds.set(Math.ceil(delay / 1000));
    this.timer = setTimeout(() => {
      if (revision === this.revision) {
        if (this.userPaused) this.watchPaused(revision);
        else if (this.cursor) this.resume();
        else this.refresh();
      }
    }, delay);
  }
  private handleError(error: unknown, revision: number): void {
    if (revision !== this.revision || error instanceof StaleLogRequest) return;
    if (error instanceof HttpErrorResponse) {
      if (error.status === 401 || error.status === 403) { this.revoke(error.status === 401 ? 'session' : 'access'); return; }
      if (error.status === 404) { this.unavailable.set(true); this.stopTransport(); return; }
      if (error.status === 409) { this.discontinuity.set('reset'); this.refresh(); return; }
      if (error.status === 429) { this.wait(revision, retryAfter(error)); return; }
      if (error.status === 400) { this.errorCode.set('invalid'); this.connection.set('error'); return; }
    }
    this.errorCode.set('unavailable');
    this.connection.set('error');
    this.stream?.stop(); clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (revision === this.revision && this.visible && !this.userPaused) this.resume();
    }, error instanceof HttpErrorResponse ? retryAfter(error) : 6000);
  }
  private revoke(code: 'session' | 'access'): void {
    this.stopTransport(); this.buffer.clear(); this.entries.set([]); this.status.set(null);
    this.lastEventAt.set(null); this.newCount.set(0); this.errorCode.set(code); this.connection.set('revoked');
  }
  private stopTransport(): number {
    ++this.revision; this.stream?.stop(); this.stream = undefined; clearTimeout(this.timer);
    this.cancel.next(); this.loadingHistory.set(false);
    return this.revision;
  }
  destroy(): void { this.stopTransport(); this.cancel.complete(); this.buffer.clear(); this.entries.set([]); }
}
export function retryAfter(error: HttpErrorResponse): number {
  const value = error.headers.get('Retry-After');
  const seconds = value === null ? NaN : Number(value);
  if (Number.isFinite(seconds)) return Math.max(1000, seconds * 1000);
  const date = value ? Date.parse(value) : NaN;
  return Number.isFinite(date) ? Math.max(1000, date - Date.now()) : 30_000;
}

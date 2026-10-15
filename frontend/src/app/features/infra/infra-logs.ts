import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, OnDestroy, output, signal, untracked, viewChild } from '@angular/core';
import { I18n } from '../../core/i18n/i18n';
import { UI } from '../../shared/ui';
import { LogEntry, LogLevel, validFilters } from './infra-logs.models';
import { InfraLogsStore } from './infra-logs.store';

@Component({
  selector: 'app-infra-logs',
  imports: [...UI],
  providers: [InfraLogsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './infra-logs.html',
  styleUrl: './infra-logs.css',
})
export class InfraLogs implements OnDestroy {
  readonly store = inject(InfraLogsStore);
  private i18n = inject(I18n);
  readonly t = computed(() => this.i18n.t().infra.logs);
  readonly disabled = output<void>();
  readonly viewport = viewChild<ElementRef<HTMLDivElement>>('viewport');
  readonly detailPanel = viewChild<ElementRef<HTMLElement>>('detailPanel');
  readonly levels = signal<LogLevel[]>([]);
  readonly query = signal('');
  readonly traceId = signal('');
  readonly invalid = computed(() => !validFilters(this.filters()));
  readonly autoScroll = signal(true);
  readonly scrollTop = signal(0);
  readonly viewportHeight = signal(480);
  readonly accessible = signal(false);
  readonly pageIndex = signal(0);
  readonly selectedId = signal<string | null>(null);
  readonly selected = computed(() => this.store.entries().find(entry => entry.id === this.selectedId()));
  readonly copyResult = signal<'copied' | 'copyError' | null>(null);
  readonly rowHeight = 72;
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.store.entries().length / 150)));
  readonly rangeStart = computed(() => this.accessible() ? Math.min(this.pageIndex(), this.pageCount() - 1) * 150 :
    Math.max(0, Math.floor(this.scrollTop() / this.rowHeight) - 5));
  readonly visibleEntries = computed(() => this.store.entries().slice(this.rangeStart(),
    this.rangeStart() + (this.accessible() ? 150 : Math.ceil(this.viewportHeight() / this.rowHeight) + 10)));
  readonly topSpace = computed(() => this.accessible() ? 0 : this.rangeStart() * this.rowHeight);
  readonly bottomSpace = computed(() => this.accessible() ? 0 :
    Math.max(0, this.store.entries().length - this.rangeStart() - this.visibleEntries().length) * this.rowHeight);
  readonly filtered = computed(() => !!this.query() || !!this.traceId() || this.levels().length > 0);
  readonly connectionLabel = computed(() => this.t()[this.store.connection()]);
  readonly sourceLabel = computed(() => {
    switch (this.store.status()?.sourceStatus) {
      case 'healthy': return this.t().healthy;
      case 'disconnected': return this.t().disconnected;
      case 'starting': return this.t().starting;
      default: return this.t().sourceUnknown;
    }
  });
  readonly errorLabel = computed(() => {
    const code = this.store.errorCode();
    return code ? this.t()[code === 'unavailable' ? 'loadError' : code === 'session' ? 'sessionError' : code === 'access' ? 'accessError' : 'invalidFilters'] : '';
  });
  private debounce?: ReturnType<typeof setTimeout>;
  private resizeObserver?: ResizeObserver;
  private destroyed = false;
  private readonly onVisibility = () => this.store.setVisible(!document.hidden);

  constructor() {
    this.store.open();
    if (document.hidden) this.store.setVisible(false);
    document.addEventListener('visibilitychange', this.onVisibility);
    effect(() => { if (this.store.unavailable()) this.disabled.emit(); });
    effect(() => {
      this.store.entries();
      const viewport = this.viewport();
      const follow = this.autoScroll();
      if (viewport && follow) queueMicrotask(() => { if (!this.destroyed) this.goToEnd(); });
    });
    effect(() => {
      const panel = this.detailPanel();
      if (panel) queueMicrotask(() => { if (!this.destroyed) panel.nativeElement.focus(); });
    });
    effect(() => {
      const viewport = this.viewport();
      this.resizeObserver?.disconnect();
      if (viewport && typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(entries => this.viewportHeight.set(entries[0].contentRect.height));
        this.resizeObserver.observe(viewport.nativeElement);
      }
    });
  }
  private filters() { return { levels: this.levels(), q: this.query(), traceId: this.traceId().trim() }; }
  toggleLevel(level: LogLevel): void {
    this.levels.update(levels => levels.includes(level) ? levels.filter(item => item !== level) : [...levels, level]);
    this.applyFilters();
  }
  setQuery(value: string): void { this.query.set(value); this.scheduleFilters(); }
  setTrace(value: string): void { this.traceId.set(value); this.scheduleFilters(); }
  private scheduleFilters(): void { clearTimeout(this.debounce); this.debounce = setTimeout(() => this.applyFilters(), 300); }
  applyFilters(): void {
    clearTimeout(this.debounce);
    if (this.invalid()) return;
    this.store.discontinuity.set(null);
    this.selectedId.set(null); this.autoScroll.set(true); this.pageIndex.set(0); this.scrollTop.set(0);
    this.store.open(this.filters());
  }
  clearFilters(): void { this.levels.set([]); this.query.set(''); this.traceId.set(''); this.applyFilters(); }
  onScroll(): void {
    const viewport = this.viewport()?.nativeElement;
    if (!viewport) return;
    this.scrollTop.set(viewport.scrollTop);
    const atEnd = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < this.rowHeight;
    this.autoScroll.set(atEnd);
    if (atEnd && this.store.connection() !== 'paused') this.store.acknowledgeNew();
  }
  goToEnd(): void {
    untracked(() => {
      this.autoScroll.set(true); this.pageIndex.set(this.pageCount() - 1);
      const viewport = this.viewport()?.nativeElement;
      if (viewport) {
        const top = this.accessible() ? viewport.scrollHeight : Math.max(0, this.store.entries().length * this.rowHeight - viewport.clientHeight);
        viewport.scrollTop = top; this.scrollTop.set(top);
      }
      if (this.store.connection() !== 'paused') this.store.acknowledgeNew();
    });
  }
  async loadOlder(): Promise<void> {
    this.autoScroll.set(false);
    const viewport = this.viewport()?.nativeElement;
    const previous = this.store.entries();
    const index = Math.floor((viewport?.scrollTop ?? 0) / this.rowHeight);
    const anchor = previous[index]?.id;
    const offset = (viewport?.scrollTop ?? 0) % this.rowHeight;
    await this.store.loadOlder();
    const newIndex = this.store.entries().findIndex(entry => entry.id === anchor);
    if (viewport && newIndex >= 0 && !this.accessible()) {
      const top = newIndex * this.rowHeight + offset;
      this.scrollTop.set(top); viewport.scrollTop = top;
    }
    if (this.accessible()) this.pageIndex.set(0);
  }
  toggleAccessible(): void {
    this.accessible.update(value => !value); this.pageIndex.set(this.pageCount() - 1);
    this.autoScroll.set(false); this.scrollTop.set(0);
  }
  changePage(delta: number): void {
    this.autoScroll.set(false);
    this.pageIndex.set(Math.max(0, Math.min(this.pageCount() - 1, this.pageIndex() + delta)));
    const viewport = this.viewport()?.nativeElement;
    if (viewport) viewport.scrollTop = 0;
  }
  detail(entry: LogEntry): void { this.selectedId.set(entry.id); }
  closeDetail(): void {
    const id = this.selectedId(); this.selectedId.set(null);
    queueMicrotask(() => {
      const buttons = this.viewport()?.nativeElement.querySelectorAll<HTMLButtonElement>('[data-log-id]');
      const button = Array.from(buttons ?? []).find(item => item.dataset['logId'] === id);
      (button ?? this.viewport()?.nativeElement)?.focus();
    });
  }
  tone(level: LogLevel): 'neutral' | 'warning' | 'danger' { return level === 'ERROR' ? 'danger' : level === 'WARN' ? 'warning' : 'neutral'; }
  summary(entry: LogEntry): string {
    return entry.method && entry.route ? `${entry.method} ${entry.route}${entry.status == null ? '' : ` → ${entry.status}`}${entry.durationMs == null ? '' : ` (${entry.durationMs} ms)`}` : entry.lines[0] ?? entry.event;
  }
  time(timestamp: string | null): string {
    if (!timestamp) return this.t().noEvent;
    return new Date(timestamp).toLocaleString(this.i18n.intlLocale());
  }
  async copy(text: string): Promise<void> {
    try { await navigator.clipboard.writeText(text); this.copyResult.set('copied'); }
    catch { this.copyResult.set('copyError'); }
  }
  ngOnDestroy(): void {
    this.destroyed = true; clearTimeout(this.debounce); this.resizeObserver?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility); this.store.destroy();
  }
}

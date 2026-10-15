import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, OnDestroy, output, signal, untracked, viewChild } from '@angular/core';
import { I18n } from '../../core/i18n/i18n';
import { UI } from '../../shared/ui';
import { LogEntry, LogLevel, LogMethod, LogStatusFilter, validFilters } from './infra-logs.models';
import { InfraLogsStore } from './infra-logs.store';
import { explainLog, statusName } from './infra-logs-explanations';
import { downloadFilename, groupEntries, issueMarkdown, LogGroup, routeInsights, routeSegment, toCsv, toText } from './infra-logs-diagnostics';

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
  readonly route = signal('');
  readonly methods = signal<LogMethod[]>([]);
  readonly statuses = signal<LogStatusFilter[]>([]);
  readonly minDurationMs = signal<number | null>(null);
  readonly jumpValue = signal('');
  readonly timezone = signal<'local' | 'utc'>('local');
  readonly groupRepeated = signal(true);
  readonly expandedGroup = signal<string | null>(null);
  readonly invalid = computed(() => !validFilters(this.filters()));
  readonly autoScroll = signal(true);
  readonly scrollTop = signal(0);
  readonly viewportHeight = signal(480);
  readonly accessible = signal(false);
  readonly pageIndex = signal(0);
  readonly selectedId = signal<string | null>(null);
  readonly selected = computed(() => this.store.entries().find(entry => entry.id === this.selectedId()));
  readonly displayedEntries = computed(() => {
    const entries = this.store.entries();
    return this.store.historyAt() ? [...entries].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id)) : entries;
  });
  readonly displayedGroups = computed(() => groupEntries(this.displayedEntries(), this.groupRepeated()));
  readonly visibleGroups = computed(() => this.displayedGroups().slice(this.rangeStart(),
    this.rangeStart() + (this.accessible() ? 150 : Math.ceil(this.viewportHeight() / this.rowHeight) + 10)));
  readonly expandedGroupData = computed(() => this.displayedGroups().find(group => group.key === this.expandedGroup()) ?? null);
  readonly routeStats = computed(() => routeInsights(this.displayedEntries()));
  readonly frequentRoutes = computed(() => [...this.routeStats()].sort((a, b) => b.count - a.count || a.route.localeCompare(b.route)).slice(0, 5));
  readonly errorRoutes = computed(() => [...this.routeStats()].sort((a, b) => b.errorCount - a.errorCount || b.count - a.count || a.route.localeCompare(b.route)).filter(item => item.errorCount > 0).slice(0, 5));
  readonly copyResult = signal<'copied' | 'copyError' | null>(null);
  readonly rowHeight = 72;
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.displayedGroups().length / 150)));
  readonly rangeStart = computed(() => this.accessible() ? Math.min(this.pageIndex(), this.pageCount() - 1) * 150 :
    Math.max(0, Math.floor(this.scrollTop() / this.rowHeight) - 5));
  readonly topSpace = computed(() => this.accessible() ? 0 : this.rangeStart() * this.rowHeight);
  readonly bottomSpace = computed(() => this.accessible() ? 0 :
    Math.max(0, this.displayedGroups().length - this.rangeStart() - this.visibleGroups().length) * this.rowHeight);
  readonly filtered = computed(() => !!this.query() || !!this.traceId() || this.levels().length > 0);
  readonly hasActiveFilters = computed(() => this.filtered() || !!this.route() || this.methods().length > 0 || this.statuses().length > 0 || this.minDurationMs() !== null);
  readonly routeSuggestions = computed(() => [...new Set(this.store.entries().map(entry => entry.route).filter((route): route is string => !!route))].slice(0, 20));
  readonly summaryStats = computed(() => {
    const entries = this.store.entries();
    const durations = entries.map(entry => entry.durationMs).filter((value): value is number => value !== null);
    return { classes: Object.fromEntries(['2xx', '3xx', '4xx', '5xx'].map(status => [status,
      entries.filter(entry => entry.status !== null && `${Math.floor(entry.status / 100)}xx` === status).length])),
      warningsErrors: entries.filter(entry => entry.level !== 'INFO').length,
      slowest: durations.length ? Math.max(...durations) : null,
      average: durations.length ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length) : null };
  });
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
  private filters() { return { levels: this.levels(), q: this.query(), traceId: this.traceId().trim(), route: this.route(), methods: this.methods(), statuses: this.statuses(), minDurationMs: this.minDurationMs() }; }
  toggleLevel(level: LogLevel): void {
    this.levels.update(levels => levels.includes(level) ? levels.filter(item => item !== level) : [...levels, level]);
    this.applyFilters();
  }
  setQuery(value: string): void { this.query.set(value); this.scheduleFilters(); }
  setTrace(value: string): void { this.traceId.set(value); this.scheduleFilters(); }
  setRoute(value: string): void { this.route.set(value); this.scheduleFilters(); }
  toggleMethod(method: LogMethod): void { this.methods.update(items => items.includes(method) ? items.filter(item => item !== method) : [...items, method]); this.applyFilters(); }
  toggleStatus(status: LogStatusFilter): void { this.statuses.update(items => items.includes(status) ? items.filter(item => item !== status) : [...items, status]); this.applyFilters(); }
  setMinDuration(value: string): void { this.minDurationMs.set(value ? Number(value) : null); this.applyFilters(); }
  preset(name: 'errors' | 'slow' | 'rejected'): void {
    this.levels.set([]); this.traceId.set(''); this.route.set(''); this.methods.set([]);
    this.statuses.set(name === 'errors' ? ['4xx', '5xx'] : []);
    this.minDurationMs.set(name === 'slow' ? 1001 : null);
    this.query.set(name === 'rejected' ? 'JWT_REJECTED' : '');
    this.applyFilters();
  }
  removeFilter(name: 'route' | 'method' | 'status' | 'duration' | 'trace' | 'text' | 'level'): void {
    if (name === 'level') this.levels.set([]);
    if (name === 'route') this.route.set('');
    if (name === 'method') this.methods.set([]);
    if (name === 'status') this.statuses.set([]);
    if (name === 'duration') this.minDurationMs.set(null);
    if (name === 'trace') this.traceId.set('');
    if (name === 'text') this.query.set('');
    this.applyFilters();
  }
  activeFilterLabels(): { name: 'route' | 'method' | 'status' | 'duration' | 'trace' | 'text' | 'level'; label: string }[] {
    const filters = this.filters(); const labels: { name: 'route' | 'method' | 'status' | 'duration' | 'trace' | 'text' | 'level'; label: string }[] = [];
    if (filters.levels.length) labels.push({ name: 'level', label: `Nivel: ${filters.levels.join(', ')}` });
    if (filters.route) labels.push({ name: 'route', label: `Ruta: ${filters.route}` });
    if (filters.methods.length) labels.push({ name: 'method', label: `Método: ${filters.methods.join(', ')}` });
    if (filters.statuses.length) labels.push({ name: 'status', label: `Estado: ${filters.statuses.join(', ')}` });
    if (filters.minDurationMs !== null) labels.push({ name: 'duration', label: `≥ ${filters.minDurationMs} ms` });
    if (filters.traceId) labels.push({ name: 'trace', label: `Trace: ${filters.traceId}` });
    if (filters.q) labels.push({ name: 'text', label: `Texto: ${filters.q}` });
    return labels;
  }
  private scheduleFilters(): void { clearTimeout(this.debounce); this.debounce = setTimeout(() => this.applyFilters(), 300); }
  applyFilters(): void {
    clearTimeout(this.debounce);
    if (this.invalid()) return;
    this.store.discontinuity.set(null);
    this.selectedId.set(null); this.autoScroll.set(true); this.pageIndex.set(0); this.scrollTop.set(0);
    this.store.open(this.filters());
  }
  clearFilters(): void { this.levels.set([]); this.query.set(''); this.traceId.set(''); this.route.set(''); this.methods.set([]); this.statuses.set([]); this.minDurationMs.set(null); this.applyFilters(); }
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
        const top = this.accessible() ? viewport.scrollHeight : Math.max(0, this.displayedGroups().length * this.rowHeight - viewport.clientHeight);
        viewport.scrollTop = top; this.scrollTop.set(top);
      }
      if (this.store.connection() !== 'paused') this.store.acknowledgeNew();
    });
  }
  async loadOlder(): Promise<void> {
    this.autoScroll.set(false);
    const viewport = this.viewport()?.nativeElement;
    const previous = this.displayedGroups().map(group => group.representative);
    const index = Math.floor((viewport?.scrollTop ?? 0) / this.rowHeight);
    const anchor = previous[index]?.id;
    const offset = (viewport?.scrollTop ?? 0) % this.rowHeight;
    await this.store.loadOlder();
    const newIndex = this.displayedGroups().findIndex(group => group.representative.id === anchor);
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
  navigateDetail(delta: number): void {
    const entries = this.store.entries(); const index = entries.findIndex(entry => entry.id === this.selectedId());
    const next = entries[index + delta]; if (next) this.selectedId.set(next.id);
  }
  explanation(entry: LogEntry) { return explainLog(entry); }
  language(value: { es: string; en: string }): string { return value[this.i18n.locale()]; }
  relativeTime(timestamp: string): string {
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 60_000));
    return minutes < 1 ? 'ahora' : `hace ${minutes} min`;
  }
  jumpToDate(): void { if (this.jumpValue()) { this.autoScroll.set(false); this.selectedId.set(null); this.store.jumpTo(new Date(this.jumpValue()).toISOString()); } }
  jumpPreset(minutes: number): void { const date = new Date(Date.now() - minutes * 60_000); this.jumpValue.set(new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)); this.jumpToDate(); }
  datetimeLocal(instant: string | null): string {
    if (!instant) return '';
    const date = new Date(instant); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }
  routeHighlighted(entry: LogEntry): string { return entry.route ?? ''; }
  routeParts(entry: LogEntry): { text: string; match: boolean }[] {
    const value = entry.route ?? ''; const query = this.route().trim();
    if (!query) return [{ text: value, match: false }];
    const index = value.toLowerCase().indexOf(query.toLowerCase());
    return index < 0 ? [{ text: value, match: false }] : [
      { text: value.slice(0, index), match: false }, { text: value.slice(index, index + query.length), match: true },
      { text: value.slice(index + query.length), match: false },
    ];
  }
  applySummaryStatus(status: LogStatusFilter): void { this.statuses.set([status]); this.applyFilters(); }
  nowLocal(): string { return this.datetimeLocal(new Date().toISOString()); }
  relatedEntries(entry: LogEntry): LogEntry[] {
    return this.hasTraceId(entry) ? this.store.entries().filter(item => item.traceId === entry.traceId) : [];
  }
  detailIndex(entry: LogEntry): number { return this.store.entries().findIndex(item => item.id === entry.id); }
  toggleTimezone(): void { this.timezone.update(value => value === 'local' ? 'utc' : 'local'); }
  toggleGrouping(): void { this.groupRepeated.update(value => !value); this.expandedGroup.set(null); }
  toggleExpanded(group: LogGroup): void { this.expandedGroup.set(this.expandedGroup() === group.key ? null : group.key); }
  filterRoute(value: string): void { this.route.set(value); this.applyFilters(); }
  filterPathSegment(segment: string): void { this.filterRoute(`/api/${segment}`); }
  routePart(entry: LogEntry): string { return routeSegment(entry.route); }
  groupTimes(group: LogGroup): { first: string; last: string } {
    const times = group.entries.map(entry => Date.parse(entry.timestamp)).sort((a, b) => a - b);
    return { first: new Date(times[0]).toISOString(), last: new Date(times.at(-1)!).toISOString() };
  }
  copyIssue(entry?: LogEntry): Promise<void> { return this.copy(issueMarkdown(entry ? [entry] : this.store.entries().slice(0, 50))); }
  downloadView(format: 'json' | 'csv' | 'txt'): void {
    const entries = this.store.entries();
    const content = format === 'json' ? JSON.stringify(entries, null, 2) : format === 'csv' ? toCsv(entries) : toText(entries);
    const mime = format === 'json' ? 'application/json;charset=utf-8' : format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8';
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const link = document.createElement('a'); link.href = url;
    link.download = downloadFilename(this.store.status()?.generation ?? null, format); link.click(); URL.revokeObjectURL(url);
  }
  stackLines(entry: LogEntry): { text: string; applicationFrame: boolean }[] {
    const frameIndex = entry.lines.findIndex(line => /\bat com\.[\w.$]+\(/.test(line));
    return entry.lines.map((text, index) => ({ text, applicationFrame: index === frameIndex }));
  }
  closeDetail(): void {
    const id = this.selectedId(); this.selectedId.set(null);
    queueMicrotask(() => {
      const buttons = this.viewport()?.nativeElement.querySelectorAll<HTMLButtonElement>('[data-log-id]');
      const button = Array.from(buttons ?? []).find(item => item.dataset['logId'] === id);
      (button ?? this.viewport()?.nativeElement)?.focus();
    });
  }
  tone(level: LogLevel): 'neutral' | 'warning' | 'danger' { return level === 'ERROR' ? 'danger' : level === 'WARN' ? 'warning' : 'neutral'; }
  hasTraceId(entry: LogEntry): boolean { return !!entry.traceId && !/^0{32}$/i.test(entry.traceId); }
  hasSpanId(entry: LogEntry): boolean { return !!entry.spanId && !/^0{16}$/i.test(entry.spanId); }
  shortLogger(logger: string): string { return logger.split('.').at(-1) ?? logger; }
  fullTime(timestamp: string): string {
    return new Date(timestamp).toLocaleString(this.i18n.intlLocale(), {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      second: '2-digit', fractionalSecondDigits: 3, hour12: false, ...(this.timezone() === 'utc' ? { timeZone: 'UTC' } : {}),
    });
  }
  utcTime(timestamp: string): string { return new Date(timestamp).toISOString(); }
  statusLabel(status: number): string { return statusName(status, this.i18n.locale()); }
  goLive(): void { this.selectedId.set(null); this.autoScroll.set(true); this.pageIndex.set(0); this.store.goLive(); }
  filterByTrace(entry: LogEntry): void {
    if (!this.hasTraceId(entry)) return;
    this.levels.set([]); this.query.set(''); this.traceId.set(entry.traceId!); this.route.set('');
    this.methods.set([]); this.statuses.set([]); this.minDurationMs.set(null);
    this.applyFilters(); this.selectedId.set(null);
  }
  eventJson(entry: LogEntry): string { return JSON.stringify(entry, null, 2); }
  statusClass(status: number): string {
    if (status >= 200 && status < 300) return 'text-success';
    if (status >= 400 && status < 500) return 'text-warning';
    if (status >= 500 && status < 600) return 'text-danger';
    return 'text-text-muted';
  }
  summary(entry: LogEntry): string {
    return entry.method && entry.route ? `${entry.method} ${entry.route}${entry.status == null ? '' : ` · ${entry.status}`}${entry.durationMs == null ? '' : ` · ${entry.durationMs} ms`}` : entry.lines[0] ?? entry.event;
  }
  time(timestamp: string | null): string {
    if (!timestamp) return this.t().noEvent;
    return new Date(timestamp).toLocaleString(this.i18n.intlLocale(), {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      ...(this.timezone() === 'utc' ? { timeZone: 'UTC' } : {}),
    });
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

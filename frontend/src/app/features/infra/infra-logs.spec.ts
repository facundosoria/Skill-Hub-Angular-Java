import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { I18n } from '../../core/i18n/i18n';
import { InfraLogs } from './infra-logs';
import { InfraLogsStore } from './infra-logs.store';
import { coldLogStatus, logEntry, logStatus } from './infra-logs.fixtures';
import { LogConnection, LogEntry } from './infra-logs.models';
import { EMPTY_FILTERS } from './infra-logs.models';

function mockStore(entries: LogEntry[] = []) {
  return { entries: signal(entries), connection: signal<LogConnection>('live'), status: signal(logStatus()),
    lastEventAt: signal<string | null>(null), capacityLimited: signal(false), browserTruncated: signal(false),
    discontinuity: signal<'gap' | 'reset' | null>(null), newCount: signal(0), retrySeconds: signal(0),
    loadingHistory: signal(false), hasMoreBefore: signal(true), unavailable: signal(false),
    hasMoreAfter: signal(false), historyAt: signal<string | null>(null),
    errorCode: signal<'unavailable' | 'session' | 'access' | 'invalid' | null>(null),
    open: vi.fn(), resume: vi.fn(), pause: vi.fn(), refresh: vi.fn(), loadOlder: vi.fn(async () => {}),
    setVisible: vi.fn(), acknowledgeNew: vi.fn(), destroy: vi.fn() };
}
describe('Gateway log panel', () => {
  afterEach(() => { TestBed.inject(I18n).setLocale('es'); });
  async function configure(store = mockStore()) {
    await TestBed.configureTestingModule({ imports: [InfraLogs] })
      .overrideComponent(InfraLogs, { set: { providers: [{ provide: InfraLogsStore, useValue: store }] } }).compileComponents();
    const fixture = TestBed.createComponent(InfraLogs);
    await fixture.whenStable(); fixture.detectChanges();
    return { fixture, store, panel: fixture.componentInstance };
  }
  it.each(['es', 'en'] as const)('renders the cold source and nullable coverage in %s', async locale => {
    const { fixture, store } = await configure(); TestBed.inject(I18n).setLocale(locale);
    store.status.set(coldLogStatus()); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(locale === 'es' ? 'Esperando al colector de logs…' : 'Waiting for the log collector…');
    expect(fixture.nativeElement.textContent).not.toContain('Invalid Date');
    fixture.destroy(); TestBed.inject(I18n).setLocale('es');
  });
  it.each(['unavailable', 'unexpected', 'loadError', '__proto__'])('renders generic source text for unknown status %s', async sourceStatus => {
    const { fixture, store } = await configure();
    store.status.set({ ...logStatus(), ...JSON.parse(JSON.stringify({ sourceStatus })) }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Estado de la fuente desconocido');
    TestBed.inject(I18n).setLocale('en'); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Unknown source status');
    fixture.destroy(); TestBed.inject(I18n).setLocale('es');
  });
  it('renders HTML and ANSI payloads as text in both summaries and multiline details', async () => {
    const malicious = '<img src=x onerror="alert(1)"><script>fixture</script>\u001b[31mERROR';
    const { fixture, panel } = await configure(mockStore([logEntry(150, { method: null, route: null, lines: [malicious, '<b>second line</b>'] })]));
    panel.selectedId.set('g7:150'); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')).toBeNull(); expect(fixture.nativeElement.querySelector('script')).toBeNull();
    expect(fixture.nativeElement.querySelector('.log-continuations').textContent).toBe('<b>second line</b>');
    expect(fixture.nativeElement.textContent).toContain(malicious);
    expect(fixture.nativeElement.querySelector('[role="list"]').getAttribute('aria-live')).toBe('off');
  });
  it('shows request details as the primary row text, colors status ranges, and hides zero trace IDs', async () => {
    const entries = [
      logEntry(1, { traceId: '0'.repeat(32), status: 200 }),
      logEntry(2, { status: 302 }),
      logEntry(3, { status: 404 }),
      logEntry(4, { status: 500 }),
      logEntry(5, { level: 'WARN', status: 200, event: 'UNLISTED_EVENT' }),
    ];
    const { fixture } = await configure(mockStore(entries));
    const rows = Array.from(fixture.nativeElement.querySelectorAll('.log-row')) as HTMLElement[];
    expect(rows[0].querySelector('.log-trace')).toBeNull();
    expect(rows[0].querySelector('.log-request')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('GET /api/example/{id} · 200 · 18 ms');
    expect(rows[0].querySelector('.log-logger')?.textContent).toBe('LoggingFilter');
    expect(rows[0].querySelector('.log-request span')?.classList.contains('text-success')).toBe(true);
    expect(rows[1].querySelector('.log-request span')?.classList.contains('text-text-muted')).toBe(true);
    expect(rows[2].querySelector('.log-request span')?.classList.contains('text-warning')).toBe(true);
    expect(rows[3].querySelector('.log-request span')?.classList.contains('text-danger')).toBe(true);
    expect(rows[0].querySelector('.log-meaning')).toBeNull();
    expect(rows[1].querySelector('.log-meaning')).toBeNull();
    expect(rows[2].querySelector('.log-meaning')?.textContent).toContain('ruta no existe');
    expect(rows[3].querySelector('.log-meaning')?.textContent).toContain('falló el servidor');
    expect(rows[4].querySelector('.log-meaning')).toBeNull();
  });
  it('shows full event details, copy actions, and trace filtering in the detail panel', async () => {
    const entry = logEntry(8, { logger: 'com.example.gateway.LoggingFilter', event: 'REQUEST_COMPLETED',
      status: 201, durationMs: 1201, reason: 'synthetic reason', lines: ['safe event line', 'continuation'] });
    const { fixture, panel, store } = await configure(mockStore([entry]));
    panel.detail(entry); fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('UTC:'); expect(text).toContain('Creado'); expect(text).toContain('Lenta');
    expect(text).toContain('com.example.gateway.LoggingFilter'); expect(text).toContain('synthetic reason');
    expect(text).toContain('2222222222222222'); expect(text).toContain('safe event line');
    expect(text).toContain('Nivel'); expect(text).not.toContain('Nivel (sin selección: todos)');
    expect(fixture.nativeElement.querySelectorAll('.detail-copy').length).toBe(3);
    expect(fixture.nativeElement.querySelector('.log-continuations')?.textContent).toContain('continuation');
    const traceButton = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(button => button.textContent?.includes('Ver solo esta traza'));
    traceButton?.click();
    expect(store.open).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, traceId: entry.traceId });
  });
  it('shows self-service route and repeated-error controls and changes displayed timezone in memory', async () => {
    const entries = [logEntry(5, { level: 'ERROR', event: 'FAIL', route: '/api/users/{id}', status: 500 }),
      logEntry(6, { level: 'ERROR', event: 'FAIL', route: '/api/users/{id}', status: 500 }), logEntry(7, { level: 'INFO' })];
    const { fixture, panel } = await configure(mockStore(entries));
    expect(panel.displayedGroups().map(group => group.entries.length)).toEqual([2, 1]);
    expect(fixture.nativeElement.textContent).toContain('Rutas más frecuentes');
    const row = fixture.nativeElement.querySelector('.log-row') as HTMLElement;
    expect(row.querySelector('.route-chip')?.textContent).toBe('users');
    expect(row.querySelector('button button')).toBeNull();
    panel.toggleTimezone(); fixture.detectChanges();
    expect(panel.timezone()).toBe('utc'); expect(fixture.nativeElement.textContent).toContain('UTC');
    panel.toggleGrouping(); expect(panel.displayedGroups().map(group => group.entries.length)).toEqual([1, 1, 1]);
    fixture.destroy();
  });
  it('opens the accessible help section and prepares report-ready copy for filtered loaded entries', async () => {
    const entry = logEntry(8, { route: '/api/courses/{id}', status: 404, traceId: null });
    const { fixture, panel } = await configure(mockStore([entry]));
    const details = fixture.nativeElement.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false); details.querySelector('summary')?.dispatchEvent(new Event('click'));
    expect(fixture.nativeElement.textContent).toContain('La ventana conserva hasta 6 horas');
    const markdown = (await import('./infra-logs-diagnostics')).issueMarkdown([entry]);
    expect(markdown).toContain('Hora local'); expect(markdown).toContain('Hora UTC'); expect(markdown).toContain('/api/courses/{id}');
    expect(panel.stackLines(logEntry(9, { lines: ['at com.skillhub.Example.run(Example.java:1)', 'at java.base.Thread.run'] }))[0].applicationFrame).toBe(true);
    fixture.destroy();
  });
  it('focuses the opened detail and closes it with Escape', async () => {
    const entry = logEntry(12);
    const { fixture, panel } = await configure(mockStore([entry]));
    panel.detail(entry); fixture.detectChanges(); await fixture.whenStable();
    const detail = fixture.nativeElement.querySelector('section[tabindex="-1"]') as HTMLElement | null;
    expect(detail).not.toBeNull(); expect(document.activeElement).toBe(detail);
    detail?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); fixture.detectChanges();
    expect(panel.selectedId()).toBeNull(); fixture.destroy();
  });
  it('applies removable path, method, status, and duration filters server-side', async () => {
    const { fixture, panel, store } = await configure(); store.open.mockClear();
    panel.route.set('/api/example'); panel.methods.set(['POST']); panel.statuses.set(['4xx']); panel.minDurationMs.set(501);
    panel.levels.set(['WARN']);
    panel.applyFilters(); fixture.detectChanges();
    expect(store.open).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, route: '/api/example', methods: ['POST'], statuses: ['4xx'], minDurationMs: 501, levels: ['WARN'] });
    expect(fixture.nativeElement.textContent).toContain('Ruta: /api/example');
    expect(fixture.nativeElement.textContent).toContain('Nivel: WARN');
    panel.removeFilter('route'); expect(store.open).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, levels: ['WARN'], methods: ['POST'], statuses: ['4xx'], minDurationMs: 501 });
  });
  it('summarizes status classes and applies a summary class when selected', async () => {
    const entries = [logEntry(1, { status: 200, durationMs: 10 }), logEntry(2, { status: 404, level: 'WARN', durationMs: 20 }), logEntry(3, { status: 503, level: 'ERROR', durationMs: 30 })];
    const { fixture, panel, store } = await configure(mockStore(entries));
    expect(panel.summaryStats()).toMatchObject({ classes: { '2xx': 1, '3xx': 0, '4xx': 1, '5xx': 1 }, warningsErrors: 2, slowest: 30, average: 20 });
    panel.applySummaryStatus('4xx'); expect(store.open).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, statuses: ['4xx'] });
    fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('4xx: 1');
    const summary = Array.from(fixture.nativeElement.querySelectorAll('.summary-chip') as NodeListOf<HTMLButtonElement>)
      .find(button => button.textContent?.startsWith('4xx'))!;
    expect(summary.getAttribute('aria-pressed')).toBe('true');
    expect(summary.classList.contains('is-selected')).toBe(true);
  });
  it('renders only a bounded window for 5000 events and offers pages of at most 150', async () => {
    const { fixture, panel } = await configure(mockStore(Array.from({ length: 5000 }, (_, index) => logEntry(index + 1))));
    expect(fixture.nativeElement.querySelectorAll('[role="listitem"]').length).toBeLessThanOrEqual(80);
    panel.toggleAccessible(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[role="listitem"]').length).toBeLessThanOrEqual(150);
    panel.changePage(-1); fixture.detectChanges(); expect(panel.pageIndex()).toBe(32);
  });
  it('validates filters and keeps trace IDs byte-for-byte while trimming input whitespace', async () => {
    const { panel, store } = await configure(); store.open.mockClear();
    panel.query.set('a'.repeat(121)); panel.applyFilters(); expect(store.open).not.toHaveBeenCalled();
    panel.query.set('literal.*'); panel.traceId.set('z'.repeat(32)); panel.applyFilters(); expect(store.open).not.toHaveBeenCalled();
    panel.traceId.set(' ' + 'A'.repeat(32) + ' '); panel.toggleLevel('WARN');
    expect(store.open).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, levels: ['WARN'], q: 'literal.*', traceId: 'A'.repeat(32) });
    panel.clearFilters(); expect(store.open).toHaveBeenLastCalledWith(EMPTY_FILTERS);
  });
  it('debounces text changes by 300 ms and cancels pending filters on destruction', async () => {
    const { panel, store, fixture } = await configure(); vi.useFakeTimers(); store.open.mockClear();
    panel.setQuery('one'); panel.setQuery('two'); await vi.advanceTimersByTimeAsync(299); expect(store.open).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(store.open).toHaveBeenCalledOnce();
    panel.setTrace('1'.repeat(32)); fixture.destroy(); await vi.advanceTimersByTimeAsync(300);
    expect(store.open).toHaveBeenCalledOnce(); expect(store.destroy).toHaveBeenCalledOnce(); vi.useRealTimers();
  });
  it('disables auto-scroll on upward scroll and restores it with go-to-end', async () => {
    const { panel, fixture, store } = await configure(mockStore(Array.from({ length: 100 }, (_, index) => logEntry(index + 1))));
    const viewport = fixture.nativeElement.querySelector('.log-viewport');
    Object.defineProperty(viewport, 'clientHeight', { value: 480 }); Object.defineProperty(viewport, 'scrollHeight', { value: 7200 });
    viewport.scrollTop = 100; panel.onScroll(); expect(panel.autoScroll()).toBe(false);
    store.entries.update(entries => [...entries, logEntry(101)]); await fixture.whenStable();
    expect(viewport.scrollTop).toBe(100); panel.goToEnd(); expect(panel.autoScroll()).toBe(true);
    expect(viewport.scrollTop).toBe(6792); expect(store.acknowledgeNew).toHaveBeenCalled();
  });
  it('keeps paused pending counts when scrolling to the end of the frozen view', async () => {
    const { panel, store } = await configure(mockStore([logEntry()]));
    store.connection.set('paused'); store.newCount.set(3); store.acknowledgeNew.mockClear();
    panel.goToEnd(); expect(store.acknowledgeNew).not.toHaveBeenCalled(); expect(store.newCount()).toBe(3);
  });
  it('preserves the visible event anchor when prepending history', async () => {
    const { panel, fixture, store } = await configure(mockStore([logEntry(150), logEntry(151)]));
    const viewport = fixture.nativeElement.querySelector('.log-viewport'); viewport.scrollTop = 10;
    store.loadOlder.mockImplementation(async () => { store.entries.set([logEntry(149), ...store.entries()]); });
    await panel.loadOlder(); expect(viewport.scrollTop).toBe(82); expect(panel.autoScroll()).toBe(false);
  });
  it('shows loading, empty filtered and disconnected source states with retention warnings', async () => {
    const { fixture, store, panel } = await configure();
    expect(fixture.nativeElement.textContent).toContain('No hay eventos disponibles');
    panel.query.set('absent'); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('No hay eventos con estos filtros');
    store.connection.set('loading'); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('Cargando logs');
    store.connection.set('live'); store.status.set(logStatus({ sourceStatus: 'disconnected', retentionTruncated: true }));
    store.browserTruncated.set(true); store.discontinuity.set('gap'); fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('fuente de logs está desconectada'); expect(text).toContain('historial ya no está disponible');
    expect(text).toContain('límite del navegador'); expect(text).toContain('hueco en la conexión');
  });
  it('does not show a retention warning for an empty starting collector', async () => {
    const { fixture, store } = await configure();
    store.entries.set([]); store.status.set(logStatus({ sourceStatus: 'starting', retentionTruncated: true }));
    store.capacityLimited.set(false); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Parte del historial ya no está disponible');
  });
  it('keeps compact filter controls and the follow/help disclosures collapsed', async () => {
    const { fixture, panel } = await configure();
    const follow = fixture.nativeElement.querySelector('.log-toolbar details') as HTMLDetailsElement;
    expect(follow).not.toBeNull(); expect(follow.open).toBe(false);
    expect(fixture.nativeElement.querySelectorAll('.log-filter-row').length).toBe(2);
    panel.toggleMethod('GET'); fixture.detectChanges();
    const getChip = Array.from(fixture.nativeElement.querySelectorAll('.log-method-chip') as NodeListOf<HTMLButtonElement>)
      .find(button => button.textContent?.trim() === 'GET');
    expect(getChip?.getAttribute('aria-pressed')).toBe('true'); expect(getChip?.classList.contains('is-selected')).toBe(true);
  });
  it('shows related events with a count and keeps continuation lines distinct from the main line', async () => {
    const traceId = '1'.repeat(32);
    const entries = [logEntry(1, { traceId, lines: ['main', 'main', 'continuation'] }), logEntry(2, { traceId })];
    const { fixture, panel } = await configure(mockStore(entries));
    panel.detail(entries[0]); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.log-continuations')?.textContent).toBe('continuation');
    expect(fixture.nativeElement.querySelector('.related-count')?.textContent).toContain('2');
    expect(fixture.nativeElement.querySelectorAll('.related-events button').length).toBe(2);
    expect(fixture.nativeElement.querySelector('.detail-actions')?.textContent).toContain('Copiar evento');
    expect(fixture.nativeElement.querySelector('.detail-actions')?.textContent).toContain('Copiar para un issue');
    expect(fixture.nativeElement.querySelector('.detail-actions')?.textContent).toContain('Ver solo esta traza');
  });
  it('uses an absolute timestamp instead of keeping the relative label at now', async () => {
    const { panel } = await configure();
    expect(panel.relativeTime(new Date(Date.now() - 60_001).toISOString())).not.toBe('ahora');
  });
  it('renders errors and quota waits and disables early live retry', async () => {
    const { fixture, store } = await configure(); store.errorCode.set('session'); store.connection.set('revoked'); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Tu sesión venció');
    store.errorCode.set(null); store.connection.set('blocked'); store.retrySeconds.set(20); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('demasiadas ventanas');
    const button = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(item => item.textContent?.includes('Reintentar conexión'));
    expect(button?.disabled).toBe(true);
  });
  it('copies only the displayed sanitized text and reports clipboard failures', async () => {
    const { fixture, panel } = await configure();
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await panel.copy('11111111111111111111111111111111'); expect(writeText).toHaveBeenCalledWith('11111111111111111111111111111111');
    expect(panel.copyResult()).toBe('copied'); writeText.mockRejectedValueOnce(new Error('Denied'));
    await panel.copy('Synthetic summary'); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('No pudimos copiar');
  });
});

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
  it('shows the request as the primary row text with status and duration in their own columns, colors status ranges, and hides zero trace IDs', async () => {
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
    expect(rows[0].querySelector('.log-request')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('GET /api/example/{id}');
    expect(rows[0].querySelector('.log-status')?.textContent?.trim()).toBe('200');
    expect(rows[0].querySelector('.log-duration')?.textContent?.trim()).toBe('18 ms');
    expect(rows[0].querySelector('.log-logger')).toBeNull();
    expect(rows[0].querySelector('.log-message')?.getAttribute('aria-label')).toContain('LoggingFilter');
    expect(rows[0].querySelector('.log-status')?.classList.contains('text-success')).toBe(true);
    expect(rows[1].querySelector('.log-status')?.classList.contains('text-text-muted')).toBe(true);
    expect(rows[2].querySelector('.log-status')?.classList.contains('text-warning')).toBe(true);
    expect(rows[3].querySelector('.log-status')?.classList.contains('text-danger')).toBe(true);
    expect(rows[0].querySelector('.log-level-plain')?.textContent).toBe('INFO');
    expect(rows[4].querySelector('.log-level-plain')).toBeNull();
    expect(rows[0].querySelector('.log-meaning')).toBeNull();
    expect(rows[1].querySelector('.log-meaning')).toBeNull();
    expect(rows[2].querySelector('.log-meaning')?.textContent).toContain('ruta no existe');
    expect(rows[3].querySelector('.log-meaning')?.textContent).toContain('falló el servidor');
    expect(rows[4].querySelector('.log-meaning')).toBeNull();
  });
  it('keeps compact rows and exposes the timezone as a two-choice segmented control', async () => {
    const { fixture, panel } = await configure(mockStore([logEntry(1)]));
    expect(panel.rowHeight).toBe(48);
    const timezone = fixture.nativeElement.querySelector('[role="group"][aria-label="Zona horaria"]');
    expect(timezone).not.toBeNull();
    expect(timezone.closest('.log-listhead')).not.toBeNull();
    const choices = Array.from(timezone.querySelectorAll('button')) as HTMLButtonElement[];
    expect(choices.map(button => button.textContent?.trim())).toEqual(['Local', 'UTC']);
    expect(choices.map(button => button.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    choices[1].click(); fixture.detectChanges();
    expect(panel.timezone()).toBe('utc');
    expect(choices.map(button => button.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    expect(fixture.nativeElement.querySelector('.log-meta-line')).not.toBeNull();
    fixture.destroy();
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
    expect(fixture.nativeElement.querySelectorAll('.detail-copy').length).toBe(1);
    const actions = fixture.nativeElement.querySelector('.detail-actions')?.textContent;
    expect(actions).toContain('Copiar trace ID'); expect(actions).toContain('Copiar span ID');
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
    const details = fixture.nativeElement.querySelector('.log-more .log-help-inline') as HTMLDetailsElement;
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
  it('routes a pasted trace ID from the search box to the trace filter and any other text to the text search', async () => {
    const { panel, store } = await configure();
    const trace = 'a1b2c3d4'.repeat(4);
    panel.setQuery(trace); panel.applyFilters();
    expect(store.open).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, traceId: trace });
    expect(panel.searchText()).toBe(trace);
    panel.setQuery('/api/llm'); panel.applyFilters();
    expect(store.open).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, q: '/api/llm' });
  });
  it('lets the 4xx and 5xx chips combine and toggles the slow and rejected chips from the summary strip', async () => {
    const { fixture, panel, store } = await configure();
    panel.applySummaryStatus('4xx'); panel.applySummaryStatus('5xx');
    expect(store.open).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, statuses: ['4xx', '5xx'] });
    panel.applySummaryStatus('4xx'); expect(store.open).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, statuses: ['5xx'] });
    panel.toggleSlow(); expect(store.open).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, statuses: ['5xx'], minDurationMs: 1001 });
    panel.toggleSlow(); expect(store.open).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, statuses: ['5xx'] });
    panel.toggleRejected(); expect(store.open).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, statuses: ['5xx'], q: 'JWT_REJECTED' });
    fixture.detectChanges();
    const rejected = Array.from(fixture.nativeElement.querySelectorAll('.summary-chip') as NodeListOf<HTMLButtonElement>).find((b) => b.textContent?.includes('Sesión rechazada'))!;
    expect(rejected.getAttribute('aria-pressed')).toBe('true');
    panel.toggleRejected(); expect(store.open).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, statuses: ['5xx'] });
  });
  it('summarizes status classes and applies a summary class when selected', async () => {
    const entries = [logEntry(1, { status: 200, durationMs: 10 }), logEntry(2, { status: 404, level: 'WARN', durationMs: 20 }), logEntry(3, { status: 503, level: 'ERROR', durationMs: 30 })];
    const { fixture, panel, store } = await configure(mockStore(entries));
    expect(panel.summaryStats()).toMatchObject({ classes: { '2xx': 1, '3xx': 0, '4xx': 1, '5xx': 1 }, warningsErrors: 2, slowest: 30, average: 20 });
    panel.applySummaryStatus('4xx'); expect(store.open).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, statuses: ['4xx'] });
    fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('4xx 1');
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
    expect(viewport.scrollTop).toBe(101 * panel.rowHeight - 480); expect(store.acknowledgeNew).toHaveBeenCalled();
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
    await panel.loadOlder(); expect(viewport.scrollTop).toBe(panel.rowHeight + 10); expect(panel.autoScroll()).toBe(false);
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
  it('keeps secondary filters and header help collapsed until requested', async () => {
    const { fixture, panel } = await configure();
    const follow = fixture.nativeElement.querySelector('.log-more') as HTMLDetailsElement;
    const filters = fixture.nativeElement.querySelector('.log-filter-panel') as HTMLElement;
    expect(follow).not.toBeNull(); expect(follow.open).toBe(false);
    expect(filters.closest('details')?.open).toBe(false);
    expect(fixture.nativeElement.querySelector('.log-toolbar details')).toBeTruthy();
    panel.toggleMethod('GET'); fixture.detectChanges();
    const getChip = Array.from(fixture.nativeElement.querySelectorAll('.log-method-chip') as NodeListOf<HTMLButtonElement>)
      .find(button => button.textContent?.trim() === 'GET');
    expect(getChip?.getAttribute('aria-pressed')).toBe('true');
    expect(fixture.nativeElement.querySelector('.log-filter-count')?.textContent).toBe('1');
    expect(fixture.nativeElement.querySelector('.log-active-chip')?.textContent).toContain('GET');
  });
  it('closes an open disclosure with Escape and restores focus to its summary', async () => {
    const { fixture, panel } = await configure();
    const disclosure = fixture.nativeElement.querySelector('.log-more') as HTMLDetailsElement;
    const summary = disclosure.querySelector('summary') as HTMLElement;
    disclosure.open = true;
    const popover = disclosure.querySelector('.log-popover') as HTMLElement;
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    popover.dispatchEvent(event);
    panel.closeDisclosure(event);
    expect(disclosure.open).toBe(false);
    expect(document.activeElement).toBe(summary);
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
  it('groups the rarely used actions in one menu and keeps the toolbar to search, level, pause, jump and filters', async () => {
    const { fixture, panel } = await configure(mockStore([logEntry(1)]));
    const root = fixture.nativeElement as HTMLElement;
    const menu = root.querySelector('.log-more') as HTMLDetailsElement;
    expect(menu).not.toBeNull(); expect(menu.open).toBe(false);
    const text = menu.textContent ?? '';
    expect(text).toContain('Agrupar repetidos'); expect(text).toContain('Cómo leer esto');
    expect(text).not.toContain('Zona horaria');
    expect(text).toContain('Vista paginada accesible'); expect(text).toContain('Copiar para un issue');
    expect(text).toContain('Descargar vista'); expect(text).toContain('.json'); expect(text).toContain('.csv'); expect(text).toContain('.txt');
    expect(root.querySelectorAll('.log-toolbar > details').length).toBe(3);
    // "Rango" existe una sola vez, muestra el rango actual y trae el selector de fecha con los atajos de 15 min, 1 h y 3 h.
    const jumps = Array.from(root.querySelectorAll('.log-toolbar > details > summary')).filter(summary => summary.textContent?.includes('Rango'));
    expect(jumps.length).toBe(1);
    expect(jumps[0].textContent).toContain('En vivo');
    expect(jumps[0].closest('details')?.textContent).toContain('Ir a fecha y hora');
    expect(jumps[0].closest('details')?.textContent).toContain('Hace 15 min');
    const accessible = Array.from(menu.querySelectorAll('button')).find(button => button.textContent?.includes('Vista paginada accesible')) as HTMLButtonElement;
    accessible.click(); fixture.detectChanges();
    expect(panel.accessible()).toBe(true);
    fixture.destroy();
  });
  it('moves the static window, privacy and last event info to the footer and colors the HTTP summary by severity', async () => {
    const { fixture } = await configure(mockStore([logEntry(1)]));
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('header')?.textContent).not.toContain('Datos sensibles ocultos');
    const footer = Array.from(root.querySelectorAll('p')).find(p => p.textContent?.includes('Datos sensibles ocultos'));
    expect(footer).toBeTruthy();
    expect(footer!.closest('header')).toBeNull();
    const classes = Array.from(root.querySelectorAll('.summary-chip strong')).map(label => [label.textContent?.trim(), label.className]);
    expect(classes).toEqual([['2xx', 'text-success'], ['3xx', 'text-text-muted'], ['4xx', 'text-warning'], ['5xx', 'text-danger']]);
    fixture.destroy();
  });
  it('puts pause next to the live badge as an icon button and swaps it for resume when paused', async () => {
    const { fixture, store } = await configure(mockStore([logEntry(1)]));
    const root = fixture.nativeElement as HTMLElement;
    const pause = root.querySelector('button[aria-label="Pausar"]') as HTMLButtonElement;
    expect(pause).not.toBeNull(); expect(pause.textContent?.trim()).toBe('');
    const live = pause.parentElement as HTMLElement;
    expect(live.querySelector('.log-connection-badge')).not.toBeNull();
    expect(live.textContent).toContain('api-gateway');
    pause.click(); expect(store.pause).toHaveBeenCalled();
    store.connection.set('paused'); store.newCount.set(12); fixture.detectChanges();
    const resume = live.querySelector('button[aria-label="Reanudar"]') as HTMLButtonElement;
    expect(resume).not.toBeNull(); resume.click(); expect(store.resume).toHaveBeenCalled();
    const banner = Array.from(root.querySelectorAll('[role="status"]')).find(node => node.textContent?.includes('eventos nuevos'))!.textContent as string;
    expect(banner).toContain('Pausado'); expect(banner).toContain('12'); expect(banner).toContain('eventos nuevos');
    fixture.destroy();
  });
  it('labels the columns, keeps the timezone in the time header and shows the filter count only when there are filters', async () => {
    const { fixture, panel } = await configure(mockStore([logEntry(1)]));
    const root = fixture.nativeElement as HTMLElement;
    const head = root.querySelector('.log-listhead')!.textContent as string;
    ['Hora', 'Nivel', 'Petición', 'Estado', 'Duración', 'Servicio'].forEach(label => expect(head).toContain(label));
    expect(root.querySelector('.log-filter-count')).toBeNull();
    panel.toggleMethod('GET'); fixture.detectChanges();
    expect(root.querySelector('.log-filter-count')?.textContent).toBe('1');
    expect(Array.from(root.querySelectorAll('.log-levels label')).map(label => label.textContent?.trim())).toEqual(['INFO', 'WARN', 'ERROR']);
    fixture.destroy();
  });
  it('shows only the time for today and adds day and month for older events, in the chosen zone', async () => {
    const { fixture, panel } = await configure(mockStore([logEntry(1)]));
    const now = new Date();
    const today = panel.clock(now.toISOString());
    expect(today).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    const older = panel.clock(new Date(now.getTime() - 3 * 86_400_000).toISOString());
    expect(older).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
    panel.setTimezone('utc');
    expect(panel.clock('2026-10-18T23:14:13.000Z')).toBe('18/10 23:14:13');
    fixture.destroy();
  });
  it.each(['reconnecting', 'blocked'] as const)('keeps the badge short and shows the full %s message in its own banner', async connection => {
    const { fixture, store } = await configure(mockStore([logEntry(1)]));
    store.connection.set(connection); store.retrySeconds.set(7); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const badge = root.querySelector('.log-connection-badge') as HTMLElement;
    expect(badge.className).toContain('truncate');
    const banner = Array.from(root.querySelectorAll('[role="status"]')).find(node => node.classList.contains('bg-warning-soft'))!;
    expect(banner.textContent).toContain(badge.getAttribute('title')!);
    expect(banner.textContent).toContain('7 s');
    fixture.destroy();
  });
});

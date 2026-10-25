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
  it('keeps compact rows and exposes the timezone as a two-choice segmented control', async () => {
    const { fixture, panel } = await configure(mockStore([logEntry(1)]));
    expect(panel.rowHeight).toBe(52);
    const timezone = fixture.nativeElement.querySelector('[role="group"][aria-label="Zona horaria"]');
    expect(timezone).not.toBeNull();
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
    const follow = fixture.nativeElement.querySelector('.log-header-links details') as HTMLDetailsElement;
    const filters = fixture.nativeElement.querySelector('.log-filter-panel') as HTMLElement;
    expect(follow).not.toBeNull(); expect(follow.open).toBe(false);
    expect(filters.closest('details')?.open).toBe(false);
    expect(fixture.nativeElement.querySelector('.log-toolbar details')).toBeTruthy();
    panel.toggleMethod('GET'); fixture.detectChanges();
    const getChip = Array.from(fixture.nativeElement.querySelectorAll('.log-method-chip') as NodeListOf<HTMLButtonElement>)
      .find(button => button.textContent?.trim() === 'GET');
    expect(getChip?.getAttribute('aria-pressed')).toBe('true'); expect(getChip?.classList.contains('is-selected')).toBe(true);
    expect(fixture.nativeElement.querySelector('.log-filter-count')?.textContent).toBe('1');
    expect(fixture.nativeElement.querySelector('.log-active-chip')?.textContent).toContain('GET');
  });
  it('closes an open disclosure with Escape and restores focus to its summary', async () => {
    const { fixture, panel } = await configure();
    const disclosure = fixture.nativeElement.querySelector('.log-header-links details') as HTMLDetailsElement;
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
});

function fullStore(entries: LogEntry[] = []) {
  return { ...mockStore(entries), jumpTo: vi.fn(), goLive: vi.fn(), loadNewer: vi.fn(async () => {}) };
}

describe('Gateway log panel states and actions', () => {
  afterEach(() => { TestBed.inject(I18n).setLocale('es'); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  async function configure(store = fullStore()) {
    await TestBed.configureTestingModule({ imports: [InfraLogs] })
      .overrideComponent(InfraLogs, { set: { providers: [{ provide: InfraLogsStore, useValue: store }] } }).compileComponents();
    TestBed.inject(I18n).setLocale('es');
    const fixture = TestBed.createComponent(InfraLogs);
    await fixture.whenStable(); fixture.detectChanges();
    const text = () => (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');
    const buttonWith = (label: string) => [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')]
      .find(button => button.textContent?.includes(label)) as HTMLButtonElement | undefined;
    return { fixture, store, panel: fixture.componentInstance, text, buttonWith };
  }

  describe('connection and source states', () => {
    it('offers resume while paused and pause while live', async () => {
      const { fixture, store, panel, buttonWith } = await configure();
      buttonWith(panel.t().pause)!.click();
      expect(store.pause).toHaveBeenCalled();

      store.connection.set('paused'); fixture.detectChanges();
      buttonWith(panel.t().resume)!.click();
      expect(store.resume).toHaveBeenCalled();
      expect(buttonWith(panel.t().backLive)).toBeTruthy();
    });

    it('announces the retry countdown while blocked or reconnecting', async () => {
      const { fixture, store, panel } = await configure();
      store.connection.set('blocked'); store.retrySeconds.set(12); fixture.detectChanges();
      const live = fixture.nativeElement.querySelector('.log-status-area [role="status"]') as HTMLElement;
      expect(live.textContent).toContain(`${panel.t().retryIn} 12 s`);

      store.connection.set('reconnecting'); fixture.detectChanges();
      expect(live.textContent).toContain(panel.t().reconnecting);
    });

    it('shows the loading text before the first page', async () => {
      const { fixture, store, panel, text } = await configure();
      store.connection.set('loading'); fixture.detectChanges();
      expect(text()).toContain(panel.t().loading);
    });

    it.each([
      ['unavailable', 'loadError'],
      ['access', 'accessError'],
      ['invalid', 'invalidFilters'],
    ] as const)('maps the %s error to its message', async (code, key) => {
      const { fixture, store, panel } = await configure();
      store.errorCode.set(code); fixture.detectChanges();
      expect(panel.errorLabel()).toBe(panel.t()[key]);
      expect(fixture.nativeElement.querySelector('.log-status-area [role="alert"]').textContent).toContain(panel.t()[key]);
    });

    it('links to the login page when the session expired', async () => {
      const { fixture, store, panel } = await configure();
      store.errorCode.set('session'); fixture.detectChanges();
      const link = fixture.nativeElement.querySelector('.log-status-area [role="alert"] a') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/login');
      expect(link.textContent).toContain(panel.t().sessionError);
    });

    it('labels every known source status', async () => {
      const { store, panel } = await configure();
      store.status.set(logStatus({ sourceStatus: 'healthy' })); expect(panel.sourceLabel()).toBe(panel.t().healthy);
      store.status.set(logStatus({ sourceStatus: 'disconnected' })); expect(panel.sourceLabel()).toBe(panel.t().disconnected);
      store.status.set(logStatus({ sourceStatus: 'starting' })); expect(panel.sourceLabel()).toBe(panel.t().starting);
    });

    it('warns about browser truncation and capacity limits', async () => {
      const { fixture, store, panel, text } = await configure();
      store.browserTruncated.set(true); store.capacityLimited.set(true); fixture.detectChanges();
      expect(text()).toContain(panel.t().browserLimit);
      expect(text()).toContain(panel.t().retention);
    });

    it('offers the latest events after a gap or reset', async () => {
      const { fixture, store, panel, buttonWith } = await configure();
      store.discontinuity.set('reset'); fixture.detectChanges();
      buttonWith(panel.t().latest)!.click();
      expect(store.refresh).toHaveBeenCalled();
    });

    it('emits disabled when the feature becomes unavailable', async () => {
      const { fixture, store, panel } = await configure();
      const disabled = vi.fn();
      panel.disabled.subscribe(disabled);
      store.unavailable.set(true); fixture.detectChanges(); await fixture.whenStable();
      expect(disabled).toHaveBeenCalled();
    });

    it('pauses the store while the tab is hidden', async () => {
      const { store } = await configure();
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(store.setVisible).toHaveBeenLastCalledWith(false);
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(store.setVisible).toHaveBeenLastCalledWith(true);
    });

    it('stops listening and destroys the store when removed', async () => {
      const { fixture, store } = await configure();
      fixture.destroy();
      expect(store.destroy).toHaveBeenCalled();
      store.setVisible.mockClear();
      document.dispatchEvent(new Event('visibilitychange'));
      expect(store.setVisible).not.toHaveBeenCalled();
    });
  });

  describe('history navigation', () => {
    it('jumps to a chosen date and resets selection', async () => {
      const { store, panel } = await configure(fullStore([logEntry(1)]));
      panel.selectedId.set('g7:1');
      panel.jumpValue.set('2026-10-25T10:00');
      panel.jumpToDate();
      expect(store.jumpTo).toHaveBeenCalledWith(new Date('2026-10-25T10:00').toISOString());
      expect(panel.autoScroll()).toBe(false);
      expect(panel.selectedId()).toBeNull();
    });

    it('does nothing without a date', async () => {
      const { store, panel } = await configure();
      panel.jumpToDate();
      expect(store.jumpTo).not.toHaveBeenCalled();
    });

    it('jumps a number of minutes back with presets', async () => {
      const { store, panel } = await configure();
      panel.jumpPreset(15);
      expect(panel.jumpValue()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      const target = Date.parse(store.jumpTo.mock.calls[0][0]);
      expect(Math.abs(Date.now() - 15 * 60_000 - target)).toBeLessThan(61_000);
    });

    it('converts instants to datetime-local values', async () => {
      const { panel } = await configure();
      expect(panel.datetimeLocal(null)).toBe('');
      expect(panel.datetimeLocal(new Date().toISOString())).toBe(panel.nowLocal());
    });

    it('shows history mode, sorts entries by time and offers newer pages', async () => {
      const older = logEntry(2, { timestamp: '2026-10-25T10:00:00.000Z' });
      const newer = logEntry(1, { timestamp: '2026-10-25T11:00:00.000Z' });
      const { fixture, store, panel, text, buttonWith } = await configure(fullStore([newer, older]));
      store.historyAt.set('2026-10-25T10:00:00.000Z'); store.hasMoreAfter.set(true); fixture.detectChanges();

      expect(text()).toContain(panel.t().historyFrom);
      expect(panel.displayedEntries().map(entry => entry.id)).toEqual(['g7:2', 'g7:1']);
      buttonWith(panel.t().newer)!.click();
      expect(store.loadNewer).toHaveBeenCalled();
    });

    it('goes back to live and clears the selection', async () => {
      const { store, panel } = await configure(fullStore([logEntry(1)]));
      panel.selectedId.set('g7:1'); panel.autoScroll.set(false);
      panel.goLive();
      expect(store.goLive).toHaveBeenCalled();
      expect(panel.selectedId()).toBeNull();
      expect(panel.autoScroll()).toBe(true);
    });

    it('explains an empty jump and offers to go back live', async () => {
      const { fixture, store, panel, text } = await configure();
      store.historyAt.set(new Date().toISOString()); fixture.detectChanges();
      expect(text()).toContain(panel.t().emptyJumpHelp);
    });

    it('explains an empty list while the source starts', async () => {
      const { fixture, store, panel, text } = await configure();
      store.status.set(logStatus({ sourceStatus: 'disconnected' })); fixture.detectChanges();
      expect(text()).toContain(panel.t().emptySourceHelp);
      expect(text()).toContain(panel.t().sourceDisconnected);
    });
  });

  describe('filters', () => {
    it('toggles levels, methods and statuses on and off', async () => {
      const { store, panel } = await configure();
      panel.toggleLevel('WARN'); panel.toggleMethod('POST'); panel.toggleStatus('5xx');
      expect(store.open).toHaveBeenLastCalledWith(expect.objectContaining({ levels: ['WARN'], methods: ['POST'], statuses: ['5xx'] }));
      panel.toggleLevel('WARN'); panel.toggleMethod('POST'); panel.toggleStatus('5xx');
      expect(store.open).toHaveBeenLastCalledWith(expect.objectContaining({ levels: [], methods: [], statuses: [] }));
    });

    it('labels every active filter and removes them one by one', async () => {
      const { fixture, store, panel } = await configure();
      panel.levels.set(['ERROR']); panel.route.set('/api/x'); panel.methods.set(['GET']); panel.statuses.set(['4xx']);
      panel.minDurationMs.set(500); panel.traceId.set('a'.repeat(32)); panel.query.set('boom');
      fixture.detectChanges();

      expect(panel.activeFilterLabels().map(item => item.label)).toEqual([
        'Nivel: ERROR', 'Ruta: /api/x', 'Método: GET', 'Estado: 4xx', '≥ 500 ms', `Trace: ${'a'.repeat(32)}`, 'Texto: boom',
      ]);
      expect(panel.hasActiveFilters()).toBe(true);

      for (const name of ['level', 'route', 'method', 'status', 'duration', 'trace', 'text'] as const) panel.removeFilter(name);
      expect(panel.activeFilterLabels()).toEqual([]);
      expect(panel.hasActiveFilters()).toBe(false);
      expect(store.open).toHaveBeenLastCalledWith(EMPTY_FILTERS);
    });

    it('removes a filter from its chip', async () => {
      const { fixture, panel } = await configure();
      panel.route.set('/api/x'); fixture.detectChanges();
      (fixture.nativeElement.querySelector('.log-active-chip') as HTMLButtonElement).click();
      expect(panel.route()).toBe('');
    });

    it('applies the presets', async () => {
      const { store, panel } = await configure();
      panel.preset('errors');
      expect(store.open).toHaveBeenLastCalledWith(expect.objectContaining({ statuses: ['4xx', '5xx'], minDurationMs: null, q: '' }));
      panel.preset('slow');
      expect(store.open).toHaveBeenLastCalledWith(expect.objectContaining({ statuses: [], minDurationMs: 1001 }));
      panel.preset('rejected');
      expect(store.open).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'JWT_REJECTED', minDurationMs: null }));
    });

    it('sets and clears the minimum duration', async () => {
      const { panel } = await configure();
      panel.setMinDuration('201'); expect(panel.minDurationMs()).toBe(201);
      panel.setMinDuration(''); expect(panel.minDurationMs()).toBeNull();
    });

    it('debounces route changes', async () => {
      const { store, panel } = await configure();
      vi.useFakeTimers();
      try {
        store.open.mockClear();
        panel.setRoute('/api/a'); panel.setRoute('/api/ab');
        vi.advanceTimersByTime(299); expect(store.open).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1); expect(store.open).toHaveBeenCalledWith(expect.objectContaining({ route: '/api/ab' }));
      } finally { vi.useRealTimers(); }
    });

    it('does not reload with invalid filters and shows the error', async () => {
      const { fixture, store, panel } = await configure();
      store.open.mockClear();
      panel.route.set('/api/\u0001'); panel.applyFilters(); fixture.detectChanges();
      expect(store.open).not.toHaveBeenCalled();
      expect(fixture.nativeElement.querySelector('#logs-filter-error')).not.toBeNull();
    });

    it('filters by a route from the stats or by a path segment', async () => {
      const { store, panel } = await configure();
      panel.filterRoute('/api/skills');
      expect(store.open).toHaveBeenLastCalledWith(expect.objectContaining({ route: '/api/skills' }));
      panel.filterPathSegment('users');
      expect(store.open).toHaveBeenLastCalledWith(expect.objectContaining({ route: '/api/users' }));
    });

    it('applies a status class from the summary', async () => {
      const { store, panel } = await configure();
      panel.applySummaryStatus('3xx');
      expect(store.open).toHaveBeenLastCalledWith(expect.objectContaining({ statuses: ['3xx'] }));
    });

    it('filters by trace only for real trace ids', async () => {
      const { store, panel } = await configure(fullStore([logEntry(1)]));
      store.open.mockClear();
      panel.filterByTrace(logEntry(2, { traceId: null }));
      panel.filterByTrace(logEntry(3, { traceId: '0'.repeat(32) }));
      expect(store.open).not.toHaveBeenCalled();
      panel.selectedId.set('g7:1');
      panel.filterByTrace(logEntry(1));
      expect(store.open).toHaveBeenCalledWith(expect.objectContaining({ traceId: '11111111111111111111111111111111' }));
      expect(panel.selectedId()).toBeNull();
    });

    it('highlights the matching part of the route', async () => {
      const { panel } = await configure();
      const entry = logEntry(1, { route: '/api/Skills/{id}' });
      expect(panel.routeParts(entry)).toEqual([{ text: '/api/Skills/{id}', match: false }]);
      panel.route.set('skills');
      expect(panel.routeParts(entry)).toEqual([
        { text: '/api/', match: false }, { text: 'Skills', match: true }, { text: '/{id}', match: false },
      ]);
      panel.route.set('nada');
      expect(panel.routeParts(entry)).toEqual([{ text: '/api/Skills/{id}', match: false }]);
      expect(panel.routeParts(logEntry(2, { route: null }))).toEqual([{ text: '', match: false }]);
      expect(panel.routeHighlighted(logEntry(2, { route: null }))).toBe('');
    });

    it('suggests up to twenty distinct routes', async () => {
      const entries = Array.from({ length: 25 }, (_, i) => logEntry(i + 1, { route: `/api/r${i % 22}` }));
      const { panel } = await configure(fullStore(entries));
      expect(panel.routeSuggestions()).toHaveLength(20);
      expect(new Set(panel.routeSuggestions()).size).toBe(20);
    });
  });

  describe('summary and route statistics', () => {
    it('counts status classes, warnings and durations', async () => {
      const entries = [
        logEntry(1, { status: 201, durationMs: 10 }),
        logEntry(2, { status: 302, durationMs: 30 }),
        logEntry(3, { status: 404, level: 'WARN', durationMs: null }),
        logEntry(4, { status: 503, level: 'ERROR', durationMs: 2000 }),
        logEntry(5, { status: null, durationMs: null }),
      ];
      const { panel } = await configure(fullStore(entries));
      expect(panel.summaryStats()).toEqual({ classes: { '2xx': 1, '3xx': 1, '4xx': 1, '5xx': 1 }, warningsErrors: 2, slowest: 2000, average: 680 });
    });

    it('reports no durations as empty', async () => {
      const { panel } = await configure(fullStore([logEntry(1, { durationMs: null })]));
      expect(panel.summaryStats().slowest).toBeNull();
      expect(panel.summaryStats().average).toBeNull();
    });

    it('ranks frequent and failing routes', async () => {
      const entries = [
        logEntry(1, { route: '/api/a', status: 200 }), logEntry(2, { route: '/api/a', status: 500 }),
        logEntry(3, { route: '/api/b', status: 404 }), logEntry(4, { route: '/api/b', status: 404 }),
        logEntry(5, { route: '/api/b', status: 200 }), logEntry(6, { route: '/api/c', status: 200 }),
      ];
      const { panel } = await configure(fullStore(entries));
      expect(panel.frequentRoutes().map(item => item.route).slice(0, 2)).toEqual(['/api/b', '/api/a']);
      expect(panel.errorRoutes().every(item => item.errorCount > 0)).toBe(true);
      expect(panel.errorRoutes()[0].route).toBe('/api/b');
    });
  });

  describe('grouping and the list', () => {
    const repeated = () => [
      logEntry(1, { level: 'WARN', event: 'X', lines: ['boom'], timestamp: '2026-10-25T10:00:00.000Z' }),
      logEntry(2, { level: 'WARN', event: 'X', lines: ['boom'], timestamp: '2026-10-25T10:05:00.000Z' }),
    ];

    it('groups repeated events and expands their timeline', async () => {
      const { fixture, panel } = await configure(fullStore(repeated()));
      const group = panel.displayedGroups()[0];
      expect(panel.displayedGroups()).toHaveLength(1);
      expect(group.entries).toHaveLength(2);
      panel.toggleExpanded(group); fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(`${panel.t().groupTimeline} · 2`);
      expect(panel.expandedGroupData()?.key).toBe(group.key);
      expect(panel.groupTimes(group)).toEqual({ first: '2026-10-25T10:00:00.000Z', last: '2026-10-25T10:05:00.000Z' });
      panel.toggleExpanded(group);
      expect(panel.expandedGroup()).toBeNull();
    });

    it('turns grouping off and collapses any open group', async () => {
      const { panel } = await configure(fullStore(repeated()));
      panel.expandedGroup.set('x');
      panel.toggleGrouping();
      expect(panel.groupRepeated()).toBe(false);
      expect(panel.expandedGroup()).toBeNull();
      expect(panel.displayedGroups()).toHaveLength(2);
    });

    it('paginates in the accessible view', async () => {
      const entries = Array.from({ length: 320 }, (_, i) => logEntry(i + 1, { lines: [`l${i}`], event: `E${i}` }));
      const { fixture, panel } = await configure(fullStore(entries));
      panel.groupRepeated.set(false);
      panel.toggleAccessible(); fixture.detectChanges();
      expect(panel.pageCount()).toBe(3);
      expect(panel.pageIndex()).toBe(2);
      expect(panel.topSpace()).toBe(0);
      expect(panel.bottomSpace()).toBe(0);

      panel.changePage(-1); expect(panel.pageIndex()).toBe(1);
      panel.changePage(-5); expect(panel.pageIndex()).toBe(0);
      panel.changePage(10); expect(panel.pageIndex()).toBe(2);
      expect(panel.visibleGroups()).toHaveLength(20);

      panel.toggleAccessible();
      expect(panel.accessible()).toBe(false);
    });

    it('keeps the anchor when older events load in the accessible view', async () => {
      const { panel, store } = await configure(fullStore([logEntry(1)]));
      panel.accessible.set(true); panel.pageIndex.set(3);
      await panel.loadOlder();
      expect(store.loadOlder).toHaveBeenCalled();
      expect(panel.pageIndex()).toBe(0);
    });

    it('jumps to the end and acknowledges new events unless paused', async () => {
      const { fixture, store, panel } = await configure(fullStore([logEntry(1)]));
      panel.accessible.set(true); fixture.detectChanges();
      store.acknowledgeNew.mockClear();
      panel.goToEnd();
      expect(store.acknowledgeNew).toHaveBeenCalled();

      store.connection.set('paused'); store.acknowledgeNew.mockClear();
      panel.goToEnd();
      expect(store.acknowledgeNew).not.toHaveBeenCalled();
    });

    it('shows the pending count button when not following', async () => {
      const { fixture, store, panel, buttonWith } = await configure(fullStore([logEntry(1)]));
      panel.autoScroll.set(false); store.newCount.set(4); fixture.detectChanges();
      expect(buttonWith(`4 ${panel.t().newEvents}`)).toBeTruthy();
    });
  });

  describe('detail panel', () => {
    const detailed = () => [
      logEntry(1, { status: 503, durationMs: 1500, reason: 'timeout', level: 'ERROR', logger: 'com.skillhub.Gateway' }),
      logEntry(2, { status: null, durationMs: null, method: null, route: null, spanId: null, traceId: null, lines: ['solo texto', 'at com.skillhub.App.run(App.java:1)', 'otra'] }),
      logEntry(3),
    ];

    it('shows all fields of a request event', async () => {
      const { fixture, panel, text } = await configure(fullStore(detailed()));
      panel.detail(panel.store.entries()[0]); fixture.detectChanges();
      expect(text()).toContain('timeout');
      expect(text()).toContain(panel.t().slow);
      expect(text()).toContain('(Gateway)');
      expect(text()).toContain('Trace ID');
      expect(text()).toContain('Span ID');
    });

    it('shows placeholders and the continuation lines of a plain event', async () => {
      const { fixture, panel } = await configure(fullStore(detailed()));
      const entry = panel.store.entries()[1];
      panel.detail(entry); fixture.detectChanges();
      expect(panel.summary(entry)).toBe('solo texto');
      expect(panel.relatedEntries(entry)).toEqual([]);
      expect(panel.continuationLines(entry)).toEqual([
        { text: 'at com.skillhub.App.run(App.java:1)', applicationFrame: true },
        { text: 'otra', applicationFrame: false },
      ]);
      expect(panel.continuationText(entry)).toBe('at com.skillhub.App.run(App.java:1)\notra');
      expect(fixture.nativeElement.querySelector('.application-frame')).not.toBeNull();
    });

    it('moves between events and stops at the ends', async () => {
      const { panel } = await configure(fullStore(detailed()));
      panel.selectedId.set('g7:1');
      panel.navigateDetail(-1); expect(panel.selectedId()).toBe('g7:1');
      panel.navigateDetail(1); expect(panel.selectedId()).toBe('g7:2');
      panel.navigateDetail(1); panel.navigateDetail(1); expect(panel.selectedId()).toBe('g7:3');
      expect(panel.detailIndex(panel.store.entries()[2])).toBe(2);
    });

    it('returns focus to the row when the detail closes', async () => {
      const { fixture, panel } = await configure(fullStore(detailed()));
      panel.selectedId.set('g7:2'); fixture.detectChanges();
      panel.closeDetail(); fixture.detectChanges();
      await Promise.resolve(); await Promise.resolve();
      expect(panel.selectedId()).toBeNull();
      expect((document.activeElement as HTMLElement).dataset['logId'] ?? document.activeElement?.className).toBeTruthy();
    });

    it('summarizes events with or without status and duration', async () => {
      const { panel } = await configure();
      expect(panel.summary(logEntry(1, { status: null, durationMs: null }))).toBe('GET /api/example/{id}');
      expect(panel.summary(logEntry(1, { method: null, lines: [] }))).toBe('REQUEST_COMPLETED');
    });
  });

  describe('formatting helpers', () => {
    it('maps levels to tones and statuses to colours', async () => {
      const { panel } = await configure();
      expect(panel.tone('ERROR')).toBe('danger');
      expect(panel.tone('WARN')).toBe('warning');
      expect(panel.tone('INFO')).toBe('neutral');
      expect(panel.statusClass(204)).toBe('text-success');
      expect(panel.statusClass(418)).toBe('text-warning');
      expect(panel.statusClass(502)).toBe('text-danger');
      expect(panel.statusClass(101)).toBe('text-text-muted');
      expect(panel.statusClass(700)).toBe('text-text-muted');
    });

    it('detects real trace and span ids', async () => {
      const { panel } = await configure();
      expect(panel.hasSpanId(logEntry(1))).toBe(true);
      expect(panel.hasSpanId(logEntry(1, { spanId: '0'.repeat(16) }))).toBe(false);
      expect(panel.hasSpanId(logEntry(1, { spanId: null }))).toBe(false);
    });

    it('formats times in local or UTC and says ahora for recent events', async () => {
      const { panel } = await configure();
      const stamp = '2026-10-25T10:00:00.000Z';
      expect(panel.time(null)).toBe(panel.t().noEvent);
      panel.setTimezone('utc');
      expect(panel.time(stamp)).toContain('10:00:00');
      expect(panel.fullTime(stamp)).toContain('10:00:00');
      expect(panel.utcTime(stamp)).toBe(stamp);
      expect(panel.relativeTime(new Date().toISOString())).toBe('ahora');
      expect(panel.relativeTime(stamp)).toBe(panel.time(stamp));
      panel.toggleTimezone(); expect(panel.timezone()).toBe('local');
      panel.toggleTimezone(); expect(panel.timezone()).toBe('utc');
    });

    it('shortens logger names and picks the text for the current language', async () => {
      const { panel } = await configure();
      expect(panel.shortLogger('com.skillhub.web.Controller')).toBe('Controller');
      expect(panel.shortLogger('Plain')).toBe('Plain');
      expect(panel.language({ es: 'hola', en: 'hello' })).toBe('hola');
      TestBed.inject(I18n).setLocale('en');
      expect(panel.language({ es: 'hola', en: 'hello' })).toBe('hello');
      expect(panel.statusLabel(404)).toBeTruthy();
    });

    it('explains rejected tokens and unexpected errors in the row', async () => {
      const { panel } = await configure();
      expect(panel.showRowExplanation(logEntry(1, { event: 'JWT_REJECTED', reason: 'session-closed', status: 200, level: 'INFO' }))).toBe(true);
      expect(panel.showRowExplanation(logEntry(1, { event: 'UNEXPECTED_ERROR', status: null, level: 'INFO' }))).toBe(true);
      expect(panel.showRowExplanation(logEntry(1, { event: 'JWT_REJECTED', reason: 'otro', status: 200, level: 'INFO' }))).toBe(false);
      expect(panel.showRowExplanation(logEntry(1, { status: 200, level: 'INFO' }))).toBe(false);
    });
  });

  describe('copy and download', () => {
    it('copies the issue report for one event or the first fifty', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
      const { panel } = await configure(fullStore([logEntry(1), logEntry(2)]));
      await panel.copyIssue(logEntry(1));
      await panel.copyIssue();
      expect(writeText).toHaveBeenCalledTimes(2);
      expect(panel.copyResult()).toBe('copied');
    });

    it.each(['json', 'csv', 'txt'] as const)('downloads the view as %s', async format => {
      const created: Blob[] = [];
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      vi.stubGlobal('URL', Object.assign(URL, {
        createObjectURL: vi.fn((blob: Blob) => { created.push(blob); return 'blob:x'; }),
        revokeObjectURL: vi.fn(),
      }));
      const { panel, store } = await configure(fullStore([logEntry(1)]));
      store.status.set(logStatus());
      panel.downloadView(format);
      expect(click).toHaveBeenCalled();
      expect(created[0].type).toContain(format === 'json' ? 'application/json' : format === 'csv' ? 'text/csv' : 'text/plain');
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
    });

    it('does nothing when closing a disclosure that is not open', async () => {
      const { panel } = await configure();
      const details = document.createElement('details');
      const inner = document.createElement('span');
      details.appendChild(inner);
      const event = new KeyboardEvent('keydown', { cancelable: true });
      Object.defineProperty(event, 'target', { value: inner });
      panel.closeDisclosure(event);
      expect(event.defaultPrevented).toBe(false);
    });
  });
});

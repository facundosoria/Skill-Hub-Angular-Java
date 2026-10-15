import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { InfraLogs } from './infra-logs';
import { InfraLogsStore } from './infra-logs.store';
import { logEntry, logStatus } from './infra-logs.fixtures';
import { LogConnection, LogEntry } from './infra-logs.models';

function mockStore(entries: LogEntry[] = []) {
  return { entries: signal(entries), connection: signal<LogConnection>('live'), status: signal(logStatus()),
    lastEventAt: signal<string | null>(null), capacityLimited: signal(false), browserTruncated: signal(false),
    discontinuity: signal<'gap' | 'reset' | null>(null), newCount: signal(0), retrySeconds: signal(0),
    loadingHistory: signal(false), hasMoreBefore: signal(true), unavailable: signal(false),
    errorCode: signal<'unavailable' | 'session' | 'access' | 'invalid' | null>(null),
    open: vi.fn(), resume: vi.fn(), pause: vi.fn(), refresh: vi.fn(), loadOlder: vi.fn(async () => {}),
    setVisible: vi.fn(), acknowledgeNew: vi.fn(), destroy: vi.fn() };
}
describe('Gateway log panel', () => {
  async function configure(store = mockStore()) {
    await TestBed.configureTestingModule({ imports: [InfraLogs] })
      .overrideComponent(InfraLogs, { set: { providers: [{ provide: InfraLogsStore, useValue: store }] } }).compileComponents();
    const fixture = TestBed.createComponent(InfraLogs);
    await fixture.whenStable(); fixture.detectChanges();
    return { fixture, store, panel: fixture.componentInstance };
  }
  it('renders HTML and ANSI payloads as text in both summaries and multiline details', async () => {
    const malicious = '<img src=x onerror="alert(1)"><script>fixture</script>\u001b[31mERROR';
    const { fixture, panel } = await configure(mockStore([logEntry(150, { method: null, route: null, lines: [malicious, '<b>second line</b>'] })]));
    panel.selectedId.set('g7:150'); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')).toBeNull(); expect(fixture.nativeElement.querySelector('script')).toBeNull();
    expect(fixture.nativeElement.querySelector('pre').textContent).toBe(malicious + '\n<b>second line</b>');
    expect(fixture.nativeElement.textContent).toContain(malicious);
    expect(fixture.nativeElement.querySelector('[role="list"]').getAttribute('aria-live')).toBe('off');
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
    expect(store.open).toHaveBeenLastCalledWith({ levels: ['WARN'], q: 'literal.*', traceId: 'A'.repeat(32) });
    panel.clearFilters(); expect(store.open).toHaveBeenLastCalledWith({ levels: [], q: '', traceId: '' });
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

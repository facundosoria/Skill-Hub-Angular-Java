import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { InfraService, InfraStateView } from '../../core/infra';
import { Infra } from './infra';
import { FakeLogSource, logPage, logStatus } from './infra-logs.fixtures';
import { LOG_EVENT_SOURCE } from './infra-logs.stream';

const BASE = '/api/infra/logs/api-gateway';
async function settle() { for (let index = 0; index < 12; index++) await Promise.resolve(); }
const state: InfraStateView = { enabled: false, configured: false, generatedAt: '2026-10-14T06:00:00Z',
  source: { registryConfigured: false, registryOk: false, lastCheckAt: null },
  summary: { total: 0, up: 0, down: 0, degraded: 0, unknown: 0, noAccess: 0 }, services: [],
  frontendNodes: { enabled: false, available: false, status: 'unavailable', nodes: [] } };

describe('Infra logs tab integration', () => {
  let http: HttpTestingController;
  let sources: FakeLogSource[];
  beforeEach(async () => {
    sources = []; vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    await TestBed.configureTestingModule({ imports: [Infra], providers: [provideHttpClient(), provideHttpClientTesting(),
      { provide: InfraService, useValue: { state: () => of(state) } },
      { provide: LOG_EVENT_SOURCE, useValue: (url: string) => { const source = new FakeLogSource(url); sources.push(source); return source; } }] }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { http.verify(); vi.restoreAllMocks(); });
  it('hides the logs tab on status 404 and preserves the existing state view', async () => {
    const fixture = TestBed.createComponent(Infra);
    http.expectOne(BASE + '/status').flush({}, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="tablist"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Monitoreo deshabilitado'); expect(sources).toHaveLength(0);
  });
  it('preserves Infra when the status probe fails with 503', async () => {
    const fixture = TestBed.createComponent(Infra);
    http.expectOne(BASE + '/status').flush({}, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable(); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('Monitoreo deshabilitado');
    expect(fixture.componentInstance.error()).toBe(false);
  });
  it('shows logs independently of availability monitoring and closes SSE when leaving the tab', async () => {
    const fixture = TestBed.createComponent(Infra); http.expectOne(BASE + '/status').flush(logStatus());
    await fixture.whenStable(); fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('#infra-tab-logs') as HTMLButtonElement;
    expect(button.textContent).toContain('Logs'); expect(button.getAttribute('aria-selected')).toBe('false');
    expect(document.hidden).toBe(false);
    button.click(); fixture.detectChanges(); http.expectOne(req => req.url === BASE).flush(logPage());
    await settle(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#infra-panel-logs')).not.toBeNull(); expect(sources).toHaveLength(1);
    fixture.nativeElement.querySelector('#infra-tab-state').click(); await fixture.whenStable(); fixture.detectChanges();
    expect(sources[0].closed).toBe(true); expect(fixture.nativeElement.textContent).toContain('Monitoreo deshabilitado');
  });
  it('supports arrow and Home keys with tab/tabpanel selection', async () => {
    const fixture = TestBed.createComponent(Infra); http.expectOne(BASE + '/status').flush(logStatus());
    await fixture.whenStable(); fixture.detectChanges();
    fixture.nativeElement.querySelector('#infra-tab-state').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges(); http.expectOne(req => req.url === BASE).flush(logPage()); await settle(); await fixture.whenStable(); fixture.detectChanges();
    const tab = fixture.nativeElement.querySelector('#infra-tab-logs'); expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(tab.getAttribute('aria-controls')).toBe('infra-panel-logs');
    tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.activeTab()).toBe('state');
  });
});

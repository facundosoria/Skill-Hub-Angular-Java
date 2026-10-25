import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { InfraService, type InfraStateView } from '../../core/infra';
import { Infra } from './infra';

function stateView(overrides: Partial<InfraStateView> = {}): InfraStateView {
  return {
    enabled: true,
    configured: true,
    generatedAt: '2026-10-06T00:00:00Z',
    source: { registryConfigured: true, registryOk: true, lastCheckAt: '2026-10-06T00:00:00Z' },
    summary: { total: 2, up: 1, down: 0, degraded: 1, unknown: 0, noAccess: 0 },
    services: [
      {
        name: 'users-service',
        displayName: 'users-service',
        state: 'UP',
        reason: null,
        coverage: 'full',
        uptimeSeconds: 90061,
        instances: 2,
        lastObservedAt: '2026-10-06T00:00:00Z',
        lastHealthyAt: new Date(Date.now() - 30_000).toISOString(),
        lastRegistryLeaseAt: '2026-10-06T00:00:00Z',
        availability24h: {
          observedSeconds: 3600,
          availableSeconds: 3500,
          degradedSeconds: 100,
          unobservedSeconds: 0,
          availability: 0.97,
          coverage: 0.9,
          hasData: true,
        },
        availability7d: null,
      },
      {
        name: 'llm-service',
        displayName: 'llm-service',
        state: 'DEGRADED',
        reason: 'actuator_unreachable',
        coverage: 'unavailable',
        uptimeSeconds: null,
        instances: 1,
        lastObservedAt: '2026-10-06T00:00:00Z',
        lastHealthyAt: null,
        lastRegistryLeaseAt: '2026-10-06T00:00:00Z',
        availability24h: null,
        availability7d: null,
      },
    ],
    frontendNodes: { enabled: false, available: false, status: 'unavailable', nodes: [] },
    ...overrides,
  };
}

describe('Infra component', () => {
  async function configure(view: InfraStateView) {
    await TestBed.configureTestingModule({
      imports: [Infra],
      providers: [{ provide: InfraService, useValue: { state: () => of(view) } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(Infra);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('renders the expected services with state, uptime and availability', async () => {
    const fixture = await configure(stateView());
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('users-service');
    expect(text).toContain('llm-service');
    expect(text).toContain('OK');
    expect(text).toContain('Degradado');
    expect(text).toContain('1d 1h');
    expect(text).toContain('97%');
  });

  it('shows no fabricated data when the feature is disabled', async () => {
    const fixture = await configure(
      stateView({
        enabled: false,
        source: { registryConfigured: false, registryOk: false, lastCheckAt: null },
        services: [
          {
            name: 'users-service',
            displayName: 'users-service',
            state: 'UNKNOWN',
            reason: null,
            coverage: null,
            uptimeSeconds: null,
            instances: 0,
            lastObservedAt: null,
            lastHealthyAt: null,
            lastRegistryLeaseAt: null,
            availability24h: null,
            availability7d: null,
          },
        ],
        frontendNodes: { enabled: false, available: false, status: 'unavailable', nodes: [] },
      }),
    );
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Monitoreo deshabilitado');
    expect(text).toContain('Desconocido');
    expect(text).toContain('Sin dato');
  });

  it('never renders internal endpoints or mesh details', async () => {
    const fixture = await configure(stateView());
    const html = fixture.nativeElement.innerHTML as string;
    expect(html).not.toContain('127.0.0.1');
    expect(html).not.toContain('management.port');
    expect(html).not.toContain('100.64');
    expect(html).not.toContain('tailnet');
  });

  it('reports an error state instead of stale data on failure', async () => {
    await TestBed.configureTestingModule({
      imports: [Infra],
      providers: [{ provide: InfraService, useValue: { state: () => throwError(() => new Error('boom')) } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(Infra);
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement.textContent as string)).toContain('No se pudo cargar');
  });

  describe('labels and formatting', () => {
    async function component() {
      return (await configure(stateView())).componentInstance;
    }

    it('maps every state to a tone and a label', async () => {
      const infra = await component();
      const i = infra.t().infra;
      expect(infra.stateTone('UP')).toBe('success');
      expect(infra.stateTone('DOWN')).toBe('danger');
      expect(infra.stateTone('DEGRADED')).toBe('warning');
      expect(infra.stateTone('UNKNOWN')).toBe('neutral');
      expect(infra.stateLabel('UP')).toBe(i.estadoUp);
      expect(infra.stateLabel('DOWN')).toBe(i.estadoDown);
      expect(infra.stateLabel('DEGRADED')).toBe(i.estadoDegraded);
      expect(infra.stateLabel('NO_ACCESS')).toBe(i.estadoNoAccess);
      expect(infra.stateLabel('UNKNOWN')).toBe(i.estadoUnknown);
    });

    it('labels coverage values', async () => {
      const infra = await component();
      const i = infra.t().infra;
      expect(infra.coverageLabel('full')).toBe(i.coberturaFull);
      expect(infra.coverageLabel('partial')).toBe(i.coberturaPartial);
      expect(infra.coverageLabel('unavailable')).toBe(i.coberturaUnavailable);
      expect(infra.coverageLabel(null)).toBe(i.sinDato);
    });

    it('formats availability with and without coverage', async () => {
      const infra = await component();
      const base = { observedSeconds: 1, availableSeconds: 1, degradedSeconds: 0, unobservedSeconds: 0 };
      expect(infra.availabilityLabel(null)).toBe(infra.t().infra.sinDato);
      expect(infra.availabilityLabel({ ...base, availability: 0.5, coverage: 1, hasData: false })).toBe(infra.t().infra.sinDato);
      expect(infra.availabilityLabel({ ...base, availability: null, coverage: 1, hasData: true })).toBe(infra.t().infra.sinDato);
      expect(infra.availabilityLabel({ ...base, availability: 0.987, coverage: null, hasData: true })).toBe('99%');
      expect(infra.availabilityLabel({ ...base, availability: 0.5, coverage: 0.25, hasData: true })).toBe('50% (25%)');
    });

    it('formats uptime in days, hours or minutes', async () => {
      const infra = await component();
      expect(infra.uptimeLabel(null)).toBe(infra.t().infra.sinDato);
      expect(infra.uptimeLabel(2 * 86400 + 3 * 3600)).toBe('2d 3h');
      expect(infra.uptimeLabel(5 * 3600 + 7 * 60)).toBe('5h 7m');
      expect(infra.uptimeLabel(59)).toBe('0m');
    });

    it('formats relative and absolute times', async () => {
      const infra = await component();
      const i = infra.t().infra;
      const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
      expect(infra.relative(null)).toBe(i.nunca);
      expect(infra.relative('no es fecha')).toBe(i.sinDato);
      expect(infra.relative(ago(1))).toBe(i.relAhora);
      expect(infra.relative(ago(30))).toBe(i.relSegundos.replace('{n}', '30'));
      expect(infra.relative(ago(120))).toBe(i.relMinutos.replace('{n}', '2'));
      expect(infra.relative(ago(7200))).toBe(i.relHoras.replace('{n}', '2'));
      expect(infra.relative(ago(3 * 86400))).toBe(i.relDias.replace('{n}', '3'));
      expect(infra.relative(new Date(Date.now() + 60_000).toISOString())).toBe(i.relAhora);
      expect(infra.absolute(null)).toBe('');
      expect(infra.absolute('no es fecha')).toBe('');
      expect(infra.absolute('2026-10-06T00:00:00Z')).not.toBe('');
    });
  });

  describe('frontend nodes and reloading', () => {
    it('lists frontend nodes and flags missing build data', async () => {
      const fixture = await configure(stateView({
        frontendNodes: { enabled: true, available: true, status: 'ok', nodes: [
          { label: 'nodo-a', buildDataAvailable: true }, { label: 'nodo-b', buildDataAvailable: false },
        ] } as unknown as InfraStateView['frontendNodes'],
      }));
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('nodo-a');
      expect(text).toContain(fixture.componentInstance.t().infra.sinBuild);
    });

    it('says the nodes are pending when enabled but not yet available', async () => {
      const fixture = await configure(stateView({
        frontendNodes: { enabled: true, available: false, status: 'unavailable', nodes: [] },
      }));
      expect(fixture.nativeElement.textContent).toContain(fixture.componentInstance.t().infra.nodosPendiente);
    });

    it('reloads the state from the refresh button', async () => {
      const state = vi.fn(() => of(stateView()));
      await TestBed.configureTestingModule({
        imports: [Infra],
        providers: [{ provide: InfraService, useValue: { state } }],
      }).compileComponents();
      const fixture = TestBed.createComponent(Infra);
      await fixture.whenStable();
      fixture.detectChanges();

      (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(state).toHaveBeenCalledTimes(2);
    });
  });

  describe('logs tab', () => {
    it('switches tabs with the keyboard and hides the logs when disabled', async () => {
      const fixture = await configure(stateView());
      const infra = fixture.componentInstance;
      infra.logsEnabled.set(true);
      fixture.detectChanges();
      const tab = fixture.nativeElement.querySelector('#infra-tab-state') as HTMLButtonElement;
      const press = (key: string) => {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        tab.dispatchEvent(event);
        return event;
      };

      expect(press('a').defaultPrevented).toBe(false);
      expect(press('ArrowRight').defaultPrevented).toBe(true);
      expect(infra.activeTab()).toBe('logs');
      press('ArrowLeft');
      expect(infra.activeTab()).toBe('state');
      press('End');
      expect(infra.activeTab()).toBe('logs');
      press('Home');
      expect(infra.activeTab()).toBe('state');

      infra.activeTab.set('logs');
      infra.hideLogs();
      expect(infra.logsEnabled()).toBe(false);
      expect(infra.activeTab()).toBe('state');
    });
  });
});

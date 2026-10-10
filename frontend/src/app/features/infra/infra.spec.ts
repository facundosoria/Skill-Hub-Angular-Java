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
});

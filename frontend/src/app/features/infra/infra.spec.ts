import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { InfraService, type InfraStateView } from '../../core/infra';
import { Infra } from './infra';
import { InfraLogsApi } from './infra-logs.api';

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
        dependsOn: ['llm-service'],
        publishesTo: [],
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
        dependsOn: [],
        publishesTo: [],
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
            dependsOn: [],
            publishesTo: [],
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

  describe('Mapa tab', () => {
    async function openMap(view: InfraStateView) {
      const fixture = await configure(view);
      (fixture.nativeElement.querySelector('#infra-tab-map') as HTMLButtonElement).click();
      fixture.detectChanges();
      return fixture;
    }

    it('shows the tabs next to the refresh button and opens the map without the logs tab', async () => {
      const fixture = await openMap(stateView());
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('#infra-tab-logs')).toBeNull();
      expect(root.querySelector('#infra-panel-map')).not.toBeNull();
      expect(root.querySelectorAll('svg [role="button"]').length).toBe(2);
    });

    it('draws only the declared connections and shows them in the detail panel', async () => {
      const fixture = await openMap(stateView());
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelectorAll('svg[role="group"] line').length).toBe(1);
      (root.querySelector('svg [role="button"]') as SVGGElement).dispatchEvent(new Event('click'));
      fixture.detectChanges();
      const text = root.querySelector('aside')!.textContent as string;
      expect(text).toContain('users-service');
      expect(text).toContain('llm-service');
    });

    it('puts the most connected service at the center of the map', async () => {
      const base = stateView();
      const view = stateView({
        services: [
          { ...base.services[0], name: 'a-service', displayName: 'a-service', dependsOn: ['hub-service'], publishesTo: [] },
          { ...base.services[0], name: 'b-service', displayName: 'b-service', dependsOn: ['hub-service'], publishesTo: [] },
          { ...base.services[0], name: 'hub-service', displayName: 'hub-service', dependsOn: [], publishesTo: [] },
        ],
      });
      const fixture = await openMap(view);
      const hub = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('svg [role="button"]'))
        .find((node) => node.getAttribute('aria-label')?.startsWith('hub-service'))!;
      expect(hub.getAttribute('transform')).toBe('translate(450,265)');
    });

    it('draws HTTP calls and Kafka events as different relations and lets each layer be hidden', async () => {
      const base = stateView();
      const view = stateView({
        services: [
          { ...base.services[0], name: 'a-service', displayName: 'a-service', dependsOn: ['b-service'], publishesTo: ['b-service'] },
          { ...base.services[0], name: 'b-service', displayName: 'b-service', dependsOn: [], publishesTo: [] },
        ],
      });
      const fixture = await openMap(view);
      const root = fixture.nativeElement as HTMLElement;
      const lines = () => Array.from(root.querySelectorAll('svg[role="group"] line'));
      expect(lines().length).toBe(2);
      expect(lines().filter((line) => line.getAttribute('stroke-dasharray')).length).toBe(1);

      const eventLayer = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes('Eventos Kafka')) as HTMLButtonElement;
      eventLayer.click();
      fixture.detectChanges();
      expect(lines().length).toBe(1);
      expect(lines().filter((line) => line.getAttribute('stroke-dasharray')).length).toBe(0);
    });

    it('lists calls and events in both directions in the detail panel and keeps the gateway at the center', async () => {
      const base = stateView();
      const svc = (name: string, dependsOn: string[], publishesTo: string[]) =>
        ({ ...base.services[0], name, displayName: name, dependsOn, publishesTo });
      const view = stateView({
        services: [svc('api-gateway', ['llm-service', 'course-service'], []), svc('llm-service', [], ['course-service']), svc('course-service', ['llm-service'], [])],
      });
      const fixture = await openMap(view);
      const root = fixture.nativeElement as HTMLElement;
      const gateway = Array.from(root.querySelectorAll('svg [role="button"]')).find((n) => n.getAttribute('aria-label')?.startsWith('api-gateway'))!;
      expect(gateway.getAttribute('transform')).toBe('translate(450,265)');
      const llm = Array.from(root.querySelectorAll('svg [role="button"]')).find((n) => n.getAttribute('aria-label')?.startsWith('llm-service'))!;
      llm.dispatchEvent(new Event('click'));
      fixture.detectChanges();
      const text = root.querySelector('aside')!.textContent as string;
      expect(text).toContain('Recibe llamadas de');
      expect(text).toContain('api-gateway');
      expect(text).toContain('Publica eventos a');
      expect(text).toContain('course-service');
    });

    it('says explicitly that no connections are declared instead of inventing them', async () => {
      const base = stateView();
      const view = stateView({ services: base.services.map((svc) => ({ ...svc, dependsOn: [], publishesTo: [] })) });
      const fixture = await openMap(view);
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelectorAll('svg[role="group"] line').length).toBe(0);
      expect(root.textContent).toContain('Todavía no hay conexiones declaradas');
    });
  });

  describe('Estado (propuesta A)', () => {
    const base = () => stateView().services[0];
    const svc = (name: string, state: 'UP' | 'DOWN' | 'DEGRADED' | 'UNKNOWN', extra: Record<string, unknown> = {}) =>
      ({ ...base(), name, displayName: name, state, ...extra }) as InfraStateView['services'][number];
    const rowNames = (root: HTMLElement) =>
      Array.from(root.querySelectorAll('tbody tr')).map((row) => row.querySelector('td span')?.textContent?.trim());

    it('sorts the table so what fails comes first and warns about down or degraded services', async () => {
      const fixture = await configure(stateView({
        services: [svc('ok-a', 'UP'), svc('slow', 'DEGRADED', { reason: 'latency_degraded' }), svc('ok-b', 'UP'), svc('broken', 'DOWN'), svc('mystery', 'UNKNOWN')],
      }));
      const root = fixture.nativeElement as HTMLElement;
      expect(rowNames(root)).toEqual(['broken', 'slow', 'mystery', 'ok-a', 'ok-b']);
      const alert = root.querySelector('[role="status"]')!.textContent as string;
      expect(alert).toContain('Requieren atención (2)');
      expect(alert).toContain('broken'); expect(alert).toContain('slow'); expect(alert).not.toContain('ok-a');
    });

    it('filters the table from the summary chips and lets the same chip clear the filter', async () => {
      const fixture = await configure(stateView({
        services: [svc('ok-a', 'UP'), svc('slow', 'DEGRADED'), svc('ok-b', 'UP')],
        summary: { total: 3, up: 2, down: 0, degraded: 1, unknown: 0, noAccess: 0 },
      }));
      const root = fixture.nativeElement as HTMLElement;
      const chip = (label: string) => Array.from(root.querySelectorAll('button[aria-pressed]')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
      expect(chip('Caídos').disabled).toBe(true);
      chip('Degradados').click(); fixture.detectChanges();
      expect(rowNames(root)).toEqual(['slow']);
      expect(chip('Degradados').getAttribute('aria-pressed')).toBe('true');
      chip('Degradados').click(); fixture.detectChanges();
      expect(rowNames(root)).toEqual(['slow', 'ok-a', 'ok-b']);
    });

    it('shows no attention alert when everything is up and mutes the zero counters', async () => {
      const fixture = await configure(stateView({ services: [svc('ok-a', 'UP')],
        summary: { total: 1, up: 1, down: 0, degraded: 0, unknown: 0, noAccess: 0 } }));
      const root = fixture.nativeElement as HTMLElement;
      expect(root.textContent).not.toContain('Requieren atención');
      const counter = (label: string) => Array.from(root.querySelectorAll('strong')).find((node) => node.textContent?.trim() === label)!;
      expect(counter('OK').className).toContain('text-success');
      expect(counter('Caídos').className).toContain('text-text-faint');
      expect(counter('Degradados').className).toContain('text-text-faint');
    });

    it('draws availability as 24 h and 7 d bars and mentions coverage only when it is not full', async () => {
      const availability = (value: number) => ({ observedSeconds: 1, availableSeconds: 1, degradedSeconds: 0, unobservedSeconds: 0, availability: value, coverage: 1, hasData: true });
      const fixture = await configure(stateView({
        services: [
          svc('good', 'UP', { availability24h: availability(1), availability7d: availability(0.77), coverage: 'full' }),
          svc('partial', 'UP', { availability24h: availability(0.9), availability7d: null, coverage: 'partial' }),
        ],
      }));
      const root = fixture.nativeElement as HTMLElement;
      const rows = Array.from(root.querySelectorAll('tbody tr')) as HTMLElement[];
      const bar = (row: HTMLElement, index: number) => row.querySelectorAll('span[aria-hidden="true"] > span')[index] as HTMLElement;
      expect(rows[0].textContent).toContain('100%'); expect(rows[0].textContent).toContain('77%');
      expect(bar(rows[0], 0).className).toContain('bg-success'); expect(bar(rows[0], 1).className).toContain('bg-danger');
      expect(bar(rows[0], 0).style.width).toBe('100%');
      expect(rows[0].textContent).not.toContain('Cobertura');
      expect(rows[1].textContent).toContain('Cobertura: Parcial'); expect(rows[1].textContent).toContain('Sin dato');
      expect(root.querySelector('thead')!.textContent).not.toContain('Cobertura');
    });

    it('keeps the source and frontend nodes as a single footer line and shows the last read next to refresh', async () => {
      const fixture = await configure(stateView());
      const root = fixture.nativeElement as HTMLElement;
      const footer = root.querySelector('section > div:last-child') as HTMLElement;
      expect(footer.textContent).toContain('Registro de servicios'); expect(footer.textContent).toContain('Nodos frontend');
      const header = root.querySelector('#infra-tab-state')!.parentElement!.parentElement!;
      expect(header.textContent).toContain('Actualizado hace');
      expect(header.querySelector('button[aria-label="Actualizar"]')).not.toBeNull();
    });
  });

  describe('Cabecera compacta (propuesta 1b)', () => {
    it('shows the title with the subtitle as an info icon and underlined text tabs', async () => {
      const fixture = await configure(stateView());
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('h1')!.textContent).toContain('Infraestructura y salud');
      const info = root.querySelector('h1 + [role="img"]') as HTMLElement;
      expect(info.getAttribute('title')).toContain('Solo lectura');
      const selected = root.querySelector('[role="tab"][aria-selected="true"]') as HTMLElement;
      expect(selected.className).toContain('after:bg-accent');
      expect(root.textContent).not.toContain('Estado del catálogo de microservicios y del gateway. Solo lectura, con cobertura');
    });

    it('does not show the refresh button in Logs, where the data is live', async () => {
      await TestBed.configureTestingModule({
        imports: [Infra],
        providers: [
          { provide: InfraService, useValue: { state: () => of(stateView()) } },
          { provide: InfraLogsApi, useValue: { status: () => of({}) } },
        ],
      }).compileComponents();
      const fixture = TestBed.createComponent(Infra);
      await fixture.whenStable(); fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('button[aria-label="Actualizar"]')).not.toBeNull();
      (root.querySelector('#infra-tab-logs') as HTMLButtonElement).click(); fixture.detectChanges();
      expect(root.querySelector('button[aria-label="Actualizar"]')).toBeNull();
      expect(fixture.componentInstance.fillHeight()).toBe(true);
      fixture.destroy();
    });

    it('shows the refresh action as an icon only, keeping its name, age and tooltip for assistive tech and hover', async () => {
      const fixture = await configure(stateView({ source: { registryConfigured: true, registryOk: true, lastCheckAt: new Date(Date.now() - 13_000).toISOString() } }));
      const button = (fixture.nativeElement as HTMLElement).querySelector('button[aria-label="Actualizar"]') as HTMLButtonElement;
      expect(button.querySelector('svg')).not.toBeNull();
      const visible = button.cloneNode(true) as HTMLElement;
      visible.querySelectorAll('.sr-only').forEach((node) => node.remove());
      expect((visible.textContent ?? '').trim()).toBe('');
      expect(button.getAttribute('title')).toBe('Actualizar · Actualizado hace 13 s');
      expect(button.getAttribute('aria-describedby')).toBe('infra-refresh-age');
      expect(button.querySelector('#infra-refresh-age')!.textContent).toContain('Actualizado hace 13 s');
    });

    it('keeps the "updated ... ago" time moving without reloading', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
      try {
        const now = Date.now();
        const view = stateView({ source: { registryConfigured: true, registryOk: true, lastCheckAt: new Date(now - 13_000).toISOString() } });
        const fixture = await configure(view);
        const root = fixture.nativeElement as HTMLElement;
        const label = () => (root.querySelector('button[aria-label="Actualizar"] time')!.textContent ?? '').replace(/\s+/g, ' ').trim();
        expect(label()).toBe('Actualizado hace 13 s');
        vi.advanceTimersByTime(5 * 60_000); fixture.detectChanges();
        expect(label()).toBe('Actualizado hace 5 min');
        fixture.destroy();
      } finally { vi.useRealTimers(); }
    });
  });

  describe('Mapa a ancho completo', () => {
    it('floats the detail on the side opposite to the selected service so it never covers it', async () => {
      const base = stateView();
      const svc = (name: string, dependsOn: string[]) => ({ ...base.services[0], name, displayName: name, dependsOn, publishesTo: [] });
      const view = stateView({ services: [svc('hub-service', []), svc('a-service', ['hub-service']), svc('b-service', ['hub-service']), svc('c-service', ['hub-service'])] });
      await TestBed.configureTestingModule({ imports: [Infra], providers: [{ provide: InfraService, useValue: { state: () => of(view) } }] }).compileComponents();
      const fixture = TestBed.createComponent(Infra); await fixture.whenStable(); fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      (root.querySelector('#infra-tab-map') as HTMLButtonElement).click(); fixture.detectChanges();
      expect(root.querySelector('aside')).toBeNull();
      const nodes = Array.from(root.querySelectorAll('svg[role="group"] g[role="button"]'));
      const xOf = (node: Element) => Number(/translate\(([-\d.]+),/.exec(node.getAttribute('transform')!)![1]);
      const right = nodes.find((node) => xOf(node) > 450)!;
      const left = nodes.find((node) => xOf(node) < 450)!;
      right.dispatchEvent(new Event('click')); fixture.detectChanges();
      expect(root.querySelector('aside')!.className).toContain('sm:left-3');
      left.dispatchEvent(new Event('click')); left.dispatchEvent(new Event('click')); fixture.detectChanges();
      right.dispatchEvent(new Event('click')); fixture.detectChanges();
      left.dispatchEvent(new Event('click')); fixture.detectChanges();
      expect(root.querySelector('aside')!.className).toContain('sm:right-3');
      expect(fixture.componentInstance.fillHeight()).toBe(true);
    });
  });
});

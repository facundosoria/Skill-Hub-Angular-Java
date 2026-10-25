import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { Api } from '../../core/api';
import { AuthService } from '../../core/auth';
import { DepMap, estimateMapScale, shouldFitMap } from './dep-map';

describe('DepMap fit-height estimation', () => {
  const baseMeasurements = {
    cardWidth: 1400,
    horizontalPadding: 16,
    viewportHeight: 777,
    cardTop: 246.6,
    scrollY: 0,
    verticalPadding: 16,
    shellPaddingBottom: 42.5,
    legendHeight: 51.5,
  };

  it('subtracts the shell bottom padding from available height', () => {
    expect(estimateMapScale(baseMeasurements)).toBeCloseTo(0.564, 2);
  });

  it('uses document coordinates, keeping the estimate stable across scroll', () => {
    const scrolled = { ...baseMeasurements, cardTop: baseMeasurements.cardTop - 300, scrollY: 300 };
    expect(estimateMapScale(scrolled)).toBeCloseTo(estimateMapScale(baseMeasurements), 10);
  });

  it('uses the last known legend height when the graph is not rendered', () => {
    expect(estimateMapScale({ ...baseMeasurements, legendHeight: 51.5 }))
      .toBeCloseTo(estimateMapScale({ ...baseMeasurements, legendHeight: 0 }) - 51.5 / 745, 10);
  });

  it('applies the entry and exit hysteresis thresholds', () => {
    expect(shouldFitMap(0.60, false)).toBe(true);
    expect(shouldFitMap(0.59, false)).toBe(false);
    expect(shouldFitMap(0.59, true)).toBe(true);
    expect(shouldFitMap(0.57, true)).toBe(false);
  });

  it('fits by height when a wide card still has limited viewport height', () => {
    const estimatedScale = estimateMapScale({
      ...baseMeasurements,
      cardWidth: 1800,
      cardTop: 300,
      viewportHeight: 900,
      legendHeight: 65,
    });

    expect(estimatedScale).toBeLessThan(1);
    expect(estimatedScale).toBeGreaterThanOrEqual(0.6);
    expect(shouldFitMap(estimatedScale, false)).toBe(true);
  });
});

describe('DepMap offline controls', () => {
  let fixture: ComponentFixture<DepMap>;
  let api: { get: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.useFakeTimers();
    localStorage.clear();
    localStorage.setItem('depmap-cache-v2', JSON.stringify({
      nodes: { usr: { n: 'Usuarios', s: 'usr', x: 0, y: 0 }, ops: { n: 'Operaciones', s: 'ops', x: 1, y: 1 } },
      kinds: { bloqueante: 'Bloqueante' },
      info: {},
      edges: [{ id: 'edge-1', from: 'usr', to: 'ops', kind: 'bloqueante', state: 'pendiente', text: 'Prueba' }],
      done: {}, activity: [], presence: [], version: 1, updatedAt: null, updatedBy: null,
    }));
    api = { get: vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 }))) };
    await TestBed.configureTestingModule({
      imports: [DepMap],
      providers: [
        { provide: Api, useValue: api },
        { provide: AuthService, useValue: { user: signal({ role: 'admin' }) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DepMap);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('disables every mutation control while keeping copy/data access available', () => {
    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLButtonElement>('[data-menu-trigger="more"]')?.click();
    fixture.detectChanges();
    const buttons = [...root.querySelectorAll('button')];
    const matching = (text: string) => buttons.filter((button) => button.textContent?.includes(text));

    expect(matching('Agregar').every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(matching('Aplicar').every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(matching('Restaurar').every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect([...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((input) => input.disabled)).toBe(true);
    expect([...root.querySelectorAll<HTMLButtonElement>('button[aria-label="Eliminar dependencia"]')].every((button) => button.disabled)).toBe(true);
    expect(matching('Importar/Exportar').every((button) => !button.disabled)).toBe(true);
    expect(matching('Copiar').every((button) => !button.disabled)).toBe(true);
  });

  it('keeps dependency removal buttons accessible and touch-sized', () => {
    const root = fixture.nativeElement as HTMLElement;
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('button.x')];

    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.getAttribute('aria-label') === 'Eliminar dependencia')).toBe(true);
    expect(buttons.every((button) => button.classList.contains('x'))).toBe(true);
    expect(buttons.every((button) => {
      const style = getComputedStyle(button);
      return style.display === 'inline-flex' && style.width === '32px' && style.height === '32px';
    })).toBe(true);
  });

  it('clears the pair with Escape while preserving its node selection', () => {
    fixture.componentInstance.store.selectNode('usr');
    fixture.componentInstance.store.selectPair(['usr', 'ops']);
    fixture.nativeElement.querySelector('.dep-map')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(fixture.componentInstance.store.node()).toBe('usr');
    expect(fixture.componentInstance.store.pair()).toBeNull();
  });

  it('returns a non-default node selection to My group with Escape', () => {
    fixture.componentInstance.store.selectNode('ops');
    fixture.nativeElement.querySelector('.dep-map')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(fixture.componentInstance.store.node()).toBe(fixture.componentInstance.store.mine());
    expect(fixture.componentInstance.store.pair()).toBeNull();
  });

  it('moves and activates tabs with arrow keys using roving tabindex', () => {
    const tabs = [...fixture.nativeElement.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
    expect(tabs[0].getAttribute('tabindex')).toBe('0');
    expect(tabs[1].getAttribute('tabindex')).toBe('-1');

    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.store.view()).toBe('matriz');
    expect((fixture.nativeElement.querySelector('[role="tab"][aria-selected="true"]') as HTMLButtonElement | null)?.id).toBe('depmap-tab-matriz');
    const panels = [...(fixture.nativeElement as HTMLElement).querySelectorAll('[role="tabpanel"]')] as HTMLElement[];
    expect(panels).toHaveLength(3);
    expect(panels.map((panel) => panel.id)).toEqual(['depmap-panel-mapa', 'depmap-panel-matriz', 'depmap-panel-lista']);
    expect(panels.map((panel) => panel.getAttribute('aria-labelledby'))).toEqual(['depmap-tab-mapa', 'depmap-tab-matriz', 'depmap-tab-lista']);
    expect(panels.find((panel) => panel.id === 'depmap-panel-mapa')?.hidden).toBe(true);
    expect(panels.find((panel) => panel.id === 'depmap-panel-matriz')?.hidden).toBe(false);
  });

  it('renders the store error in an alert with a retry action', () => {
    fixture.componentInstance.store.error.set('network failure');
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector('[role="alert"]') as HTMLElement | null;
    expect(alert?.textContent).toContain('network failure');
    expect(alert?.querySelector('button')?.textContent).toContain('Reintentar');
  });

  it('keeps the fit-height graph chain through the tab panel wrapper', () => {
    const root = fixture.nativeElement as HTMLElement;
    const panel = root.querySelector('.workspace-card > .tab-panel');
    const graph = panel?.querySelector(':scope > app-dep-map-graph');
    const map = graph?.querySelector(':scope .graph > svg.map');

    expect(panel).toBeTruthy();
    expect(graph).toBeTruthy();
    expect(map).toBeTruthy();
  });

  it('keeps the group selector synchronized with the store preference', () => {
    const select = fixture.nativeElement.querySelector('select[name="mine"]') as HTMLSelectElement;
    expect(select.value).toBe(fixture.componentInstance.store.mine());
    fixture.componentInstance.store.setMine('ops');
    fixture.detectChanges();
    expect(select.value).toBe('ops');
  });

  it('toggles and persists the collapsible details panel', () => {
    const toggle = fixture.nativeElement.querySelector('.panel-toggle') as HTMLButtonElement;
    expect(toggle.textContent).toContain('Contraer detalle');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const toolbar = fixture.nativeElement.querySelector('.dep-map-toolbar');
    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('Expandir detalle');
    expect(localStorage.getItem('depmap-panel-collapsed')).toBe('true');
    expect(fixture.nativeElement.querySelector('.workspace')?.classList.contains('panel-collapsed')).toBe(true);
    expect(fixture.nativeElement.querySelector('.dep-map-toolbar')).toBe(toolbar);
  });

  it('renders outgoing and incoming details in separate side panels', () => {
    const panels = fixture.nativeElement.querySelectorAll('.details-side app-dep-map-panel');
    expect(panels).toHaveLength(2);
    expect(panels[0].getAttribute('direction')).toBe('out');
    expect(panels[1].getAttribute('direction')).toBe('in');
    expect(fixture.nativeElement.querySelector('.details-out')?.textContent).toContain('grupos de los que depende');
    expect(fixture.nativeElement.querySelector('.details-in')?.textContent).toContain('grupos que dependen de él');
  });

  it('uses Ajustar to align the boxes and reset the zoom', () => {
    // With reduced motion the zoom reset and the node glide apply immediately.
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query })) as unknown as typeof window.matchMedia;
    const graph = fixture.componentInstance.graph!;
    graph.zoomIn();
    const adjust = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.map-ctl')]
      .find((button) => button.textContent?.trim() === 'Ajustar');

    expect(adjust).toBeTruthy();
    adjust!.click();
    fixture.detectChanges();
    window.matchMedia = originalMatchMedia;

    expect(graph.transform().scale).toBe(1);
    expect(graph.renderedNodes()['usr'].x).toBe(525);
    expect(graph.renderedNodes()['ops'].x).toBe(975);
    expect(graph.renderedNodes()['usr'].y).toBe(graph.renderedNodes()['ops'].y);
    expect(graph.displayNodes()['usr'].x).toBe(525);
    expect(JSON.parse(localStorage.getItem('depmap-node-positions-v3') ?? '{}')).toEqual({
      usr: { x: 525, y: 465 }, ops: { x: 975, y: 465 },
    });
  });

  it('enters viewport fullscreen, preserves map focus state, and exits with Escape', () => {
    const component = fixture.componentInstance;
    component.store.selectNode('ops');
    component.enterFullscreen();
    fixture.detectChanges();
    expect(component.fullscreen()).toBe(true);
    expect(component.store.node()).toBe('ops');
    expect((fixture.nativeElement.querySelector('.dep-map') as HTMLElement).classList.contains('fullscreen')).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement.style.overflow).toBe('hidden');

    fixture.nativeElement.querySelector('.dep-map')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(component.fullscreen()).toBe(false);
    expect(component.store.node()).toBe('ops');
    expect(document.body.style.overflow).toBe('');
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('toggles viewport fullscreen from the toolbar and updates its icon and label', () => {
    const button = fixture.nativeElement.querySelector('.fullscreen-toggle') as HTMLButtonElement;
    const expandIcon = button.querySelector('path')?.getAttribute('d');
    expect(button.getAttribute('aria-label')).toBe('Pantalla completa');

    button.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.fullscreen()).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Salir de pantalla completa');
    expect(button.querySelector('path')?.getAttribute('d')).not.toBe(expandIcon);

    button.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.fullscreen()).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Pantalla completa');
    expect(button.querySelector('path')?.getAttribute('d')).toBe(expandIcon);
  });

  it('keeps graph full-map focus independent from the viewport fullscreen mode', () => {
    const component = fixture.componentInstance;
    component.store.toggleFullMap();
    component.enterFullscreen();
    expect(component.fullscreen()).toBe(true);
    expect(component.store.fullMap()).toBe(true);
    component.exitFullscreen(false);
    expect(component.store.fullMap()).toBe(true);
  });

  it('keeps the matrix in the normal view with its detail toggle', () => {
    const component = fixture.componentInstance;
    component.activateView('matriz');
    fixture.detectChanges();
    expectFullscreenToggleReserved();
    const detailToggle = fixture.nativeElement.querySelector('.panel-toggle') as HTMLButtonElement;
    const initialExpanded = detailToggle.getAttribute('aria-expanded');
    detailToggle.click();
    fixture.detectChanges();
    expect(detailToggle.getAttribute('aria-expanded')).not.toBe(initialExpanded);
    detailToggle.click();
    fixture.detectChanges();
    expect(detailToggle.getAttribute('aria-expanded')).toBe(initialExpanded);
    component.enterFullscreen();
    expect(component.fullscreen()).toBe(false);
    component.activateView('mapa');
    component.enterFullscreen();
    expect(component.fullscreen()).toBe(true);
    component.activateView('matriz');
    fixture.detectChanges();
    expect(component.fullscreen()).toBe(false);
    expect(component.store.view()).toBe('matriz');
    expectFullscreenToggleReserved();
  });

  it('toggles the full map from the toolbar without re-selecting My group', () => {
    const store = fixture.componentInstance.store;
    const toggle = () => fixture.nativeElement.querySelector('.map-ctl.toggle') as HTMLButtonElement;
    expect(toggle().textContent).toContain('Ver mapa completo');
    toggle().click();
    fixture.detectChanges();
    expect(store.fullMap()).toBe(true);
    expect(store.node()).toBeNull();
    expect(toggle().textContent).toContain('Enfocar mi grupo');
    toggle().click();
    fixture.detectChanges();
    expect(store.fullMap()).toBe(false);
    expect(store.node()).toBe(store.mine());
  });

  // Desde 057a803 el botón queda reservado (deshabilitado y oculto) fuera del mapa para no mover la barra.
  function expectFullscreenToggleReserved(): void {
    const button = fixture.nativeElement.querySelector('.fullscreen-toggle') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-hidden')).toBe('true');
    expect(button.classList.contains('controls-hidden')).toBe(true);
  }

  it('keeps Details functional as an overlay while fullscreen', () => {
    const component = fixture.componentInstance;
    const normalCollapsedState = component.store.panelCollapsed();
    component.enterFullscreen();
    fixture.detectChanges();
    const toggle = fixture.nativeElement.querySelector('.panel-toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('Expandir detalle');
    toggle.click();
    fixture.detectChanges();
    expect(component.fullscreenDetailsOpen()).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(fixture.nativeElement.querySelector('.workspace')?.classList.contains('detail-open')).toBe(true);
    toggle.click();
    fixture.detectChanges();
    expect(component.fullscreenDetailsOpen()).toBe(false);
    expect(component.store.panelCollapsed()).toBe(normalCollapsedState);
    expect(fixture.nativeElement.querySelector('.workspace')?.classList.contains('detail-open')).toBe(false);
    component.exitFullscreen(false);
  });

  it('contains keyboard focus in the fullscreen surface', async () => {
    const component = fixture.componentInstance;
    component.enterFullscreen();
    fixture.detectChanges();
    await Promise.resolve();
    const exit = fixture.nativeElement.querySelector('.fullscreen-exit') as HTMLButtonElement;
    expect(fixture.nativeElement.querySelector('.dep-map')?.getAttribute('aria-modal')).toBe('true');
    const focusable = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.closest('[hidden]') && !element.closest('.module-header,.banner,.error-banner') && getComputedStyle(element).display !== 'none');
    const last = focusable[focusable.length - 1];
    last.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(exit);
    component.exitFullscreen(false);
  });

  it('returns focus to the data dialog opener when it closes', async () => {
    const opener = fixture.nativeElement.querySelector('[data-menu-trigger="more"]') as HTMLButtonElement;
    opener.focus();
    opener.click();
    fixture.detectChanges();
    const dialog = fixture.componentInstance.dataDialog.nativeElement as HTMLDialogElement & { showModal: () => void; close: () => void };
    dialog.showModal = vi.fn();
    dialog.close = vi.fn();
    (fixture.nativeElement.querySelector('#depmap-more-options button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(dialog.showModal).toHaveBeenCalled();
    fixture.componentInstance.close(fixture.componentInstance.dataDialog.nativeElement);
    await Promise.resolve();
    expect(document.activeElement).toBe(opener);
  });

  it('filters by type from the grouped filters menu and announces active filters', () => {
    const trigger = fixture.nativeElement.querySelector('[data-menu-trigger="filters"]') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    const option = fixture.nativeElement.querySelector('#depmap-filter-options input[type=checkbox]') as HTMLInputElement;
    expect(option.checked).toBe(true);

    option.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.store.visible()).toHaveLength(0);
    expect(trigger.textContent).toContain('Filtros');
    expect(trigger.querySelector('.filter-count')?.textContent).toBe('1');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);

    trigger.click();
    fixture.detectChanges();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('DepMap editing and data dialogs', () => {
  let fixture: ComponentFixture<DepMap>;
  let api: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  let role: 'admin' | 'member';
  const onlineState = {
    nodes: {
      usr: { n: 'Usuarios', s: 'usr', x: 0, y: 0 },
      ops: { n: 'Operaciones', s: 'ops', x: 1, y: 1 },
      sec: { n: 'Seguridad', s: 'sec', x: 2, y: 2, transv: true },
    },
    kinds: { api: 'API', propio: 'Propio' },
    info: {},
    edges: [{ id: 'edge-1', from: 'usr', to: 'ops', kind: 'api', state: 'pendiente', text: 'Prueba' }],
    done: { 'edge-1': true },
    activity: [],
    presence: [],
    version: 7,
    updatedAt: null,
    updatedBy: 'ana',
  };

  beforeAll(() => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  });

  async function render(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [DepMap],
      providers: [
        { provide: Api, useValue: api },
        { provide: AuthService, useValue: { user: signal({ role }) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DepMap);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    localStorage.clear();
    // jsdom no trae matchMedia; el layout lo consulta al correr los timers.
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }));
    role = 'admin';
    api = {
      get: vi.fn().mockReturnValue(of(onlineState)),
      post: vi.fn().mockReturnValue(of({})),
      put: vi.fn().mockReturnValue(of({})),
      delete: vi.fn().mockReturnValue(of({})),
    };
    await render();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
  });

  const map = () => fixture.componentInstance;
  const root = () => fixture.nativeElement as HTMLElement;
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

  describe('labels', () => {
    it('translates views, statuses and kinds', () => {
      expect(map().viewLabel('mapa')).toBe('Mapa');
      expect(map().viewLabel('matriz')).toBe('Matriz');
      expect(map().viewLabel('lista')).toBe('Lista');
      expect(map().statusLabel('todos')).toBe('Todos los estados');
      expect(map().statusLabel('pendiente')).toBe('Pendiente');
      expect(map().statusLabel('definir')).toBe('A definir');
      expect(map().statusLabel('hecho')).toBe('Hecho');
      expect(map().kindLabel('api')).toBe(map().t().mapa.tipoApi);
      expect(map().kindLabel('evento')).toBe(map().t().mapa.tipoEvento);
      expect(map().kindLabel('dato')).toBe(map().t().mapa.tipoDatos);
      expect(map().kindLabel('permiso')).toBe(map().t().mapa.tipoPermiso);
      expect(map().kindLabel('ui')).toBe(map().t().mapa.tipoComponente);
      expect(map().kindLabel('propio', 'Propio')).toBe('Propio');
      expect(map().kindLabel('otro')).toBe('otro');
    });

    it('builds stable ids for tabs and panels', () => {
      expect(map().tabId('lista')).toBe('depmap-tab-lista');
      expect(map().panelId('lista')).toBe('depmap-panel-lista');
    });

    it('lists only non-transversal groups as editable', () => {
      expect(map().groupIds()).toEqual(['usr', 'ops']);
      expect(map().kindEntries().map((kind) => kind.label)).toEqual([map().t().mapa.tipoApi, 'Propio']);
    });
  });

  describe('adding a dependency', () => {
    it('opens with the selected group and sensible defaults', () => {
      map().openAdd();

      expect(map().addDialog.nativeElement.open).toBe(true);
      expect(map().addFrom).toBe('usr');
      expect(map().addTo).toBe('ops');
      expect(map().addKind).toBe('api');
      expect(map().addState).toBe('pendiente');
      expect(map().addText).toBe('');
    });

    it('starts from the requested group when it exists', () => {
      map().openAdd('ops');
      expect(map().addFrom).toBe('ops');
      expect(map().addTo).toBe('usr');
    });

    it('falls back to my group when the requested one is unknown', () => {
      map().store.selectNode('sec');

      map().openAdd('nada');

      expect(map().addFrom).toBe(map().store.mine());
    });

    it('does not open without editable groups', () => {
      map().store.state.set({ ...map().store.state(), nodes: {} });

      map().openAdd();

      expect(map().addDialog.nativeElement.open).toBe(false);
    });

    it('rejects the same group on both sides', async () => {
      map().openAdd();
      map().addTo = map().addFrom;
      map().addText = 'Algo';

      await map().submitAdd();
      fixture.detectChanges();

      expect(map().dialogError()).toBe('Elegí dos grupos distintos.');
      expect(root().querySelector('dialog[aria-labelledby="add-title"] [role="alert"]')!.textContent).toContain('Elegí dos grupos distintos.');
      expect(api.post).not.toHaveBeenCalled();
    });

    it('requires a description', async () => {
      map().openAdd();
      map().addText = '   ';

      await map().submitAdd();

      expect(map().dialogError()).toBe('Contá qué necesita.');
      expect(api.post).not.toHaveBeenCalled();
    });

    it('saves the trimmed dependency, closes the dialog and shows a toast', async () => {
      map().openAdd();
      map().addState = 'definir';
      map().addText = '  Necesitamos un endpoint  ';

      await map().submitAdd();
      fixture.detectChanges();

      expect(api.post).toHaveBeenCalledWith('/depmap/edges', { from: 'usr', to: 'ops', kind: 'api', state: 'definir', text: 'Necesitamos un endpoint' });
      expect(map().addDialog.nativeElement.open).toBe(false);
      expect(map().busy()).toBe(false);
      expect(root().querySelector('.toast')!.textContent).toContain('Dependencia agregada para todos');

      await vi.advanceTimersByTimeAsync(2_200);
      fixture.detectChanges();
      expect(root().querySelector('.toast')).toBeNull();
    });

    it('keeps the dialog open with the error when saving fails', async () => {
      api.post.mockReturnValue(throwError(() => new Error('Sin permiso')));
      map().openAdd();
      map().addText = 'Algo';

      await map().submitAdd();

      expect(map().dialogError()).toBe('Sin permiso');
      expect(map().addDialog.nativeElement.open).toBe(true);
      expect(map().busy()).toBe(false);
    });

    it('uses a generic message for unknown errors', async () => {
      api.post.mockReturnValue(throwError(() => 'raro'));
      map().openAdd();
      map().addText = 'Algo';

      await map().submitAdd();

      expect(map().dialogError()).toBe('No se pudo guardar.');
    });

    it('opens from the toolbar button', () => {
      const add = [...root().querySelectorAll('button')].find((button) => button.textContent?.includes(map().t().mapa.agregar))!;

      add.click();

      expect(map().addDialog.nativeElement.open).toBe(true);
    });
  });

  describe('data dialog', () => {
    it('shows the shared state as JSON with its metadata', () => {
      map().openData(document.body);
      fixture.detectChanges();

      expect(JSON.parse(map().jsonDataValue)).toEqual({ edges: onlineState.edges, done: onlineState.done });
      expect(map().dataMeta()).toBe('Estado compartido: versión 7 · último cambio de ana · 1 dependencias, 1 hechas.');
      expect(map().dataDialog.nativeElement.open).toBe(true);
    });

    it('omits the author when nobody changed the map', () => {
      map().store.state.set({ ...map().store.state(), updatedBy: null });

      expect(map().dataMeta()).toBe('Estado compartido: versión 7 · 1 dependencias, 1 hechas.');
    });

    it('copies the JSON to the clipboard', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
      map().openData(document.body);

      await map().copyData();

      expect(writeText).toHaveBeenCalledWith(map().jsonDataValue);
      expect(map().toast()).toBe('Copiado');
      vi.unstubAllGlobals();
    });

    it('asks to copy by hand when the clipboard fails', async () => {
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no')) } });

      await map().copyData();

      expect(map().toast()).toBe('Seleccioná y copiá a mano');
      vi.unstubAllGlobals();
    });

    it('applies edited JSON for everyone', async () => {
      map().openData(document.body);
      map().jsonDataValue = JSON.stringify({ edges: [], done: { x: true } });

      await map().applyData();

      expect(api.post).toHaveBeenCalledWith('/depmap/import', { edges: [], done: { x: true } });
      expect(map().dataDialog.nativeElement.open).toBe(false);
      expect(map().toast()).toBe('Datos aplicados para todos');
    });

    it('sends an empty done map when the JSON has none', async () => {
      map().jsonDataValue = JSON.stringify({ edges: [] });

      await map().applyData();

      expect(api.post).toHaveBeenCalledWith('/depmap/import', { edges: [], done: {} });
    });

    it('reports invalid JSON without calling the server', async () => {
      map().openData(document.body);
      map().jsonDataValue = '{roto';

      await map().applyData();

      expect(map().dialogError()).toBeTruthy();
      expect(api.post).not.toHaveBeenCalled();
      expect(map().busy()).toBe(false);
    });

    it('reports a generic message for non Error failures', async () => {
      api.post.mockReturnValue(throwError(() => 'raro'));
      map().jsonDataValue = JSON.stringify({ edges: [] });

      await map().applyData();

      expect(map().dialogError()).toBe('JSON inválido.');
    });

    it('opens from the more menu and closes the menu', () => {
      map().toggleMenu('more');
      expect(map().openMenu()).toBe('more');

      map().openDataFromMenu();

      expect(map().openMenu()).toBeNull();
      expect(map().dataDialog.nativeElement.open).toBe(true);
    });

    it('hides reset and apply for members', async () => {
      TestBed.resetTestingModule();
      role = 'member';
      await render();
      map().openData(document.body);
      fixture.detectChanges();

      const labels = [...root().querySelectorAll('dialog[aria-labelledby="data-title"] button')].map((button) => button.textContent?.trim());
      expect(labels).not.toContain(map().t().mapa.restaurar);
    });
  });

  describe('confirmations', () => {
    it('resets the map after confirming', async () => {
      map().openData(document.body);
      map().askReset();
      fixture.detectChanges();
      expect(map().confirmKind()).toBe('reset');
      expect(root().querySelector('dialog[aria-labelledby="confirm-title"] .meta')!.textContent).toContain('datos de la reunión');

      await map().confirmAction();

      expect(api.post).toHaveBeenCalledWith('/depmap/reset');
      expect(map().confirmDialog.nativeElement.open).toBe(false);
      expect(map().dataDialog.nativeElement.open).toBe(false);
      expect(map().toast()).toBe('Datos originales restaurados');
    });

    it('deletes a dependency after confirming', async () => {
      const edge = onlineState.edges[0];
      map().askDelete(edge);

      expect(map().confirmMessage()).toContain('«Prueba»');

      await map().confirmAction();

      expect(api.delete).toHaveBeenCalledWith('/depmap/edges/edge-1');
      expect(map().toast()).toBe('Dependencia eliminada');
      expect(map().confirmDialog.nativeElement.open).toBe(false);
    });

    it('keeps the confirmation open when the action fails', async () => {
      api.delete.mockReturnValue(throwError(() => new Error('Ya no existe')));
      map().askDelete(onlineState.edges[0]);

      await map().confirmAction();

      expect(map().dialogError()).toBe('Ya no existe');
      expect(map().confirmDialog.nativeElement.open).toBe(true);
      expect(map().busy()).toBe(false);
    });

    it('uses a generic message for unknown failures', async () => {
      api.post.mockReturnValue(throwError(() => 'raro'));
      map().askReset();

      await map().confirmAction();

      expect(map().dialogError()).toBe('No se pudo completar la acción.');
    });

    it('only closes when there is nothing to confirm', async () => {
      map().confirmDialog.nativeElement.showModal();

      await map().confirmAction();

      expect(api.post).not.toHaveBeenCalled();
      expect(api.delete).not.toHaveBeenCalled();
      expect(map().confirmDialog.nativeElement.open).toBe(false);
    });

    it('returns focus to the element that opened the dialog', async () => {
      const opener = document.createElement('button');
      document.body.appendChild(opener);
      opener.focus();
      map().askReset();
      (document.activeElement as HTMLElement)?.blur();

      map().close(map().confirmDialog.nativeElement);
      await flush();

      expect(document.activeElement).toBe(opener);
      opener.remove();
    });
  });

  describe('keyboard', () => {
    function keydown(key: string, target: Element = root(), init: KeyboardEventInit = {}): KeyboardEvent {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
      Object.defineProperty(event, 'target', { value: target });
      map().onKeydown(event);
      return event;
    }

    it('jumps to the first and last tab with Home and End', () => {
      const end = new KeyboardEvent('keydown', { key: 'End', cancelable: true });
      map().onTabKeydown(end, 'mapa');
      expect(map().store.view()).toBe('lista');
      expect(end.defaultPrevented).toBe(true);

      map().onTabKeydown(new KeyboardEvent('keydown', { key: 'Home' }), 'lista');
      expect(map().store.view()).toBe('mapa');

      map().onTabKeydown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }), 'mapa');
      expect(map().store.view()).toBe('lista');
    });

    it('ignores other keys on the tabs', () => {
      const event = new KeyboardEvent('keydown', { key: 'a', cancelable: true });

      map().onTabKeydown(event, 'mapa');

      expect(event.defaultPrevented).toBe(false);
      expect(map().store.view()).toBe('mapa');
    });

    it('closes an open menu with Escape and focuses its trigger', () => {
      map().toggleMenu('more');
      fixture.detectChanges();

      const event = keydown('Escape');

      expect(map().openMenu()).toBeNull();
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(root().querySelector('[data-menu-trigger="more"]'));
    });

    it('leaves Escape to open dialogs and form fields', () => {
      map().store.selectPair(['usr', 'ops']);
      map().openAdd();
      const insideDialog = map().addDialog.nativeElement.querySelector('textarea')!;
      expect(keydown('Escape', insideDialog).defaultPrevented).toBe(false);

      map().close(map().addDialog.nativeElement);
      const input = document.createElement('input');
      root().appendChild(input);
      expect(keydown('Escape', input).defaultPrevented).toBe(false);
      expect(map().store.pair()).toEqual(['usr', 'ops']);

      const editable = document.createElement('div');
      editable.setAttribute('contenteditable', 'true');
      const child = document.createElement('span');
      editable.appendChild(child);
      root().appendChild(editable);
      expect(keydown('Escape', child).defaultPrevented).toBe(false);
    });

    it('does nothing on Escape when my group is already selected', () => {
      expect(keydown('Escape').defaultPrevented).toBe(false);
      expect(map().store.node()).toBe('usr');
    });

    it('ignores keys other than Escape and Tab', () => {
      map().store.selectPair(['usr', 'ops']);

      keydown('Enter');

      expect(map().store.pair()).toEqual(['usr', 'ops']);
    });
  });

  describe('driving the screen through the DOM', () => {
    const click = (selector: string) => {
      const target = root().querySelector(selector) as HTMLElement;
      target.click();
      fixture.detectChanges();
    };
    const buttonIn = (scope: string, label: string) =>
      [...root().querySelectorAll(`${scope} button`)].find((button) => button.textContent?.includes(label)) as HTMLButtonElement;
    const setValue = (element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string, event = 'input') => {
      element.value = value;
      element.dispatchEvent(new Event(event, { bubbles: true }));
      fixture.detectChanges();
    };

    it('changes my group from the header select', () => {
      const select = root().querySelector('select[name="mine"]') as HTMLSelectElement;

      setValue(select, 'ops', 'change');

      expect(map().store.mine()).toBe('ops');
    });

    it('fills and submits the add dialog from its fields', async () => {
      map().openAdd();
      fixture.detectChanges();
      const dialog = 'dialog[aria-labelledby="add-title"]';
      setValue(root().querySelector(`${dialog} select[name="from"]`) as HTMLSelectElement, 'ops', 'change');
      setValue(root().querySelector(`${dialog} select[name="to"]`) as HTMLSelectElement, 'usr', 'change');
      setValue(root().querySelector(`${dialog} select[name="kind"]`) as HTMLSelectElement, 'propio', 'change');
      setValue(root().querySelector(`${dialog} select[name="state"]`) as HTMLSelectElement, 'definir', 'change');
      setValue(root().querySelector(`${dialog} textarea[name="text"]`) as HTMLTextAreaElement, 'Desde el formulario');

      (root().querySelector(`${dialog} form`) as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush();

      expect(api.post).toHaveBeenCalledWith('/depmap/edges', { from: 'ops', to: 'usr', kind: 'propio', state: 'definir', text: 'Desde el formulario' });
    });

    it('closes the add dialog from the cross and the cancel button', () => {
      map().openAdd();
      fixture.detectChanges();
      click('dialog[aria-labelledby="add-title"] .close');
      expect(map().addDialog.nativeElement.open).toBe(false);

      map().openAdd();
      fixture.detectChanges();
      buttonIn('dialog[aria-labelledby="add-title"]', map().t().mapa.cancelar).click();
      expect(map().addDialog.nativeElement.open).toBe(false);
    });

    it('uses every button of the data dialog', async () => {
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
      map().openData(document.body);
      fixture.detectChanges();
      const dialog = 'dialog[aria-labelledby="data-title"]';
      setValue(root().querySelector(`${dialog} textarea[name="json"]`) as HTMLTextAreaElement, JSON.stringify({ edges: [] }));
      expect(map().jsonDataValue).toBe(JSON.stringify({ edges: [] }));

      buttonIn(dialog, map().t().mapa.copiar).click();
      await flush();
      expect(map().toast()).toBe('Copiado');

      buttonIn(dialog, map().t().mapa.restaurar).click();
      fixture.detectChanges();
      expect(map().confirmKind()).toBe('reset');
      buttonIn('dialog[aria-labelledby="confirm-title"]', map().t().mapa.cancelar).click();
      expect(map().confirmDialog.nativeElement.open).toBe(false);

      buttonIn(dialog, map().t().mapa.aplicar).click();
      await flush();
      expect(api.post).toHaveBeenCalledWith('/depmap/import', { edges: [], done: {} });

      map().openData(document.body);
      fixture.detectChanges();
      click(`${dialog} .close`);
      expect(map().dataDialog.nativeElement.open).toBe(false);
    });

    it('confirms from the confirmation dialog button', async () => {
      map().askReset();
      fixture.detectChanges();

      (root().querySelector('dialog[aria-labelledby="confirm-title"] .actions button:last-child') as HTMLButtonElement).click();
      await flush();

      expect(api.post).toHaveBeenCalledWith('/depmap/reset');
    });

    it('asks to delete from the details panel', () => {
      const remove = root().querySelector('button[aria-label="Eliminar dependencia"]') as HTMLButtonElement;

      remove.click();

      expect(map().confirmKind()).toBe('delete');
      expect(map().pendingDelete()?.id).toBe('edge-1');
    });

    it('retries from the offline banner and the error banner', () => {
      map().store.offline.set(true);
      map().store.error.set('Caido');
      fixture.detectChanges();
      api.get.mockClear();

      buttonIn('.banner', map().t().mapa.reintentar).click();
      buttonIn('.error-banner', map().t().mapa.reintentarAccion).click();

      expect(api.get).toHaveBeenCalledTimes(2);
    });

    it('shows the loading state before any edge arrives', () => {
      map().store.loading.set(true);
      map().store.state.set({ ...map().store.state(), edges: [] });
      fixture.detectChanges();

      expect(root().textContent).toContain(map().t().mapa.cargando);
    });

    it('drives search, status filter and view tabs from the toolbar', () => {
      setValue(root().querySelector('.toolbar-search') as HTMLInputElement, 'prueba');
      expect(map().store.query()).toBe('prueba');

      click('[data-menu-trigger="filters"]');
      setValue(root().querySelector('#depmap-filter-options select') as HTMLSelectElement, 'hecho', 'change');
      expect(map().store.status()).toBe('hecho');

      click('#depmap-tab-lista');
      expect(map().store.view()).toBe('lista');
    });

    it('uses the zoom, fit and full map buttons', () => {
      const ctl = (label: string) => root().querySelector(`.map-ctl[aria-label="${label}"]`) as HTMLButtonElement;
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }));

      ctl(map().t().mapa.zoomIn).click();
      fixture.detectChanges();
      expect(map().graph!.transform().scale).toBeCloseTo(1.25);

      ctl(map().t().mapa.zoomOut).click();
      fixture.detectChanges();
      expect(map().graph!.transform().scale).toBeCloseTo(1);

      buttonIn('.map-controls', map().t().mapa.ajustar).click();
      buttonIn('.map-controls', map().t().mapa.verCompleto).click();
      expect(map().store.fullMap()).toBe(true);
    });

    it('collapses and expands the floating controls in full screen', () => {
      map().enterFullscreen();
      fixture.detectChanges();

      click('.collapse-controls');
      expect(map().floatingControlsCollapsed()).toBe(true);

      click('.expand-controls');
      expect(map().floatingControlsCollapsed()).toBe(false);

      click('.fullscreen-exit');
      expect(map().fullscreen()).toBe(false);
    });
  });

  describe('full screen keyboard and layout', () => {
    it('sends Escape outside the map to exit full screen', () => {
      map().enterFullscreen();
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

      outside.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(map().fullscreen()).toBe(false);
      outside.remove();
    });

    it('brings Tab from outside back to the exit button', async () => {
      map().enterFullscreen();
      fixture.detectChanges();
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });

      outside.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(root().querySelector('.fullscreen-exit'));
      outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      map().exitFullscreen(false);
      outside.remove();
    });

    it('leaves full screen when the browser exits native full screen', () => {
      map().enterFullscreen();

      document.dispatchEvent(new Event('fullscreenchange'));

      expect(map().fullscreen()).toBe(false);
    });

    it('closes the open menu on outside presses only', () => {
      map().toggleMenu('more');
      fixture.detectChanges();
      const inside = root().querySelector('[data-map-menu="more"] button') as HTMLElement;

      inside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      expect(map().openMenu()).toBe('more');

      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      expect(map().openMenu()).toBeNull();
    });

    it('wraps Tab focus inside the full screen surface', () => {
      map().enterFullscreen();
      fixture.detectChanges();
      const focusable = [...root().querySelectorAll<HTMLElement>('button:not([disabled])')].filter((element) => !element.closest('[hidden],.module-header,.banner,.error-banner,.details-side'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      last.focus();
      const forward = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
      Object.defineProperty(forward, 'target', { value: last });
      map().onKeydown(forward);
      expect(forward.defaultPrevented).toBe(true);

      first.focus();
      const backward = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true });
      Object.defineProperty(backward, 'target', { value: first });
      map().onKeydown(backward);
      expect(backward.defaultPrevented).toBe(true);
      map().exitFullscreen(false);
    });

    it('measures the layout on resize when the map sits inside a main element', async () => {
      const main = document.createElement('main');
      main.style.paddingBottom = '10px';
      main.appendChild(fixture.nativeElement);
      document.body.appendChild(main);
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('min-width'), media: query }));

      window.dispatchEvent(new Event('resize'));
      await vi.advanceTimersByTimeAsync(100);

      expect(map().fitHeight()).toBe(true);
      expect((fixture.nativeElement as HTMLElement).style.getPropertyValue('--map-offset')).toMatch(/px$/);
      main.remove();
    });

    it('repositions the filter popover on resize while it is open', () => {
      map().toggleMenu('filters');
      const trigger = root().querySelector('[data-menu-trigger="filters"]') as HTMLElement;
      trigger.getBoundingClientRect = () => ({ left: 40, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });

      window.dispatchEvent(new Event('resize'));

      expect(map().filterPopoverLeft()).toBe(40);
    });
  });

  describe('menus and panels', () => {
    it('toggles each menu and closes it on a second click', () => {
      map().toggleMenu('filters');
      expect(map().openMenu()).toBe('filters');
      map().toggleMenu('more');
      expect(map().openMenu()).toBe('more');
      map().toggleMenu('more');
      expect(map().openMenu()).toBeNull();
    });

    it('keeps the filter popover inside narrow viewports', () => {
      const trigger = root().querySelector('[data-menu-trigger="filters"]') as HTMLElement;
      trigger.getBoundingClientRect = () => ({ left: 900, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });

      map().toggleMenu('filters');

      expect(map().filterPopoverLeft()).toBe(400 - 300 - 12);
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    });

    it('leaves the full screen when switching away from the map', () => {
      map().enterFullscreen();
      expect(map().fullscreen()).toBe(true);

      map().activateView('lista');

      expect(map().fullscreen()).toBe(false);
      expect(map().store.view()).toBe('lista');
    });

    it('only enters full screen from the map view', () => {
      map().activateView('matriz');

      map().enterFullscreen();

      expect(map().fullscreen()).toBe(false);
    });

    it('locks page scroll in full screen and restores it afterwards', () => {
      document.body.style.overflow = 'auto';

      map().toggleFullscreen();
      expect(document.body.style.overflow).toBe('hidden');
      expect(document.documentElement.style.overflow).toBe('hidden');

      map().toggleFullscreen();
      expect(document.body.style.overflow).toBe('auto');
      expect(document.documentElement.style.overflow).toBe('');
      document.body.style.overflow = '';
    });

    it('ignores exit requests outside full screen', () => {
      expect(() => map().exitFullscreen()).not.toThrow();
      expect(map().fullscreen()).toBe(false);
    });

    it('requests native full screen when available', () => {
      const request = vi.fn().mockResolvedValue(undefined);
      (fixture.nativeElement as HTMLElement & { requestFullscreen: () => Promise<void> }).requestFullscreen = request;

      map().enterFullscreen();

      expect(request).toHaveBeenCalled();
      map().exitFullscreen(false);
    });

    it('opens details as an overlay while in full screen', () => {
      map().enterFullscreen();

      map().togglePanel();
      expect(map().fullscreenDetailsOpen()).toBe(true);
      map().togglePanel();
      expect(map().fullscreenDetailsOpen()).toBe(false);

      map().exitFullscreen(false);
    });
  });
});

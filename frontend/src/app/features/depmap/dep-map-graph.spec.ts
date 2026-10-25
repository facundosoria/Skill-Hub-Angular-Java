import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { DepMapGraph } from './dep-map-graph';
import { DepMapEdge, DepMapState, DepMapStore } from './dep-map-store';
import { pairs } from './dep-map-geometry';
import { I18n } from '../../core/i18n/i18n';

const edges: DepMapEdge[] = [
  { id: 'edge-1', from: 'usr', to: 'ops', kind: 'bloqueante', state: 'pendiente', text: 'Prueba' },
];

const state: DepMapState = {
  nodes: {
    usr: { n: 'Usuarios', s: 'usr', x: 300, y: 200 },
    ops: { n: 'Operaciones', s: 'ops', x: 700, y: 500 },
  },
  kinds: { bloqueante: 'Bloqueante' },
  info: {},
  edges,
  done: {},
  activity: [],
  presence: [],
  version: 1,
  updatedAt: null,
  updatedBy: null,
};

function createFakeStore() {
  const stateSignal = signal(state);
  const mine = signal('usr');
  const node = signal<string | null>('usr');
  const pair = signal<[string, string] | null>(null);
  const fullMap = signal(false);
  const store = {
    state: stateSignal,
    mine,
    node,
    pair,
    fullMap,
    flashId: signal<string | null>(null),
    visible: computed(() => stateSignal().edges.filter((edge) => !!stateSignal().nodes[edge.from] && !!stateSignal().nodes[edge.to])),
    grouped: computed(() => pairs(stateSignal().edges)),
    selectNode: (id: string) => { fullMap.set(false); node.set(id); pair.set(null); },
    selectPair: (next: [string, string]) => { fullMap.set(false); pair.set(next); },
    toggleFullMap: () => {
      if (fullMap()) { fullMap.set(false); node.set(mine()); pair.set(null); }
      else { fullMap.set(true); node.set(null); pair.set(null); }
    },
  };
  return store;
}

describe('DepMapGraph zoom and full map controls', () => {
  let fixture: ComponentFixture<DepMapGraph>;
  let store: ReturnType<typeof createFakeStore>;

  beforeEach(async () => {
    store = createFakeStore();
    await TestBed.configureTestingModule({
      imports: [DepMapGraph],
      providers: [{ provide: DepMapStore, useValue: store }],
    }).compileComponents();
    fixture = TestBed.createComponent(DepMapGraph);
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function svg(): SVGSVGElement {
    return fixture.nativeElement.querySelector('svg.map') as SVGSVGElement;
  }

  function button(label: string): HTMLButtonElement {
    const match = ([...(fixture.nativeElement as HTMLElement).querySelectorAll('button')] as HTMLButtonElement[])
      .find((candidate) => candidate.textContent?.includes(label));
    if (!match) throw new Error(`Button "${label}" not found`);
    return match;
  }

  it('does not prevent the default wheel when Ctrl/⌘ is not held', () => {
    const event = new WheelEvent('wheel', { deltaY: -120, ctrlKey: false, bubbles: true, cancelable: true });
    svg().dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(fixture.componentInstance.transform().scale).toBe(1);
  });

  it('zooms and prevents the default only for Ctrl + wheel', () => {
    const event = new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true });
    svg().dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(fixture.componentInstance.transform().scale).toBeGreaterThan(1);
  });

  it('renders the full map without a selected group', () => {
    store.toggleFullMap();
    fixture.detectChanges();

    expect(store.fullMap()).toBe(true);
    expect(store.node()).toBeNull();
    expect(store.pair()).toBeNull();

    store.toggleFullMap();
    fixture.detectChanges();

    expect(store.fullMap()).toBe(false);
    expect(store.node()).toBe('usr');
  });

  it('leaves the map controls to the dep-map toolbar', () => {
    // Desde 7140bcf los controles viven en la barra de dep-map, no en la leyenda del grafo.
    expect(fixture.nativeElement.querySelector('.legend')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.map-controls')).toHaveLength(0);
  });

  it('renders line-based focus halos for edges without a group outline', () => {
    expect(fixture.nativeElement.querySelectorAll('.edge .focus-halo')).toHaveLength(1);
    expect(fixture.nativeElement.querySelectorAll('.edge .focus-halo-contrast')).toHaveLength(1);
  });
});

const richEdges: DepMapEdge[] = [
  { id: 'r1', from: 'usr', to: 'ops', kind: 'api', state: 'pendiente', text: 'Alta' },
  { id: 'r2', from: 'usr', to: 'ops', kind: 'api', state: 'pendiente', text: 'Baja' },
  { id: 'r3', from: 'ops', to: 'usr', kind: 'api', state: 'pendiente', text: 'Vuelta' },
  { id: 'r4', from: 'pag', to: 'usr', kind: 'api', state: 'pendiente', text: 'Cobro' },
];

const richState: DepMapState = {
  nodes: {
    usr: { n: 'Usuarios', s: 'usr', x: 300, y: 200 },
    ops: { n: 'Operaciones', s: 'ops', x: 700, y: 500 },
    pag: { n: 'Pagos', s: 'pag', x: 300, y: 600 },
    sec: { n: 'Seguridad', s: 'sec', x: 700, y: 150, transv: true },
  },
  kinds: { api: 'API' },
  info: {},
  edges: richEdges,
  done: {},
  activity: [],
  presence: [],
  version: 1,
  updatedAt: null,
  updatedBy: null,
};

function createRichStore() {
  const stateSignal = signal(richState);
  const node = signal<string | null>('usr');
  const pair = signal<[string, string] | null>(null);
  const shown = signal<DepMapEdge[]>(richEdges);
  return {
    state: stateSignal,
    mine: signal('usr'),
    node,
    pair,
    fullMap: signal(false),
    flashId: signal<string | null>(null),
    shown,
    visible: computed(() => shown()),
    grouped: computed(() => pairs(shown())),
    selectNode: vi.fn((id: string) => { node.set(id); pair.set(null); }),
    selectPair: vi.fn((next: [string, string]) => { pair.set(next); }),
  };
}

describe('DepMapGraph interactions', () => {
  let fixture: ComponentFixture<DepMapGraph>;
  let store: ReturnType<typeof createRichStore>;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let clock: number;

  function runFrames(at: number): void {
    clock = at;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(at));
  }

  function create(): void {
    fixture = TestBed.createComponent(DepMapGraph);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    localStorage.clear();
    frames = new Map();
    nextFrame = 1;
    clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
    store = createRichStore();
    await TestBed.configureTestingModule({
      imports: [DepMapGraph],
      providers: [{ provide: DepMapStore, useValue: store }],
    }).compileComponents();
    TestBed.inject(I18n).setLocale('es');
    create();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const graph = () => fixture.componentInstance;
  const nodeEl = (id: string) => el().querySelector(`.node[data-node="${id}"]`) as SVGGElement;
  const edgeEl = (key: string) => el().querySelector(`.edge[data-pair="${key}"]`) as SVGGElement;

  function pointer(type: string, init: Partial<PointerEventInit> & { target?: Element } = {}): PointerEvent {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 0, clientY: 0, ...init }) as unknown as PointerEvent;
    Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 });
    Object.defineProperty(event, 'pointerType', { value: init.pointerType ?? 'mouse' });
    if (init.target) Object.defineProperty(event, 'target', { value: init.target });
    return event;
  }

  /** jsdom no implementa getScreenCTM: se simula una matriz identidad. */
  function identityScreenMatrix(svg: SVGSVGElement): void {
    Object.defineProperty(svg, 'getScreenCTM', { configurable: true, value: () => ({ inverse: () => ({}) }) });
  }

  describe('rendering', () => {
    it('draws one node per group and marks my group', () => {
      expect(el().querySelectorAll('.node')).toHaveLength(4);
      expect(nodeEl('usr').querySelector('.mineTag')).not.toBeNull();
      expect(nodeEl('ops').querySelector('.mineTag')).toBeNull();
    });

    it('shows outgoing and incoming counts for regular groups', () => {
      const counts = nodeEl('usr').querySelector('.ct')!.textContent!.replace(/\s+/g, ' ').trim();

      expect(counts).toBe('↑2 ↓2');
    });

    it('labels transversal groups instead of counting', () => {
      const text = nodeEl('sec').querySelector('.ct')!.textContent!.trim();

      expect(text).toBe(graph().t().mapa.transversal);
      expect(nodeEl('sec').getAttribute('aria-label')).toBe('Seguridad: transversal');
    });

    it('builds the accessible label of a group from its counts', () => {
      expect(nodeEl('usr').getAttribute('aria-label')).toBe('Usuarios: necesita 2; lo necesitan 2');
    });

    it('draws one edge per direction with its count badge and label', () => {
      expect(edgeEl('usr>ops').querySelector('.badge text')!.textContent!.trim()).toBe('2');
      expect(edgeEl('ops>usr').querySelector('.badge text')!.textContent!.trim()).toBe('1');
      expect(edgeEl('usr>ops').getAttribute('aria-label')).toBe('Usuarios necesita de Operaciones: 2 pedidos');
      expect(edgeEl('pag>usr').getAttribute('aria-label')).toBe('Pagos necesita de Usuarios: 1 pedido');
      expect(edgeEl('usr>ops').querySelector('.hit title')!.textContent).toBe('Usuarios necesita de Operaciones (2)');
    });

    it('colours edges by direction relative to the selected group', () => {
      expect(edgeEl('usr>ops').classList).toContain('out');
      expect(edgeEl('ops>usr').classList).toContain('in');
      expect(edgeEl('usr>ops').querySelector('.line')!.getAttribute('marker-end')).toBe('url(#m-out)');
      expect(edgeEl('ops>usr').querySelector('.line')!.getAttribute('marker-end')).toBe('url(#m-in)');
      expect(edgeEl('usr>ops').querySelector('.flow')).not.toBeNull();
    });

    it('dims the rest when a pair is selected', () => {
      store.pair.set(['pag', 'usr']);
      fixture.detectChanges();

      expect(edgeEl('pag>usr').classList).toContain('sel');
      expect(edgeEl('pag>usr').querySelector('.line')!.getAttribute('marker-end')).toBe('url(#m-sel)');
      expect(edgeEl('usr>ops').classList).toContain('dim');
      expect(edgeEl('usr>ops').querySelector('.line')!.getAttribute('marker-end')).toBe('url(#m-n)');
      expect(edgeEl('usr>ops').querySelector('.flow')).toBeNull();
    });

    it('uses neutral edges when nothing is selected', () => {
      store.node.set(null);
      fixture.detectChanges();

      expect(edgeEl('usr>ops').classList).toContain('base');
      expect(graph().passiveEdges()).toHaveLength(0);
      expect(graph().activeEdges()).toHaveLength(3);
    });

    it('highlights the edge that contains the flashed dependency', () => {
      store.flashId.set('r2');
      fixture.detectChanges();

      expect(edgeEl('usr>ops').classList).toContain('flash');
      expect(edgeEl('ops>usr').classList).not.toContain('flash');
    });
  });

  describe('legend', () => {
    const legend = () => el().querySelector('.legend')!.textContent!.replace(/\s+/g, ' ');

    it('names the selected group and counts visible dependencies', () => {
      expect(legend()).toContain('Usuarios');
      expect(legend()).toContain('4 dependencias visibles');
    });

    it('uses the singular for one dependency', () => {
      store.shown.set([richEdges[3]]);
      fixture.detectChanges();

      expect(legend()).toContain('1 dependencia visible');
    });

    it('shows the generic help when a pair is selected', () => {
      store.pair.set(['usr', 'ops']);
      fixture.detectChanges();

      expect(legend()).toContain(graph().t().mapa.leyendaGrupoAyuda);
      expect(legend()).toContain(graph().t().mapa.leyendaNecesita);
    });

    it('warns when the filters hide everything', () => {
      store.shown.set([]);
      fixture.detectChanges();

      expect(legend()).toContain(graph().t().mapa.sinFiltros);
    });

    it('says tap on narrow screens and click otherwise', () => {
      expect(legend()).toContain(graph().t().mapa.clic);

      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), media: query }));
      store.shown.set([...richEdges]);
      fixture.detectChanges();

      expect(graph().isNarrow()).toBe(true);
      expect(legend()).toContain(graph().t().mapa.toca);
    });
  });

  describe('names', () => {
    it('falls back to the id or empty text for unknown groups', () => {
      expect(graph().nodeName('usr')).toBe('Usuarios');
      expect(graph().nodeName('zzz')).toBe('zzz');
      expect(graph().nodeName(null)).toBe('');
    });
  });

  describe('selection', () => {
    it('selects a group on click', () => {
      nodeEl('ops').dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(store.selectNode).toHaveBeenCalledWith('ops');
    });

    it('selects a pair on click, Enter and Space', () => {
      edgeEl('usr>ops').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      edgeEl('ops>usr').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
      edgeEl('pag>usr').dispatchEvent(space);

      expect(store.selectPair).toHaveBeenNthCalledWith(1, ['usr', 'ops']);
      expect(store.selectPair).toHaveBeenNthCalledWith(2, ['ops', 'usr']);
      expect(store.selectPair).toHaveBeenNthCalledWith(3, ['pag', 'usr']);
      expect(space.defaultPrevented).toBe(true);
    });

    it('selects a group with Enter or Space', () => {
      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      nodeEl('pag').dispatchEvent(enter);
      nodeEl('ops').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));

      expect(enter.defaultPrevented).toBe(true);
      expect(store.selectNode).toHaveBeenCalledWith('pag');
      expect(store.selectNode).toHaveBeenCalledWith('ops');
    });

    it('ignores other keys on a group', () => {
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      nodeEl('pag').dispatchEvent(tab);

      expect(tab.defaultPrevented).toBe(false);
      expect(store.selectNode).not.toHaveBeenCalled();
    });
  });

  describe('moving groups with the keyboard', () => {
    function press(id: string, key: string, shiftKey = false): KeyboardEvent {
      const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
      nodeEl(id).dispatchEvent(event);
      fixture.detectChanges();
      return event;
    }

    it('moves a group two units per arrow and ten with Shift', () => {
      const start = { ...graph().renderedNodes()['ops'] };

      press('ops', 'ArrowRight');
      expect(graph().renderedNodes()['ops'].x).toBeCloseTo(start.x + 2);

      press('ops', 'ArrowDown', true);
      expect(graph().renderedNodes()['ops'].y).toBeCloseTo(start.y + 10);

      press('ops', 'ArrowLeft', true);
      press('ops', 'ArrowUp');
      expect(graph().renderedNodes()['ops'].x).toBeCloseTo(start.x - 8);
      expect(graph().renderedNodes()['ops'].y).toBeCloseTo(start.y + 8);
    });

    it('saves the moved position', () => {
      const event = press('ops', 'ArrowRight');

      expect(event.defaultPrevented).toBe(true);
      const saved = JSON.parse(localStorage.getItem('depmap-node-positions-v3')!);
      expect(saved.ops.x).toBeCloseTo(graph().renderedNodes()['ops'].x);
    });

    it('keeps the group inside the map', () => {
      for (let i = 0; i < 200; i++) press('ops', 'ArrowRight', true);

      const node = graph().renderedNodes()['ops'];
      expect(node.x).toBeLessThan(1500);
    });

    it('ignores arrows for a group that is not rendered', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true });

      graph().onNodeKeydown(event, 'zzz');

      expect(event.defaultPrevented).toBe(false);
      expect(localStorage.getItem('depmap-node-positions-v3')).toBeNull();
    });
  });

  describe('saved positions', () => {
    it('restores positions saved by a previous visit', () => {
      localStorage.setItem('depmap-node-positions-v3', JSON.stringify({ ops: { x: 900, y: 400 } }));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ imports: [DepMapGraph], providers: [{ provide: DepMapStore, useValue: store }] });
      create();

      expect(graph().renderedNodes()['ops'].x).toBe(900);
      expect(graph().renderedNodes()['ops'].y).toBe(400);
    });

    it('skips invalid stored points', () => {
      localStorage.setItem('depmap-node-positions-v3', JSON.stringify({ ops: { x: 'a', y: 1 }, usr: null }));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ imports: [DepMapGraph], providers: [{ provide: DepMapStore, useValue: store }] });
      create();

      expect(graph().renderedNodes()['ops'].x).not.toBe('a');
    });

    it('migrates v1 positions from server coordinates', () => {
      localStorage.setItem('depmap-node-positions', JSON.stringify({ ops: { x: 600, y: 400 } }));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ imports: [DepMapGraph], providers: [{ provide: DepMapStore, useValue: store }] });
      create();

      const migrated = JSON.parse(localStorage.getItem('depmap-node-positions-v3')!);
      expect(migrated.ops).toEqual({ x: 600 * 1.25 + 125, y: 400 * 1.25 });
    });

    it('migrates v2 positions removing the old offset', () => {
      localStorage.setItem('depmap-node-positions-v2', JSON.stringify({ ops: { x: 700, y: 400 } }));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ imports: [DepMapGraph], providers: [{ provide: DepMapStore, useValue: store }] });
      create();

      const migrated = JSON.parse(localStorage.getItem('depmap-node-positions-v3')!);
      expect(migrated.ops).toEqual({ x: 600 * 1.25 + 125, y: 400 * 1.25 });
    });

    it('ignores corrupt storage', () => {
      localStorage.setItem('depmap-node-positions-v3', '{roto');
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ imports: [DepMapGraph], providers: [{ provide: DepMapStore, useValue: store }] });

      expect(() => create()).not.toThrow();
    });

    it('keeps working when saving throws', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('lleno'); });

      expect(() => graph().onNodeKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }), 'ops')).not.toThrow();
    });
  });

  describe('zoom buttons and fit', () => {
    it('zooms in and out with a smooth animation', () => {
      expect(graph().canZoomOut()).toBe(false);
      expect(graph().zoomPercent()).toBe('100%');

      graph().zoomIn();
      runFrames(0);
      runFrames(125);
      expect(graph().transform().scale).toBeGreaterThan(1);
      expect(graph().transform().scale).toBeLessThan(1.25);
      runFrames(250);
      expect(graph().transform().scale).toBeCloseTo(1.25);
      expect(graph().zoomPercent()).toBe('125%');
      expect(graph().canPan()).toBe(true);

      graph().zoomOut();
      runFrames(1000);
      expect(graph().transform().scale).toBeCloseTo(1);
    });

    it('stacks fast clicks on the animation target', () => {
      graph().zoomIn();
      graph().zoomIn();
      runFrames(10_000);

      expect(graph().transform().scale).toBeCloseTo(1.5625);
    });

    it('does nothing past the zoom limits', () => {
      graph().zoomOut();
      runFrames(1000);
      expect(graph().transform().scale).toBe(1);

      for (let i = 0; i < 10; i++) { graph().zoomIn(); runFrames(clock + 1000); }
      expect(graph().transform().scale).toBe(3);
      expect(graph().canZoomIn()).toBe(false);

      graph().zoomIn();
      runFrames(clock + 1000);
      expect(graph().transform().scale).toBe(3);
    });

    it('writes the transform attribute of the viewport', () => {
      graph().transform.set({ scale: 2, x: -10.123, y: 5 });
      fixture.detectChanges();

      expect(el().querySelector('.viewport')!.getAttribute('transform')).toBe('translate(-10.12 5.00) scale(2)');
    });

    it('applies the zoom at once with reduced motion', () => {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }));

      graph().zoomIn();

      // Sin correr ningun frame el zoom ya esta aplicado.
      expect(graph().transform().scale).toBeCloseTo(1.25);
    });

    it('fit rearranges groups, saves them and resets the zoom', () => {
      graph().transform.set({ scale: 2, x: -100, y: -100 });

      graph().fit();
      runFrames(0);
      runFrames(225);
      expect(graph().displayNodes()).not.toEqual(graph().renderedNodes());
      runFrames(10_000);

      expect(graph().transform()).toEqual({ scale: 1, x: 0, y: 0 });
      expect(graph().displayNodes()).toEqual(graph().renderedNodes());
      expect(Object.keys(JSON.parse(localStorage.getItem('depmap-node-positions-v3')!)).sort()).toEqual(['ops', 'pag', 'sec', 'usr']);
    });

    it('cancels running animations when destroyed', () => {
      graph().transform.set({ scale: 2, x: -50, y: -50 });
      graph().fit();
      const component = graph();

      fixture.destroy();
      runFrames(10_000);

      // La animacion cancelada nunca llega al destino.
      expect(component.transform()).toEqual({ scale: 2, x: -50, y: -50 });
    });
  });

  describe('wheel zoom', () => {
    it('zooms out with a positive delta', () => {
      graph().transform.set({ scale: 2, x: 0, y: 0 });

      el().querySelector('svg.map')!.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, metaKey: true, cancelable: true }));

      expect(graph().transform().scale).toBeCloseTo(1.6);
    });

    it('zooms around the cursor when the browser maps coordinates', () => {
      const svg = el().querySelector('svg.map') as SVGSVGElement;
      identityScreenMatrix(svg);
      vi.stubGlobal('DOMPoint', class {
        constructor(public x: number, public y: number) {}
        matrixTransform() { return { x: this.x, y: this.y }; }
      });

      svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, clientX: 0, clientY: 0, cancelable: true }));

      expect(graph().transform().scale).toBe(1.25);
      // El foco es la esquina (0,0): esa esquina queda fija.
      expect(graph().transform().x).toBeCloseTo(0);
      expect(graph().transform().y).toBeCloseTo(0);
    });
  });

  describe('panning', () => {
    const svg = () => el().querySelector('svg.map') as SVGSVGElement;

    it('does not pan at the minimum zoom', () => {
      svg().dispatchEvent(pointer('pointerdown', { clientX: 10, clientY: 10 }));
      svg().dispatchEvent(pointer('pointermove', { clientX: 200, clientY: 200 }));

      expect(graph().dragging()).toBe(false);
    });

    it('ignores touch and non primary buttons', () => {
      graph().transform.set({ scale: 2, x: 0, y: 0 });

      svg().dispatchEvent(pointer('pointerdown', { pointerType: 'touch' }));
      svg().dispatchEvent(pointer('pointerdown', { button: 2 }));
      svg().dispatchEvent(pointer('pointermove', { clientX: 200 }));

      expect(graph().dragging()).toBe(false);
    });

    it('starts panning only after the threshold and swallows the click that ends it', () => {
      graph().transform.set({ scale: 2, x: -200, y: -200 });
      const svgEl = svg() as SVGSVGElement & { setPointerCapture: () => void; hasPointerCapture: () => boolean; releasePointerCapture: () => void };
      let mapX = 0;
      identityScreenMatrix(svgEl);
      vi.stubGlobal('DOMPoint', class {
        constructor(public x: number, public y: number) {}
        matrixTransform() { mapX = this.x; return { x: this.x, y: this.y }; }
      });
      svgEl.setPointerCapture = vi.fn();
      svgEl.hasPointerCapture = vi.fn(() => true);
      svgEl.releasePointerCapture = vi.fn();

      svgEl.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100 }));
      svgEl.dispatchEvent(pointer('pointermove', { clientX: 102, clientY: 101 }));
      expect(graph().dragging()).toBe(false);

      const move = pointer('pointermove', { clientX: 150, clientY: 130 });
      svgEl.dispatchEvent(move);
      expect(mapX).toBe(150);
      expect(graph().dragging()).toBe(true);
      expect(move.defaultPrevented).toBe(true);
      expect(svgEl.setPointerCapture).toHaveBeenCalledWith(1);
      expect(graph().transform().x).toBeGreaterThan(-200);

      svgEl.dispatchEvent(pointer('pointerup'));
      expect(graph().dragging()).toBe(false);
      expect(svgEl.releasePointerCapture).toHaveBeenCalledWith(1);

      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      svgEl.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);

      const nextClick = new MouseEvent('click', { bubbles: true, cancelable: true });
      svgEl.dispatchEvent(nextClick);
      expect(nextClick.defaultPrevented).toBe(false);
    });

    it('treats a press without movement as a normal click', () => {
      graph().transform.set({ scale: 2, x: 0, y: 0 });

      svg().dispatchEvent(pointer('pointerdown', { clientX: 5, clientY: 5 }));
      svg().dispatchEvent(pointer('pointerup'));
      nodeEl('ops').dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(store.selectNode).toHaveBeenCalledWith('ops');
    });

    it('ignores moves and releases without a press', () => {
      expect(() => {
        graph().onPointerMove(pointer('pointermove'));
        graph().onPointerUp(pointer('pointerup'));
      }).not.toThrow();
      expect(graph().dragging()).toBe(false);
    });
  });

  describe('dragging groups', () => {
    it('drags a group with the pointer and saves it on release', () => {
      const target = nodeEl('ops').querySelector('rect')!;
      const startX = graph().renderedNodes()['ops'].x;
      const svgEl = el().querySelector('svg.map') as SVGSVGElement & { setPointerCapture: () => void; hasPointerCapture: () => boolean; releasePointerCapture: () => void };
      svgEl.setPointerCapture = vi.fn(() => { throw new Error('jsdom'); });
      svgEl.hasPointerCapture = () => true;
      svgEl.releasePointerCapture = vi.fn(() => { throw new Error('jsdom'); });
      let call = 0;
      identityScreenMatrix(svgEl);
      vi.stubGlobal('DOMPoint', class {
        constructor(public x: number, public y: number) {}
        matrixTransform() { call++; return { x: this.x, y: this.y }; }
      });

      graph().onPointerDown(pointer('pointerdown', { clientX: 100, clientY: 100, target }));
      graph().onPointerMove(pointer('pointermove', { clientX: 101, clientY: 100 }));
      expect(graph().draggingNodeId()).toBeNull();

      graph().onPointerMove(pointer('pointermove', { clientX: 160, clientY: 100 }));
      fixture.detectChanges();
      expect(graph().draggingNodeId()).toBe('ops');
      expect(graph().renderedNodes()['ops'].x).toBeCloseTo(startX + 60);
      expect(localStorage.getItem('depmap-node-positions-v3')).toBeNull();

      graph().onPointerUp(pointer('pointerup'));
      expect(graph().draggingNodeId()).toBeNull();
      expect(JSON.parse(localStorage.getItem('depmap-node-positions-v3')!).ops.x).toBeCloseTo(startX + 60);
      expect(call).toBeGreaterThan(0);

      graph().selectNode('ops');
      expect(store.selectNode).not.toHaveBeenCalled();
      graph().selectNode('ops');
      expect(store.selectNode).toHaveBeenCalledWith('ops');
    });

    it('selects the group when it is pressed without moving', () => {
      const target = nodeEl('pag').querySelector('rect')!;

      graph().onPointerDown(pointer('pointerdown', { target }));
      graph().onPointerUp(pointer('pointerup'));
      graph().selectNode('pag');

      expect(store.selectNode).toHaveBeenCalledWith('pag');
      expect(localStorage.getItem('depmap-node-positions-v3')).toBeNull();
    });

    it('swallows the pair click that ends a drag', () => {
      const target = nodeEl('pag').querySelector('rect')!;
      graph().onPointerDown(pointer('pointerdown', { clientX: 0, clientY: 0, target }));
      graph().onPointerMove(pointer('pointermove', { clientX: 0, clientY: 50 }));
      graph().onPointerUp(pointer('pointerup'));

      graph().selectPair(['pag', 'usr']);
      expect(store.selectPair).not.toHaveBeenCalled();

      graph().selectPair(['pag', 'usr']);
      expect(store.selectPair).toHaveBeenCalledWith(['pag', 'usr']);
    });

    it('pans instead when the pressed group is not rendered', () => {
      graph().transform.set({ scale: 2, x: 0, y: 0 });
      const fake = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      fake.classList.add('node');
      fake.setAttribute('data-node', 'zzz');

      graph().onPointerDown(pointer('pointerdown', { clientX: 0, clientY: 0, target: fake }));
      graph().onPointerMove(pointer('pointermove', { clientX: 80, clientY: 0 }));

      expect(graph().draggingNodeId()).toBeNull();
      expect(graph().dragging()).toBe(true);
    });
  });
});

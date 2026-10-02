import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { DepMapGraph } from './dep-map-graph';
import { DepMapEdge, DepMapState, DepMapStore } from './dep-map-store';
import { pairs } from './dep-map-geometry';

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

  it('toggles the full map mode without re-selecting My group', () => {
    button('Ver mapa completo').click();
    fixture.detectChanges();

    expect(store.fullMap()).toBe(true);
    expect(store.node()).toBeNull();
    expect(store.pair()).toBeNull();

    button('Enfocar mi grupo').click();
    fixture.detectChanges();

    expect(store.fullMap()).toBe(false);
    expect(store.node()).toBe('usr');
  });
});

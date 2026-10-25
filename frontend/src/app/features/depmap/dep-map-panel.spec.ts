import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { I18n } from '../../core/i18n/i18n';
import { DepMapPanel } from './dep-map-panel';
import { DepMapEdge, DepMapState, DepMapStore } from './dep-map-store';

const edges: DepMapEdge[] = [
  { id: 'o1', from: 'usr', to: 'ops', kind: 'api', state: 'pendiente', text: 'Alta' },
  { id: 'o2', from: 'usr', to: 'ops', kind: 'evento', state: 'definir', text: 'Evento' },
  { id: 'o3', from: 'usr', to: 'pag', kind: 'dato', state: 'pendiente', text: 'Datos' },
  { id: 'i1', from: 'pag', to: 'usr', kind: 'propio', state: 'pendiente', text: 'Entrante' },
];

function baseState(): DepMapState {
  return {
    nodes: {
      usr: { n: 'Usuarios', s: 'usr', x: 0, y: 0 },
      ops: { n: 'Operaciones', s: 'ops', x: 0, y: 0 },
      pag: { n: 'Pagos', s: 'pag', x: 0, y: 0 },
      sec: { n: 'Seguridad', s: 'sec', x: 0, y: 0, transv: true },
    },
    kinds: { propio: 'Propio' },
    info: { usr: { note: 'Nota del grupo', own: ['Tarea A', 'Tarea B'] } },
    edges,
    done: { o3: true },
    activity: [],
    presence: [],
    version: 1,
    updatedAt: null,
    updatedBy: null,
  };
}

function createStore() {
  const state = signal(baseState());
  const node = signal<string | null>(null);
  const pair = signal<[string, string] | null>(null);
  const store = {
    state,
    node,
    pair,
    mine: signal('usr'),
    online: signal(true),
    flashId: signal<string | null>(null),
    visible: computed(() => state().edges),
    clearPair: vi.fn(() => pair.set(null)),
    selectNode: vi.fn((id: string) => node.set(id)),
    setDone: vi.fn((): Promise<void> => Promise.resolve()),
  };
  return store;
}

describe('DepMapPanel', () => {
  let fixture: ComponentFixture<DepMapPanel>;
  let store: ReturnType<typeof createStore>;

  async function render(direction: 'out' | 'in' = 'out'): Promise<HTMLElement> {
    store = createStore();
    await TestBed.configureTestingModule({
      imports: [DepMapPanel],
      providers: [{ provide: DepMapStore, useValue: store }],
    }).compileComponents();
    TestBed.inject(I18n).setLocale('es');
    fixture = TestBed.createComponent(DepMapPanel);
    fixture.componentRef.setInput('direction', direction);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  const panel = () => fixture.componentInstance;
  const text = () => (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');

  describe('outgoing side', () => {
    it('defaults to my group and shows its note and own tasks', async () => {
      const el = await render('out');

      expect(panel().selectedNodeId()).toBe('usr');
      expect(el.querySelector('.obj')!.textContent).toBe('Nota del grupo');
      expect([...el.querySelectorAll('.own li')].map((li) => li.textContent)).toEqual(['Tarea A', 'Tarea B']);
    });

    it('counts the distinct groups it depends on', async () => {
      const el = await render('out');

      expect(panel().uniqueOut()).toBe(2);
      expect(el.querySelector('.sum b')!.textContent).toBe('2');
    });

    it('groups dependencies by the other group, biggest first', async () => {
      await render('out');

      const groups = panel().groupList(panel().outgoing());
      expect(groups.map((group) => group.id)).toEqual(['ops', 'pag']);
      expect(groups[0].edges).toHaveLength(2);
    });

    it('counts only pending dependencies', async () => {
      await render('out');

      expect(panel().pending(panel().outgoing())).toBe(2);
    });

    it('labels kinds and states', async () => {
      await render('out');
      const m = panel().t().mapa;

      expect(panel().kindLabel('api')).toBe(m.tipoApi);
      expect(panel().kindLabel('evento')).toBe(m.tipoEvento);
      expect(panel().kindLabel('dato')).toBe(m.tipoDatos);
      expect(panel().kindLabel('permiso')).toBe(m.tipoPermiso);
      expect(panel().kindLabel('ui')).toBe(m.tipoComponente);
      expect(panel().kindLabel('propio')).toBe('Propio');
      expect(panel().kindLabel('raro')).toBe('raro');
      expect(panel().stateLabel(edges[2])).toBe(m.estadoHecho);
      expect(panel().stateLabel(edges[1])).toBe(m.estadoADefinir);
      expect(panel().stateLabel(edges[0])).toBe(m.estadoPendiente);
    });

    it('marks done items and highlights the to-define chip', async () => {
      const el = await render('out');

      expect(el.querySelectorAll('li.it.done')).toHaveLength(1);
      expect(el.querySelectorAll('.chip.q')).toHaveLength(1);
    });

    it('highlights the flashed item', async () => {
      const el = await render('out');
      store.flashId.set('o1');
      fixture.detectChanges();

      expect(el.querySelectorAll('li.it.flash')).toHaveLength(1);
    });

    it('selects a group from its heading', async () => {
      const el = await render('out');

      (el.querySelector('.grp button') as HTMLButtonElement).click();

      expect(store.selectNode).toHaveBeenCalledWith('ops');
    });

    it('asks to delete an item', async () => {
      const el = await render('out');
      const deleted: DepMapEdge[] = [];
      panel().deleteRequested.subscribe((edge) => deleted.push(edge));

      (el.querySelector('li.it button.x') as HTMLButtonElement).click();

      expect(deleted).toHaveLength(1);
    });

    it('marks an item as done from its checkbox', async () => {
      const el = await render('out');
      const box = el.querySelector('li.it:not(.done) input') as HTMLInputElement;

      box.click();
      await fixture.whenStable();

      expect(store.setDone).toHaveBeenCalledWith(expect.any(String), true);
      expect(box.checked).toBe(true);
    });

    it('restores the checkbox when saving fails', async () => {
      const el = await render('out');
      store.setDone.mockReturnValue(Promise.reject(new Error('offline')));
      const box = el.querySelector('li.it.done input') as HTMLInputElement;

      box.click();
      for (let i = 0; i < 3; i++) await Promise.resolve();

      expect(box.checked).toBe(true);
    });

    it('disables editing while offline', async () => {
      const el = await render('out');
      store.online.set(false);
      fixture.detectChanges();

      expect([...el.querySelectorAll('li.it input')].every((input) => (input as HTMLInputElement).disabled)).toBe(true);
      expect([...el.querySelectorAll('li.it button.x')].every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    });

    it('works for a group without extra information', async () => {
      const el = await render('out');
      store.node.set('ops');
      fixture.detectChanges();

      expect(panel().info()).toEqual({ own: [] });
      expect(el.querySelector('.obj')).toBeNull();
      expect(el.querySelector('.own')).toBeNull();
    });
  });

  describe('incoming side', () => {
    it('counts and lists the groups that depend on the selection', async () => {
      const el = await render('in');

      expect(panel().uniqueIn()).toBe(1);
      expect(el.querySelector('.sum b')!.textContent).toBe('1');
      expect(text()).toContain('Entrante');
      expect(el.querySelector('.own')).toBeNull();
    });
  });

  describe('transversal groups', () => {
    it('skips the dependency summary for transversal groups', async () => {
      const el = await render('out');
      store.node.set('sec');
      fixture.detectChanges();

      expect(panel().selectedNode()?.transv).toBe(true);
      expect(el.querySelector('.sum')).toBeNull();
    });
  });

  describe('pair selection', () => {
    it('lists the pair items with a way back on the outgoing side', async () => {
      const el = await render('out');
      store.pair.set(['usr', 'ops']);
      fixture.detectChanges();

      expect(panel().pairEdges().map((edge) => edge.id)).toEqual(['o1', 'o2']);
      expect(el.querySelector('h2')!.textContent).toContain('Usuarios');
      expect(el.querySelectorAll('.pair-items li')).toHaveLength(2);

      (el.querySelector('button.back') as HTMLButtonElement).click();
      expect(store.clearPair).toHaveBeenCalled();
    });

    it('keeps the incoming list on the incoming side', async () => {
      await render('in');
      store.pair.set(['usr', 'ops']);
      fixture.detectChanges();

      expect(text()).toContain('Entrante');
    });

    it('has no pair items without a pair', async () => {
      await render('out');

      expect(panel().pairEdges()).toEqual([]);
    });
  });
});

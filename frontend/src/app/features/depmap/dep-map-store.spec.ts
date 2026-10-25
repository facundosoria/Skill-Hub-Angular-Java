import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Api } from '../../core/api';
import { AuthService } from '../../core/auth';
import { clearDepMapCache, DEP_MAP_CACHE_KEY } from './dep-map-cache';
import { DepMapState, DepMapStore } from './dep-map-store';

class FakeEventSource {
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readonly url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close(): void { this.readyState = FakeEventSource.CLOSED; }
  open(): void { this.readyState = 1; this.onopen?.(); }
  fail(): void { this.onerror?.(); }
}

const state: DepMapState = {
  nodes: { usr: { n: 'Usuarios', s: 'usr', x: 0, y: 0 } },
  kinds: { bloqueante: 'Bloqueante' },
  info: {},
  edges: [{ id: 'edge-1', from: 'usr', to: 'usr', kind: 'bloqueante', state: 'pendiente', text: 'Prueba' }],
  done: {},
  activity: [],
  presence: [],
  version: 1,
  updatedAt: null,
  updatedBy: null,
};

describe('DepMapStore offline mode', () => {
  let api: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('shows cached data, marks offline, and disables mutations after a network error', async () => {
    localStorage.setItem(DEP_MAP_CACHE_KEY, JSON.stringify(state));
    api.get.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    const store = await createStore();

    expect(store.offline()).toBe(true);
    expect(store.online()).toBe(false);
    expect(store.state().edges).toHaveLength(1);
    // The map mutation controls bind their disabled state to this signal.
    expect(store.online()).toBe(false);
  });

  it('retries after 8 seconds, recreates SSE, and leaves offline mode on recovery', async () => {
    api.get.mockReturnValueOnce(of(state)).mockReturnValue(of(state));
    const store = await createStore();
    const firstSse = FakeEventSource.instances[0];
    firstSse.fail();
    expect(store.offline()).toBe(true);
    expect(firstSse.readyState).toBe(FakeEventSource.CLOSED);

    await vi.advanceTimersByTimeAsync(7_999);
    expect(api.get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(store.offline()).toBe(false);
    expect(store.online()).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it('does not treat a 401 state response as offline', async () => {
    api.get.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 401 })));
    const store = await createStore();

    expect(store.offline()).toBe(false);
    expect(store.online()).toBe(true);
  });

  async function createStore(): Promise<DepMapStore> {
    TestBed.configureTestingModule({ providers: [DepMapStore, { provide: Api, useValue: api }] });
    const store = TestBed.inject(DepMapStore);
    await Promise.resolve();
    await Promise.resolve();
    return store;
  }
});

describe('DepMapStore full map mode', () => {
  let api: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    api = { get: vi.fn().mockReturnValue(of(state)), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
  });

  async function createStore(): Promise<DepMapStore> {
    TestBed.configureTestingModule({ providers: [DepMapStore, { provide: Api, useValue: api }] });
    const store = TestBed.inject(DepMapStore);
    await Promise.resolve();
    await Promise.resolve();
    return store;
  }

  it('clears the selection and keeps it clear across refreshes while viewing the full map', async () => {
    const store = await createStore();
    expect(store.node()).toBe('usr');

    store.toggleFullMap();
    expect(store.fullMap()).toBe(true);
    expect(store.node()).toBeNull();
    expect(store.pair()).toBeNull();

    await store.refresh();
    expect(store.fullMap()).toBe(true);
    expect(store.node()).toBeNull();
  });

  it('exits the full map mode when a node or an edge is selected', async () => {
    const store = await createStore();
    store.toggleFullMap();
    store.selectNode('usr');
    expect(store.fullMap()).toBe(false);

    store.toggleFullMap();
    store.selectPair(['usr', 'usr']);
    expect(store.fullMap()).toBe(false);
  });

  it('returns to My group when the toggle is turned off', async () => {
    const store = await createStore();
    store.toggleFullMap();
    store.toggleFullMap();

    expect(store.fullMap()).toBe(false);
    expect(store.node()).toBe(store.mine());
  });
});

describe('DepMap cache logout cleanup', () => {
  let api: { post: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    localStorage.clear();
    api = { post: vi.fn().mockReturnValue(of({})) };
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('clears only the map cache during the central logout', async () => {
    localStorage.setItem(DEP_MAP_CACHE_KEY, JSON.stringify(state));
    localStorage.setItem('depmap-mine', 'usr');
    localStorage.setItem('depmap-view', 'lista');
    TestBed.configureTestingModule({ providers: [AuthService, { provide: Api, useValue: api }] });

    await TestBed.inject(AuthService).logout();

    expect(localStorage.getItem(DEP_MAP_CACHE_KEY)).toBeNull();
    expect(localStorage.getItem('depmap-mine')).toBe('usr');
    expect(localStorage.getItem('depmap-view')).toBe('lista');
  });

  it('is safe when localStorage is unavailable', () => {
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(() => clearDepMapCache()).not.toThrow();
    removeItem.mockRestore();
  });
});

const richState: DepMapState = {
  nodes: {
    usr: { n: 'Usuarios', s: 'usr', x: 0, y: 0 },
    ops: { n: 'Operaciones', s: 'ops', x: 0, y: 0 },
    pag: { n: 'Pagos', s: 'pag', x: 0, y: 0 },
  },
  kinds: { api: 'API', evento: 'Evento' },
  info: {},
  edges: [
    { id: 'a', from: 'usr', to: 'ops', kind: 'api', state: 'pendiente', text: 'Alta de clientes' },
    { id: 'b', from: 'ops', to: 'pag', kind: 'evento', state: 'definir', text: 'Cobro confirmado' },
    { id: 'c', from: 'pag', to: 'usr', kind: 'api', state: 'pendiente', text: 'Reintegro' },
    { id: 'ghost', from: 'usr', to: 'borrado', kind: 'api', state: 'pendiente', text: 'Nodo inexistente' },
  ],
  done: { c: true },
  activity: [],
  presence: ['usr'],
  version: 5,
  updatedAt: null,
  updatedBy: null,
};

type FakeApi = {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

describe('DepMapStore behaviour', () => {
  let api: FakeApi;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    api = {
      get: vi.fn().mockReturnValue(of(richState)),
      post: vi.fn().mockReturnValue(of({})),
      put: vi.fn().mockReturnValue(of({})),
      delete: vi.fn().mockReturnValue(of({})),
    };
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
  });

  async function createStore(): Promise<DepMapStore> {
    TestBed.configureTestingModule({ providers: [DepMapStore, { provide: Api, useValue: api }] });
    const store = TestBed.inject(DepMapStore);
    await Promise.resolve();
    await Promise.resolve();
    return store;
  }

  function sse(): FakeEventSource {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1];
  }

  function send(data: unknown): void {
    sse().onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent<string>);
  }

  describe('loading', () => {
    it('loads the state, stops loading and caches the result', async () => {
      const store = await createStore();

      expect(api.get).toHaveBeenCalledWith('/depmap/state');
      expect(store.loading()).toBe(false);
      expect(store.error()).toBeNull();
      expect(store.state().version).toBe(5);
      expect(JSON.parse(localStorage.getItem(DEP_MAP_CACHE_KEY)!).version).toBe(5);
    });

    it('opens one realtime connection to the events endpoint', async () => {
      await createStore();

      expect(FakeEventSource.instances).toHaveLength(1);
      expect(sse().url).toBe('/api/depmap/events');
    });

    it('marks the realtime connection as open when the stream opens', async () => {
      const store = await createStore();
      expect(store.sseOpen()).toBe(false);

      sse().open();

      expect(store.sseOpen()).toBe(true);
    });

    it('does not open a second connection while the first is alive', async () => {
      const store = await createStore();
      sse().open();

      await store.refresh();

      expect(FakeEventSource.instances).toHaveLength(1);
    });

    it('fills missing collections with empty defaults', async () => {
      api.get.mockReturnValue(of({ nodes: { usr: richState.nodes['usr'] }, version: 2 }));
      const store = await createStore();

      expect(store.state().edges).toEqual([]);
      expect(store.state().done).toEqual({});
      expect(store.state().kinds).toEqual({});
      expect(store.state().activity).toEqual([]);
      expect(store.state().presence).toEqual([]);
      expect(store.state().info).toEqual({});
    });

    it('ignores edges, activity and presence that are not arrays', async () => {
      api.get.mockReturnValue(of({ ...richState, edges: 'x', activity: {}, presence: 3 }));
      const store = await createStore();

      expect(store.state().edges).toEqual([]);
      expect(store.state().activity).toEqual([]);
      expect(store.state().presence).toEqual([]);
    });

    it('enables every kind of the state on first load', async () => {
      const store = await createStore();

      expect([...store.kindsOn()].sort()).toEqual(['api', 'evento']);
    });

    it('resets the enabled kinds when a selected kind disappears', async () => {
      const store = await createStore();
      store.toggleKind('evento');
      store.toggleKind('fantasma');
      api.get.mockReturnValue(of(richState));

      await store.refresh();

      expect([...store.kindsOn()].sort()).toEqual(['api', 'evento']);
    });

    it('falls back to the first non-transversal group when the saved one does not exist', async () => {
      localStorage.setItem('depmap-mine', 'inexistente');
      api.get.mockReturnValue(of({
        ...richState,
        nodes: { tr: { n: 'Transversal', s: 'tr', x: 0, y: 0, transv: true }, ops: richState.nodes['ops'] },
      }));
      const store = await createStore();

      expect(store.mine()).toBe('ops');
      expect(store.node()).toBe('ops');
    });

    it('uses a transversal group when it is the only one', async () => {
      api.get.mockReturnValue(of({ ...richState, nodes: { tr: { n: 'Transversal', s: 'tr', x: 0, y: 0, transv: true } } }));
      const store = await createStore();

      expect(store.mine()).toBe('tr');
    });

    it('reports the server error text', async () => {
      api.get.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500, error: { error: 'Base caida' } })));
      const store = await createStore();

      expect(store.error()).toBe('Base caida');
      expect(store.loading()).toBe(false);
    });

    it('reports the status code when the server sends no text', async () => {
      api.get.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503, error: null })));
      const store = await createStore();

      expect(store.error()).toBe('Error 503');
    });

    it('reports plain errors by message and unknown errors generically', async () => {
      api.get.mockReturnValue(throwError(() => new Error('timeout')));
      const store = await createStore();
      expect(store.error()).toBe('timeout');

      api.get.mockReturnValue(throwError(() => 'raro'));
      await expect(store.refresh()).rejects.toBe('raro');
      expect(store.error()).toBe('No se pudo contactar al servidor.');
    });

    it('keeps retrying every 8 seconds while the server stays down', async () => {
      api.get.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
      await createStore();
      expect(api.get).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(8_000);
      expect(api.get).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(8_000);
      expect(api.get).toHaveBeenCalledTimes(3);
    });

    it('retries right away on demand and cancels the scheduled retry', async () => {
      api.get.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })));
      const store = await createStore();
      expect(store.offline()).toBe(true);

      store.retry();
      await Promise.resolve();
      await Promise.resolve();
      expect(store.offline()).toBe(false);

      await vi.advanceTimersByTimeAsync(8_000);
      expect(api.get).toHaveBeenCalledTimes(2);
    });

    it('works without EventSource support', async () => {
      vi.stubGlobal('EventSource', undefined);
      const store = await createStore();

      expect(store.online()).toBe(true);
      expect(FakeEventSource.instances).toHaveLength(0);
    });
  });

  describe('filters', () => {
    it('hides edges whose groups do not exist', async () => {
      const store = await createStore();

      expect(store.visible().map((edge) => edge.id)).toEqual(['a', 'b', 'c']);
    });

    it('filters by status, treating done edges as done', async () => {
      const store = await createStore();

      store.setStatus('pendiente');
      expect(store.visible().map((edge) => edge.id)).toEqual(['a']);

      store.setStatus('definir');
      expect(store.visible().map((edge) => edge.id)).toEqual(['b']);

      store.setStatus('hecho');
      expect(store.visible().map((edge) => edge.id)).toEqual(['c']);

      store.setStatus('todos');
      expect(store.visible()).toHaveLength(3);
    });

    it('filters by kind', async () => {
      const store = await createStore();

      store.toggleKind('api');
      expect(store.visible().map((edge) => edge.id)).toEqual(['b']);

      store.toggleKind('api');
      expect(store.visible()).toHaveLength(3);
    });

    it('searches the text and both group names ignoring case and spaces', async () => {
      const store = await createStore();

      store.setQuery('  COBRO ');
      expect(store.visible().map((edge) => edge.id)).toEqual(['b']);

      store.setQuery('pagos');
      expect(store.visible().map((edge) => edge.id)).toEqual(['b', 'c']);

      store.setQuery('no existe');
      expect(store.visible()).toEqual([]);
    });

    it('combines search, status and kind', async () => {
      const store = await createStore();
      store.setQuery('usuarios');
      store.setStatus('pendiente');

      expect(store.visible().map((edge) => edge.id)).toEqual(['a']);

      store.toggleKind('api');
      expect(store.visible()).toEqual([]);
    });

    it('groups the visible edges by pair of groups', async () => {
      const store = await createStore();

      expect([...store.grouped().keys()]).toEqual(['usr>ops', 'ops>pag', 'pag>usr']);
      store.setQuery('no existe');
      expect(store.grouped().size).toBe(0);
    });
  });

  describe('preferences and selection', () => {
    it('remembers the chosen view', async () => {
      const store = await createStore();

      store.setView('lista');

      expect(store.view()).toBe('lista');
      expect(localStorage.getItem('depmap-view')).toBe('lista');
    });

    it('reads the saved view and panel state on start', async () => {
      localStorage.setItem('depmap-view', 'matriz');
      localStorage.setItem('depmap-panel-collapsed', 'true');
      const store = await createStore();

      expect(store.view()).toBe('matriz');
      expect(store.panelCollapsed()).toBe(true);
    });

    it('toggles and remembers the side panel', async () => {
      const store = await createStore();
      expect(store.panelCollapsed()).toBe(false);

      store.togglePanel();
      expect(store.panelCollapsed()).toBe(true);
      expect(localStorage.getItem('depmap-panel-collapsed')).toBe('true');

      store.togglePanel();
      expect(store.panelCollapsed()).toBe(false);
      expect(localStorage.getItem('depmap-panel-collapsed')).toBe('false');
    });

    it('changes my group, selects it and leaves the full map', async () => {
      const store = await createStore();
      store.toggleFullMap();
      store.selectPair(['usr', 'ops']);

      store.setMine('pag');

      expect(store.mine()).toBe('pag');
      expect(store.node()).toBe('pag');
      expect(store.pair()).toBeNull();
      expect(store.fullMap()).toBe(false);
      expect(localStorage.getItem('depmap-mine')).toBe('pag');
    });

    it('selecting a group clears the selected pair', async () => {
      const store = await createStore();
      store.selectPair(['usr', 'ops']);

      store.selectNode('pag');

      expect(store.node()).toBe('pag');
      expect(store.pair()).toBeNull();
    });

    it('clears the pair alone or the whole selection', async () => {
      const store = await createStore();
      store.selectPair(['usr', 'ops']);

      store.clearPair();
      expect(store.pair()).toBeNull();
      expect(store.node()).toBe('usr');

      store.selectPair(['usr', 'ops']);
      store.clearSelection();
      expect(store.pair()).toBeNull();
      expect(store.node()).toBeNull();
    });

    it('keeps working when localStorage throws', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado'); });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado'); });
      const store = await createStore();

      expect(store.view()).toBe('mapa');
      expect(() => store.setView('lista')).not.toThrow();
      expect(() => store.togglePanel()).not.toThrow();
      expect(store.view()).toBe('lista');
      vi.restoreAllMocks();
    });
  });

  describe('mutations', () => {
    it('adds an edge and reloads', async () => {
      const store = await createStore();
      const body = { from: 'usr', to: 'pag', kind: 'api', state: 'pendiente', text: 'Nueva' };

      await store.addEdge(body);

      expect(api.post).toHaveBeenCalledWith('/depmap/edges', body);
      expect(api.get).toHaveBeenCalledTimes(2);
    });

    it('deletes an edge with an encoded id and reloads', async () => {
      const store = await createStore();

      await store.deleteEdge('id con/barra');

      expect(api.delete).toHaveBeenCalledWith('/depmap/edges/id%20con%2Fbarra');
      expect(api.get).toHaveBeenCalledTimes(2);
    });

    it('marks an edge as done, reloads and flashes it', async () => {
      const store = await createStore();

      await store.setDone('a', true);

      expect(api.put).toHaveBeenCalledWith('/depmap/done/a', { done: true });
      expect(api.get).toHaveBeenCalledTimes(2);
      expect(store.flashId()).toBe('a');
    });

    it('reports and rethrows when marking as done fails', async () => {
      const store = await createStore();
      api.put.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'Version vieja' } })));

      await expect(store.setDone('a', false)).rejects.toBeInstanceOf(HttpErrorResponse);

      expect(store.error()).toBe('Version vieja');
      expect(store.flashId()).toBeNull();
    });

    it('imports data and reloads', async () => {
      const store = await createStore();
      const data = { edges: richState.edges, done: { a: true } };

      await store.importData(data);

      expect(api.post).toHaveBeenCalledWith('/depmap/import', data);
      expect(api.get).toHaveBeenCalledTimes(2);
    });

    it('resets the map and reloads', async () => {
      const store = await createStore();

      await store.reset();

      expect(api.post).toHaveBeenCalledWith('/depmap/reset');
      expect(api.get).toHaveBeenCalledTimes(2);
    });

    it('does not reload when the mutation fails', async () => {
      const store = await createStore();
      api.post.mockReturnValue(throwError(() => new Error('rechazado')));

      await expect(store.addEdge({ from: 'usr', to: 'ops', kind: 'api', state: 'pendiente', text: 'x' })).rejects.toThrow('rechazado');

      expect(api.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('flash', () => {
    it('clears the highlight after 1.8 seconds', async () => {
      const store = await createStore();

      store.flash('a');
      await vi.advanceTimersByTimeAsync(1_799);
      expect(store.flashId()).toBe('a');

      await vi.advanceTimersByTimeAsync(1);
      expect(store.flashId()).toBeNull();
    });

    it('restarts the timer when another edge flashes', async () => {
      const store = await createStore();

      store.flash('a');
      await vi.advanceTimersByTimeAsync(1_000);
      store.flash('b');
      await vi.advanceTimersByTimeAsync(1_000);
      expect(store.flashId()).toBe('b');

      await vi.advanceTimersByTimeAsync(800);
      expect(store.flashId()).toBeNull();
    });
  });

  describe('realtime events', () => {
    it('updates presence from hello without reloading when the version matches', async () => {
      const store = await createStore();

      send({ type: 'hello', presence: ['usr', 'ops'], version: 5 });
      await vi.advanceTimersByTimeAsync(200);

      expect(store.state().presence).toEqual(['usr', 'ops']);
      expect(api.get).toHaveBeenCalledTimes(1);
    });

    it('keeps the previous presence when hello has none', async () => {
      const store = await createStore();

      send({ type: 'hello', version: 5 });

      expect(store.state().presence).toEqual(['usr']);
    });

    it('reloads after hello when the server version differs', async () => {
      await createStore();

      send({ type: 'hello', version: 6 });
      await vi.advanceTimersByTimeAsync(139);
      expect(api.get).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(api.get).toHaveBeenCalledTimes(2);
    });

    it('replaces presence on presence events', async () => {
      const store = await createStore();

      send({ type: 'presence', presence: ['pag'] });
      expect(store.state().presence).toEqual(['pag']);

      send({ type: 'presence' });
      expect(store.state().presence).toEqual([]);
    });

    it('reloads and flashes the changed edge on newer updates', async () => {
      const store = await createStore();

      send({ type: 'update', version: 6, entity: { id: 'b' } });
      await vi.advanceTimersByTimeAsync(140);

      expect(api.get).toHaveBeenCalledTimes(2);
      expect(store.flashId()).toBe('b');
    });

    it('ignores updates that are not newer than the current state', async () => {
      await createStore();

      send({ type: 'update', version: 5 });
      send({ type: 'update', version: 3 });
      await vi.advanceTimersByTimeAsync(200);

      expect(api.get).toHaveBeenCalledTimes(1);
    });

    it('reloads on updates without a version', async () => {
      await createStore();

      send({ type: 'update' });
      await vi.advanceTimersByTimeAsync(140);

      expect(api.get).toHaveBeenCalledTimes(2);
    });

    it('collapses a burst of updates into one reload', async () => {
      await createStore();

      send({ type: 'update', version: 6 });
      send({ type: 'update', version: 7 });
      send({ type: 'update', version: 8 });
      await vi.advanceTimersByTimeAsync(140);

      expect(api.get).toHaveBeenCalledTimes(2);
    });

    it('ignores malformed and unknown messages', async () => {
      const store = await createStore();
      const before = store.state();

      send('{no es json');
      send({ type: 'otra-cosa' });
      await vi.advanceTimersByTimeAsync(200);

      expect(store.state()).toBe(before);
      expect(api.get).toHaveBeenCalledTimes(1);
    });

    it('goes offline with an explanation when the stream breaks', async () => {
      const store = await createStore();
      sse().open();

      sse().fail();

      expect(store.sseOpen()).toBe(false);
      expect(store.offline()).toBe(true);
      expect(store.error()).toBe('La conexión en tiempo real se interrumpió.');
    });

    it('does not fail when a delayed reload errors', async () => {
      const store = await createStore();
      api.get.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));

      store.refreshSoon('a');
      await vi.advanceTimersByTimeAsync(140);

      expect(store.offline()).toBe(true);
      expect(store.flashId()).toBeNull();
    });
  });
});

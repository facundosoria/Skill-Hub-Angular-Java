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

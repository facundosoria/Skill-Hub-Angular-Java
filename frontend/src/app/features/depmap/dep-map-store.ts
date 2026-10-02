import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../core/api';
import { pairs } from './dep-map-geometry';
import { DEP_MAP_CACHE_KEY } from './dep-map-cache';

export interface DepMapNode {
  n: string;
  s: string;
  x: number;
  y: number;
  transv?: boolean;
}

export interface DepMapInfo {
  obj?: string;
  note?: string;
  own?: string[];
}

export interface DepMapEdge {
  id: string;
  from: string;
  to: string;
  kind: string;
  state: 'pendiente' | 'definir' | string;
  text: string;
}

export interface DepMapActivity {
  ts: string;
  by?: string;
  summary: string;
}

export interface DepMapState {
  nodes: Record<string, DepMapNode>;
  kinds: Record<string, string>;
  info: Record<string, DepMapInfo>;
  edges: DepMapEdge[];
  done: Record<string, boolean>;
  activity: DepMapActivity[];
  presence: string[];
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  serverTime?: string | null;
}

export type DepMapView = 'mapa' | 'matriz' | 'lista';
export type DepMapStatus = 'todos' | 'pendiente' | 'definir' | 'hecho';

const MINE_KEY = 'depmap-mine';
const VIEW_KEY = 'depmap-view';
const PANEL_COLLAPSED_KEY = 'depmap-panel-collapsed';

const emptyState: DepMapState = {
  nodes: {}, kinds: {}, info: {}, edges: [], done: {}, activity: [], presence: [],
  version: 0, updatedAt: null, updatedBy: null, serverTime: null,
};

@Injectable({ providedIn: 'root' })
export class DepMapStore {
  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private relativeTimer: ReturnType<typeof setInterval> | null = null;
  private eventSource: EventSource | null = null;

  readonly state = signal<DepMapState>(emptyState);
  readonly view = signal<DepMapView>(this.readPreference(VIEW_KEY, 'mapa') as DepMapView);
  readonly query = signal('');
  readonly status = signal<DepMapStatus>('todos');
  readonly kindsOn = signal<Set<string>>(new Set());
  readonly mine = signal(this.readPreference(MINE_KEY, 'usr'));
  readonly node = signal<string | null>(null);
  readonly pair = signal<[string, string] | null>(null);
  readonly fullMap = signal(false);
  readonly panelCollapsed = signal(this.readPreference(PANEL_COLLAPSED_KEY, 'false') === 'true');
  readonly online = signal(false);
  readonly sseOpen = signal(false);
  readonly offline = signal(false);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly flashId = signal<string | null>(null);
  readonly relativeTick = signal(0);

  readonly visible = computed(() => {
    const state = this.state();
    const q = this.query().trim().toLowerCase();
    const enabled = this.kindsOn();
    return state.edges.filter((edge) => {
      if (!state.nodes[edge.from] || !state.nodes[edge.to]) return false;
      if (!enabled.has(edge.kind)) return false;
      const edgeState = state.done[edge.id] ? 'hecho' : edge.state;
      if (this.status() !== 'todos' && edgeState !== this.status()) return false;
      if (q && !(edge.text + ' ' + state.nodes[edge.from].n + ' ' + state.nodes[edge.to].n).toLowerCase().includes(q)) return false;
      return true;
    });
  });

  readonly grouped = computed(() => pairs(this.visible()));

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.clearRefreshTimer();
      this.clearRetryTimer();
      if (this.flashTimer) clearTimeout(this.flashTimer);
      if (this.relativeTimer) clearInterval(this.relativeTimer);
      this.closeSse();
    });
    this.relativeTimer = setInterval(() => this.relativeTick.update((value) => value + 1), 60_000);
    void this.refresh().catch(() => undefined);
  }

  async refresh(): Promise<DepMapState> {
    try {
      const result = await firstValueFrom(this.api.get<DepMapState>('/depmap/state'));
      this.applyState(result);
      this.markOnline();
      this.error.set(null);
      this.writeCache(result);
      this.connectSse();
      return result;
    } catch (error) {
      this.error.set(errorMessage(error));
      if (isUnauthorized(error)) {
        // A 401 proves that the server is reachable; session handling remains
        // with the auth flow and must not turn the map into offline mode.
        this.markOnline();
      } else {
        this.goOffline();
      }
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  refreshSoon(entityId?: string): void {
    this.clearRefreshTimer();
    this.refreshTimer = setTimeout(async () => {
      this.refreshTimer = null;
      try {
        await this.refresh();
        if (entityId) this.flash(entityId);
      } catch { /* retry is scheduled by goOffline */ }
    }, 140);
  }

  retry(): void {
    this.clearRetryTimer();
    void this.refresh().catch(() => undefined);
  }

  setView(view: DepMapView): void {
    this.view.set(view);
    this.writePreference(VIEW_KEY, view);
  }

  setMine(mine: string): void {
    this.mine.set(mine);
    this.node.set(mine);
    this.pair.set(null);
    this.fullMap.set(false);
    this.writePreference(MINE_KEY, mine);
  }

  togglePanel(): void {
    this.panelCollapsed.update((collapsed) => {
      const next = !collapsed;
      this.writePreference(PANEL_COLLAPSED_KEY, String(next));
      return next;
    });
  }

  setQuery(query: string): void { this.query.set(query); }
  setStatus(status: DepMapStatus): void { this.status.set(status); }

  toggleKind(kind: string): void {
    this.kindsOn.update((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind); else next.add(kind);
      return next;
    });
  }

  selectNode(node: string): void { this.fullMap.set(false); this.node.set(node); this.pair.set(null); }
  selectPair(pair: [string, string]): void { this.fullMap.set(false); this.pair.set(pair); }
  clearSelection(): void { this.fullMap.set(false); this.node.set(null); this.pair.set(null); }
  clearPair(): void { this.pair.set(null); }

  /** Toggles "view full map": no selection, no dimming. Exits by selecting or focusing a group. */
  toggleFullMap(): void {
    if (this.fullMap()) {
      this.fullMap.set(false);
      this.node.set(this.mine());
      this.pair.set(null);
    } else {
      this.fullMap.set(true);
      this.node.set(null);
      this.pair.set(null);
    }
  }

  async addEdge(body: Pick<DepMapEdge, 'from' | 'to' | 'kind' | 'state' | 'text'>): Promise<void> {
    await firstValueFrom(this.api.post('/depmap/edges', body));
    await this.refresh();
  }

  async deleteEdge(id: string): Promise<void> {
    await firstValueFrom(this.api.delete(`/depmap/edges/${encodeURIComponent(id)}`));
    await this.refresh();
  }

  async setDone(id: string, done: boolean): Promise<void> {
    try {
      await firstValueFrom(this.api.put(`/depmap/done/${encodeURIComponent(id)}`, { done }));
      await this.refresh();
      this.flash(id);
    } catch (error) {
      this.error.set(errorMessage(error));
      throw error;
    }
  }

  async importData(data: { edges: DepMapEdge[]; done: Record<string, boolean> }): Promise<void> {
    await firstValueFrom(this.api.post('/depmap/import', data));
    await this.refresh();
  }

  async reset(): Promise<void> {
    await firstValueFrom(this.api.post('/depmap/reset'));
    await this.refresh();
  }

  flash(id: string): void {
    this.flashId.set(id);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.flashTimer = null;
      if (this.flashId() === id) this.flashId.set(null);
    }, 1_800);
  }

  private applyState(next: DepMapState): void {
    const state: DepMapState = {
      ...emptyState,
      ...next,
      nodes: next.nodes ?? {}, kinds: next.kinds ?? {}, info: next.info ?? {},
      edges: Array.isArray(next.edges) ? next.edges : [], done: next.done ?? {},
      activity: Array.isArray(next.activity) ? next.activity : [],
      presence: Array.isArray(next.presence) ? next.presence : [],
    };
    this.state.set(state);
    if (!state.nodes[this.mine()]) {
      const first = Object.keys(state.nodes).find((id) => !state.nodes[id].transv) ?? Object.keys(state.nodes)[0];
      if (first) this.mine.set(first);
    }
    if (!this.fullMap() && !this.node() && this.mine()) this.node.set(this.mine());
    if (!this.kindsOn().size || [...this.kindsOn()].some((kind) => !state.kinds[kind])) this.kindsOn.set(new Set(Object.keys(state.kinds)));
  }

  private connectSse(): void {
    if (typeof EventSource === 'undefined') return;
    if (this.eventSource && this.eventSource.readyState !== EventSource.CLOSED) return;
    this.closeSse();
    try {
      this.eventSource = new EventSource('/api/depmap/events');
    } catch (error) {
      this.goOffline(error);
      return;
    }
    this.eventSource.onopen = () => this.sseOpen.set(true);
    this.eventSource.onerror = () => {
      this.sseOpen.set(false);
      this.goOffline(new Error('La conexión en tiempo real se interrumpió.'));
    };
    this.eventSource.onmessage = (event) => {
      let data: { type?: string; presence?: string[]; version?: number; entity?: { id?: string } };
      try { data = JSON.parse(event.data) as typeof data; } catch { return; }
      if (data.type === 'hello') {
        this.state.update((state) => ({ ...state, presence: data.presence ?? state.presence }));
        if (data.version !== undefined && data.version !== this.state().version) this.refreshSoon();
      } else if (data.type === 'presence') {
        this.state.update((state) => ({ ...state, presence: data.presence ?? [] }));
      } else if (data.type === 'update' && (!data.version || data.version > this.state().version)) {
        this.refreshSoon(data.entity?.id);
      }
    };
  }

  private goOffline(error?: unknown): void {
    this.online.set(false);
    this.sseOpen.set(false);
    this.offline.set(true);
    if (error) this.error.set(errorMessage(error));
    this.closeSse();
    this.loadCache();
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (!this.offline()) return;
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      try { await this.refresh(); } catch { this.scheduleRetry(); }
    }, 8_000);
  }

  private markOnline(): void {
    this.online.set(true);
    this.offline.set(false);
    this.clearRetryTimer();
  }

  private closeSse(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private loadCache(): void {
    try {
      const cache = localStorage.getItem(DEP_MAP_CACHE_KEY);
      if (cache) this.applyState(JSON.parse(cache) as DepMapState);
    } catch { /* localStorage can be disabled */ }
  }

  private writeCache(state: DepMapState): void {
    try { localStorage.setItem(DEP_MAP_CACHE_KEY, JSON.stringify(state)); } catch { /* localStorage can be disabled */ }
  }

  private readPreference(key: string, fallback: string): string {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
  }

  private writePreference(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* localStorage can be disabled */ }
  }
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 401;
}

function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as { error?: string } | null;
    return body?.error || `Error ${error.status}`;
  }
  return error instanceof Error ? error.message : 'No se pudo contactar al servidor.';
}

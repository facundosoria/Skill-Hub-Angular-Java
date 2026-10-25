import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import type { InfraServiceStatus, InfraStateName } from '../../core/infra';
import { I18n } from '../../core/i18n/i18n';
import { UI } from '../../shared/ui';

type EdgeKind = 'route' | 'http' | 'event';

interface MapNode {
  svc: InfraServiceStatus;
  x: number;
  y: number;
  hub: boolean;
}

interface MapEdge {
  kind: EdgeKind;
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// Tamaño del lienzo si todavía no se midió el contenedor (primer render, pruebas sin ResizeObserver).
const DEFAULT_WIDTH = 900;
const DEFAULT_HEIGHT = 520;
// Margen entre el anillo de nodos y el borde: deja lugar a las etiquetas y a los nodos.
const MARGIN_X = 90;
const MARGIN_Y = 60;
const GATEWAY = 'api-gateway';
const HUB_R = 26;
const NODE_R = 19;
// Separación perpendicular para que HTTP y eventos entre el mismo par no se superpongan.
const OFFSET: Record<EdgeKind, number> = { route: 0, http: 4, event: -4 };

/**
 * Pestaña "Mapa" de /infra: salud de cada servicio y sus relaciones tal como las
 * declara el backend: `dependsOn` (llamadas HTTP; las que salen del api-gateway
 * son sus rutas) y `publishesTo` (eventos por el bus). No infiere ni inventa
 * relaciones: sin ninguna declarada muestra sólo los nodos y lo dice.
 */
@Component({
  selector: 'app-infra-map',
  imports: [...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-1 flex-col' },
  template: `
      <section uiCard class="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div class="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <div class="w-56 max-w-full">
            <input uiInput type="search" class="w-full" [attr.aria-label]="t().buscar" [placeholder]="t().buscar"
              [value]="query()" (input)="query.set($any($event.target).value)" />
          </div>
          <button type="button" uiButton variant="secondary" size="sm" [attr.aria-pressed]="onlyProblems()"
            [class.ring-2]="onlyProblems()" [class.ring-accent]="onlyProblems()" (click)="onlyProblems.set(!onlyProblems())">
            {{ t().resaltarProblemas }}
          </button>
          @for (layer of layerList(); track layer.kind) {
            <button type="button" uiButton variant="secondary" size="sm" [attr.aria-pressed]="layers()[layer.kind]"
              [class.ring-2]="layers()[layer.kind]" [class.ring-accent]="layers()[layer.kind]" (click)="toggleLayer(layer.kind)">
              {{ layer.label }}
            </button>
          }
          @if (!selectedService()) { <span class="ml-auto hidden text-xs text-text-muted md:inline">{{ t().elegir }}</span> }
        </div>
        @if (!hasRelations()) {
          <div class="border-b border-border px-4 py-3" role="status">
            <h3 class="text-xs font-semibold text-text">{{ t().vacioTitulo }}</h3>
            <p class="mt-1 text-xs text-text-muted">{{ t().vacioTexto }}</p>
          </div>
        }

        <div #stage class="relative min-h-[18rem] flex-1">
        <svg [attr.viewBox]="'0 0 ' + width() + ' ' + height()" class="absolute inset-0 block h-full w-full" role="group" [attr.aria-label]="t().aria">
          <defs>
            <marker id="infra-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="var(--text-faint)" />
            </marker>
            <marker id="infra-arrow-event" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="var(--accent)" />
            </marker>
          </defs>
          @for (edge of edges(); track edge.kind + edge.from + '>' + edge.to) {
            <line [attr.x1]="edge.x1" [attr.y1]="edge.y1" [attr.x2]="edge.x2" [attr.y2]="edge.y2"
              [attr.stroke]="edgeColor(edge)" [attr.stroke-width]="edgeWidth(edge)"
              [attr.stroke-dasharray]="edge.kind === 'event' ? '5 4' : null"
              [attr.marker-end]="edge.kind === 'route' && !isHighlighted(edge) ? null : markerFor(edge)"
              [attr.opacity]="isDimmedEdge(edge) ? 0.12 : edge.kind === 'route' && !isHighlighted(edge) ? 0.45 : 1" />
          }
          @for (node of nodes(); track node.svc.name) {
            <g role="button" tabindex="0" class="cursor-pointer focus-visible:outline-none"
              [attr.aria-pressed]="selected() === node.svc.name" [attr.aria-label]="nodeLabel(node.svc)"
              [attr.transform]="'translate(' + node.x + ',' + node.y + ')'" [attr.opacity]="isDimmedNode(node.svc) ? 0.2 : 1"
              (click)="toggle(node.svc.name)" (keydown.enter)="toggle(node.svc.name)" (keydown.space)="$event.preventDefault(); toggle(node.svc.name)">
              @if (node.svc.state === 'DEGRADED') {
                <circle [attr.r]="node.hub ? 32 : 26" fill="none" stroke="var(--warning)" stroke-width="2" opacity="0.4" />
              }
              <circle [attr.r]="node.hub ? hubR : nodeR" [attr.fill]="selected() === node.svc.name ? 'var(--accent-soft)' : 'var(--surface-2)'"
                [attr.stroke]="stateColor(node.svc.state)" stroke-width="3" />
              @if (lowAvailability(node.svc)) {
                <circle cx="14" cy="-14" r="6" fill="var(--danger)" stroke="var(--surface)" stroke-width="2"><title>{{ t().bajaDisp }}</title></circle>
              }
              <text [attr.y]="(node.hub ? hubR : nodeR) + 18" text-anchor="middle" font-size="11.5" fill="var(--text)"
                stroke="var(--surface)" stroke-width="4" paint-order="stroke">{{ shortName(node.svc) }}</text>
            </g>
          }
        </svg>
        </div>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-3 text-xs text-text-muted">
          <span class="font-semibold text-text">{{ t().leyendaTitulo }}</span>
          @for (item of legend(); track item.state) {
            <span class="inline-flex items-center gap-1.5">
              <span class="inline-block h-2.5 w-2.5 rounded-full border-2" [style.border-color]="stateColor(item.state)"></span>{{ item.label }}
            </span>
          }
          <span class="inline-flex items-center gap-1.5"><svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--text-faint)" stroke-width="1" opacity="0.45" /></svg>{{ t().leyendaRuta }}</span>
          <span class="inline-flex items-center gap-1.5"><svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--text-faint)" stroke-width="1.6" /></svg>{{ t().leyendaHttp }}</span>
          <span class="inline-flex items-center gap-1.5"><svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--accent)" stroke-width="1.6" stroke-dasharray="5 4" /></svg>{{ t().leyendaEvento }}</span>
        </div>

        <ul class="sr-only" [attr.aria-label]="t().lista">
          @for (node of nodes(); track node.svc.name) {
            <li>{{ node.svc.name }}:
              {{ node.svc.dependsOn.length ? t().llamaALista + ' ' + node.svc.dependsOn.join(', ') : '' }}
              {{ node.svc.publishesTo.length ? t().publicaALista + ' ' + node.svc.publishesTo.join(', ') : '' }}
              {{ !node.svc.dependsOn.length && !node.svc.publishesTo.length ? t().sinLlamadas : '' }}</li>
          }
        </ul>
      @if (selectedService(); as svc) {
      <aside class="z-10 m-3 max-h-[min(34rem,70%)] overflow-auto rounded-[var(--radius-lg)] border border-border bg-surface p-4 text-sm shadow-lg sm:absolute sm:top-16 sm:m-0 sm:w-72" [class]="panelSide() === 'left' ? 'sm:left-3' : 'sm:right-3'" aria-live="polite">
        
          <div class="flex items-start justify-between gap-2">
            <h2 class="break-all font-semibold">{{ svc.displayName }}</h2>
            <span uiBadge [tone]="stateTone(svc.state)">{{ stateLabel(svc.state) }}</span>
          </div>
          @if (svc.reason) { <p class="mt-2 text-xs text-warning">{{ i().motivo }}: {{ svc.reason }}</p> }
          <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt class="text-text-muted">{{ i().colDisponibilidad }}</dt>
            <dd class="text-right font-mono text-xs">{{ pct(svc, '24h') }} · {{ pct(svc, '7d') }}</dd>
            <dt class="text-text-muted">{{ i().colUptime }}</dt>
            <dd class="text-right font-mono text-xs">{{ uptime(svc.uptimeSeconds) }}</dd>
            <dt class="text-text-muted">{{ i().colInstancias }}</dt>
            <dd class="text-right font-mono text-xs">{{ svc.instances }}</dd>
          </dl>
          @for (group of relations(svc); track group.label) {
            <div class="mt-4">
              <div class="text-xs text-text-muted">{{ group.label }}</div>
              <div class="mt-1.5 flex flex-wrap gap-1.5">
                @for (name of group.names; track name) {
                  <button type="button" class="rounded-full border border-border bg-surface-2 px-3 py-1 text-xs hover:border-accent" (click)="selected.set(name)">{{ name }}</button>
                } @empty { <span class="text-xs text-text-faint">{{ t().sinConexiones }}</span> }
              </div>
            </div>
          }
          <button type="button" uiButton variant="ghost" size="sm" class="mt-4" (click)="selected.set(null)">{{ t().quitar }}</button>
        
      </aside>
      }
      </section>
  `,
})
export class InfraMap {
  private i18n = inject(I18n);
  readonly services = input.required<InfraServiceStatus[]>();

  readonly t = computed(() => this.i18n.t().infra.mapa);
  readonly i = computed(() => this.i18n.t().infra);
  readonly width = signal(DEFAULT_WIDTH);
  readonly height = signal(DEFAULT_HEIGHT);
  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');
  readonly hubR = HUB_R;
  readonly nodeR = NODE_R;
  readonly selected = signal<string | null>(null);
  readonly query = signal('');
  readonly onlyProblems = signal(false);
  readonly layers = signal<Record<EdgeKind, boolean>>({ route: true, http: true, event: true });

  readonly layerList = computed<{ kind: EdgeKind; label: string }[]>(() => [
    { kind: 'route', label: this.t().capaRutas },
    { kind: 'http', label: this.t().capaHttp },
    { kind: 'event', label: this.t().capaEventos },
  ]);

  /** Servicio central: el api-gateway si existe; si no, el más conectado. */
  private readonly hubName = computed(() => {
    const names = new Set(this.services().map((svc) => svc.name));
    if (names.has(GATEWAY)) return GATEWAY;
    const degree = new Map<string, number>();
    for (const svc of this.services()) {
      for (const target of [...(svc.dependsOn ?? []), ...(svc.publishesTo ?? [])]) {
        if (!names.has(target)) continue;
        degree.set(svc.name, (degree.get(svc.name) ?? 0) + 1);
        degree.set(target, (degree.get(target) ?? 0) + 1);
      }
    }
    let best = '';
    let bestDegree = 0;
    for (const [name, value] of degree) {
      if (value > bestDegree) { best = name; bestDegree = value; }
    }
    return best;
  });

  constructor() {
    // El lienzo toma el tamaño real del contenedor: el anillo de nodos aprovecha todo el ancho y alto disponibles.
    effect((onCleanup) => {
      const element = this.stage()?.nativeElement;
      if (!element || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver((entries) => {
        const { width, height } = entries[0].contentRect;
        if (width > 0 && height > 0) {
          this.width.set(Math.round(width));
          this.height.set(Math.round(height));
        }
      });
      observer.observe(element);
      onCleanup(() => observer.disconnect());
    });
  }

  readonly nodes = computed<MapNode[]>(() => {
    const list = this.services();
    const hub = list.find((svc) => svc.name === this.hubName());
    const width = this.width();
    const height = this.height();
    const ring = this.groupByConnections(list.filter((svc) => svc !== hub));
    const nodes: MapNode[] = ring.map((svc, index) => {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / ring.length;
      return { svc, x: width / 2 + (width / 2 - MARGIN_X) * Math.cos(angle), y: height / 2 + 5 + (height / 2 - MARGIN_Y) * Math.sin(angle), hub: false };
    });
    if (hub) nodes.push({ svc: hub, x: width / 2, y: height / 2 + 5, hub: true });
    return nodes;
  });

  /**
   * Ordena el anillo para que los servicios relacionados queden contiguos y las
   * flechas crucen menos: parte del más conectado y suma siempre el que más
   * relaciones tiene con los ya ubicados.
   */
  private groupByConnections(ring: InfraServiceStatus[]): InfraServiceStatus[] {
    const links = new Map<string, Map<string, number>>(ring.map((svc) => [svc.name, new Map()]));
    for (const svc of ring) {
      for (const target of [...(svc.dependsOn ?? []), ...(svc.publishesTo ?? [])]) {
        if (!links.has(target) || target === svc.name) continue;
        links.get(svc.name)!.set(target, (links.get(svc.name)!.get(target) ?? 0) + 1);
        links.get(target)!.set(svc.name, (links.get(target)!.get(svc.name) ?? 0) + 1);
      }
    }
    const degree = (name: string): number => [...links.get(name)!.values()].reduce((sum, value) => sum + value, 0);
    const pending = [...ring];
    const ordered: InfraServiceStatus[] = [];
    while (pending.length) {
      const placed = new Set(ordered.map((svc) => svc.name));
      let bestIndex = 0;
      let bestScore = -1;
      pending.forEach((svc, index) => {
        const toPlaced = [...links.get(svc.name)!].filter(([name]) => placed.has(name)).reduce((sum, [, value]) => sum + value, 0);
        const score = ordered.length ? toPlaced * 1000 + degree(svc.name) : degree(svc.name);
        if (score > bestScore) { bestScore = score; bestIndex = index; }
      });
      ordered.push(...pending.splice(bestIndex, 1));
    }
    return ordered;
  }

  /** Todas las relaciones declaradas (sin filtrar por capa). */
  private readonly allEdges = computed<MapEdge[]>(() => {
    const byName = new Map(this.nodes().map((node) => [node.svc.name, node]));
    const edges: MapEdge[] = [];
    const add = (kind: EdgeKind, from: MapNode, targetName: string): void => {
      const to = byName.get(targetName);
      if (!to || to === from) return;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      const shiftX = -uy * OFFSET[kind];
      const shiftY = ux * OFFSET[kind];
      const fromR = from.hub ? HUB_R : NODE_R;
      const toR = (to.hub ? HUB_R : NODE_R) + 4;
      edges.push({
        kind, from: from.svc.name, to: targetName,
        x1: from.x + ux * fromR + shiftX, y1: from.y + uy * fromR + shiftY,
        x2: to.x - ux * toR + shiftX, y2: to.y - uy * toR + shiftY,
      });
    };
    for (const node of byName.values()) {
      for (const target of node.svc.dependsOn ?? []) add(node.svc.name === GATEWAY ? 'route' : 'http', node, target);
      for (const target of node.svc.publishesTo ?? []) add('event', node, target);
    }
    return edges;
  });

  readonly edges = computed(() => this.allEdges().filter((edge) => this.layers()[edge.kind]));
  /** El detalle flota del lado opuesto al servicio elegido, para no taparlo ni tapar a sus vecinos. */
  readonly panelSide = computed<'left' | 'right'>(() => {
    const node = this.nodes().find((item) => item.svc.name === this.selected());
    return node && node.x > this.width() / 2 ? 'left' : 'right';
  });
  readonly hasRelations = computed(() => this.allEdges().length > 0);
  readonly selectedService = computed(() => this.services().find((svc) => svc.name === this.selected()) ?? null);
  readonly legend = computed(() => {
    const i = this.i();
    return [
      { state: 'UP' as InfraStateName, label: i.estadoUp },
      { state: 'DEGRADED' as InfraStateName, label: i.estadoDegraded },
      { state: 'DOWN' as InfraStateName, label: i.estadoDown },
      { state: 'UNKNOWN' as InfraStateName, label: `${i.estadoUnknown} / ${i.estadoNoAccess}` },
    ];
  });

  toggle(name: string): void { this.selected.set(this.selected() === name ? null : name); }

  toggleLayer(kind: EdgeKind): void { this.layers.update((layers) => ({ ...layers, [kind]: !layers[kind] })); }

  /** Relaciones del servicio elegido, agrupadas por tipo, sólo las que tienen contenido o son llamadas. */
  relations(svc: InfraServiceStatus): { label: string; names: string[] }[] {
    const t = this.t();
    const services = this.services();
    const callers = services.filter((item) => item.dependsOn?.includes(svc.name)).map((item) => item.name);
    const publishers = services.filter((item) => item.publishesTo?.includes(svc.name)).map((item) => item.name);
    return [
      { label: t.conexion, names: svc.dependsOn ?? [] },
      { label: t.conexionRecibe, names: callers },
      { label: t.eventosA, names: svc.publishesTo ?? [] },
      { label: t.eventosDe, names: publishers },
    ];
  }

  edgeColor(edge: MapEdge): string {
    if (edge.kind === 'event') return 'var(--accent)';
    if (edge.kind === 'http') return this.isHighlighted(edge) ? 'var(--text-muted)' : 'var(--text-faint)';
    return this.isHighlighted(edge) ? 'var(--text-muted)' : 'var(--text-faint)';
  }

  edgeWidth(edge: MapEdge): number {
    if (this.isHighlighted(edge)) return 2.2;
    return edge.kind === 'route' ? 1 : 1.5;
  }

  markerFor(edge: MapEdge): string {
    return edge.kind === 'event' ? 'url(#infra-arrow-event)' : 'url(#infra-arrow)';
  }

  isHighlighted(edge: MapEdge): boolean {
    const selected = this.selected();
    return !!selected && (edge.from === selected || edge.to === selected);
  }

  isDimmedEdge(edge: MapEdge): boolean {
    if (this.selected()) return !this.isHighlighted(edge);
    if (this.onlyProblems()) return !this.isProblem(edge.from) && !this.isProblem(edge.to);
    return false;
  }

  isDimmedNode(svc: InfraServiceStatus): boolean {
    const selected = this.selected();
    if (selected && svc.name !== selected && !this.isRelated(svc.name, selected)) return true;
    if (this.onlyProblems() && !this.isProblem(svc.name)) return true;
    const query = this.query().trim().toLowerCase();
    return !!query && !svc.name.toLowerCase().includes(query);
  }

  private isRelated(name: string, selected: string): boolean {
    return this.edges().some((edge) => (edge.from === selected && edge.to === name) || (edge.to === selected && edge.from === name));
  }

  private isProblem(name: string): boolean {
    const svc = this.services().find((item) => item.name === name);
    return !!svc && (svc.state !== 'UP' || this.lowAvailability(svc));
  }

  lowAvailability(svc: InfraServiceStatus): boolean {
    const availability = svc.availability24h;
    return svc.state === 'UP' && !!availability?.hasData && availability.availability !== null && availability.availability < 0.8;
  }

  shortName(svc: InfraServiceStatus): string { return svc.displayName.replace(/-service$/, ''); }

  stateColor(state: InfraStateName): string {
    switch (state) {
      case 'UP': return 'var(--success)';
      case 'DEGRADED': return 'var(--warning)';
      case 'DOWN': return 'var(--danger)';
      default: return 'var(--text-faint)';
    }
  }

  stateTone(state: InfraStateName): 'success' | 'danger' | 'warning' | 'neutral' {
    return state === 'UP' ? 'success' : state === 'DOWN' ? 'danger' : state === 'DEGRADED' ? 'warning' : 'neutral';
  }

  stateLabel(state: InfraStateName): string {
    const i = this.i();
    switch (state) {
      case 'UP': return i.estadoUp;
      case 'DOWN': return i.estadoDown;
      case 'DEGRADED': return i.estadoDegraded;
      case 'NO_ACCESS': return i.estadoNoAccess;
      default: return i.estadoUnknown;
    }
  }

  pct(svc: InfraServiceStatus, window: '24h' | '7d'): string {
    const availability = window === '24h' ? svc.availability24h : svc.availability7d;
    return availability?.hasData && availability.availability !== null ? `${Math.round(availability.availability * 100)}%` : this.i().sinDato;
  }

  uptime(seconds: number | null): string {
    if (seconds === null || seconds === undefined) return this.i().sinDato;
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  nodeLabel(svc: InfraServiceStatus): string {
    return this.t().nodoAria.replace('{name}', svc.displayName).replace('{state}', this.stateLabel(svc.state)).replace('{availability}', this.pct(svc, '24h'));
  }
}

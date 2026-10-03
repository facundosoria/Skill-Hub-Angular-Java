import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { I18n } from '../../core/i18n/i18n';
import {
  edgeClass,
  edgeStrokeWidth,
  clampNode,
  clampNodes,
  geom,
  MapTransform,
  MAP_IDENTITY,
  MAP_LAYOUT_OFFSET_X,
  MAP_MAX_SCALE,
  MAP_MIN_SCALE,
  MAP_PAN_THRESHOLD,
  MAP_VIEWBOX_HEIGHT,
  MAP_VIEWBOX_WIDTH,
  mineTagWidth,
  NODE_HEIGHT,
  NODE_WIDTH,
  nodeClass,
  NODE_TEXT_X,
  panBy,
  touchedNodes,
  zoomAt,
  zoomedScale,
} from './dep-map-geometry';
import { DepMapEdge, DepMapStore } from './dep-map-store';

@Component({
  selector: 'app-dep-map-graph',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="graph" [class.panning]="dragging()" [class.dragging-node]="draggingNodeId() !== null">
    <div class="legend">
      <span class="legend-primary">
        @if (store.node() && !store.pair()) {
          <i class="legend-out"></i><span class="legend-direction legend-out">{{ nodeName(store.node()) }} {{ t().mapa.leyendaSeleccionNecesita }}</span>
          · <i class="legend-in"></i><span class="legend-direction legend-in">{{ t().mapa.leyendaSeleccionNecesitan }} {{ nodeName(store.node()) }}</span>
        } @else {
          <span class="legend-direction legend-out">↑ {{ t().mapa.leyendaNecesita }}</span> · <span class="legend-direction legend-in">↓ {{ t().mapa.leyendaNecesitan }}</span>
        }
      </span>
      @if (!store.visible().length) {
        <span class="legend-help">{{ t().mapa.sinFiltros }}</span>
      } @else if (store.node() && !store.pair()) {
        <span class="legend-help">{{ t().mapa.leyendaCantidad }} {{ isNarrow() ? t().mapa.toca : t().mapa.clic }} {{ t().mapa.leyendaSeleccionAyuda }} · {{ visibleCount() }}.</span>
      } @else {
        <span class="legend-help">{{ isNarrow() ? t().mapa.toca : t().mapa.clic }} {{ t().mapa.leyendaGrupoAyuda }}; {{ t().mapa.leyendaFlecha }} · {{ visibleCount() }}.</span>
      }
    </div>
    <svg #mapSvg class="map" [class.pannable]="canPan()" [attr.viewBox]="viewBox" role="group" [attr.aria-label]="t().mapa.mapaAria"
      (wheel)="onWheel($event)" (pointerdown)="onPointerDown($event)" (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerUp($event)" (pointercancel)="onPointerUp($event)" (click)="onMapClick($event)">
      <defs>
        @for (marker of markers; track marker.id) {
          <marker [id]="marker.id" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0L10,5L0,10z" [attr.fill]="marker.color" />
          </marker>
        }
      </defs>
      <g class="viewport" [attr.transform]="transformAttr()">
      <g>
        @for (edge of passiveEdges(); track edge.key) {
          <ng-container *ngTemplateOutlet="edgeTemplate; context: { edge: edge }" />
        }
      </g>
      <g>
        @for (edge of activeEdges(); track edge.key) {
          <ng-container *ngTemplateOutlet="edgeTemplate; context: { edge: edge }" />
        }
      </g>
      <g>
        @for (entry of nodeEntries(); track entry.id) {
          <g class="node" [class]="entry.classes" [attr.data-node]="entry.id" [attr.transform]="'translate(' + (entry.node.x - NODE_WIDTH / 2) + ',' + (entry.node.y - NODE_HEIGHT / 2) + ')'"
             tabindex="0" role="button" [attr.aria-label]="nodeAriaLabel(entry.node.n, entry.out, entry.in, !!entry.node.transv)" (click)="selectNode(entry.id)"
             (keydown)="onNodeKeydown($event, entry.id)">
            <title>{{ nodeAriaLabel(entry.node.n, entry.out, entry.in, !!entry.node.transv) }}</title>
            <rect [attr.width]="NODE_WIDTH" [attr.height]="NODE_HEIGHT" rx="12"></rect>
            <text class="nm" [attr.x]="NODE_TEXT_X" y="25">{{ entry.node.n }}</text>
            @if (entry.node.transv) {
              <text class="ct" [attr.x]="NODE_TEXT_X" y="49">{{ t().mapa.transversal }}</text>
            } @else {
              <text class="ct" [attr.x]="NODE_TEXT_X" y="49"><tspan class="cto">↑{{ entry.out }}</tspan>{{ '  ' }}<tspan class="cti">↓{{ entry.in }}</tspan></text>
            }
            @if (entry.id === store.mine()) {
              <g class="mineTag" transform="translate(136,-9)"><rect [attr.width]="mineTagWidth(t().mapa.grupoPropio)" height="17" rx="8.5"></rect><text [attr.x]="mineTagWidth(t().mapa.grupoPropio) / 2" y="12" text-anchor="middle">{{ t().mapa.grupoPropio }}</text></g>
            }
          </g>
        }
      </g>
      </g>
      <ng-template #edgeTemplate let-edge="edge">
      <g class="edge" [class]="edge.classes" [class.flash]="edge.items.some(item => item.id === store.flashId())" [attr.data-pair]="edge.key" [attr.data-eid]="edge.firstId" tabindex="0" role="button" [attr.aria-label]="edgeLabel(edge.pair, edge.items.length)" (click)="selectPair(edge.pair)" (keydown.enter)="selectPair(edge.pair)" (keydown.space)="selectPair(edge.pair); $event.preventDefault()">
        <path class="focus-halo" [attr.d]="edge.geometry.d" />
        <path class="focus-halo-contrast" [attr.d]="edge.geometry.d" />
        <path class="line" [attr.d]="edge.geometry.d" [attr.stroke-width]="edge.width" [attr.marker-end]="'url(#' + edge.marker + ')'" />
        <path class="hit" [attr.d]="edge.geometry.d"><title>{{ edgeTitle(edge.pair, edge.items.length) }}</title></path>
        <g class="badge"><circle [attr.cx]="edge.geometry.lx" [attr.cy]="edge.geometry.ly" r="9" /><text [attr.x]="edge.geometry.lx" [attr.y]="edge.geometry.ly + 3.4" text-anchor="middle">{{ edge.items.length }}</text></g>
      </g>
      </ng-template>
    </svg>
    </div>
  `,
  imports: [NgTemplateOutlet],
  styles: `
    :host { display:block; }
    :host-context(.fit-height) { min-height:0; height:100%; }
    .graph { position:relative; display:flex; flex-direction:column; min-height:0; height:100%; }
    .graph.panning,.graph.dragging-node { user-select:none; }
    .legend { display:grid; grid-template-columns:minmax(0,1fr); grid-template-areas:'primary' 'help'; align-items:center; gap:4px 12px; padding:6px 10px 2px; color:var(--text-muted); font-size:12.5px; }
    .legend-primary { grid-area:primary; min-width:0; } .legend-help { grid-area:help; min-width:0; }
    .legend i { display:inline-block; width:22px; height:0; border-top:3px solid; vertical-align:middle; margin-right:6px; border-radius:2px; }
    .legend i.legend-out { border-top-color:var(--dep-out); border-top-style:solid; } .legend i.legend-in { border-top-color:var(--dep-in); border-top-style:dashed; }
    .legend-direction.legend-out { color:var(--dep-out); } .legend-direction.legend-in { color:var(--dep-in); }
    @media (max-width:560px) { .legend { display:flex; flex-wrap:wrap; align-items:flex-start; gap:3px 18px; } .legend-primary,.legend-help { flex:0 1 auto; } }
    svg.map { width:100%; height:auto; display:block; } .map.pannable { cursor:grab; } .graph.panning svg.map { cursor:grabbing; }
    @media (min-width:1021px) { :host-context(.fit-height) svg.map { flex:1 1 0; min-height:0; height:auto; } }
    .node { cursor:grab; } .graph.dragging-node .node { cursor:grabbing; } .node rect { fill:var(--surface); stroke:var(--border); stroke-width:1.2; }
    .node:hover rect { stroke:var(--text-muted); } .node:focus-visible rect { stroke:var(--text); stroke-width:2.4; }
    .node.sel rect { stroke:var(--text); stroke-width:2.2; } .node.out rect { stroke:var(--dep-out); stroke-width:2; }
    .node.in rect { stroke:var(--dep-in); stroke-width:2; } .node.dim > rect { opacity:.35; }
    .node.transv rect { stroke-dasharray:5 4; } .node text.nm { font-weight:700; font-size:16px; fill:var(--text); }
    .node text.ct { font-size:13px; fill:var(--text-muted); } .node .cto { fill:var(--dep-out); font-weight:600; } .node .cti { fill:var(--dep-in); font-weight:600; }
    .mineTag rect { fill:var(--text); stroke:none; } .mineTag text { fill:var(--bg); font-size:10.5px; font-weight:600; }
    .edge { outline:none; } .edge path.line,.edge path.focus-halo,.edge path.focus-halo-contrast { fill:none; stroke-linecap:round; }
    .edge path.focus-halo,.edge path.focus-halo-contrast { opacity:0; pointer-events:none; }
    .edge path.hit { fill:none; stroke:transparent; stroke-width:14; cursor:pointer; }
    .edge:focus-visible { opacity:1; }
    .edge:focus-visible path.focus-halo { opacity:1; stroke:var(--bg); stroke-width:10; }
    .edge:focus-visible path.focus-halo-contrast { opacity:1; stroke:var(--text); stroke-width:8; }
    .edge:focus-visible path.line { stroke-width:5; }
    .edge.base path.line { stroke:var(--text-muted); } .edge.out path.line { stroke:var(--dep-out); } .edge.in path.line { stroke:var(--dep-in); stroke-dasharray:10 6; } .edge.sel path.line { stroke:var(--text); stroke-dasharray:none; }
    .edge.dim { opacity:.1; } .edge.base { opacity:.7; } .edge .badge circle { fill:var(--surface); stroke:var(--border-strong); }
    .edge.out .badge circle { stroke:var(--dep-out); } .edge.in .badge circle { stroke:var(--dep-in); } .edge .badge text { font-size:13px; font-weight:600; fill:var(--text); }
    .edge.dim .badge { display:none; } .edge[data-eid].flash path.line { animation:flash 1.6s ease-out; }
    @keyframes flash { from { opacity:.25; } to { opacity:1; } }
    @media (max-width:760px) { svg.map { min-width:720px; } }
    @media (prefers-reduced-motion:reduce) { * { animation:none !important; } }
  `,
})
export class DepMapGraph {
  readonly store = inject(DepMapStore);
  private readonly i18n = inject(I18n);
  readonly t = this.i18n.t;
  readonly markers = [
    { id: 'm-n', color: 'var(--border-strong)' }, { id: 'm-out', color: 'var(--dep-out)' },
    { id: 'm-in', color: 'var(--dep-in)' }, { id: 'm-sel', color: 'var(--text)' },
  ];
  readonly NODE_WIDTH = NODE_WIDTH;
  readonly NODE_HEIGHT = NODE_HEIGHT;
  readonly NODE_TEXT_X = NODE_TEXT_X;
  readonly viewBox = `0 0 ${MAP_VIEWBOX_WIDTH} ${MAP_VIEWBOX_HEIGHT}`;
  readonly mineTagWidth = mineTagWidth;

  readonly transform = signal<MapTransform>({ ...MAP_IDENTITY });
  readonly dragging = signal(false);
  readonly draggingNodeId = signal<string | null>(null);
  readonly canPan = computed(() => this.transform().scale > MAP_MIN_SCALE + 1e-6);
  readonly canZoomIn = computed(() => this.transform().scale < MAP_MAX_SCALE - 1e-6);
  readonly canZoomOut = computed(() => this.transform().scale > MAP_MIN_SCALE + 1e-6);
  readonly zoomPercent = computed(() => `${Math.round(this.transform().scale * 100)}%`);
  readonly transformAttr = computed(() => {
    const view = this.transform();
    return `translate(${view.x.toFixed(2)} ${view.y.toFixed(2)}) scale(${view.scale})`;
  });
  private readonly mapSvg = viewChild<ElementRef<SVGSVGElement>>('mapSvg');
  private pointerStart: { x: number; y: number } | null = null;
  private pointerStartTransform: MapTransform | null = null;
  private pointerMoved = false;
  private suppressClick = false;
  private nodePointerStart: { id: string; pointerId: number; clientX: number; clientY: number; mapX: number; mapY: number; nodeX: number; nodeY: number; scale: number } | null = null;
  private readonly savedNodePositions = signal<Record<string, { x: number; y: number }>>(this.readNodePositions());

  readonly renderedNodes = computed(() => {
    const nodes = this.store.state().nodes;
    const expanded = Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, { ...node, x: node.x + MAP_LAYOUT_OFFSET_X }]));
    const positioned = clampNodes(expanded, 8, 6, this.t().mapa.grupoPropio);
    const saved = this.savedNodePositions();
    return Object.fromEntries(Object.entries(positioned).map(([id, node]) => [
      id,
      saved[id] ? clampNode({ ...node, ...saved[id] }, 8, this.t().mapa.grupoPropio) : node,
    ]));
  });

  readonly edgeEntries = computed(() => {
    const grouped = this.store.grouped();
    const nodes = this.renderedNodes();
    const selectedPair = this.store.pair();
    const selectedNode = this.store.node();
    return [...grouped.entries()].map(([key, items]) => {
      const pair = key.split('>') as [string, string];
      const geometry = geom(nodes, pair[0], pair[1], grouped.has(`${pair[1]}>${pair[0]}`));
      const classes = edgeClass(pair[0], pair[1], selectedNode, selectedPair);
      return { key, pair, items, geometry, classes, width: edgeStrokeWidth(items.length), marker: classes === 'out' ? 'm-out' : classes === 'in' ? 'm-in' : classes === 'sel' ? 'm-sel' : 'm-n', firstId: items[0]?.id };
    });
  });
  readonly activeEdges = computed(() => this.edgeEntries().filter((edge) => edge.classes !== 'dim'));
  readonly passiveEdges = computed(() => this.edgeEntries().filter((edge) => edge.classes === 'dim'));

  readonly nodeEntries = computed(() => {
    const nodes = this.renderedNodes();
    const visible = this.store.visible();
    const out: Record<string, number> = {}, incoming: Record<string, number> = {};
    visible.forEach((edge) => { out[edge.from] = (out[edge.from] || 0) + 1; incoming[edge.to] = (incoming[edge.to] || 0) + 1; });
    const touched = touchedNodes(visible, this.store.node());
    return Object.entries(nodes).map(([id, node]) => ({ id, node, out: out[id] || 0, in: incoming[id] || 0, classes: nodeClass(id, this.store.node(), this.store.pair(), touched, !!node.transv) }));
  });

  zoomIn(): void { this.applyZoom(1); }
  zoomOut(): void { this.applyZoom(-1); }
  fit(): void { this.transform.set({ ...MAP_IDENTITY }); }

  private applyZoom(direction: 1 | -1): void {
    const current = this.transform();
    const scale = zoomedScale(current.scale, direction);
    if (scale === current.scale) return;
    this.transform.set(zoomAt(current, scale, MAP_VIEWBOX_WIDTH / 2, MAP_VIEWBOX_HEIGHT / 2));
  }

  /** Ctrl/⌘ + wheel zooms around the cursor; a plain wheel keeps scrolling the page. */
  onWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const focus = this.pointInMap(event.clientX, event.clientY);
    const current = this.transform();
    const scale = zoomedScale(current.scale, event.deltaY < 0 ? 1 : -1);
    this.transform.set(zoomAt(current, scale, focus.x, focus.y));
  }

  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    const target = typeof Element !== 'undefined' && event.target instanceof Element
      ? event.target.closest<SVGGElement>('.node[data-node]')
      : null;
    const nodeId = target?.getAttribute('data-node');
    const node = nodeId ? this.renderedNodes()[nodeId] : undefined;
    if (nodeId && node) {
      const point = this.pointInMap(event.clientX, event.clientY);
      this.nodePointerStart = { id: nodeId, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, mapX: point.x, mapY: point.y, nodeX: node.x, nodeY: node.y, scale: this.transform().scale };
      this.pointerMoved = false;
      this.suppressClick = false;
      return;
    }
    if (!this.canPan()) return;
    this.pointerStart = { x: event.clientX, y: event.clientY };
    this.pointerStartTransform = this.transform();
    this.pointerMoved = false;
    this.suppressClick = false;
  }

  onPointerMove(event: PointerEvent): void {
    if (this.nodePointerStart) {
      const start = this.nodePointerStart;
      const dx = event.clientX - start.clientX;
      const dy = event.clientY - start.clientY;
      if (!this.pointerMoved && Math.hypot(dx, dy) < MAP_PAN_THRESHOLD) return;
      if (!this.pointerMoved) {
        this.pointerMoved = true;
        this.draggingNodeId.set(start.id);
        try { this.mapSvg()?.nativeElement.setPointerCapture(event.pointerId); } catch { /* jsdom / unsupported */ }
      }
      event.preventDefault();
      const point = this.pointInMap(event.clientX, event.clientY);
      this.saveNodePosition(start.id, start.nodeX + (point.x - start.mapX) / start.scale, start.nodeY + (point.y - start.mapY) / start.scale, false);
      return;
    }
    if (!this.pointerStart || !this.pointerStartTransform) return;
    const dx = event.clientX - this.pointerStart.x;
    const dy = event.clientY - this.pointerStart.y;
    if (!this.pointerMoved && Math.hypot(dx, dy) < MAP_PAN_THRESHOLD) return;
    if (!this.pointerMoved) {
      this.pointerMoved = true;
      this.dragging.set(true);
      try { this.mapSvg()?.nativeElement.setPointerCapture(event.pointerId); } catch { /* jsdom / unsupported */ }
    }
    event.preventDefault();
    const from = this.pointInMap(this.pointerStart.x, this.pointerStart.y);
    const to = this.pointInMap(event.clientX, event.clientY);
    this.transform.set(panBy(this.pointerStartTransform, to.x - from.x, to.y - from.y));
  }

  onPointerUp(event: PointerEvent): void {
    if (this.nodePointerStart) {
      const moved = this.pointerMoved;
      const svg = this.mapSvg()?.nativeElement;
      if (moved && svg && typeof svg.hasPointerCapture === 'function' && svg.hasPointerCapture(event.pointerId)) {
        try { svg.releasePointerCapture(event.pointerId); } catch { /* jsdom / unsupported */ }
      }
      this.nodePointerStart = null;
      this.pointerMoved = false;
      this.draggingNodeId.set(null);
      if (moved) { this.persistNodePositions(); this.suppressClick = true; }
      return;
    }
    if (!this.pointerStart) return;
    const moved = this.pointerMoved;
    const svg = this.mapSvg()?.nativeElement;
    if (moved && svg && typeof svg.hasPointerCapture === 'function' && svg.hasPointerCapture(event.pointerId)) {
      try { svg.releasePointerCapture(event.pointerId); } catch { /* jsdom / unsupported */ }
    }
    this.pointerStart = null;
    this.pointerStartTransform = null;
    this.pointerMoved = false;
    this.dragging.set(false);
    if (moved) this.suppressClick = true;
  }

  selectNode(id: string): void {
    if (this.suppressClick) { this.suppressClick = false; return; }
    this.store.selectNode(id);
  }

  onNodeKeydown(event: KeyboardEvent, id: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      this.selectNode(id);
      event.preventDefault();
      return;
    }
    const delta = event.shiftKey ? 10 : 2;
    const movement = event.key === 'ArrowLeft' ? [-delta, 0]
      : event.key === 'ArrowRight' ? [delta, 0]
        : event.key === 'ArrowUp' ? [0, -delta]
          : event.key === 'ArrowDown' ? [0, delta] : null;
    if (!movement) return;
    const node = this.renderedNodes()[id];
    if (!node) return;
    event.preventDefault();
    this.saveNodePosition(id, node.x + movement[0], node.y + movement[1]);
  }

  private readNodePositions(): Record<string, { x: number; y: number }> {
    try {
      if (typeof localStorage === 'undefined') return {};
      const current = localStorage.getItem('depmap-node-positions-v2');
      const stored = JSON.parse(current ?? localStorage.getItem('depmap-node-positions') ?? '{}') as Record<string, { x?: number; y?: number }>;
      const valid = Object.fromEntries(Object.entries(stored).filter(([, point]) => Number.isFinite(point?.x) && Number.isFinite(point?.y)).map(([id, point]) => [id, { x: point.x!, y: point.y! }]));
      if (!current && Object.keys(valid).length) {
        for (const point of Object.values(valid)) point.x += MAP_LAYOUT_OFFSET_X;
        localStorage.setItem('depmap-node-positions-v2', JSON.stringify(valid));
      }
      return valid;
    } catch { return {}; }
  }

  private saveNodePosition(id: string, x: number, y: number, persist = true): void {
    const node = this.renderedNodes()[id];
    if (!node) return;
    const position = clampNode({ ...node, x, y }, 8, this.t().mapa.grupoPropio);
    const next = { ...this.savedNodePositions(), [id]: { x: position.x, y: position.y } };
    this.savedNodePositions.set(next);
    if (persist) this.persistNodePositions();
  }

  private persistNodePositions(): void {
    try { localStorage.setItem('depmap-node-positions-v2', JSON.stringify(this.savedNodePositions())); } catch { /* storage is optional */ }
  }

  selectPair(pair: [string, string]): void {
    if (this.suppressClick) { this.suppressClick = false; return; }
    this.store.selectPair(pair);
  }

  onMapClick(event: MouseEvent): void {
    if (!this.suppressClick) return;
    this.suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  }

  private pointInMap(clientX: number, clientY: number): { x: number; y: number } {
    const svg = this.mapSvg()?.nativeElement;
    try {
      if (svg && typeof svg.getScreenCTM === 'function' && typeof DOMPoint !== 'undefined') {
        const matrix = svg.getScreenCTM();
        if (matrix) {
          const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
          return { x: point.x, y: point.y };
        }
      }
    } catch { /* jsdom / unsupported */ }
    return { x: MAP_VIEWBOX_WIDTH / 2, y: MAP_VIEWBOX_HEIGHT / 2 };
  }

  nodeName(id: string | null): string { return id ? this.store.state().nodes[id]?.n || id : ''; }
  edgeLabel(pair: [string, string], count: number): string { const m = this.t().mapa; return `${this.nodeName(pair[0])} ${m.necesitaDe} ${this.nodeName(pair[1])}: ${count} ${count === 1 ? m.pedido : m.pedidos}`; }
  nodeAriaLabel(name: string, out: number, incoming: number, transversal: boolean): string {
    const m = this.t().mapa;
    return transversal ? m.nodoTransversalAria.replace('{name}', name) : m.nodoAria.replace('{name}', name).replace('{out}', String(out)).replace('{incoming}', String(incoming));
  }
  edgeTitle(pair: [string, string], count: number): string { return `${this.nodeName(pair[0])} ${this.t().mapa.necesitaDe} ${this.nodeName(pair[1])} (${count})`; }
  visibleCount(): string { const count = this.store.visible().length; const m = this.t().mapa; return `${count} ${count === 1 ? m.dependenciaVisible : m.dependenciasVisibles}`; }
  isNarrow(): boolean { return typeof matchMedia !== 'undefined' && matchMedia('(max-width:760px)').matches; }
}

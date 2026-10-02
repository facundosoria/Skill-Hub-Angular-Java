import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { I18n } from '../../core/i18n/i18n';
import {
  edgeClass,
  edgeStrokeWidth,
  geom,
  NODE_HEIGHT,
  NODE_WIDTH,
  nodeClass,
  NODE_TEXT_X,
  touchedNodes,
} from './dep-map-geometry';
import { DepMapEdge, DepMapStore } from './dep-map-store';

@Component({
  selector: 'app-dep-map-graph',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="graph">
    <div class="legend">
      <span class="legend-format">En cada grupo: <span class="legend-direction legend-out">↑ cuántos necesita</span> · <span class="legend-direction legend-in">↓ cuántos lo necesitan</span></span>
      @if (!store.visible().length) {
        <span>{{ t().mapa.sinFiltros }}</span>
      } @else if (store.node() && !store.pair()) {
        <span><i class="legend-out"></i>{{ nodeName(store.node()) }} necesita de…</span>
        <span><i class="legend-in"></i>…quienes necesitan a {{ nodeName(store.node()) }}</span>
        <span>El número es la cantidad de pedidos. {{ isNarrow() ? 'Tocá' : 'Clic' }} en una flecha para ver el detalle. {{ store.visible().length }} {{ store.visible().length === 1 ? 'dependencia visible' : 'dependencias visibles' }}.</span>
      } @else {
        <span>{{ isNarrow() ? 'Tocá' : 'Clic' }} en un grupo para ver sus dependencias en ambos sentidos. La flecha apunta hacia quien provee. {{ store.visible().length }} {{ store.visible().length === 1 ? 'dependencia visible' : 'dependencias visibles' }}.</span>
      }
    </div>
    <svg class="map" viewBox="0 0 1000 745" role="group" aria-label="Mapa de dependencias">
      <defs>
        @for (marker of markers; track marker.id) {
          <marker [id]="marker.id" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0L10,5L0,10z" [attr.fill]="marker.color" />
          </marker>
        }
      </defs>
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
             tabindex="0" role="button" [attr.aria-label]="nodeAriaLabel(entry.node.n, entry.out, entry.in, !!entry.node.transv)" (click)="store.selectNode(entry.id)"
             (keydown.enter)="store.selectNode(entry.id)" (keydown.space)="store.selectNode(entry.id); $event.preventDefault()">
            <title>{{ nodeAriaLabel(entry.node.n, entry.out, entry.in, !!entry.node.transv) }}</title>
            <rect [attr.width]="NODE_WIDTH" [attr.height]="NODE_HEIGHT" rx="12"></rect>
            <text class="nm" [attr.x]="NODE_TEXT_X" y="25">{{ entry.node.n }}</text>
            @if (entry.node.transv) {
              <text class="ct" [attr.x]="NODE_TEXT_X" y="49">transversal</text>
            } @else {
              <text class="ct" [attr.x]="NODE_TEXT_X" y="49"><tspan class="cto">↑{{ entry.out }}</tspan>{{ '  ' }}<tspan class="cti">↓{{ entry.in }}</tspan></text>
            }
            @if (entry.id === store.mine()) {
              <g class="mineTag" transform="translate(136,-9)"><rect width="56" height="17" rx="8.5"></rect><text x="28" y="12" text-anchor="middle">tu grupo</text></g>
            }
          </g>
        }
      </g>
      <ng-template #edgeTemplate let-edge="edge">
      <g class="edge" [class]="edge.classes" [class.flash]="edge.items.some(item => item.id === store.flashId())" [attr.data-pair]="edge.key" [attr.data-eid]="edge.firstId" tabindex="0" role="button" [attr.aria-label]="edgeLabel(edge.pair, edge.items.length)" (click)="store.selectPair(edge.pair)" (keydown.enter)="store.selectPair(edge.pair)" (keydown.space)="store.selectPair(edge.pair); $event.preventDefault()">
        <path class="line" [attr.d]="edge.geometry.d" [attr.stroke-width]="edge.width" [attr.marker-end]="'url(#' + edge.marker + ')'" />
        <path class="hit" [attr.d]="edge.geometry.d"><title>{{ nodeName(edge.pair[0]) }} necesita de {{ nodeName(edge.pair[1]) }} ({{ edge.items.length }})</title></path>
        <g class="badge"><circle [attr.cx]="edge.geometry.lx" [attr.cy]="edge.geometry.ly" r="9" /><text [attr.x]="edge.geometry.lx" [attr.y]="edge.geometry.ly + 3.4" text-anchor="middle">{{ edge.items.length }}</text></g>
      </g>
      </ng-template>
    </svg>
    </div>
  `,
  imports: [NgTemplateOutlet],
  styles: `
    :host { display:block; }
    .graph { display:flex; flex-direction:column; min-height:0; height:100%; }
    .legend { display:flex; flex-wrap:wrap; gap:6px 18px; padding:6px 10px 2px; color:var(--text-muted); font-size:12.5px; }
    .legend i { display:inline-block; width:22px; height:0; border-top:3px solid; vertical-align:middle; margin-right:6px; border-radius:2px; }
    .legend i.legend-out { border-top-color:var(--dep-out); } .legend i.legend-in { border-top-color:var(--dep-in); }
    .legend-direction.legend-out { color:var(--dep-out); } .legend-direction.legend-in { color:var(--dep-in); }
    svg.map { width:100%; height:auto; display:block; }
    @media (min-width:1021px) and (min-height:700px) { :host-context(.fit-height) svg.map { flex:1 1 auto; min-height:0; height:100%; } }
    .node { cursor:pointer; } .node rect { fill:var(--surface); stroke:var(--border); stroke-width:1.2; }
    .node:hover rect { stroke:var(--text-muted); } .node:focus-visible rect { stroke:var(--text); stroke-width:2.4; }
    .node.sel rect { stroke:var(--text); stroke-width:2.2; } .node.out rect { stroke:var(--dep-out); stroke-width:2; }
    .node.in rect { stroke:var(--dep-in); stroke-width:2; } .node.dim > rect { opacity:.35; } .node.dim .mineTag { opacity:.35; }
    .node.transv rect { stroke-dasharray:5 4; } .node text.nm { font-weight:700; font-size:16px; fill:var(--text); }
    .node text.ct { font-size:13px; fill:var(--text-muted); } .node .cto { fill:var(--dep-out); font-weight:600; } .node .cti { fill:var(--dep-in); font-weight:600; }
    .mineTag rect { fill:var(--text); stroke:none; } .mineTag text { fill:var(--bg); font-size:10.5px; font-weight:600; }
    .edge path.line { fill:none; stroke:var(--border-strong); stroke-linecap:round; } .edge path.hit { fill:none; stroke:transparent; stroke-width:14; cursor:pointer; }
    .edge:focus-visible { outline:2px solid var(--text); outline-offset:3px; } .edge:focus-visible path.line { stroke-width:5; }
    .edge.out path.line { stroke:var(--dep-out); } .edge.in path.line { stroke:var(--dep-in); } .edge.sel path.line { stroke:var(--text); }
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

  readonly edgeEntries = computed(() => {
    const grouped = this.store.grouped();
    const state = this.store.state();
    const selectedPair = this.store.pair();
    const selectedNode = this.store.node();
    return [...grouped.entries()].map(([key, items]) => {
      const pair = key.split('>') as [string, string];
      const geometry = geom(state.nodes, pair[0], pair[1], grouped.has(`${pair[1]}>${pair[0]}`));
      const classes = edgeClass(pair[0], pair[1], selectedNode, selectedPair);
      return { key, pair, items, geometry, classes, width: edgeStrokeWidth(items.length), marker: classes === 'out' ? 'm-out' : classes === 'in' ? 'm-in' : classes === 'sel' ? 'm-sel' : 'm-n', firstId: items[0]?.id };
    });
  });
  readonly activeEdges = computed(() => this.edgeEntries().filter((edge) => edge.classes !== 'dim'));
  readonly passiveEdges = computed(() => this.edgeEntries().filter((edge) => edge.classes === 'dim'));

  readonly nodeEntries = computed(() => {
    const state = this.store.state();
    const visible = this.store.visible();
    const out: Record<string, number> = {}, incoming: Record<string, number> = {};
    visible.forEach((edge) => { out[edge.from] = (out[edge.from] || 0) + 1; incoming[edge.to] = (incoming[edge.to] || 0) + 1; });
    const touched = touchedNodes(visible, this.store.node());
    return Object.entries(state.nodes).map(([id, node]) => ({ id, node, out: out[id] || 0, in: incoming[id] || 0, classes: nodeClass(id, this.store.node(), this.store.pair(), touched, !!node.transv) }));
  });

  nodeName(id: string | null): string { return id ? this.store.state().nodes[id]?.n || id : ''; }
  edgeLabel(pair: [string, string], count: number): string { return `${this.nodeName(pair[0])} necesita de ${this.nodeName(pair[1])}: ${count} ${count === 1 ? 'pedido' : 'pedidos'}`; }
  nodeAriaLabel(name: string, out: number, incoming: number, transversal: boolean): string {
    return transversal ? `${name}: transversal` : `${name}: necesita ${out} · lo necesitan ${incoming}`;
  }
  isNarrow(): boolean { return typeof matchMedia !== 'undefined' && matchMedia('(max-width:760px)').matches; }
}

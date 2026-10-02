import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { I18n } from '../../core/i18n/i18n';
import { DepMapEdge, DepMapStore } from './dep-map-store';
import { rel } from './dep-map-geometry';
import { UI } from '../../shared/ui';

@Component({
  selector: 'app-dep-map-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.pair(); as selectedPair) {
      <button type="button" class="back" (click)="store.clearPair()">← {{ t().mapa.panelVolver }} {{ node(selectedPair[0]).n }}</button>
      <h2>{{ node(selectedPair[0]).n }} {{ t().mapa.panelTituloNecesita }} {{ node(selectedPair[1]).n }}</h2>
      <ul class="items pair-items">
        @for (edge of pairEdges(); track edge.id) { <ng-container *ngTemplateOutlet="item; context: { edge: edge }" /> }
        @empty { <li class="empty">{{ t().mapa.panelSinPedidos }}</li> }
      </ul>
      <p class="empty">{{ t().mapa.panelMarcarAyuda }}</p>
    } @else {
      <h2>{{ selectedNode()?.n || selectedNodeId() }}</h2>
      @if (info()?.obj) { <p class="obj">{{ info()?.obj }}</p> }
      @if (info()?.note) { <p class="obj">{{ info()?.note }}</p> }
      @if (!selectedNode()?.transv) {
        <div class="sum"><div class="o"><b>{{ uniqueOut() }}</b><span>{{ t().mapa.panelGruposDependencia }} · {{ outgoing().length }} {{ t().mapa.panelGruposDependenciaPedidos }}, {{ pending(outgoing()) }} {{ t().mapa.panelAbiertos }}</span></div>
          <div class="i"><b>{{ uniqueIn() }}</b><span>{{ t().mapa.panelGruposDependientes }} · {{ incoming().length }} {{ t().mapa.panelGruposDependenciaPedidos }}, {{ pending(incoming()) }} {{ t().mapa.panelAbiertos }}</span></div></div>
        <h3><span class="dot out-dot"></span>{{ t().mapa.panelNecesitaDe }}</h3><ng-container *ngTemplateOutlet="groups; context: { list: outgoing(), key: 'to', color: 'out' }" />
        <h3><span class="dot in-dot"></span>{{ t().mapa.panelLoNecesitan }}</h3><ng-container *ngTemplateOutlet="groups; context: { list: incoming(), key: 'from', color: 'in' }" />
      }
      @if (info()?.own?.length) { <h3>{{ t().mapa.panelTareasPropias }}</h3><ul class="own">@for (task of info()?.own; track task) { <li>{{ task }}</li> }</ul> }
      <h3>{{ t().mapa.panelActividad }}</h3>
      @if (!store.state().activity.length) { <p class="empty">{{ t().mapa.panelSinActividad }}</p> } @else {
        <ul class="feed">@for (activity of store.state().activity.slice(0, 8); track activity.ts + activity.summary) { <li><span><b>{{ activity.by || t().mapa.panelAnonimo }}</b> {{ activity.summary }}</span><time>{{ relative(activity.ts) }}</time></li> }</ul>
      }
      <p class="add"><button uiButton variant="secondary" size="sm" type="button" [disabled]="!store.online()" (click)="addRequested.emit(selectedNodeId())">{{ t().mapa.panelAgregarDe }} {{ selectedNode()?.n || selectedNodeId() }}</button></p>
    }
    <ng-template #item let-edge="edge">
      <li class="it" [class.done]="!!store.state().done[edge.id]" [class.flash]="store.flashId() === edge.id">
        <input type="checkbox" [checked]="!!store.state().done[edge.id]" [disabled]="!store.online()" [attr.aria-label]="t().mapa.marcarHecho" (change)="toggle(edge, $event)" />
        <div class="edge-meta"><span class="chip">{{ kindLabel(edge.kind) }}</span><span class="chip" [class.q]="edge.state === 'definir' && !store.state().done[edge.id]">{{ stateLabel(edge) }}</span><span class="tx">{{ edge.text }}</span></div>
        <button type="button" class="x" [attr.title]="t().mapa.eliminar" [attr.aria-label]="t().mapa.eliminarDependencia" [disabled]="!store.online()" (click)="deleteRequested.emit(edge)">×</button>
      </li>
    </ng-template>
    <ng-template #groups let-list="list" let-color="color">
      @if (!list.length) { <div class="empty">{{ t().mapa.panelNadaFiltros }}</div> }
      @else {
        @for (group of groupList(list); track group.id) {
          <div class="grp"><span class="dot" [class.out-dot]="color === 'out'" [class.in-dot]="color === 'in'"></span><button type="button" (click)="store.selectNode(group.id)">{{ node(group.id).n }}</button><span class="chip">{{ group.edges.length }}</span></div>
          <ul class="items">@for (edge of group.edges; track edge.id) { <ng-container *ngTemplateOutlet="item; context: { edge: edge }" /> }</ul>
        }
      }
    </ng-template>
  `,
  imports: [NgTemplateOutlet, ...UI],
  styles: `
    :host { display:block; padding:18px; } h2 { font-size:22px; margin:0; } .obj { color:var(--text-muted); margin:8px 0 0; font-size:13px; max-width:68ch; }
    .obj + .obj { margin-top:6px; } .sum { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:14px 0 4px; } .sum div { border-radius:10px; padding:10px 12px; border:1px solid var(--border); }
    .sum b { font-size:24px; display:block; line-height:1.1; } .sum .o { border-color:color-mix(in srgb,var(--dep-out) 45%,var(--border)); } .sum .o b { color:var(--dep-out); }
    .sum .i { border-color:color-mix(in srgb,var(--dep-in) 45%,var(--border)); } .sum .i b { color:var(--dep-in); } .sum span { font-size:12px; color:var(--text-muted); }
    h3 { font-size:15px; margin:18px 0 6px; display:flex; align-items:center; gap:8px; } .dot { width:8px; height:8px; border-radius:50%; display:inline-block; }
    .out-dot { background:var(--dep-out); } .in-dot { background:var(--dep-in); } .grp { display:flex; align-items:center; gap:8px; margin:12px 0 2px; }
    .grp button { border:0; background:transparent; padding:0; font-weight:600; text-decoration:underline; text-decoration-color:var(--border); text-underline-offset:3px; cursor:pointer; color:var(--text); }
    ul.items { list-style:none; margin:0; padding:0; } .it { display:grid; grid-template-columns:20px 1fr 26px; gap:8px; padding:7px 2px; border-top:1px solid var(--border); align-items:start; border-radius:8px; }
    .it:first-child { border-top:0; } .it.done .tx { text-decoration:line-through; color:var(--text-muted); } .it input { margin:3px 0 0; accent-color:var(--success); width:16px; height:16px; }
    .edge-meta { display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 6px; } .chip { display:inline-block; font-size:11.5px; border-radius:6px; padding:0 7px; background:var(--surface-2); border:1px solid var(--border); color:var(--text-muted); vertical-align:1px; }
    .chip.q { background:var(--warning-soft); color:var(--warning); border-color:transparent; } .x { border:0; background:transparent; color:var(--text-muted); padding:2px; line-height:0; border-radius:6px; cursor:pointer; font-size:18px; }
    .x:hover { color:var(--danger); background:color-mix(in srgb,var(--danger) 10%,transparent); } .it .x { opacity:0; } .it:hover .x,.x:focus-visible { opacity:1; }
    .own { margin:0; padding-left:18px; color:var(--text); } .own li { margin:3px 0; } .empty { color:var(--text-muted); font-size:13px; padding:6px 0; }
    .back { margin-bottom:10px; border:0; background:transparent; color:var(--text-muted); cursor:pointer; } .feed { list-style:none; margin:0; padding:0; font-size:12.5px; color:var(--text-muted); }
    .feed li { padding:5px 0; border-top:1px solid var(--border); display:flex; gap:8px; align-items:baseline; justify-content:space-between; } .feed li:first-child { border-top:0; }
    .feed b { color:var(--text); font-weight:600; } time { flex:none; font-size:11.5px; } .add { margin-top:16px; } .pair-items { margin-top:10px; }
    .it.flash { animation:flash 1.6s ease-out; } @keyframes flash { from { background:color-mix(in srgb,var(--dep-out) 14%,transparent); } to { background:transparent; } }
    @media (hover:none) { .it .x { opacity:1; } } @media (prefers-reduced-motion:reduce) { * { animation:none !important; } }
  `,
})
export class DepMapPanel {
  readonly store = inject(DepMapStore);
  private readonly i18n = inject(I18n);
  readonly t = this.i18n.t;
  readonly addRequested = output<string>();
  readonly deleteRequested = output<DepMapEdge>();
  readonly selectedNodeId = computed(() => this.store.node() || this.store.mine());
  readonly selectedNode = computed(() => this.store.state().nodes[this.selectedNodeId()]);
  readonly info = computed(() => this.store.state().info[this.selectedNodeId()] || { own: [] });
  readonly outgoing = computed(() => this.store.visible().filter((edge) => edge.from === this.selectedNodeId()));
  readonly incoming = computed(() => this.store.visible().filter((edge) => edge.to === this.selectedNodeId()));
  readonly pairEdges = computed(() => { const pair = this.store.pair(); return pair ? this.store.visible().filter((edge) => edge.from === pair[0] && edge.to === pair[1]) : []; });
  readonly uniqueOut = computed(() => new Set(this.outgoing().map((edge) => edge.to)).size);
  readonly uniqueIn = computed(() => new Set(this.incoming().map((edge) => edge.from)).size);
  node(id: string) { return this.store.state().nodes[id]; }
  pending(edges: DepMapEdge[]): number { return edges.filter((edge) => !this.store.state().done[edge.id]).length; }
  groupList(edges: DepMapEdge[]): Array<{ id: string; edges: DepMapEdge[] }> {
    const grouped = new Map<string, DepMapEdge[]>(); edges.forEach((edge) => { const id = edge.from === this.selectedNodeId() ? edge.to : edge.from; if (!grouped.has(id)) grouped.set(id, []); grouped.get(id)!.push(edge); });
    return [...grouped.entries()].sort((a, b) => b[1].length - a[1].length).map(([id, group]) => ({ id, edges: group }));
  }
  relative(ts: string): string { return rel(ts); }
  kindLabel(id: string): string {
    const m = this.t().mapa;
    return id === 'api' ? m.tipoApi : id === 'evento' ? m.tipoEvento : id === 'dato' ? m.tipoDatos : id === 'permiso' ? m.tipoPermiso : id === 'ui' ? m.tipoComponente : this.store.state().kinds[id] || id;
  }
  stateLabel(edge: DepMapEdge): string { return this.store.state().done[edge.id] ? this.t().mapa.estadoHecho : edge.state === 'definir' ? this.t().mapa.estadoADefinir : this.t().mapa.estadoPendiente; }
  toggle(edge: DepMapEdge, event: Event): void {
    const input = event.target as HTMLInputElement;
    const previous = !!this.store.state().done[edge.id];
    void this.store.setDone(edge.id, input.checked).catch(() => { input.checked = previous; });
  }
}

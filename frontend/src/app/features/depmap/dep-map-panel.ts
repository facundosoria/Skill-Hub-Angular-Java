import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { I18n } from '../../core/i18n/i18n';
import { DepMapEdge, DepMapStore } from './dep-map-store';

@Component({
  selector: 'app-dep-map-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.pair(); as selectedPair) {
      @if (direction() === 'out') {
      <button type="button" class="back" (click)="store.clearPair()">← {{ t().mapa.panelVolver }} {{ node(selectedPair[0]).n }}</button>
      <h2>{{ node(selectedPair[0]).n }} {{ t().mapa.panelTituloNecesita }} {{ node(selectedPair[1]).n }}</h2>
      <ul class="items pair-items">
        @for (edge of pairEdges(); track edge.id) { <ng-container *ngTemplateOutlet="item; context: { edge: edge }" /> }
        @empty { <li class="empty">{{ t().mapa.panelSinPedidos }}</li> }
      </ul>
      <p class="empty">{{ t().mapa.panelMarcarAyuda }}</p>
      }
      @if (direction() === 'in') { <ng-container *ngTemplateOutlet="incomingContent" /> }
    } @else {
      @if (info()?.note) { <p class="obj">{{ info()?.note }}</p> }
      @if (!selectedNode()?.transv) {
        @if (direction() === 'out') {
          <div class="sum"><div class="o"><b>{{ uniqueOut() }}</b><div class="sum-copy"><span class="sum-label">{{ t().mapa.panelGruposDependencia }}</span></div></div></div>
          <ng-container *ngTemplateOutlet="groups; context: { list: outgoing(), color: 'out' }" />
        } @else {
          <div class="sum"><div class="i"><b>{{ uniqueIn() }}</b><div class="sum-copy"><span class="sum-label">{{ t().mapa.panelGruposDependientes }}</span></div></div></div>
          <ng-container *ngTemplateOutlet="incomingContent" />
        }
      }
      @if (direction() === 'out') {
        @if (info()?.own?.length) { <h3>{{ t().mapa.panelTareasPropias }}</h3><ul class="own">@for (task of info()?.own; track task) { <li>{{ task }}</li> }</ul> }
      }
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
    <ng-template #incomingContent>
      <ng-container *ngTemplateOutlet="groups; context: { list: incoming(), color: 'in' }" />
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
  styles: `
    :host { display:block; padding:18px; font-family:inherit; font-size:14px; line-height:1.5; } h2 { font-size:22px; margin:0; } .obj { color:var(--text-muted); margin:8px 0 0; font-size:13px; max-width:68ch; }
    .obj + .obj { margin-top:6px; } .sum { display:block; margin:14px 0 4px; } .sum > div { display:flex; align-items:center; gap:14px; min-width:0; border-radius:10px; padding:14px 16px; border:1px solid var(--border); }
    .sum b { flex:0 0 54px; font-size:36px; line-height:1; text-align:center; font-variant-numeric:tabular-nums; } .sum-copy { display:flex; flex-direction:column; gap:5px; min-width:0; }
    .sum-label { font-size:14px; line-height:1.3; color:var(--text); }
    .sum .o { border-color:color-mix(in srgb,var(--dep-out) 45%,var(--border)); } .sum .o b { color:var(--dep-out); }
    .sum .i { border-color:color-mix(in srgb,var(--dep-in) 45%,var(--border)); } .sum .i b { color:var(--dep-in); }
    h3 { font-size:15px; margin:18px 0 6px; display:flex; align-items:center; gap:8px; } .dot { width:8px; height:8px; border-radius:50%; display:inline-block; }
    .out-dot { background:var(--dep-out); } .in-dot { background:var(--dep-in); } .grp { display:flex; align-items:center; gap:8px; margin:12px 0 2px; }
    .grp { min-width:0; } .grp button { min-width:0; overflow-wrap:anywhere; border:0; background:transparent; padding:0; font-size:14px; line-height:1.35; font-weight:600; text-decoration:underline; text-decoration-color:var(--border); text-underline-offset:3px; cursor:pointer; color:var(--text); }
    ul.items { list-style:none; margin:0; padding:0; } .it { display:grid; grid-template-columns:20px minmax(0,1fr) 32px; gap:8px; padding:7px 2px; border-top:1px solid var(--border); align-items:start; border-radius:8px; min-width:0; }
    .it:first-child { border-top:0; } .it.done .tx { text-decoration:line-through; color:var(--text-muted); } .it input { margin:3px 0 0; accent-color:var(--success); width:16px; height:16px; }
    .edge-meta { display:flex; flex-wrap:wrap; align-items:flex-start; gap:6px; min-width:0; } .edge-meta .chip { max-width:100%; white-space:normal; overflow-wrap:anywhere; } .tx { flex:0 0 100%; min-width:0; font-size:11px; line-height:1.5; color:var(--text); text-align:justify; text-justify:inter-word; hyphens:auto; overflow-wrap:anywhere; } .chip { display:inline-block; font-size:11.5px; border-radius:6px; padding:0 7px; background:var(--surface-2); border:1px solid var(--border); color:var(--text-muted); vertical-align:1px; }
    .chip.q { background:var(--warning-soft); color:var(--warning); border-color:transparent; } .x { display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; border:0; background:transparent; color:var(--text-muted); padding:0; line-height:1; border-radius:6px; cursor:pointer; font-size:18px; }
    .x:hover { color:var(--danger); background:color-mix(in srgb,var(--danger) 10%,transparent); } .x:focus-visible { outline:2px solid var(--accent); outline-offset:2px; } .it .x { opacity:0; } .it:hover .x,.x:focus-visible { opacity:1; }
    .own { margin:0; padding-left:18px; list-style:disc; color:var(--text); font-size:14px; line-height:1.5; } .own li { margin:7px 0; text-align:justify; text-justify:inter-word; hyphens:auto; overflow-wrap:anywhere; } .empty { color:var(--text-muted); font-size:13px; padding:6px 0; }
    .back { margin-bottom:10px; border:0; background:transparent; color:var(--text-muted); cursor:pointer; } .feed { list-style:none; margin:0; padding:0; font-size:12.5px; color:var(--text-muted); }
    .add { margin-top:16px; } .pair-items { margin-top:10px; }
    .it.flash { animation:flash 1.6s ease-out; } @keyframes flash { from { background:color-mix(in srgb,var(--dep-out) 14%,transparent); } to { background:transparent; } }
    @media (hover:none) { .it .x { opacity:1; } } @media (prefers-reduced-motion:reduce) { * { animation:none !important; } }
  `,
})
export class DepMapPanel {
  readonly store = inject(DepMapStore);
  private readonly i18n = inject(I18n);
  readonly t = this.i18n.t;
  readonly direction = input<'out' | 'in'>('out');
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

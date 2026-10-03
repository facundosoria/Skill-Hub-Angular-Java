import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { I18n } from '../../core/i18n/i18n';
import { DepMapEdge, DepMapStore } from './dep-map-store';

@Component({
  selector: 'app-dep-map-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!edges().length) { <div class="empty">{{ t().mapa.listaVacia }}</div> }
    @else {
      <div class="tablewrap"><table class="list"><thead><tr><th scope="col" [attr.aria-label]="t().mapa.listaHecho"></th><th>{{ t().mapa.listaQuienNecesita }}</th><th>{{ t().mapa.listaDe }}</th><th>{{ t().mapa.listaQue }}</th><th>{{ t().mapa.listaTipo }}</th><th>{{ t().mapa.listaEstado }}</th></tr></thead>
        <tbody>@for (edge of edges(); track edge.id) {
          <tr [class.done-row]="!!store.state().done[edge.id]" [class.flash]="store.flashId() === edge.id">
            <td><input type="checkbox" [checked]="!!store.state().done[edge.id]" [attr.aria-label]="t().mapa.marcarHecho" (change)="toggle(edge, $event)" /></td>
            <td><button type="button" class="lnk" (click)="store.selectNode(edge.from)">{{ node(edge.from).n }}</button></td>
            <td><button type="button" class="lnk" (click)="store.selectNode(edge.to)">{{ node(edge.to).n }}</button></td>
            <td [class.line-through]="!!store.state().done[edge.id]" [class.text-text-muted]="!!store.state().done[edge.id]">{{ edge.text }}</td>
            <td>{{ kindLabel(edge.kind) }}</td>
            <td>@if (store.state().done[edge.id]) { {{ t().mapa.listaHecho }} } @else if (edge.state === 'definir') { <span class="chip q">{{ t().mapa.listaADefinir }}</span> } @else { {{ t().mapa.listaPendiente }} }</td>
          </tr>
        }</tbody>
      </table></div>
    }
  `,
  styles: `
    :host { display:block; } .tablewrap { overflow:auto; padding:12px; } table { border-collapse:separate; border-spacing:0; font-size:13px; width:100%; }
    @media (min-width:1021px) {
      :host-context(.fit-height) { height:100%; min-height:0; }
      :host-context(.fit-height) .tablewrap { height:100%; min-height:0; overflow:auto; }
    }
    th,td { padding:6px 8px; text-align:left; vertical-align:top; } .list th { position:sticky; top:0; background:var(--surface); border-bottom:1px solid var(--border); font-weight:600; }
    .list td { border-bottom:1px solid var(--border); } .list tr:last-child td { border-bottom:0; } .list tr.flash td { animation:flash 1.6s ease-out; }
    input { margin:3px 0 0; accent-color:var(--success); width:16px; height:16px; } .lnk { border:0; background:transparent; padding:0; font-weight:600; text-decoration:underline; text-decoration-color:var(--border); text-underline-offset:3px; cursor:pointer; color:var(--text); }
    .chip { display:inline-block; font-size:11.5px; border-radius:6px; padding:0 7px; background:var(--surface-2); border:1px solid var(--border); color:var(--text-muted); } .chip.q { background:var(--warning-soft); color:var(--warning); border-color:transparent; }
    .empty { color:var(--text-muted); font-size:13px; padding:20px; } @keyframes flash { from { background:color-mix(in srgb,var(--dep-out) 12%,transparent); } to { background:transparent; } }
    @media (prefers-reduced-motion:reduce) { * { animation:none !important; } }
  `,
})
export class DepMapList {
  readonly store = inject(DepMapStore);
  private readonly i18n = inject(I18n);
  readonly t = this.i18n.t;
  readonly deleteRequested = output<DepMapEdge>();
  readonly edges = computed(() => this.store.visible().slice().sort((a, b) => this.node(a.from).n.localeCompare(this.node(b.from).n) || this.node(a.to).n.localeCompare(this.node(b.to).n)));
  node(id: string) { return this.store.state().nodes[id]; }
  kindLabel(id: string): string {
    const m = this.t().mapa;
    return id === 'api' ? m.tipoApi : id === 'evento' ? m.tipoEvento : id === 'dato' ? m.tipoDatos : id === 'permiso' ? m.tipoPermiso : id === 'ui' ? m.tipoComponente : this.store.state().kinds[id] || id;
  }
  toggle(edge: DepMapEdge, event: Event): void { const input = event.target as HTMLInputElement; const previous = !!this.store.state().done[edge.id]; void this.store.setDone(edge.id, input.checked).catch(() => { input.checked = previous; }); }
}

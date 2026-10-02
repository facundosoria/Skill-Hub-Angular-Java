import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { I18n } from '../../core/i18n/i18n';
import { DepMapStore } from './dep-map-store';

@Component({
  selector: 'app-dep-map-matrix',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tablewrap">
      <table class="mx">
        <thead><tr><th class="corner" scope="col" aria-label="Grupo"></th>
          @for (column of ids(); track column) { <th scope="col" [class.minecol]="column === store.mine()"><span>{{ node(column).s }}</span></th> }
          <th class="tot" scope="col"><span>Necesita (total)</span></th>
        </tr></thead>
        <tbody>
          @for (row of ids(); track row) {
            <tr [class.minerow]="row === store.mine()"><th scope="row">{{ node(row).n }}</th>
              @for (column of ids(); track column) {
                @if (row === column) { <td><div class="cell self" aria-hidden="true"></div></td> }
                @else { <td [class.minecol]="column === store.mine()">
                  @if (cellCount(row, column)) {
                    <button type="button" class="cell on" (click)="store.selectPair([row, column])"
                      [attr.aria-label]="node(row).n + ' necesita de ' + node(column).n + ': ' + cellCount(row, column) + ' pedidos'"
                      [title]="node(row).n + ' necesita de ' + node(column).n">{{ cellCount(row, column) }}</button>
                  } @else { <div class="cell" aria-hidden="true"></div> }
                </td> }
              }
              <td class="tot">{{ rowTotal(row) }}</td>
            </tr>
          }
          <tr><th scope="row" class="tot">Lo necesitan (total)</th>
            @for (column of ids(); track column) { <td class="tot">{{ colTotal(column) }}</td> }
            <td class="tot"></td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="hint">Cada fila necesita de la columna. Tu grupo está resaltado: <b class="out-text">la fila</b> es lo que necesita, <b class="in-text">la columna</b> es lo que otros necesitan de vos. {{ isNarrow() ? 'Tocá' : 'Clic' }} en un número para ver el detalle.{{ isNarrow() ? ' Deslizá la tabla para ver todas las columnas.' : '' }}</p>
  `,
  styles: `
    :host { display:block; } .tablewrap { overflow:auto; padding:12px; }
    @media (min-width:1021px) and (min-height:700px) {
      :host-context(.fit-height) { height:100%; min-height:0; display:flex; flex-direction:column; }
      :host-context(.fit-height) .tablewrap { height:100%; min-height:0; flex:1 1 auto; overflow:auto; }
      :host-context(.fit-height) .hint { flex:none; }
    }
    table { border-collapse:separate; border-spacing:0; font-size:13px; width:100%; }
    th,td { padding:0; text-align:left; vertical-align:top; } .mx { min-width:820px; table-layout:fixed; }
    .mx thead th { position:relative; height:112px; vertical-align:bottom; border-bottom:1px solid var(--border); padding:0 2px; }
    .mx thead th span { position:absolute; left:50%; bottom:50%; transform:translate(-50%,50%) rotate(-90deg); white-space:nowrap; font-weight:500; color:var(--text-muted); font-size:12px; }
    .mx thead th.corner { width:150px; } .mx thead th.tot { width:80px; }
    .mx tbody th { position:sticky; left:0; background:var(--surface); z-index:1; text-align:right; white-space:nowrap; font-weight:600; padding:0 12px 0 8px; height:40px; border-bottom:1px solid var(--border); width:150px; }
    .mx tbody td { height:40px; text-align:center; border-bottom:1px solid var(--border); padding:1px 2px; }
    .mx tbody tr:last-child th,.mx tbody tr:last-child td { border-bottom:0; }
    .cell { width:40px; height:36px; border-radius:8px; border:1px solid var(--border); background:var(--surface-2); color:var(--text-muted); display:inline-flex; align-items:center; justify-content:center; padding:0; font-weight:600; font-size:12.5px; }
    button.cell { cursor:pointer; } .cell.on { background:var(--dep-out); border-color:var(--dep-out); color:#fff; } .cell.on:hover { outline:2px solid var(--text); }
    .cell.self { background:transparent; border-style:dashed; cursor:default; } .tot { color:var(--text-muted); font-size:12.5px; padding:0 6px; text-align:center; vertical-align:middle; }
    .mx tbody th.tot { color:var(--text-muted); font-weight:500; text-align:right; position:sticky; left:0; background:var(--surface); }
    .minerow th,.minecol { color:var(--dep-out); } .mx td.minecol .cell { box-shadow:0 0 0 2px color-mix(in srgb,var(--dep-in) 55%,transparent); }
    .mx tr.minerow .cell.on { box-shadow:0 0 0 2px color-mix(in srgb,var(--dep-out) 40%,transparent); }
    .hint { color:var(--text-muted); font-size:12.5px; padding:2px 12px 12px; max-width:90ch; } .out-text { color:var(--dep-out); } .in-text { color:var(--dep-in); }
  `,
})
export class DepMapMatrix {
  readonly store = inject(DepMapStore);
  private readonly i18n = inject(I18n);
  readonly t = this.i18n.t;
  readonly ids = computed(() => Object.keys(this.store.state().nodes).filter((id) => !this.store.state().nodes[id].transv));
  private readonly matrix = computed(() => this.store.visible());
  node(id: string) { return this.store.state().nodes[id]; }
  cellCount(from: string, to: string): number { return this.matrix().filter((edge) => edge.from === from && edge.to === to).length; }
  rowTotal(id: string): number { return this.matrix().filter((edge) => edge.from === id).length; }
  colTotal(id: string): number { return this.matrix().filter((edge) => edge.to === id).length; }
  isNarrow(): boolean { return typeof matchMedia !== 'undefined' && matchMedia('(max-width:760px)').matches; }
}

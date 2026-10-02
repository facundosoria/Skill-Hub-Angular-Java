import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, signal } from '@angular/core';
import { I18n } from '../../core/i18n/i18n';
import { DepMapStore } from './dep-map-store';

const DESKTOP_QUERY = '(min-width:1021px)';
const WRAPPER_PADDING = 24;
const TABLE_BORDER = 0;
const TOTAL_COLUMN_WIDTH = 80;
const MIN_CELL = 28;
const MAX_CELL = 44;
const MIN_ROW_LABEL = 96;
const MAX_ROW_LABEL = 150;

export interface MatrixLayout {
  cell: number;
  rowLabel: number;
  header: number;
}

/** Calculates the largest usable cell while keeping the desktop matrix in its wrapper. */
export function calculateMatrixLayout(width: number, height: number, rows: number, columns: number): MatrixLayout {
  // The wrapper has 12px padding on each side; table borders are explicit so
  // the calculation stays aligned with the CSS box model below.
  const availableWidth = Math.max(0, width - WRAPPER_PADDING - TABLE_BORDER * 2);
  const availableHeight = Math.max(0, height - WRAPPER_PADDING - TABLE_BORDER * 2);
  const safeRows = Math.max(1, rows);
  const safeColumns = Math.max(1, columns);
  const rowLabel = Math.max(MIN_ROW_LABEL, Math.min(MAX_ROW_LABEL,
    availableWidth - safeColumns * MIN_CELL - TOTAL_COLUMN_WIDTH));
  const widthCell = (availableWidth - rowLabel - TOTAL_COLUMN_WIDTH) / safeColumns;
  const headerFor = (cell: number) => Math.max(72, Math.min(112, cell * 2.5));
  const heightCell = (availableHeight - headerFor(widthCell)) / safeRows;
  const cell = Math.max(MIN_CELL, Math.min(MAX_CELL, widthCell, heightCell));
  return { cell, rowLabel, header: headerFor(cell) };
}

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
    :host { display:block; } .tablewrap { position:relative; overflow:auto; padding:12px; box-sizing:border-box; }
    .tablewrap.overflow-x::after,.tablewrap.overflow-y::before { content:""; position:absolute; pointer-events:none; z-index:3; }
    .tablewrap.overflow-x::after { top:0; right:0; bottom:12px; width:24px; background:linear-gradient(90deg,transparent,var(--surface)); }
    .tablewrap.overflow-y::before { left:0; right:12px; bottom:0; height:24px; background:linear-gradient(0deg,var(--surface),transparent); }
    @media (min-width:1021px) and (min-height:700px) {
      :host-context(.fit-height) { height:100%; min-height:0; display:flex; flex-direction:column; }
      :host-context(.fit-height) .tablewrap { height:100%; min-height:0; flex:1 1 auto; overflow:auto; }
      :host-context(.fit-height) .hint { flex:none; }
    }
    @media (min-width:1021px) {
      .tablewrap { overflow-x:auto; overflow-y:visible; }
      :host-context(.fit-height) .tablewrap { overflow:auto; }
    }
    table { border-collapse:separate; border-spacing:0; border:0; box-sizing:border-box; font-size:13px; width:max(100%, var(--matrix-width, 820px)); }
    th,td { box-sizing:border-box; padding:0; line-height:1; text-align:left; vertical-align:top; } .mx { min-width:820px; table-layout:fixed; }
    .mx thead th { position:relative; box-sizing:border-box; height:112px; min-height:0; vertical-align:bottom; border-bottom:1px solid var(--border); padding:0 2px; }
    .mx thead th span { position:absolute; left:50%; bottom:50%; transform:translate(-50%,50%) rotate(-90deg); white-space:nowrap; font-weight:500; color:var(--text-muted); font-size:12px; }
    .mx thead th.corner { width:150px; } .mx thead th.tot { width:80px; }
    .mx tbody tr { height:var(--cell,40px); }
    .mx tbody th { position:sticky; left:0; background:var(--surface); z-index:1; box-sizing:border-box; text-align:right; white-space:nowrap; font-weight:600; padding:0 12px 0 8px; height:40px; min-height:0; line-height:1; border-bottom:1px solid var(--border); width:150px; }
    .mx tbody td { box-sizing:border-box; height:40px; min-height:0; text-align:center; line-height:1; border-bottom:1px solid var(--border); padding:0; }
    .mx tbody tr:last-child th,.mx tbody tr:last-child td { border-bottom:0; }
    .cell { width:40px; height:36px; border-radius:8px; border:1px solid var(--border); background:var(--surface-2); color:var(--text-muted); display:inline-flex; align-items:center; justify-content:center; padding:0; font-weight:600; font-size:12.5px; }
    button.cell { cursor:pointer; } .cell.on { background:var(--dep-out); border-color:var(--dep-out); color:#fff; } .cell.on:hover { outline:2px solid var(--text); }
    .cell.self { background:transparent; border-style:dashed; cursor:default; } .tot { color:var(--text-muted); font-size:12.5px; padding:0 6px; text-align:center; vertical-align:middle; }
    .mx tbody th.tot { color:var(--text-muted); font-weight:500; text-align:right; position:sticky; left:0; background:var(--surface); }
    .minerow th,.minecol { color:var(--dep-out); } .mx td.minecol .cell { box-shadow:0 0 0 2px color-mix(in srgb,var(--dep-in) 55%,transparent); }
    .mx tr.minerow .cell.on { box-shadow:0 0 0 2px color-mix(in srgb,var(--dep-out) 40%,transparent); }
    .hint { color:var(--text-muted); font-size:12.5px; padding:2px 12px 12px; max-width:90ch; } .out-text { color:var(--dep-out); } .in-text { color:var(--dep-in); }
    @media (min-width:1021px) {
      .mx { min-width:0; }
      .mx thead th { height:var(--header-height,112px); min-height:var(--header-height,112px); }
      .mx thead th.corner,.mx tbody th { width:var(--row-label,150px); }
      .mx tbody tr,.mx tbody th,.mx tbody td { height:var(--cell,40px); min-height:var(--cell,40px); }
      .mx tbody th { font-size:clamp(12px,calc(var(--cell,40px) * .3),13px); }
      .cell { width:calc(var(--cell,40px) - 4px); height:calc(var(--cell,40px) - 4px); font-size:clamp(11px,calc(var(--cell,40px) * .3),12.5px); }
      .mx thead th span { font-size:clamp(11px,calc(var(--cell,40px) * .3),12px); }
    }
  `,
})
export class DepMapMatrix {
  readonly store = inject(DepMapStore);
  private readonly i18n = inject(I18n);
  readonly t = this.i18n.t;
  readonly ids = computed(() => Object.keys(this.store.state().nodes).filter((id) => !this.store.state().nodes[id].transv));
  private readonly matrix = computed(() => this.store.visible());
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly desktop = signal(false);

  constructor() {
    afterNextRender(() => this.initializeLayout());
  }

  private initializeLayout(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const wrapper = this.host.nativeElement.querySelector('.tablewrap') as HTMLElement | null;
    if (!wrapper) return;
    const media = window.matchMedia(DESKTOP_QUERY);
    const update = () => {
      this.desktop.set(media.matches);
      this.updateLayout(wrapper);
    };
    update();
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    resizeObserver?.observe(wrapper);
    const mutationObserver = typeof MutationObserver !== 'undefined' ? new MutationObserver(update) : null;
    mutationObserver?.observe(wrapper, { childList: true, subtree: true });
    media.addEventListener?.('change', update);
    this.destroyRef.onDestroy(() => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      media.removeEventListener?.('change', update);
    });
  }

  private updateLayout(wrapper: HTMLElement): void {
    if (!this.desktop()) {
      wrapper.classList.remove('overflow-x', 'overflow-y');
      for (const property of ['--cell', '--row-label', '--header-height', '--matrix-width']) wrapper.style.removeProperty(property);
      return;
    }
    const count = this.ids().length;
    const fitHeight = this.host.nativeElement.closest('.fit-height') !== null;
    const rows = count + 1;
    const layout = calculateMatrixLayout(wrapper.clientWidth, fitHeight ? wrapper.clientHeight : 100000, rows, count);
    let cell = layout.cell;
    const setLayout = (nextCell: number) => {
      wrapper.style.setProperty('--cell', `${nextCell}px`);
      wrapper.style.setProperty('--row-label', `${layout.rowLabel}px`);
      wrapper.style.setProperty('--header-height', `${Math.max(72, Math.min(112, nextCell * 2.5))}px`);
      wrapper.style.setProperty('--matrix-width', `${layout.rowLabel + TOTAL_COLUMN_WIDTH + nextCell * count}px`);
    };
    setLayout(cell);

    // CSS table layout can still add a few pixels for borders or font metrics.
    // Re-measure after applying the variables, but keep this bounded and honor
    // the existing 28px readability floor.
    if (fitHeight) {
      for (let iteration = 0; iteration < 2 && cell > MIN_CELL; iteration += 1) {
        const overflowY = wrapper.scrollHeight > wrapper.clientHeight + 1;
        const overflowX = wrapper.scrollWidth > wrapper.clientWidth + 1;
        if (!overflowY && !overflowX) break;
        const heightRatio = overflowY ? wrapper.clientHeight / wrapper.scrollHeight : 1;
        const widthRatio = overflowX ? wrapper.clientWidth / wrapper.scrollWidth : 1;
        const ratio = Math.min(heightRatio, widthRatio);
        const nextCell = Math.max(MIN_CELL, cell * ratio);
        if (nextCell >= cell - 0.01) break;
        cell = nextCell;
        setLayout(cell);
      }
    }
    wrapper.classList.toggle('overflow-x', wrapper.scrollWidth > wrapper.clientWidth + 1);
    wrapper.classList.toggle('overflow-y', fitHeight && wrapper.scrollHeight > wrapper.clientHeight + 1);
  }
  node(id: string) { return this.store.state().nodes[id]; }
  cellCount(from: string, to: string): number { return this.matrix().filter((edge) => edge.from === from && edge.to === to).length; }
  rowTotal(id: string): number { return this.matrix().filter((edge) => edge.from === id).length; }
  colTotal(id: string): number { return this.matrix().filter((edge) => edge.to === id).length; }
  isNarrow(): boolean { return typeof matchMedia !== 'undefined' && matchMedia('(max-width:760px)').matches; }
}

import { afterNextRender, ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18n } from '../../core/i18n/i18n';
import { AuthService } from '../../core/auth';
import { UI } from '../../shared/ui';
import { DepMapEdge, DepMapStore } from './dep-map-store';
import { DepMapGraph } from './dep-map-graph';
import { DepMapMatrix } from './dep-map-matrix';
import { DepMapList } from './dep-map-list';
import { DepMapPanel } from './dep-map-panel';

type DialogRef = ElementRef<HTMLDialogElement>;

// Minimum rendered SVG scale for the height-fitted desktop layout.
const MIN_MAP_SCALE = 0.6;
const MIN_MAP_SCALE_EXIT = 0.58;
// Fallback for the expanded legend block; the observer below replaces it with
// the rendered height as soon as the graph settles.
const DEFAULT_LEGEND_HEIGHT = 65.5;

export interface MapFitMeasurements {
  cardWidth: number;
  horizontalPadding: number;
  viewportHeight: number;
  cardTop: number;
  scrollY: number;
  verticalPadding: number;
  shellPaddingBottom: number;
  legendHeight: number;
}

export function estimateMapScale(measurements: MapFitMeasurements): number {
  const availableWidth = measurements.cardWidth - measurements.horizontalPadding;
  const cardDocumentTop = measurements.cardTop + measurements.scrollY;
  const availableHeight = measurements.viewportHeight - cardDocumentTop
    - measurements.verticalPadding - measurements.shellPaddingBottom - measurements.legendHeight;
  return Math.min(availableWidth / 1000, availableHeight / 745);
}

export function shouldFitMap(estimatedScale: number, currentlyFitting: boolean): boolean {
  return estimatedScale >= (currentlyFitting ? MIN_MAP_SCALE_EXIT : MIN_MAP_SCALE);
}

@Component({
  selector: 'app-dep-map',
  imports: [FormsModule, ...UI, DepMapGraph, DepMapMatrix, DepMapList, DepMapPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dep-map text-text" [class.fit-height]="fitHeight()" (keydown)="onKeydown($event)">
      <header class="module-header flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pb-2.5">
        <div class="module-heading"><h1 class="m-0 text-[26px] leading-[1.1] tracking-[-.01em] max-[560px]:text-[22px]">{{ t().mapa.titulo }}</h1><p class="module-subtitle mt-1 mb-0 max-w-[64ch] text-text-muted">{{ t().mapa.subtitulo }}</p></div>
        <div class="module-actions flex flex-wrap items-end gap-2.5">
          <span class="live" [class.on]="store.online() && store.sseOpen()" [class.warn]="store.online() && !store.sseOpen()" [class.off]="!store.online()" role="status" aria-live="polite">
            <span class="dot"></span><span>{{ liveText() }}</span>
          </span>
          <label class="flex flex-col gap-[3px] text-xs text-text-muted">{{ t().mapa.miGrupo }}<select uiSelect class="min-w-[150px]" [value]="store.mine()" (change)="store.setMine($any($event.target).value)">@for (id of groupIds(); track id) { <option [value]="id">{{ node(id).n }}</option> }</select></label>
          <button uiButton variant="secondary" type="button" (click)="openData()">{{ t().mapa.importarExportar }}</button>
          <button uiButton type="button" (click)="openAdd()" [disabled]="!store.online()">{{ t().mapa.agregar }}</button>
        </div>
      </header>

      @if (store.offline()) {
        <div class="banner" role="status"><span><strong>{{ t().mapa.sinConexion }}</strong> {{ t().mapa.sinConexionDetalle }}</span><button uiButton variant="secondary" size="sm" type="button" (click)="store.retry()">{{ t().mapa.reintentar }}</button></div>
      }
      @if (store.error(); as error) { <div class="error-banner" role="alert"><span>{{ t().mapa.errorCarga }} {{ t().mapa.errorPrefijo }} {{ error }}</span><button uiButton variant="secondary" size="sm" type="button" (click)="store.retry()">{{ t().mapa.reintentarAccion }}</button></div> }

      <div class="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 py-0.5 pb-3">
        <div class="inline-flex rounded-[10px] border border-border bg-surface-2 p-[3px]" role="tablist" [attr.aria-label]="t().mapa.vista">
          @for (view of views; track view.id) { <button type="button" role="tab" class="cursor-pointer rounded-[7px] border-0 bg-transparent px-3.5 py-1.5 font-medium text-text-muted" [class.bg-surface]="store.view() === view.id" [class.text-text]="store.view() === view.id" [class.shadow-[var(--shadow-sm)]]="store.view() === view.id" [attr.aria-selected]="store.view() === view.id" [attr.id]="tabId(view.id)" [attr.aria-controls]="panelId(view.id)" [attr.tabindex]="store.view() === view.id ? 0 : -1" (click)="activateView(view.id)" (keydown)="onTabKeydown($event, view.id)">{{ viewLabel(view.id) }}</button> }
        </div>
        <input uiInput class="max-w-[240px]" type="search" [value]="store.query()" [placeholder]="t().mapa.buscar" [attr.aria-label]="t().mapa.buscarAria" (input)="store.setQuery($any($event.target).value)" />
        <select uiSelect [value]="store.status()" [attr.aria-label]="t().mapa.estado" (change)="store.setStatus($any($event.target).value)">
          @for (status of statuses; track status.id) { <option [value]="status.id">{{ statusLabel(status.id) }}</option> }
        </select>
        <div class="flex flex-wrap gap-1.5" [attr.aria-label]="t().mapa.tipo">@for (kind of kindEntries(); track kind.id) { <button type="button" class="cursor-pointer rounded-full border border-border bg-surface px-[11px] py-[3px] text-[12.5px] text-text-muted" [class.border-text]="store.kindsOn().has(kind.id)" [class.text-text]="store.kindsOn().has(kind.id)" [attr.aria-pressed]="store.kindsOn().has(kind.id)" (click)="store.toggleKind(kind.id)">{{ kind.label }}</button> }</div>
      </div>

      <div class="workspace grid items-start gap-4 min-[1021px]:grid-cols-[minmax(0,1fr)_420px]">
        <main uiCard class="workspace-card min-w-0 overflow-hidden p-2 max-[760px]:overflow-auto">
          @if (store.loading() && !store.state().edges.length) { <div class="p-6 text-text-muted">{{ t().mapa.cargando }}</div> }
          @else {
            <section class="tab-panel" role="tabpanel" [attr.id]="panelId('mapa')" [attr.aria-labelledby]="tabId('mapa')" [hidden]="store.view() !== 'mapa'">@if (store.view() === 'mapa') { <app-dep-map-graph /> }</section>
            <section class="tab-panel" role="tabpanel" [attr.id]="panelId('matriz')" [attr.aria-labelledby]="tabId('matriz')" [hidden]="store.view() !== 'matriz'">@if (store.view() === 'matriz') { <app-dep-map-matrix /> }</section>
            <section class="tab-panel" role="tabpanel" [attr.id]="panelId('lista')" [attr.aria-labelledby]="tabId('lista')" [hidden]="store.view() !== 'lista'">@if (store.view() === 'lista') { <app-dep-map-list /> }</section>
          }
        </main>
        <aside uiCard class="workspace-panel overflow-auto max-[1020px]:static max-[1020px]:max-h-none"><app-dep-map-panel (addRequested)="openAdd($event)" (deleteRequested)="askDelete($event)" /></aside>
      </div>

      <dialog #addDialog class="dialog" aria-labelledby="add-title">
        <form (ngSubmit)="submitAdd()" class="dialog-form"><div class="dialog-head"><h2 id="add-title">{{ t().mapa.agregar }}</h2><button type="button" class="close" [attr.aria-label]="t().mapa.cerrarDialogo" (click)="close(addDialog)">×</button></div>
          <div class="row"><label>{{ t().mapa.quienNecesita }}<select uiSelect class="w-full" [(ngModel)]="addFrom" name="from">@for (id of groupIds(); track id) { <option [value]="id">{{ node(id).n }}</option> }</select></label><label>{{ t().mapa.deQuien }}<select uiSelect class="w-full" [(ngModel)]="addTo" name="to">@for (id of groupIds(); track id) { <option [value]="id">{{ node(id).n }}</option> }</select></label></div>
          <label>{{ t().mapa.queNecesita }}<textarea uiTextarea rows="3" [(ngModel)]="addText" name="text" [placeholder]="t().mapa.queNecesitaPlaceholder"></textarea></label>
          <div class="row"><label>{{ t().mapa.tipoDependencia }}<select uiSelect class="w-full" [(ngModel)]="addKind" name="kind">@for (kind of kindEntries(); track kind.id) { <option [value]="kind.id">{{ kind.label }}</option> }</select></label><label>{{ t().mapa.estado }}<select uiSelect class="w-full" [(ngModel)]="addState" name="state"><option value="pendiente">{{ t().mapa.opcionPendiente }}</option><option value="definir">{{ t().mapa.opcionADefinir }}</option></select></label></div>
          @if (dialogError()) { <p class="error" role="alert">{{ dialogError() }}</p> }
          <div class="actions"><button uiButton variant="secondary" type="button" (click)="close(addDialog)">{{ t().mapa.cancelar }}</button><button uiButton type="submit" [disabled]="busy()">{{ t().mapa.guardar }}</button></div>
        </form>
      </dialog>

      <dialog #dataDialog class="dialog data-dialog" aria-labelledby="data-title">
        <div class="dialog-form"><div class="dialog-head"><h2 id="data-title">{{ t().mapa.datosTitulo }}</h2><button type="button" class="close" [attr.aria-label]="t().mapa.cerrarDialogo" (click)="close(dataDialog)">×</button></div>
          <p class="meta">{{ dataMeta() }}</p><p class="meta">{{ t().mapa.datosAyuda }}</p><textarea uiTextarea class="json" spellcheck="false" [(ngModel)]="jsonDataValue" name="json"></textarea>
          @if (dialogError()) { <p class="error" role="alert">{{ dialogError() }}</p> }
          <div class="actions"><button uiButton variant="secondary" type="button" (click)="copyData()">{{ t().mapa.copiar }}</button>@if (isAdmin()) { <button uiButton variant="secondary" type="button" (click)="askReset()" [disabled]="busy() || !store.online()">{{ t().mapa.restaurar }}</button><button uiButton type="button" (click)="applyData()" [disabled]="busy() || !store.online()">{{ t().mapa.aplicar }}</button> }<button uiButton variant="secondary" type="button" (click)="close(dataDialog)">{{ t().mapa.cerrar }}</button></div>
        </div>
      </dialog>

      <dialog #confirmDialog class="dialog narrow" aria-labelledby="confirm-title"><div class="dialog-form"><h2 id="confirm-title">{{ t().mapa.confirmar }}</h2><p class="meta">{{ confirmMessage() }}</p><div class="actions"><button uiButton variant="secondary" type="button" (click)="close(confirmDialog)">{{ t().mapa.cancelar }}</button><button uiButton variant="danger" type="button" [disabled]="busy() || !store.online()" (click)="confirmAction()">{{ t().mapa.confirmarAccion }}</button></div></div></dialog>
      @if (toast()) { <div class="toast" role="status" aria-live="polite">{{ toast() }}</div> }
    </div>
  `,
  styles: `
    :host { --dep-out:#1f5fe0; --dep-in:#b8490a; --map-offset:147px; display:block; } @media (prefers-color-scheme:dark) { :host { --dep-out:#6fa0ff; --dep-in:#ff9a52; } } :host-context([data-theme=dark]) { --dep-out:#6fa0ff; --dep-in:#ff9a52; }
    @media (min-width:1021px) {
      .module-header { align-items:flex-start; }
      .module-heading { flex:1 1 auto; min-width:0; }
      .module-subtitle { font-size:12.5px; }
      .module-actions { align-items:flex-end; }
    }
    @media (min-width:1280px) {
      .module-header { flex-wrap:nowrap; }
      .module-heading { min-width:0; }
      .module-subtitle { max-width:42ch; }
      .module-actions { flex-wrap:nowrap; flex:none; }
    }
    @media (min-width:1021px) and (min-height:700px) {
      .dep-map.fit-height { height:calc(100dvh - var(--map-offset)); display:flex; flex-direction:column; min-height:0; }
      .dep-map.fit-height .workspace { flex:1 1 auto; min-height:0; height:100%; align-items:stretch; }
      .dep-map.fit-height .workspace-card, .dep-map.fit-height .workspace-panel { min-height:0; height:100%; }
      .dep-map.fit-height .workspace-card { display:flex; flex-direction:column; }
      .dep-map.fit-height .workspace-card > .tab-panel { display:flex; flex:1 1 auto; flex-direction:column; min-height:0; height:100%; }
      .dep-map.fit-height .workspace-card > .tab-panel > app-dep-map-graph, .dep-map.fit-height .workspace-card > .tab-panel > app-dep-map-matrix, .dep-map.fit-height .workspace-card > .tab-panel > app-dep-map-list { display:block; flex:1 1 auto; min-height:0; height:100%; }
      .dep-map.fit-height .workspace-card > app-dep-map-matrix, .dep-map.fit-height .workspace-card > app-dep-map-list { overflow:hidden; }
      .dep-map.fit-height .workspace-panel { overflow-y:auto; overflow-x:hidden; }
    }
    .live { display:inline-flex; align-items:center; gap:7px; min-height:36px; padding:7px 12px; border-radius:999px; border:1px solid var(--border); background:var(--surface); color:var(--text-muted); font-size:12.5px; box-shadow:var(--shadow-sm); }
    .live .dot { width:8px; height:8px; border-radius:50%; background:var(--text-muted); flex:none; } .live.on { color:var(--text); border-color:color-mix(in srgb,var(--success) 45%,var(--border)); } .live.on .dot { background:var(--success); }
    .live.warn .dot { background:var(--warning); } .live.off { color:var(--dep-in); border-color:color-mix(in srgb,var(--dep-in) 45%,var(--border)); } .live.off .dot { background:var(--dep-in); }
    .banner,.error-banner { margin:0 0 10px; padding:10px 14px; border:1px solid color-mix(in srgb,var(--dep-in) 40%,var(--border)); border-radius:10px; background:color-mix(in srgb,var(--dep-in) 8%,var(--surface)); display:flex; align-items:center; gap:10px; font-size:13px; } .banner span,.error-banner span { flex:1; } .banner strong,.error-banner { color:var(--dep-in); }
    .dialog { margin:auto; width:min(560px,calc(100% - 2rem)); max-height:90vh; overflow:auto; border:1px solid var(--border); border-radius:var(--radius-lg); padding:0; background:var(--surface); color:var(--text); box-shadow:var(--shadow-lg); } .dialog::backdrop { background:rgba(10,15,22,.55); }
    .dialog.narrow { width:min(440px,calc(100% - 2rem)); } .dialog-form { padding:20px; } .dialog-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; } .dialog h2 { font-size:20px; margin:0 0 12px; } .dialog label { display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--text-muted); margin-bottom:10px; } .dialog textarea { width:100%; resize:vertical; } .dialog .row { display:grid; grid-template-columns:1fr 1fr; gap:10px; } .dialog .json { min-height:260px; font-family:ui-monospace,Menlo,monospace; font-size:12px; } .close { border:0; background:transparent; font-size:24px; color:var(--text-muted); cursor:pointer; } .actions { display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; margin-top:6px; border-top:1px solid var(--border); padding-top:14px; } .meta { color:var(--text-muted); font-size:12.5px; margin:0 0 10px; } .error { color:var(--danger); font-size:13px; min-height:18px; }
    .toast { position:fixed; left:50%; bottom:20px; transform:translateX(-50%); background:var(--text); color:var(--bg); padding:8px 14px; border-radius:8px; font-size:13px; z-index:20; max-width:min(560px,90vw); text-align:center; }
    @media (max-width:560px) { .dialog .row { grid-template-columns:1fr; } }
    @media (prefers-reduced-motion:reduce) { * { transition:none !important; animation:none !important; } }
  `,
})
export class DepMap {
  readonly store = inject(DepMapStore);
  private readonly i18n = inject(I18n);
  private readonly auth = inject(AuthService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly t = this.i18n.t;
  readonly isAdmin = computed(() => this.auth.user()?.role === 'admin');
  readonly busy = signal(false);
  readonly dialogError = signal('');
  readonly toast = signal('');
  readonly fitHeight = signal(false);
  private lastLegendHeight = DEFAULT_LEGEND_HEIGHT;
  jsonDataValue = '';
  readonly confirmMessage = signal('');
  readonly confirmKind = signal<'delete' | 'reset' | null>(null);
  readonly pendingDelete = signal<DepMapEdge | null>(null);
  addFrom = ''; addTo = ''; addKind = ''; addState: 'pendiente' | 'definir' = 'pendiente'; addText = '';
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  @ViewChild('addDialog') addDialog!: DialogRef;
  @ViewChild('dataDialog') dataDialog!: DialogRef;
  @ViewChild('confirmDialog') confirmDialog!: DialogRef;

  constructor() {
    afterNextRender(() => {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;
      let layoutFrame: number | null = null;
      let stabilizationFrame: number | null = null;
      const updateLayout = () => {
        if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
        if (stabilizationFrame !== null) cancelAnimationFrame(stabilizationFrame);
        layoutFrame = requestAnimationFrame(() => {
          layoutFrame = null;
          this.updateMapOffset();
          this.updateFitHeight();
          stabilizationFrame = requestAnimationFrame(() => {
            stabilizationFrame = null;
            this.updateMapOffset();
            this.updateFitHeight();
          });
        });
      };
      updateLayout();
      window.addEventListener('resize', updateLayout);

      const main = this.host.nativeElement.closest('main');
      const shellHeader = main?.parentElement?.querySelector('header');
      const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateLayout) : null;
      const mutations = typeof MutationObserver !== 'undefined' ? new MutationObserver(updateLayout) : null;
      if (observer) {
        if (shellHeader) observer.observe(shellHeader);
        observer.observe(document.body);
        observer.observe(this.host.nativeElement);
        const workspace = this.host.nativeElement.querySelector('.workspace');
        if (workspace) observer.observe(workspace);
        const legend = this.host.nativeElement.querySelector('app-dep-map-graph .legend') as HTMLElement | null;
        if (legend) observer.observe(legend);
      }
      mutations?.observe(this.host.nativeElement, { childList: true, subtree: true, characterData: true });
      this.destroyRef.onDestroy(() => {
        if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
        if (stabilizationFrame !== null) cancelAnimationFrame(stabilizationFrame);
        window.removeEventListener('resize', updateLayout);
        observer?.disconnect();
        mutations?.disconnect();
      });
    });
  }

  private updateMapOffset(): void {
    const root = this.host.nativeElement as HTMLElement;
    const main = root.closest('main');
    if (!main) return;
    const paddingBottom = Number.parseFloat(getComputedStyle(main).paddingBottom) || 0;
    root.style.setProperty('--map-offset', `${root.getBoundingClientRect().top + window.scrollY + paddingBottom}px`);
  }

  private updateFitHeight(): void {
    const root = this.host.nativeElement as HTMLElement;
    const desktop = window.matchMedia('(min-width:1021px) and (min-height:700px)').matches;
    if (!desktop) { this.fitHeight.set(false); return; }

    const workspace = root.querySelector<HTMLElement>('.workspace');
    const card = root.querySelector<HTMLElement>('.workspace-card');
    if (!workspace || !card) return;

    const cardStyle = getComputedStyle(card);
    const cardRect = card.getBoundingClientRect();
    const legend = root.querySelector<HTMLElement>('app-dep-map-graph .legend');
    const measuredLegendHeight = legend?.getBoundingClientRect().height || 0;
    if (measuredLegendHeight > 0) this.lastLegendHeight = measuredLegendHeight;
    const horizontalPadding = (Number.parseFloat(cardStyle.paddingLeft) || 0) + (Number.parseFloat(cardStyle.paddingRight) || 0);
    const verticalPadding = (Number.parseFloat(cardStyle.paddingTop) || 0) + (Number.parseFloat(cardStyle.paddingBottom) || 0);
    const shell = root.closest('main');
    const shellPaddingBottom = shell ? Number.parseFloat(getComputedStyle(shell).paddingBottom) || 0 : 0;
    const estimatedScale = estimateMapScale({
      cardWidth: cardRect.width,
      horizontalPadding,
      viewportHeight: window.innerHeight,
      cardTop: cardRect.top,
      scrollY: window.scrollY,
      verticalPadding,
      shellPaddingBottom,
      legendHeight: this.lastLegendHeight,
    });
    const fitHeight = shouldFitMap(estimatedScale, this.fitHeight());
    if (fitHeight !== this.fitHeight()) {
      this.fitHeight.set(fitHeight);
      this.changeDetector.markForCheck();
    }
  }

  readonly views = [{ id: 'mapa' as const }, { id: 'matriz' as const }, { id: 'lista' as const }];
  readonly statuses = [
    { id: 'todos', label: 'Todos los estados' }, { id: 'pendiente', label: 'Pendiente' }, { id: 'definir', label: 'A definir' }, { id: 'hecho', label: 'Hecho' },
  ] as const;
  readonly groupIds = computed(() => Object.keys(this.store.state().nodes).filter((id) => !this.store.state().nodes[id].transv));
  readonly kindEntries = computed(() => Object.entries(this.store.state().kinds).map(([id, label]) => ({ id, label: this.kindLabel(id, label) })));
  node(id: string) { return this.store.state().nodes[id]; }
  liveText(): string { const presence = this.store.state().presence.length; const m = this.t().mapa; return this.store.online() && this.store.sseOpen() ? (presence > 1 ? `${m.live} · ${presence} ${m.enLinea}` : m.live) : this.store.online() ? m.reconectando : m.sinConexionCorta; }
  viewLabel(id: 'mapa' | 'matriz' | 'lista'): string { return id === 'mapa' ? this.t().mapa.pestañaMapa : id === 'matriz' ? this.t().mapa.pestañaMatriz : this.t().mapa.pestañaLista; }
  statusLabel(id: 'todos' | 'pendiente' | 'definir' | 'hecho'): string { return id === 'todos' ? this.t().mapa.todosEstados : id === 'pendiente' ? this.t().mapa.estadoPendiente : id === 'definir' ? this.t().mapa.estadoADefinir : this.t().mapa.estadoHecho; }
  kindLabel(id: string, fallback = id): string {
    const m = this.t().mapa;
    return id === 'api' ? m.tipoApi : id === 'evento' ? m.tipoEvento : id === 'dato' ? m.tipoDatos : id === 'permiso' ? m.tipoPermiso : id === 'ui' ? m.tipoComponente : fallback;
  }
  tabId(id: string): string { return `depmap-tab-${id}`; }
  panelId(id: string): string { return `depmap-panel-${id}`; }
  activateView(id: 'mapa' | 'matriz' | 'lista'): void { this.store.setView(id); }
  onTabKeydown(event: KeyboardEvent, current: 'mapa' | 'matriz' | 'lista'): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = this.views.findIndex((view) => view.id === current);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? this.views.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + this.views.length) % this.views.length;
    this.activateView(this.views[next].id);
    queueMicrotask(() => (this.host.nativeElement.querySelector(`#${this.tabId(this.views[next].id)}`) as HTMLButtonElement | null)?.focus());
  }
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    const target = event.target as HTMLElement;
    if (target.closest('dialog[open]') || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable || !!target.closest('[contenteditable]')) return;
    if (this.store.pair()) { event.preventDefault(); this.store.clearPair(); return; }
    if (this.store.node() && this.store.node() !== this.store.mine()) { event.preventDefault(); this.store.selectNode(this.store.mine()); }
  }

  openAdd(from?: string): void {
    const groups = this.groupIds(); if (!groups.length) return;
    this.addFrom = from && groups.includes(from) ? from : this.store.node() && groups.includes(this.store.node()!) ? this.store.node()! : this.store.mine();
    this.addTo = groups.find((id) => id !== this.addFrom) || groups[0]; this.addKind = this.kindEntries()[0]?.id || ''; this.addState = 'pendiente'; this.addText = ''; this.dialogError.set(''); this.addDialog.nativeElement.showModal();
  }
  async submitAdd(): Promise<void> {
    if (this.addFrom === this.addTo) { this.dialogError.set('Elegí dos grupos distintos.'); return; }
    if (!this.addText.trim()) { this.dialogError.set('Contá qué necesita.'); return; }
    this.busy.set(true); this.dialogError.set('');
    try { await this.store.addEdge({ from: this.addFrom, to: this.addTo, kind: this.addKind, state: this.addState, text: this.addText.trim() }); this.close(this.addDialog.nativeElement); this.showToast('Dependencia agregada para todos'); }
    catch (error) { this.dialogError.set(error instanceof Error ? error.message : 'No se pudo guardar.'); } finally { this.busy.set(false); }
  }
  openData(): void { const state = this.store.state(); this.jsonDataValue = JSON.stringify({ edges: state.edges, done: state.done }, null, 1); this.dialogError.set(''); this.dataDialog.nativeElement.showModal(); }
  dataMeta(): string { const state = this.store.state(); return `Estado compartido: versión ${state.version}${state.updatedBy ? ` · último cambio de ${state.updatedBy}` : ''} · ${state.edges.length} dependencias, ${Object.keys(state.done).length} hechas.`; }
  async copyData(): Promise<void> { try { await navigator.clipboard.writeText(this.jsonDataValue); this.showToast('Copiado'); } catch { this.showToast('Seleccioná y copiá a mano'); } }
  async applyData(): Promise<void> {
    try { const parsed = JSON.parse(this.jsonDataValue) as { edges: DepMapEdge[]; done?: Record<string, boolean> }; this.busy.set(true); await this.store.importData({ edges: parsed.edges, done: parsed.done || {} }); this.close(this.dataDialog.nativeElement); this.showToast('Datos aplicados para todos'); }
    catch (error) { this.dialogError.set(error instanceof Error ? error.message : 'JSON inválido.'); } finally { this.busy.set(false); }
  }
  askReset(): void { this.confirmKind.set('reset'); this.confirmMessage.set('Se vuelve a los datos de la reunión y se pierden todos los cambios hechos por el equipo.'); this.confirmDialog.nativeElement.showModal(); }
  askDelete(edge: DepMapEdge): void { this.pendingDelete.set(edge); this.confirmKind.set('delete'); this.confirmMessage.set(`Se elimina para todos los que están viendo el mapa: «${edge.text}»`); this.confirmDialog.nativeElement.showModal(); }
  async confirmAction(): Promise<void> {
    this.busy.set(true); try { if (this.confirmKind() === 'delete' && this.pendingDelete()) { await this.store.deleteEdge(this.pendingDelete()!.id); this.showToast('Dependencia eliminada'); } else if (this.confirmKind() === 'reset') { await this.store.reset(); this.close(this.dataDialog.nativeElement); this.showToast('Datos originales restaurados'); } this.close(this.confirmDialog.nativeElement); } catch (error) { this.dialogError.set(error instanceof Error ? error.message : 'No se pudo completar la acción.'); } finally { this.busy.set(false); }
  }
  close(dialog: HTMLDialogElement): void { dialog.close(); this.dialogError.set(''); }
  private showToast(message: string): void { this.toast.set(message); if (this.toastTimer) clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => this.toast.set(''), 2_200); }
}

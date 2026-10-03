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
    <div class="dep-map text-text" [class.fit-height]="fitHeight()" [class.fullscreen]="fullscreen()" [class.panel-collapsed]="store.panelCollapsed()" [attr.role]="fullscreen() ? 'dialog' : null" [attr.aria-modal]="fullscreen() ? 'true' : null" [attr.aria-label]="fullscreen() ? t().mapa.titulo : null" tabindex="-1" (keydown)="onKeydown($event)">
      @if (fullscreen()) { <button type="button" class="fullscreen-exit" [attr.aria-label]="t().mapa.salirPantallaCompleta" [title]="t().mapa.salirPantallaCompleta" (click)="exitFullscreen()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button> }
      <header class="module-header pb-2">
        <div class="module-heading">
          <h1 class="m-0 flex flex-wrap items-center gap-x-2 text-[26px] leading-[1.1] tracking-[-.01em] max-[560px]:text-[22px]">
            {{ t().mapa.titulo }} <span aria-hidden="true">—</span> {{ selectedGroupName() }}
          </h1>
          <p class="module-subtitle mt-1 mb-0 text-text-muted">{{ t().mapa.subtitulo }}</p>
        </div>
        <div class="module-actions flex flex-wrap items-end gap-2">
          <label class="group-select flex flex-col gap-[3px] text-xs text-text-muted">{{ t().mapa.miGrupo }}<select uiSelect class="min-w-[150px]" [ngModel]="store.mine()" (ngModelChange)="store.setMine($event)" name="mine">@for (id of groupIds(); track id) { <option [value]="id" [selected]="store.mine() === id">{{ node(id).n }}</option> }</select></label>
          <div class="action-buttons flex gap-2">
            <button uiButton size="sm" type="button" (click)="openAdd()" [disabled]="!store.online()">{{ t().mapa.agregar }}</button>
            <div class="menu-wrap" data-map-menu="more">
              <button uiButton variant="secondary" size="sm" type="button" data-menu-trigger="more" aria-controls="depmap-more-options" [attr.aria-expanded]="openMenu() === 'more'" (click)="toggleMenu('more')">{{ t().mapa.mas }} <span aria-hidden="true">⌄</span></button>
              @if (openMenu() === 'more') { <div class="menu-panel" id="depmap-more-options" role="group" [attr.aria-label]="t().mapa.mas"><button uiButton variant="ghost" type="button" (click)="openDataFromMenu()">{{ t().mapa.importarExportar }}</button></div> }
            </div>
          </div>
        </div>
      </header>

      @if (store.offline()) {
        <div class="banner" role="status"><span><strong>{{ t().mapa.sinConexion }}</strong> {{ t().mapa.sinConexionDetalle }}</span><button uiButton variant="secondary" size="sm" type="button" (click)="store.retry()">{{ t().mapa.reintentar }}</button></div>
      }
      @if (store.error(); as error) { <div class="error-banner" role="alert"><span>{{ t().mapa.errorCarga }} {{ t().mapa.errorPrefijo }} {{ error }}</span><button uiButton variant="secondary" size="sm" type="button" (click)="store.retry()">{{ t().mapa.reintentarAccion }}</button></div> }

      <section id="depmap-details-panel" class="workspace grid items-stretch gap-3" [class.panel-collapsed]="store.panelCollapsed()" [class.detail-open]="fullscreen() && fullscreenDetailsOpen()" [attr.aria-label]="t().mapa.vista">
        <aside uiCard class="details-side details-out overflow-y-auto overflow-x-hidden" [hidden]="store.panelCollapsed()"><app-dep-map-panel direction="out" (deleteRequested)="askDelete($event)" /></aside>
        <main uiCard class="workspace-card min-w-0 overflow-hidden p-2 max-[760px]:overflow-auto">
          @if (store.loading() && !store.state().edges.length) { <div class="p-6 text-text-muted">{{ t().mapa.cargando }}</div> }
          @else {
            <section class="tab-panel" role="tabpanel" [attr.id]="panelId('mapa')" [attr.aria-labelledby]="tabId('mapa')" [hidden]="store.view() !== 'mapa'">@if (store.view() === 'mapa') { <app-dep-map-graph /> }</section>
            <section class="tab-panel" role="tabpanel" [attr.id]="panelId('matriz')" [attr.aria-labelledby]="tabId('matriz')" [hidden]="store.view() !== 'matriz'">@if (store.view() === 'matriz') { <app-dep-map-matrix /> }</section>
            <section class="tab-panel" role="tabpanel" [attr.id]="panelId('lista')" [attr.aria-labelledby]="tabId('lista')" [hidden]="store.view() !== 'lista'">@if (store.view() === 'lista') { <app-dep-map-list /> }</section>
          }
        </main>
        <aside uiCard class="details-side details-in overflow-y-auto overflow-x-hidden" [hidden]="store.panelCollapsed()"><app-dep-map-panel direction="in" (deleteRequested)="askDelete($event)" /></aside>
      </section>

      <div class="dep-map-toolbar" [class.controls-collapsed]="fullscreen() && floatingControlsCollapsed()">
        @if (fullscreen() && floatingControlsCollapsed()) {
          <button uiButton variant="secondary" class="expand-controls" type="button" [attr.aria-label]="t().mapa.mostrarControles" [title]="t().mapa.mostrarControles" (click)="floatingControlsCollapsed.set(false)">☰</button>
        } @else {
          <div class="control-row">
            <div class="map-controls" [class.controls-hidden]="store.view() !== 'mapa'" [attr.aria-hidden]="store.view() !== 'mapa' ? 'true' : null" role="group" [attr.aria-label]="t().mapa.controlesAria">
              <button type="button" class="map-ctl" [attr.aria-label]="t().mapa.zoomOut" [disabled]="!graph?.canZoomOut()" (click)="graph?.zoomOut()">−</button>
              <span class="zoom-value" aria-hidden="true">{{ graph?.zoomPercent() ?? '100%' }}</span>
              <button type="button" class="map-ctl" [attr.aria-label]="t().mapa.zoomIn" [disabled]="!graph?.canZoomIn()" (click)="graph?.zoomIn()">+</button>
              <button type="button" class="map-ctl wide" (click)="graph?.fit()">{{ t().mapa.ajustar }}</button>
              <button type="button" class="map-ctl wide toggle" [attr.aria-pressed]="store.fullMap()" (click)="store.toggleFullMap()">{{ store.fullMap() ? t().mapa.enfocarGrupo : t().mapa.verCompleto }}</button>
            </div>
          <div class="view-tabs" role="tablist" [attr.aria-label]="t().mapa.vista">
          @for (view of views; track view.id) { <button type="button" role="tab" class="view-tab" [class.active]="store.view() === view.id" [attr.aria-selected]="store.view() === view.id" [attr.id]="tabId(view.id)" [attr.aria-controls]="panelId(view.id)" [attr.tabindex]="store.view() === view.id ? 0 : -1" (click)="activateView(view.id)" (keydown)="onTabKeydown($event, view.id)">{{ viewLabel(view.id) }}</button> }
          </div>
          <input uiInput class="toolbar-search" type="search" [value]="store.query()" [placeholder]="t().mapa.buscar" [attr.aria-label]="t().mapa.buscarAria" (input)="store.setQuery($any($event.target).value)" />
          <div class="menu-wrap filter-wrap" data-map-menu="filters">
            <button uiButton variant="secondary" size="sm" type="button" data-menu-trigger="filters" aria-controls="depmap-filter-options" [attr.aria-expanded]="openMenu() === 'filters'" (click)="toggleMenu('filters')">{{ t().mapa.filtros }} <span class="filter-count" [class.controls-hidden]="!activeFilterCount()" aria-hidden="true">{{ activeFilterCount() || 0 }}</span> <span aria-hidden="true">⌄</span></button>
            @if (openMenu() === 'filters') {
              <div class="menu-panel filter-panel" id="depmap-filter-options" role="group" [attr.aria-label]="t().mapa.filtros">
                <label class="filter-label">{{ t().mapa.estado }}<select uiSelect [value]="store.status()" (change)="store.setStatus($any($event.target).value)">@for (status of statuses; track status.id) { <option [value]="status.id">{{ statusLabel(status.id) }}</option> }</select></label>
                <div class="filter-kinds" role="group" [attr.aria-label]="t().mapa.tipo">@for (kind of kindEntries(); track kind.id) { <label class="kind-option"><input type="checkbox" [checked]="store.kindsOn().has(kind.id)" (change)="store.toggleKind(kind.id)" />{{ kind.label }}</label> }</div>
              </div>
            }
          </div>
          <button type="button" class="panel-toggle" [attr.aria-expanded]="fullscreen() ? fullscreenDetailsOpen() : !store.panelCollapsed()" aria-controls="depmap-details-panel" [attr.aria-label]="(fullscreen() ? fullscreenDetailsOpen() : !store.panelCollapsed()) ? t().mapa.contraerDetalle : t().mapa.expandirDetalle" (click)="togglePanel()">
            <svg class="panel-toggle__icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3" width="15" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 3v14" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
            {{ (fullscreen() ? fullscreenDetailsOpen() : !store.panelCollapsed()) ? t().mapa.contraerDetalle : t().mapa.expandirDetalle }}
          </button>
          <button type="button" class="fullscreen-toggle" [class.controls-hidden]="store.view() === 'lista'" [attr.aria-hidden]="store.view() === 'lista' ? 'true' : null" [disabled]="store.view() === 'lista'" [attr.aria-label]="t().mapa.pantallaCompleta" [title]="t().mapa.pantallaCompleta" (click)="enterFullscreen()">⛶</button>
          @if (fullscreen()) { <button uiButton variant="secondary" class="collapse-controls" type="button" [attr.aria-label]="t().mapa.ocultarControles" [title]="t().mapa.ocultarControles" (click)="floatingControlsCollapsed.set(true)">⌄</button> }
          </div>
        }
      </div>

      <dialog #addDialog class="dialog" aria-labelledby="add-title">
        <form (ngSubmit)="submitAdd()" class="dialog-form"><div class="dialog-head"><h2 id="add-title">{{ t().mapa.agregar }}</h2><button type="button" class="close" [attr.aria-label]="t().mapa.cerrarDialogo" (click)="close(addDialog)">×</button></div>
          <div class="dialog-body"><div class="row"><label>{{ t().mapa.quienNecesita }}<select uiSelect class="w-full" [(ngModel)]="addFrom" name="from">@for (id of groupIds(); track id) { <option [value]="id">{{ node(id).n }}</option> }</select></label><label>{{ t().mapa.deQuien }}<select uiSelect class="w-full" [(ngModel)]="addTo" name="to">@for (id of groupIds(); track id) { <option [value]="id">{{ node(id).n }}</option> }</select></label></div>
          <label>{{ t().mapa.queNecesita }}<textarea uiTextarea rows="3" [(ngModel)]="addText" name="text" [placeholder]="t().mapa.queNecesitaPlaceholder"></textarea></label>
          <div class="row"><label>{{ t().mapa.tipoDependencia }}<select uiSelect class="w-full" [(ngModel)]="addKind" name="kind">@for (kind of kindEntries(); track kind.id) { <option [value]="kind.id">{{ kind.label }}</option> }</select></label><label>{{ t().mapa.estado }}<select uiSelect class="w-full" [(ngModel)]="addState" name="state"><option value="pendiente">{{ t().mapa.opcionPendiente }}</option><option value="definir">{{ t().mapa.opcionADefinir }}</option></select></label></div>
          @if (dialogError()) { <p class="error" role="alert">{{ dialogError() }}</p> }
          </div><div class="actions"><button uiButton variant="secondary" type="button" (click)="close(addDialog)">{{ t().mapa.cancelar }}</button><button uiButton type="submit" [disabled]="busy()">{{ t().mapa.guardar }}</button></div>
        </form>
      </dialog>

      <dialog #dataDialog class="dialog data-dialog" aria-labelledby="data-title">
        <div class="dialog-form"><div class="dialog-head"><h2 id="data-title">{{ t().mapa.datosTitulo }}</h2><button type="button" class="close" [attr.aria-label]="t().mapa.cerrarDialogo" (click)="close(dataDialog)">×</button></div>
          <div class="dialog-body"><p class="meta">{{ dataMeta() }}</p><p class="meta">{{ t().mapa.datosAyuda }}</p><textarea uiTextarea class="json" spellcheck="false" [(ngModel)]="jsonDataValue" name="json"></textarea>
          @if (dialogError()) { <p class="error" role="alert">{{ dialogError() }}</p> }
          </div><div class="actions"><button uiButton variant="secondary" type="button" (click)="copyData()">{{ t().mapa.copiar }}</button>@if (isAdmin()) { <button uiButton variant="secondary" type="button" (click)="askReset()" [disabled]="busy() || !store.online()">{{ t().mapa.restaurar }}</button><button uiButton type="button" (click)="applyData()" [disabled]="busy() || !store.online()">{{ t().mapa.aplicar }}</button> }<button uiButton variant="secondary" type="button" (click)="close(dataDialog)">{{ t().mapa.cerrar }}</button></div>
        </div>
      </dialog>

      <dialog #confirmDialog class="dialog narrow" aria-labelledby="confirm-title"><div class="dialog-form"><h2 id="confirm-title">{{ t().mapa.confirmar }}</h2><p class="meta">{{ confirmMessage() }}</p><div class="actions"><button uiButton variant="secondary" type="button" (click)="close(confirmDialog)">{{ t().mapa.cancelar }}</button><button uiButton variant="danger" type="button" [disabled]="busy() || !store.online()" (click)="confirmAction()">{{ t().mapa.confirmarAccion }}</button></div></div></dialog>
      @if (toast()) { <div class="toast" role="status" aria-live="polite">{{ toast() }}</div> }
    </div>
  `,
  styleUrls: ['./dep-map-layout.css', './dep-map-overlays.css'],
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
  readonly fullscreen = signal(false);
  readonly fullscreenDetailsOpen = signal(false);
  readonly floatingControlsCollapsed = signal(false);
  readonly openMenu = signal<'more' | 'filters' | null>(null);
  readonly activeFilterCount = computed(() => Number(this.store.status() !== 'todos') + Number(this.kindEntries().length > 0 && this.store.kindsOn().size !== this.kindEntries().length));
  readonly selectedGroupId = computed(() => this.store.pair()?.[0] || this.store.node() || this.store.mine());
  readonly selectedGroupName = computed(() => this.store.state().nodes[this.selectedGroupId()]?.n || this.selectedGroupId());
  private bodyOverflowBeforeFullscreen: string | null = null;
  private documentOverflowBeforeFullscreen: string | null = null;
  private fullscreenScrollY = 0;
  jsonDataValue = '';
  readonly confirmMessage = signal('');
  readonly confirmKind = signal<'delete' | 'reset' | null>(null);
  readonly pendingDelete = signal<DepMapEdge | null>(null);
  addFrom = ''; addTo = ''; addKind = ''; addState: 'pendiente' | 'definir' = 'pendiente'; addText = '';
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly dialogOpeners = new WeakMap<HTMLDialogElement, HTMLElement>();
  private scheduleLayoutUpdate: (() => void) | null = null;
  @ViewChild('addDialog') addDialog!: DialogRef;
  @ViewChild('dataDialog') dataDialog!: DialogRef;
  @ViewChild('confirmDialog') confirmDialog!: DialogRef;
  @ViewChild(DepMapGraph) graph?: DepMapGraph;

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
      this.scheduleLayoutUpdate = updateLayout;
      updateLayout();
      window.addEventListener('resize', updateLayout);
      const closeMenusOutside = (event: PointerEvent) => {
        if (this.openMenu() && event.target instanceof Node && !this.host.nativeElement.querySelector(`[data-map-menu="${this.openMenu()}"]`)?.contains(event.target)) {
          this.openMenu.set(null);
        }
      };
      document.addEventListener('pointerdown', closeMenusOutside);
      const keepFullscreenKeyboardInside = (event: KeyboardEvent) => {
        if (!this.fullscreen() || this.host.nativeElement.contains(event.target as Node)) return;
        if (event.key === 'Escape') { event.preventDefault(); this.exitFullscreen(); }
        else if (event.key === 'Tab') { event.preventDefault(); (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('.fullscreen-exit')?.focus(); }
      };
      const syncNativeFullscreen = () => {
        if (document.fullscreenElement !== this.host.nativeElement && this.fullscreen()) this.exitFullscreen(false, false);
      };
      document.addEventListener('keydown', keepFullscreenKeyboardInside, true);
      document.addEventListener('fullscreenchange', syncNativeFullscreen);

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
        const card = this.host.nativeElement.querySelector('.workspace-card');
        if (card) observer.observe(card);
        const legend = this.host.nativeElement.querySelector('app-dep-map-graph .legend') as HTMLElement | null;
        if (legend) observer.observe(legend);
      }
      mutations?.observe(this.host.nativeElement, { childList: true, subtree: true, characterData: true });
      this.destroyRef.onDestroy(() => {
        if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
        if (stabilizationFrame !== null) cancelAnimationFrame(stabilizationFrame);
        window.removeEventListener('resize', updateLayout);
        document.removeEventListener('pointerdown', closeMenusOutside);
        document.removeEventListener('keydown', keepFullscreenKeyboardInside, true);
        document.removeEventListener('fullscreenchange', syncNativeFullscreen);
        observer?.disconnect();
        mutations?.disconnect();
        this.restoreDocumentScroll();
        this.scheduleLayoutUpdate = null;
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
    const desktop = window.matchMedia('(min-width:1021px)').matches;
    // Keep the map and the sticky controls within the route's available viewport.
    const fitHeight = desktop;
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
  viewLabel(id: 'mapa' | 'matriz' | 'lista'): string { return id === 'mapa' ? this.t().mapa.pestañaMapa : id === 'matriz' ? this.t().mapa.pestañaMatriz : this.t().mapa.pestañaLista; }
  statusLabel(id: 'todos' | 'pendiente' | 'definir' | 'hecho'): string { return id === 'todos' ? this.t().mapa.todosEstados : id === 'pendiente' ? this.t().mapa.estadoPendiente : id === 'definir' ? this.t().mapa.estadoADefinir : this.t().mapa.estadoHecho; }
  kindLabel(id: string, fallback = id): string {
    const m = this.t().mapa;
    return id === 'api' ? m.tipoApi : id === 'evento' ? m.tipoEvento : id === 'dato' ? m.tipoDatos : id === 'permiso' ? m.tipoPermiso : id === 'ui' ? m.tipoComponente : fallback;
  }
  tabId(id: string): string { return `depmap-tab-${id}`; }
  panelId(id: string): string { return `depmap-panel-${id}`; }
  activateView(id: 'mapa' | 'matriz' | 'lista'): void { if (id === 'lista' && this.fullscreen()) this.exitFullscreen(false); this.store.setView(id); }
  togglePanel(): void {
    if (this.fullscreen()) this.fullscreenDetailsOpen.update((open) => !open);
    else { this.store.togglePanel(); this.scheduleLayoutUpdate?.(); }
  }
  toggleMenu(menu: 'more' | 'filters'): void { this.openMenu.update((current) => current === menu ? null : menu); }
  enterFullscreen(): void {
    if (this.store.view() === 'lista' || this.fullscreen()) return;
    this.fullscreenScrollY = window.scrollY;
    this.bodyOverflowBeforeFullscreen = document.body.style.overflow;
    this.documentOverflowBeforeFullscreen = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    this.floatingControlsCollapsed.set(false);
    this.fullscreenDetailsOpen.set(false);
    this.fullscreen.set(true);
    const root = this.host.nativeElement as HTMLElement;
    if (typeof root.requestFullscreen === 'function') void root.requestFullscreen().catch(() => undefined);
    this.scheduleLayoutUpdate?.();
    queueMicrotask(() => (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('.fullscreen-exit')?.focus());
  }
  exitFullscreen(restoreFocus = true, exitNative = true): void {
    if (!this.fullscreen()) return;
    this.fullscreen.set(false);
    if (exitNative && document.fullscreenElement === this.host.nativeElement) void document.exitFullscreen().catch(() => undefined);
    this.fullscreenDetailsOpen.set(false);
    this.restoreDocumentScroll();
    this.scheduleLayoutUpdate?.();
    if (restoreFocus) queueMicrotask(() => (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('.fullscreen-toggle')?.focus());
  }
  private restoreDocumentScroll(): void {
    if (this.bodyOverflowBeforeFullscreen === null) return;
    document.body.style.overflow = this.bodyOverflowBeforeFullscreen;
    document.documentElement.style.overflow = this.documentOverflowBeforeFullscreen ?? '';
    this.bodyOverflowBeforeFullscreen = null;
    this.documentOverflowBeforeFullscreen = null;
    if (window.scrollY !== this.fullscreenScrollY) window.scrollTo(0, this.fullscreenScrollY);
  }
  openDataFromMenu(): void {
    const opener = (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-menu-trigger="more"]');
    this.openMenu.set(null);
    this.openData(opener ?? undefined);
  }
  onTabKeydown(event: KeyboardEvent, current: 'mapa' | 'matriz' | 'lista'): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = this.views.findIndex((view) => view.id === current);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? this.views.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + this.views.length) % this.views.length;
    this.activateView(this.views[next].id);
    queueMicrotask(() => (this.host.nativeElement.querySelector(`#${this.tabId(this.views[next].id)}`) as HTMLButtonElement | null)?.focus());
  }
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Tab' && this.fullscreen()) {
      const root = this.host.nativeElement as HTMLElement;
      const detailsVisible = root.querySelector('.workspace')?.classList.contains('detail-open') ?? false;
      const focusable = [...root.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.closest('[hidden]')
          && !(this.fullscreen() && element.closest('.module-header,.banner,.error-banner'))
          && !(this.fullscreen() && element.closest('.details-side') && !detailsVisible)
          && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden');
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (!first || !last) { event.preventDefault(); root.focus(); return; }
      if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last) || !root.contains(document.activeElement)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
      return;
    }
    if (event.key !== 'Escape') return;
    const target = event.target as HTMLElement;
    if (target.closest('dialog[open]')) return;
    if (this.openMenu()) {
      const menu = this.openMenu();
      this.openMenu.set(null);
      (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>(`[data-menu-trigger="${menu}"]`)?.focus();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (this.fullscreen()) {
      event.preventDefault();
      event.stopPropagation();
      this.exitFullscreen();
      return;
    }
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable || !!target.closest('[contenteditable]')) return;
    if (this.store.pair()) { event.preventDefault(); this.store.clearPair(); return; }
    if (this.store.node() && this.store.node() !== this.store.mine()) { event.preventDefault(); this.store.selectNode(this.store.mine()); }
  }

  openAdd(from?: string): void {
    const groups = this.groupIds(); if (!groups.length) return;
    this.dialogOpeners.set(this.addDialog.nativeElement, document.activeElement as HTMLElement);
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
  openData(opener: HTMLElement = document.activeElement as HTMLElement): void { const state = this.store.state(); this.dialogOpeners.set(this.dataDialog.nativeElement, opener); this.jsonDataValue = JSON.stringify({ edges: state.edges, done: state.done }, null, 1); this.dialogError.set(''); this.dataDialog.nativeElement.showModal(); }
  dataMeta(): string { const state = this.store.state(); return `Estado compartido: versión ${state.version}${state.updatedBy ? ` · último cambio de ${state.updatedBy}` : ''} · ${state.edges.length} dependencias, ${Object.keys(state.done).length} hechas.`; }
  async copyData(): Promise<void> { try { await navigator.clipboard.writeText(this.jsonDataValue); this.showToast('Copiado'); } catch { this.showToast('Seleccioná y copiá a mano'); } }
  async applyData(): Promise<void> {
    try { const parsed = JSON.parse(this.jsonDataValue) as { edges: DepMapEdge[]; done?: Record<string, boolean> }; this.busy.set(true); await this.store.importData({ edges: parsed.edges, done: parsed.done || {} }); this.close(this.dataDialog.nativeElement); this.showToast('Datos aplicados para todos'); }
    catch (error) { this.dialogError.set(error instanceof Error ? error.message : 'JSON inválido.'); } finally { this.busy.set(false); }
  }
  askReset(): void { this.dialogOpeners.set(this.confirmDialog.nativeElement, document.activeElement as HTMLElement); this.confirmKind.set('reset'); this.confirmMessage.set('Se vuelve a los datos de la reunión y se pierden todos los cambios hechos por el equipo.'); this.confirmDialog.nativeElement.showModal(); }
  askDelete(edge: DepMapEdge): void { this.dialogOpeners.set(this.confirmDialog.nativeElement, document.activeElement as HTMLElement); this.pendingDelete.set(edge); this.confirmKind.set('delete'); this.confirmMessage.set(`Se elimina para todos los que están viendo el mapa: «${edge.text}»`); this.confirmDialog.nativeElement.showModal(); }
  async confirmAction(): Promise<void> {
    this.busy.set(true); try { if (this.confirmKind() === 'delete' && this.pendingDelete()) { await this.store.deleteEdge(this.pendingDelete()!.id); this.showToast('Dependencia eliminada'); } else if (this.confirmKind() === 'reset') { await this.store.reset(); this.close(this.dataDialog.nativeElement); this.showToast('Datos originales restaurados'); } this.close(this.confirmDialog.nativeElement); } catch (error) { this.dialogError.set(error instanceof Error ? error.message : 'No se pudo completar la acción.'); } finally { this.busy.set(false); }
  }
  close(dialog: HTMLDialogElement): void { const opener = this.dialogOpeners.get(dialog); this.dialogOpeners.delete(dialog); dialog.close(); this.dialogError.set(''); queueMicrotask(() => opener?.focus()); }
  private showToast(message: string): void { this.toast.set(message); if (this.toastTimer) clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => this.toast.set(''), 2_200); }
}

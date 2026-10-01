import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
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

@Component({
  selector: 'app-dep-map',
  imports: [FormsModule, ...UI, DepMapGraph, DepMapMatrix, DepMapList, DepMapPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dep-map">
      <header class="header">
        <div><h1>{{ t().mapa.titulo }}</h1><p>{{ t().mapa.subtitulo }}</p></div>
        <div class="controls">
          <span class="live" [class.on]="store.online() && store.sseOpen()" [class.warn]="store.online() && !store.sseOpen()" [class.off]="!store.online()" role="status" aria-live="polite">
            <span class="dot"></span><span>{{ liveText() }}</span>
          </span>
          <label class="field">{{ t().mapa.miGrupo }}<select uiSelect class="mine" [value]="store.mine()" (change)="store.setMine($any($event.target).value)">@for (id of groupIds(); track id) { <option [value]="id">{{ node(id).n }}</option> }</select></label>
          <button uiButton variant="secondary" type="button" (click)="openData()">{{ t().mapa.datos }}</button>
          <button uiButton type="button" (click)="openAdd()" [disabled]="!store.online()">{{ t().mapa.agregar }}</button>
        </div>
      </header>

      @if (store.offline()) {
        <div class="banner" role="status"><span><strong>{{ t().mapa.sinConexion }}</strong> {{ t().mapa.sinConexionDetalle }}</span><button uiButton variant="secondary" size="sm" type="button" (click)="store.retry()">{{ t().mapa.reintentar }}</button></div>
      }

      <div class="bar">
        <div class="tabs" role="tablist" [attr.aria-label]="t().mapa.vista">
          @for (view of views; track view.id) { <button type="button" role="tab" [attr.aria-selected]="store.view() === view.id" (click)="store.setView(view.id)">{{ view.label }}</button> }
        </div>
        <input uiInput type="search" [value]="store.query()" [placeholder]="t().mapa.buscar" [attr.aria-label]="t().mapa.buscarAria" (input)="store.setQuery($any($event.target).value)" />
        <select uiSelect [value]="store.status()" [attr.aria-label]="t().mapa.estado" (change)="store.setStatus($any($event.target).value)">
          @for (status of statuses; track status.id) { <option [value]="status.id">{{ status.label }}</option> }
        </select>
        <div class="chips" [attr.aria-label]="t().mapa.tipo">@for (kind of kindEntries(); track kind.id) { <button type="button" class="chipbtn" [attr.aria-pressed]="store.kindsOn().has(kind.id)" (click)="store.toggleKind(kind.id)">{{ kind.label }}</button> }</div>
      </div>

      <div class="shell">
        <main uiCard class="stage">
          @if (store.loading() && !store.state().edges.length) { <div class="empty">{{ t().mapa.cargando }}</div> }
          @else { @switch (store.view()) { @case ('mapa') { <app-dep-map-graph /> } @case ('matriz') { <app-dep-map-matrix /> } @default { <app-dep-map-list /> } } }
        </main>
        <aside uiCard class="panel"><app-dep-map-panel (addRequested)="openAdd($event)" (deleteRequested)="askDelete($event)" /></aside>
      </div>

      <dialog #addDialog class="dialog" aria-labelledby="add-title">
        <form (ngSubmit)="submitAdd()" class="dialog-form"><div class="dialog-head"><h2 id="add-title">{{ t().mapa.agregar }}</h2><button type="button" class="close" aria-label="Cerrar" (click)="close(addDialog)">×</button></div>
          <div class="row"><label>{{ t().mapa.quienNecesita }}<select uiSelect class="w-full" [(ngModel)]="addFrom" name="from">@for (id of groupIds(); track id) { <option [value]="id">{{ node(id).n }}</option> }</select></label><label>{{ t().mapa.deQuien }}<select uiSelect class="w-full" [(ngModel)]="addTo" name="to">@for (id of groupIds(); track id) { <option [value]="id">{{ node(id).n }}</option> }</select></label></div>
          <label>{{ t().mapa.queNecesita }}<textarea uiTextarea rows="3" [(ngModel)]="addText" name="text" [placeholder]="t().mapa.queNecesitaPlaceholder"></textarea></label>
          <div class="row"><label>{{ t().mapa.tipoDependencia }}<select uiSelect class="w-full" [(ngModel)]="addKind" name="kind">@for (kind of kindEntries(); track kind.id) { <option [value]="kind.id">{{ kind.label }}</option> }</select></label><label>{{ t().mapa.estado }}<select uiSelect class="w-full" [(ngModel)]="addState" name="state"><option value="pendiente">Pendiente</option><option value="definir">A definir</option></select></label></div>
          @if (dialogError()) { <p class="error" role="alert">{{ dialogError() }}</p> }
          <div class="actions"><button uiButton variant="secondary" type="button" (click)="close(addDialog)">{{ t().mapa.cancelar }}</button><button uiButton type="submit" [disabled]="busy()">{{ t().mapa.guardar }}</button></div>
        </form>
      </dialog>

      <dialog #dataDialog class="dialog data-dialog" aria-labelledby="data-title">
        <div class="dialog-form"><div class="dialog-head"><h2 id="data-title">{{ t().mapa.datosTitulo }}</h2><button type="button" class="close" aria-label="Cerrar" (click)="close(dataDialog)">×</button></div>
          <p class="meta">{{ dataMeta() }}</p><p class="meta">{{ t().mapa.datosAyuda }}</p><textarea uiTextarea class="json" spellcheck="false" [(ngModel)]="jsonDataValue" name="json"></textarea>
          @if (dialogError()) { <p class="error" role="alert">{{ dialogError() }}</p> }
          <div class="actions"><button uiButton variant="secondary" type="button" (click)="copyData()">{{ t().mapa.copiar }}</button>@if (isAdmin()) { <button uiButton variant="secondary" type="button" (click)="askReset()">{{ t().mapa.restaurar }}</button><button uiButton type="button" (click)="applyData()" [disabled]="busy()">{{ t().mapa.aplicar }}</button> }<button uiButton variant="secondary" type="button" (click)="close(dataDialog)">{{ t().mapa.cerrar }}</button></div>
        </div>
      </dialog>

      <dialog #confirmDialog class="dialog narrow" aria-labelledby="confirm-title"><div class="dialog-form"><h2 id="confirm-title">{{ t().mapa.confirmar }}</h2><p class="meta">{{ confirmMessage() }}</p><div class="actions"><button uiButton variant="secondary" type="button" (click)="close(confirmDialog)">{{ t().mapa.cancelar }}</button><button uiButton variant="danger" type="button" [disabled]="busy()" (click)="confirmAction()">{{ t().mapa.confirmarAccion }}</button></div></div></dialog>
      @if (toast()) { <div class="toast" role="status" aria-live="polite">{{ toast() }}</div> }
    </div>
  `,
  styles: `
    :host { --dep-out:#1f5fe0; --dep-in:#b8490a; display:block; } @media (prefers-color-scheme:dark) { :host { --dep-out:#6fa0ff; --dep-in:#ff9a52; } } :host-context([data-theme=dark]) { --dep-out:#6fa0ff; --dep-in:#ff9a52; }
    .dep-map { color:var(--text); } .header { padding:0 0 10px; display:flex; flex-wrap:wrap; gap:16px 24px; align-items:flex-end; justify-content:space-between; }
    h1 { font-size:26px; line-height:1.1; margin:0; letter-spacing:-.01em; } .header p { margin:4px 0 0; color:var(--text-muted); max-width:64ch; }
    .controls { display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; } .field { display:flex; flex-direction:column; gap:3px; font-size:12px; color:var(--text-muted); } .mine { min-width:150px; }
    .live { display:inline-flex; align-items:center; gap:7px; min-height:36px; padding:7px 12px; border-radius:999px; border:1px solid var(--border); background:var(--surface); color:var(--text-muted); font-size:12.5px; box-shadow:var(--shadow-sm); }
    .live .dot { width:8px; height:8px; border-radius:50%; background:var(--text-muted); flex:none; } .live.on { color:var(--text); border-color:color-mix(in srgb,var(--success) 45%,var(--border)); } .live.on .dot { background:var(--success); }
    .live.warn .dot { background:var(--warning); } .live.off { color:var(--dep-in); border-color:color-mix(in srgb,var(--dep-in) 45%,var(--border)); } .live.off .dot { background:var(--dep-in); }
    .banner { margin:0 0 10px; padding:10px 14px; border:1px solid color-mix(in srgb,var(--dep-in) 40%,var(--border)); border-radius:10px; background:color-mix(in srgb,var(--dep-in) 8%,var(--surface)); display:flex; align-items:center; gap:10px; font-size:13px; } .banner span { flex:1; } .banner strong { color:var(--dep-in); }
    .bar { padding:2px 0 12px; display:flex; flex-wrap:wrap; gap:10px 14px; align-items:center; } .tabs { display:inline-flex; background:var(--surface-2); border:1px solid var(--border); border-radius:10px; padding:3px; } .tabs button { border:0; background:transparent; padding:6px 14px; border-radius:7px; color:var(--text-muted); font-weight:500; cursor:pointer; } .tabs button[aria-selected=true] { background:var(--surface); color:var(--text); box-shadow:var(--shadow-sm); }
    .bar input[type=search] { max-width:240px; } .chips { display:flex; flex-wrap:wrap; gap:6px; } .chipbtn { border:1px solid var(--border); background:var(--surface); border-radius:999px; padding:3px 11px; font-size:12.5px; color:var(--text-muted); cursor:pointer; } .chipbtn[aria-pressed=true] { color:var(--text); border-color:var(--text); }
    .shell { display:grid; grid-template-columns:minmax(0,1fr) 420px; gap:16px; align-items:start; } .stage { padding:8px; overflow:hidden; min-width:0; } .panel { position:sticky; top:12px; max-height:calc(100vh - 24px); overflow:auto; }
    .empty { color:var(--text-muted); padding:24px; } .dialog { margin:auto; width:min(560px,calc(100% - 2rem)); max-height:90vh; overflow:auto; border:1px solid var(--border); border-radius:var(--radius-lg); padding:0; background:var(--surface); color:var(--text); box-shadow:var(--shadow-lg); } .dialog::backdrop { background:rgba(10,15,22,.55); }
    .dialog.narrow { width:min(440px,calc(100% - 2rem)); } .dialog-form { padding:20px; } .dialog-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; } .dialog h2 { font-size:20px; margin:0 0 12px; } .dialog label { display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--text-muted); margin-bottom:10px; } .dialog textarea { width:100%; resize:vertical; } .dialog .row { display:grid; grid-template-columns:1fr 1fr; gap:10px; } .dialog .json { min-height:260px; font-family:ui-monospace,Menlo,monospace; font-size:12px; } .close { border:0; background:transparent; font-size:24px; color:var(--text-muted); cursor:pointer; } .actions { display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; margin-top:6px; border-top:1px solid var(--border); padding-top:14px; } .meta { color:var(--text-muted); font-size:12.5px; margin:0 0 10px; } .error { color:var(--danger); font-size:13px; min-height:18px; }
    .toast { position:fixed; left:50%; bottom:20px; transform:translateX(-50%); background:var(--text); color:var(--bg); padding:8px 14px; border-radius:8px; font-size:13px; z-index:20; max-width:min(560px,90vw); text-align:center; }
    @media (max-width:1020px) { .shell { grid-template-columns:1fr; } .panel { position:static; max-height:none; } } @media (max-width:760px) { .stage { overflow:auto; } } @media (max-width:560px) { h1 { font-size:22px; } .dialog .row { grid-template-columns:1fr; } }
    @media (prefers-reduced-motion:reduce) { * { transition:none !important; animation:none !important; } }
  `,
})
export class DepMap {
  readonly store = inject(DepMapStore);
  private readonly i18n = inject(I18n);
  private readonly auth = inject(AuthService);
  readonly t = this.i18n.t;
  readonly isAdmin = computed(() => this.auth.user()?.role === 'admin');
  readonly busy = signal(false);
  readonly dialogError = signal('');
  readonly toast = signal('');
  jsonDataValue = '';
  readonly confirmMessage = signal('');
  readonly confirmKind = signal<'delete' | 'reset' | null>(null);
  readonly pendingDelete = signal<DepMapEdge | null>(null);
  addFrom = ''; addTo = ''; addKind = ''; addState: 'pendiente' | 'definir' = 'pendiente'; addText = '';
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  @ViewChild('addDialog') addDialog!: DialogRef;
  @ViewChild('dataDialog') dataDialog!: DialogRef;
  @ViewChild('confirmDialog') confirmDialog!: DialogRef;

  readonly views = [
    { id: 'mapa' as const, label: 'Mapa' }, { id: 'matriz' as const, label: 'Matriz' }, { id: 'lista' as const, label: 'Lista' },
  ];
  readonly statuses = [
    { id: 'todos', label: 'Todos los estados' }, { id: 'pendiente', label: 'Pendiente' }, { id: 'definir', label: 'A definir' }, { id: 'hecho', label: 'Hecho' },
  ] as const;
  readonly groupIds = computed(() => Object.keys(this.store.state().nodes).filter((id) => !this.store.state().nodes[id].transv));
  readonly kindEntries = computed(() => Object.entries(this.store.state().kinds).map(([id, label]) => ({ id, label })));
  node(id: string) { return this.store.state().nodes[id]; }
  liveText(): string { const presence = this.store.state().presence.length; return this.store.online() && this.store.sseOpen() ? (presence > 1 ? `En vivo · ${presence} en línea` : 'En vivo') : this.store.online() ? 'Reconectando…' : 'Sin conexión'; }

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

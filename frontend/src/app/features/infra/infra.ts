import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { InfraLogsApi } from './infra-logs.api';
import { InfraLogs } from './infra-logs';
import { InfraMap } from './infra-map';
import { firstValueFrom } from 'rxjs';
import { InfraService, type InfraAvailability, type InfraStateName, type InfraStateView } from '../../core/infra';
import { I18n } from '../../core/i18n/i18n';
import { UI } from '../../shared/ui';

type InfraTab = 'state' | 'map' | 'logs';

const SEVERITY: Record<InfraStateName, number> = { DOWN: 0, DEGRADED: 1, NO_ACCESS: 2, UNKNOWN: 3, UP: 4 };

/**
 * Pantalla /infra: lista esperada de microservicios + gateway, resumen, estado,
 * disponibilidad 24 h/7 d, uptime, última conexión sana y frescura de la fuente.
 * No muestra enlaces de diagnóstico, IPs, dominios del tailnet ni columnas de VIP
 * del registro. Sin datos en vivo inventados: si el monitoreo está deshabilitado
 * o no hay historia, se dice explícitamente.
 */
@Component({
  selector: 'app-infra',
  imports: [...UI, InfraLogs, InfraMap],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="-my-8 flex flex-col gap-4" [style.height]="fillHeight() ? 'calc(100dvh - 4.75rem)' : null" [style.min-height]="fillHeight() ? '30rem' : null">
      <div class="flex flex-none flex-wrap items-center gap-x-4 border-b border-border">
        <div class="flex min-w-0 items-center gap-2 py-2.5">
          <h1 class="text-xl font-semibold tracking-tight">{{ t().infra.titulo }}</h1>
          <span class="inline-grid h-5 w-5 cursor-help place-items-center rounded-full border border-border-strong text-[11px] text-text-muted"
            role="img" tabindex="0" [attr.aria-label]="t().infra.subtitulo" [attr.title]="t().infra.subtitulo">i</span>
        </div>
        <div class="ml-auto flex items-stretch gap-2 self-stretch">
          @if (activeTab() !== 'logs') {
            <button type="button" uiButton variant="ghost" size="sm" class="self-center !h-8 !w-8 !px-0" (click)="load()" [disabled]="loading()"
              [attr.aria-label]="t().infra.actualizar" [attr.aria-describedby]="state()?.source?.lastCheckAt ? 'infra-refresh-age' : null"
              [attr.title]="refreshTitle()">
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
                [class]="loading() ? 'motion-safe:animate-spin' : ''"><path d="M16.5 10a6.5 6.5 0 1 1-2-4.7" /><path d="M16.5 3.5v3.6h-3.6" /></svg>
              @if (state()?.source?.lastCheckAt; as last) {
                <time id="infra-refresh-age" class="sr-only" [attr.datetime]="last">{{ t().infra.actualizado }} {{ relative(last) }}</time>
              }
            </button>
          }
          <div role="tablist" [attr.aria-label]="t().infra.logs.tabs" class="flex items-stretch">
            @for (tab of tabs(); track tab) {
              <button type="button" role="tab" [id]="'infra-tab-' + tab"
                [attr.aria-controls]="'infra-panel-' + tab" [attr.aria-selected]="activeTab() === tab"
                class="relative cursor-pointer border-0 bg-transparent px-3.5 text-sm transition-colors after:absolute after:inset-x-3.5 after:-bottom-px after:h-0.5 after:rounded-full after:content-[''] focus-visible:outline-none focus-visible:shadow-[var(--ring)]"
                [class]="activeTab() === tab ? 'font-semibold text-text after:bg-accent' : 'text-text-muted after:bg-transparent hover:text-text hover:after:bg-border'"
                [attr.tabindex]="activeTab() === tab ? 0 : -1" (click)="activeTab.set(tab)"
                (keydown)="onTabKeydown($event)">
                {{ tabLabel(tab) }}
              </button>
            }
          </div>
        </div>
      </div>

      @if (activeTab() === 'logs' && logsEnabled()) {
        <section id="infra-panel-logs" role="tabpanel" aria-labelledby="infra-tab-logs" class="flex min-h-0 min-w-0 flex-1 flex-col">
          <app-infra-logs (disabled)="hideLogs()" />
        </section>
      } @else if (activeTab() === 'map') {
        <section id="infra-panel-map" role="tabpanel" aria-labelledby="infra-tab-map" class="flex min-h-0 min-w-0 flex-1 flex-col">
          @if (loading()) {
            <div class="h-64 animate-pulse rounded-[var(--radius-lg)] border border-border bg-surface-2" aria-label="{{ t().infra.cargando }}"></div>
          } @else if (error() || !state()) {
            <ui-empty-state [title]="t().infra.error" />
          } @else if (state(); as s) {
            <app-infra-map [services]="s.services" />
          }
        </section>
      } @else {
        <div id="infra-panel-state" role="tabpanel" aria-labelledby="infra-tab-state" class="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      @if (loading()) {
        <div class="h-64 skeleton-shimmer rounded-[var(--radius-lg)] border border-border bg-surface-2" aria-label="{{ t().infra.cargando }}"></div>
      } @else if (error() || !state()) {
        <ui-empty-state [title]="t().infra.error" />
      } @else if (state(); as s) {
        <section uiCard class="flex min-h-0 flex-1 flex-col">
          <div class="flex flex-none flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-6 py-2.5 text-xs text-text-muted max-[700px]:px-3" aria-label="{{ t().infra.resumen }}">
            <span class="font-semibold text-text">{{ t().infra.resumen }}</span>
            <div class="flex flex-wrap gap-1.5">
              <span class="inline-flex min-h-[1.875rem] items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3">{{ t().infra.total }} <strong class="font-mono text-text">{{ s.summary.total }}</strong></span>
              @for (chip of chips(); track chip.key) {
                <button type="button" class="inline-flex min-h-[1.875rem] cursor-pointer items-center gap-1.5 rounded-full border bg-surface-2 px-3 text-xs hover:border-accent disabled:cursor-default disabled:opacity-60 disabled:hover:border-border"
                  [class]="stateFilter() === chip.key ? 'border-accent bg-accent-soft text-accent' : 'border-border'"
                  [attr.aria-pressed]="stateFilter() === chip.key" [disabled]="chip.count === 0 && stateFilter() !== chip.key" (click)="toggleStateFilter(chip.key)">
                  <i class="inline-block h-2 w-2 rounded-full" [class]="chip.dot" aria-hidden="true"></i><strong [class]="countClass(chip.count, chip.tone)">{{ chip.label }}</strong> <span class="font-mono">{{ chip.count }}</span>
                </button>
              }
            </div>
          </div>

          @if (!s.enabled) {
            <div class="flex flex-none flex-wrap items-center gap-x-3 border-b border-border bg-warning-soft px-6 py-2 text-[13px] text-warning max-[700px]:px-3" role="status"><strong>{{ t().infra.deshabilitadoTitulo }}</strong><span>· {{ t().infra.deshabilitadoTexto }}</span></div>
          }
          @if (attention().length) {
            <div class="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-warning-soft px-6 py-2 text-[13px] text-warning max-[700px]:px-3" role="status">
              <strong>{{ t().infra.atencionTitulo }} ({{ attention().length }}):</strong>
              @for (svc of attention(); track svc.name) {
                <span>{{ svc.displayName }} · {{ stateLabel(svc.state) }}@if (svc.reason) { — {{ svc.reason }} }</span>
              }
            </div>
          }

          <div class="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
            <table class="w-full min-w-[720px] text-left text-sm">
              <thead class="sticky top-0 z-10 bg-surface-2 text-[11px] uppercase tracking-[.04em] text-text-muted">
                <tr class="h-[1.875rem] border-b border-border">
                  <th scope="col" class="px-3 pl-6 font-normal">{{ t().infra.colServicio }}</th>
                  <th scope="col" class="px-3 font-normal">{{ t().infra.colEstado }}</th>
                  <th scope="col" class="px-3 font-normal">{{ t().infra.colDisponibilidad }}</th>
                  <th scope="col" class="px-3 font-normal">{{ t().infra.colUptime }}</th>
                  <th scope="col" class="px-3 pr-6 font-normal">{{ t().infra.colUltimaConexion }}</th>
                </tr>
              </thead>
              <tbody>
                @for (svc of visibleServices(); track svc.name) {
                  <tr class="h-12 border-b border-border hover:bg-surface-2/40">
                    <td class="max-w-0 truncate px-3 pl-6">
                      <span class="font-mono text-[13px] text-text">{{ svc.displayName }}</span>
                      <span class="ml-2 text-[11px] text-text-faint">
                        @if (svc.instances !== 1) { {{ t().infra.colInstancias }} {{ svc.instances }} · }
                        @if (svc.reason) { {{ t().infra.motivo }}: {{ svc.reason }} · }
                        @if (svc.coverage && svc.coverage !== 'full') { {{ t().infra.colCobertura }}: {{ coverageLabel(svc.coverage) }} }
                      </span>
                    </td>
                    <td class="px-3"><span uiBadge [tone]="stateTone(svc.state)">{{ stateLabel(svc.state) }}</span></td>
                    <td class="px-3" [attr.title]="t().infra.disponibilidadHint">
                      @let p24 = percent(svc.availability24h);
                      @let p7 = percent(svc.availability7d);
                      @if (p24 === null && p7 === null) {
                        <span class="text-xs text-text-faint">{{ t().infra.sinDato }}</span>
                      } @else {
                      <div class="flex items-center gap-4 text-xs">
                        <span class="flex items-center gap-2"><span class="text-text-muted">{{ t().infra.ventana24 }}</span>
                          @if (p24 !== null) {
                            <span class="h-1.5 w-14 overflow-hidden rounded-full bg-surface-2" aria-hidden="true"><span class="block h-full rounded-full" [class]="barClass(p24)" [style.width.%]="p24"></span></span>
                            <span class="font-mono text-text">{{ p24 }}%</span>
                          } @else { <span class="text-text-faint">{{ t().infra.sinDato }}</span> }
                        </span>
                        <span class="flex items-center gap-2"><span class="text-text-muted">{{ t().infra.ventana7 }}</span>
                          @if (p7 !== null) {
                            <span class="h-1.5 w-14 overflow-hidden rounded-full bg-surface-2" aria-hidden="true"><span class="block h-full rounded-full" [class]="barClass(p7)" [style.width.%]="p7"></span></span>
                            <span class="font-mono text-text">{{ p7 }}%</span>
                          } @else { <span class="text-text-faint">{{ t().infra.sinDato }}</span> }
                        </span>
                      </div>
                      }
                    </td>
                    <td class="px-3 font-mono text-xs text-text-muted">{{ uptimeLabel(svc.uptimeSeconds) }}</td>
                    <td class="px-3 pr-6 text-xs text-text-muted">
                      @if (svc.lastHealthyAt) {
                        <time [attr.datetime]="svc.lastHealthyAt" [attr.title]="absolute(svc.lastHealthyAt)">{{ relative(svc.lastHealthyAt) }}</time>
                      } @else {
                        <span class="text-text-faint">{{ t().infra.nunca }}</span>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr class="h-12"><td colspan="5" class="px-6 text-xs text-text-muted">{{ t().infra.sinServicios }}</td></tr>
                }
              </tbody>
            </table>
          </div>
          <div class="flex flex-none flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-surface px-6 py-1.5 text-[11px] text-text-muted max-[700px]:px-3">
            <p>{{ t().infra.registro }}: <span [class]="s.source.registryConfigured ? 'text-text' : 'text-text-faint'">{{ s.source.registryConfigured ? t().infra.configurado : t().infra.noConfigurado }}</span></p>
            <p>{{ t().infra.nodosTitulo }}: {{ nodesLabel(s) }}</p>
          </div>
        </section>
      }
        </div>
      }
    </div>
  `,
})
export class Infra {
  private service = inject(InfraService);
  private i18n = inject(I18n);
  private logsApi = inject(InfraLogsApi);
  private destroyRef = inject(DestroyRef);
  logsEnabled = signal(false);
  activeTab = signal<InfraTab>('state');
  tabs = computed<InfraTab[]>(() => (this.logsEnabled() ? ['state', 'logs', 'map'] : ['state', 'map']));

  t = this.i18n.t;
  state = signal<InfraStateView | null>(null);
  /** Servicios caídos o degradados, para el aviso sobre la tabla. */
  /** Logs y Mapa ocupan todo el alto de la ventana: la lista (o el lienzo) es lo único que se ajusta. */
  fillHeight = computed(() => (this.activeTab() === 'logs' && this.logsEnabled()) || this.activeTab() === 'map' || this.activeTab() === 'state');
  /** Reloj del componente: hace que "hace N min" avance sin recargar. */
  private now = signal(Date.now());
  attention = computed(() => (this.state()?.services ?? []).filter((svc) => svc.state === 'DOWN' || svc.state === 'DEGRADED'));
  /** Lo que falla primero; dentro de cada estado se conserva el orden del catálogo. */
  sortedServices = computed(() =>
    [...(this.state()?.services ?? [])].sort((a, b) => SEVERITY[a.state] - SEVERITY[b.state]));
  /** Filtro opcional por estado desde los chips del resumen; vacío = todos. */
  stateFilter = signal<InfraStateName | null>(null);
  visibleServices = computed(() => {
    const filter = this.stateFilter();
    return filter ? this.sortedServices().filter((svc) => svc.state === filter) : this.sortedServices();
  });
  chips = computed(() => {
    const i = this.t().infra;
    const summary = this.state()?.summary;
    return [
      { key: 'UP' as const, label: i.up, count: summary?.up ?? 0, dot: 'bg-success', tone: 'text-success' },
      { key: 'DEGRADED' as const, label: i.degraded, count: summary?.degraded ?? 0, dot: 'bg-warning', tone: 'text-warning' },
      { key: 'DOWN' as const, label: i.down, count: summary?.down ?? 0, dot: 'bg-danger', tone: 'text-danger' },
      { key: 'UNKNOWN' as const, label: i.unknown, count: summary?.unknown ?? 0, dot: 'bg-text-faint', tone: 'text-text-muted' },
      { key: 'NO_ACCESS' as const, label: i.noAccess, count: summary?.noAccess ?? 0, dot: 'bg-text-faint', tone: 'text-text-muted' },
    ];
  });
  toggleStateFilter(key: InfraStateName): void { this.stateFilter.update((current) => (current === key ? null : key)); }
  loading = signal(true);
  error = signal(false);

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 30_000);
    this.destroyRef.onDestroy(() => clearInterval(timer));
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(false);
    this.probeLogs();
    firstValueFrom(this.service.state())
      .then((s) => this.state.set(s))
      .catch(() => this.error.set(true))
      .finally(() => this.loading.set(false));
  }

  private probeLogs(): void {
    try {
      this.logsApi.status().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => this.logsEnabled.set(true),
        error: (error) => { if (error.status === 404) this.hideLogs(); },
      });
    } catch { /* The state view also works without a logs HTTP provider. */ }
  }

  hideLogs(): void { this.logsEnabled.set(false); this.activeTab.set('state'); }

  /** Tooltip del botón de actualizar: qué hace y cuán viejo es el dato. */
  refreshTitle(): string {
    const i = this.t().infra;
    const last = this.state()?.source?.lastCheckAt;
    return last ? `${i.actualizar} · ${i.actualizado} ${this.relative(last)}` : i.actualizar;
  }

  tabLabel(tab: InfraTab): string {
    const i = this.t().infra;
    return tab === 'state' ? i.logs.stateTab : tab === 'map' ? i.mapa.tab : i.logs.logsTitle;
  }

  onTabKeydown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = this.tabs();
    const current = tabs.indexOf(this.activeTab());
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
      (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[index];
    this.activeTab.set(next);
    (event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>('#infra-tab-' + next)?.focus();
  }

  stateTone(state: InfraStateName): 'success' | 'danger' | 'warning' | 'neutral' {
    switch (state) {
      case 'UP':
        return 'success';
      case 'DOWN':
        return 'danger';
      case 'DEGRADED':
        return 'warning';
      default:
        return 'neutral';
    }
  }

  stateLabel(state: InfraStateName): string {
    const i = this.t().infra;
    switch (state) {
      case 'UP':
        return i.estadoUp;
      case 'DOWN':
        return i.estadoDown;
      case 'DEGRADED':
        return i.estadoDegraded;
      case 'NO_ACCESS':
        return i.estadoNoAccess;
      default:
        return i.estadoUnknown;
    }
  }

  coverageLabel(coverage: string | null): string {
    const i = this.t().infra;
    switch (coverage) {
      case 'full':
        return i.coberturaFull;
      case 'partial':
        return i.coberturaPartial;
      case 'unavailable':
        return i.coberturaUnavailable;
      default:
        return i.sinDato;
    }
  }

  countClass(count: number, tone: string): string {
    return count > 0 ? tone : 'text-text-faint';
  }

  percent(availability: InfraAvailability | null): number | null {
    if (!availability || !availability.hasData || availability.availability === null) return null;
    return Math.round(availability.availability * 100);
  }

  barClass(percent: number): string {
    return percent < 80 ? 'bg-danger' : percent < 97 ? 'bg-warning' : 'bg-success';
  }

  nodesLabel(view: InfraStateView): string {
    const i = this.t().infra;
    const nodes = view.frontendNodes;
    if (nodes.available && nodes.nodes.length > 0) {
      return nodes.nodes.map((node) => (node.buildDataAvailable ? node.label : `${node.label} (${i.sinBuild})`)).join(', ');
    }
    return nodes.enabled ? i.nodosPendiente : i.nodosDeshabilitado;
  }

  availabilityLabel(availability: InfraAvailability | null): string {
    const i = this.t().infra;
    if (!availability || !availability.hasData || availability.availability === null) return i.sinDato;
    const pct = Math.round(availability.availability * 100);
    if (availability.coverage === null) return `${pct}%`;
    return `${pct}% (${Math.round(availability.coverage * 100)}%)`;
  }

  uptimeLabel(seconds: number | null): string {
    if (seconds === null || seconds === undefined) return this.t().infra.sinDato;
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  relative(iso: string | null): string {
    const i = this.t().infra;
    if (!iso) return i.nunca;
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return i.sinDato;
    const seconds = Math.max(0, Math.floor((this.now() - then) / 1000));
    if (seconds < 5) return i.relAhora;
    if (seconds < 60) return i.relSegundos.replace('{n}', String(seconds));
    if (seconds < 3600) return i.relMinutos.replace('{n}', String(Math.floor(seconds / 60)));
    if (seconds < 86400) return i.relHoras.replace('{n}', String(Math.floor(seconds / 3600)));
    return i.relDias.replace('{n}', String(Math.floor(seconds / 86400)));
  }

  absolute(iso: string | null): string {
    if (!iso) return '';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(this.i18n.intlLocale());
  }
}

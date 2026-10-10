import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { InfraService, type InfraAvailability, type InfraStateName, type InfraStateView } from '../../core/infra';
import { I18n } from '../../core/i18n/i18n';
import { UI } from '../../shared/ui';

/**
 * Pantalla /infra: lista esperada de microservicios + gateway, resumen, estado,
 * disponibilidad 24 h/7 d, uptime, última conexión sana y frescura de la fuente.
 * No muestra enlaces de diagnóstico, IPs, dominios del tailnet ni columnas de VIP
 * del registro. Sin datos en vivo inventados: si el monitoreo está deshabilitado
 * o no hay historia, se dice explícitamente.
 */
@Component({
  selector: 'app-infra',
  imports: [...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">{{ t().infra.titulo }}</h1>
          <p class="mt-1 max-w-2xl text-sm text-text-muted">{{ t().infra.subtitulo }}</p>
        </div>
        <button type="button" uiButton variant="secondary" size="sm" (click)="load()" [disabled]="loading()">
          {{ t().infra.actualizar }}
        </button>
      </div>

      @if (loading()) {
        <div class="h-64 animate-pulse rounded-[var(--radius-lg)] border border-border bg-surface-2" aria-label="{{ t().infra.cargando }}"></div>
      } @else if (error() || !state()) {
        <ui-empty-state [title]="t().infra.error" />
      } @else if (state(); as s) {
        @if (!s.enabled) {
          <section uiCard class="border-warning/30">
            <div class="p-5">
              <h2 class="text-sm font-semibold text-warning">{{ t().infra.deshabilitadoTitulo }}</h2>
              <p class="mt-1 text-xs text-text-muted">{{ t().infra.deshabilitadoTexto }}</p>
            </div>
          </section>
        }

        <section uiCard>
          <div class="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-surface-2/40 px-4 py-3 text-xs">
            <span class="font-semibold text-text">{{ t().infra.resumen }}</span>
            <span class="text-text-muted">{{ t().infra.total }}: <span class="font-mono text-text">{{ s.summary.total }}</span></span>
            <span class="text-success">{{ t().infra.up }}: <span class="font-mono">{{ s.summary.up }}</span></span>
            <span class="text-danger">{{ t().infra.down }}: <span class="font-mono">{{ s.summary.down }}</span></span>
            <span class="text-warning">{{ t().infra.degraded }}: <span class="font-mono">{{ s.summary.degraded }}</span></span>
            <span class="text-text-muted">{{ t().infra.unknown }}: <span class="font-mono">{{ s.summary.unknown }}</span></span>
            <span class="text-text-muted">{{ t().infra.noAccess }}: <span class="font-mono">{{ s.summary.noAccess }}</span></span>
          </div>
          <div class="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-xs">
            <span class="font-semibold text-text">{{ t().infra.fuente }}</span>
            <span class="text-text-muted">{{ t().infra.registro }}:
              <span [class]="s.source.registryConfigured ? 'text-text' : 'text-text-faint'">
                {{ s.source.registryConfigured ? t().infra.configurado : t().infra.noConfigurado }}
              </span>
            </span>
            <span class="text-text-muted">{{ t().infra.ultimaLectura }}:
              @if (s.source.lastCheckAt) {
                <time [attr.datetime]="s.source.lastCheckAt" [attr.title]="absolute(s.source.lastCheckAt)" class="text-text">{{ relative(s.source.lastCheckAt) }}</time>
              } @else {
                <span class="text-text-faint">{{ t().infra.sinLectura }}</span>
              }
            </span>
          </div>
        </section>

        <section uiCard class="overflow-x-auto">
          <table class="w-full min-w-[720px] text-left text-sm">
            <thead class="border-b border-border bg-surface-2/40 text-xs text-text-muted">
              <tr>
                <th scope="col" class="px-4 py-3 font-medium">{{ t().infra.colServicio }}</th>
                <th scope="col" class="px-4 py-3 font-medium">{{ t().infra.colEstado }}</th>
                <th scope="col" class="px-4 py-3 font-medium">{{ t().infra.colCobertura }}</th>
                <th scope="col" class="px-4 py-3 font-medium">{{ t().infra.colDisponibilidad }}</th>
                <th scope="col" class="px-4 py-3 font-medium">{{ t().infra.colUptime }}</th>
                <th scope="col" class="px-4 py-3 font-medium">{{ t().infra.colUltimaConexion }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              @for (svc of s.services; track svc.name) {
                <tr class="hover:bg-surface-2/40">
                  <td class="px-4 py-3">
                    <div class="font-medium text-text">{{ svc.displayName }}</div>
                    <div class="mt-0.5 text-[11px] text-text-faint">
                      {{ t().infra.colInstancias }} {{ svc.instances }}
                      @if (svc.reason) { · {{ t().infra.motivo }}: {{ svc.reason }} }
                    </div>
                  </td>
                  <td class="px-4 py-3">
                    <span uiBadge [tone]="stateTone(svc.state)">{{ stateLabel(svc.state) }}</span>
                  </td>
                  <td class="px-4 py-3 text-xs text-text-muted">{{ coverageLabel(svc.coverage) }}</td>
                  <td class="px-4 py-3">
                    <div class="text-xs text-text" [attr.title]="t().infra.disponibilidadHint">
                      {{ availabilityLabel(svc.availability24h) }} · {{ availabilityLabel(svc.availability7d) }}
                    </div>
                  </td>
                  <td class="px-4 py-3 font-mono text-xs text-text-muted">{{ uptimeLabel(svc.uptimeSeconds) }}</td>
                  <td class="px-4 py-3 text-xs text-text-muted">
                    @if (svc.lastHealthyAt) {
                      <time [attr.datetime]="svc.lastHealthyAt" [attr.title]="absolute(svc.lastHealthyAt)">{{ relative(svc.lastHealthyAt) }}</time>
                    } @else {
                      <span class="text-text-faint">{{ t().infra.nunca }}</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </section>

        <section uiCard>
          <div class="border-b border-border bg-surface-2/40 px-4 py-3 text-sm font-semibold text-text">
            {{ t().infra.nodosTitulo }}
          </div>
          <div class="p-5">
            @if (s.frontendNodes.available && s.frontendNodes.nodes.length > 0) {
              <ul class="space-y-2 text-sm">
                @for (node of s.frontendNodes.nodes; track node.label) {
                  <li class="flex items-center justify-between gap-4">
                    <span class="text-text">{{ node.label }}</span>
                    <span class="text-xs text-text-muted">{{ node.buildDataAvailable ? '' : t().infra.sinBuild }}</span>
                  </li>
                }
              </ul>
            } @else {
              <p class="text-xs text-text-muted">
                {{ s.frontendNodes.enabled ? t().infra.nodosPendiente : t().infra.nodosDeshabilitado }}
              </p>
            }
          </div>
        </section>
      }
    </div>
  `,
})
export class Infra {
  private service = inject(InfraService);
  private i18n = inject(I18n);

  t = this.i18n.t;
  state = signal<InfraStateView | null>(null);
  loading = signal(true);
  error = signal(false);

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(false);
    firstValueFrom(this.service.state())
      .then((s) => this.state.set(s))
      .catch(() => this.error.set(true))
      .finally(() => this.loading.set(false));
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
    const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
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

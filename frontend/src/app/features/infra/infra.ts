import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import type { FrontendNodesStatusDto, InfraOverviewDto, InfraServiceStatusDto, InfraStatusResponse } from '../../core/models';
import { UI } from '../../shared/ui';

interface InfraServiceGroup {
  serviceId: string;
  rows: InfraServiceStatusDto[];
  representative: InfraServiceStatusDto;
  heartbeatCount: number;
}

@Component({
  selector: 'app-infra',
  imports: [...UI],
  template: `
    <div class="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">{{ t().infra.titulo }}</h1>
        <p class="mt-1 text-sm text-text-muted">{{ t().infra.subtitulo }}</p>
      </div>
      <button uiButton variant="secondary" (click)="refresh()" [disabled]="loading()">
        {{ t().infra.actualizar }}
      </button>
    </div>

    <div uiCard class="mb-3 px-4 py-3">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span class="font-medium">{{ t().infra.resumen }}</span>
        <span>{{ t().infra.servicios }}: <strong>{{ summary()?.totalServices ?? 0 }}</strong></span>
        <span>{{ t().infra.ok }}: <strong>{{ summary()?.ok ?? 0 }}</strong></span>
        <span>{{ t().infra.caidos }}: <strong>{{ summary()?.down ?? 0 }}</strong></span>
        <span>{{ t().infra.degradados }}: <strong>{{ summary()?.degraded ?? 0 }}</strong></span>
        <span>{{ t().infra.sinDatos }}: <strong>{{ summary()?.noData ?? 0 }}</strong></span>
        <span>{{ t().infra.sinAcceso }}: <strong>{{ summary()?.noAccess ?? 0 }}</strong></span>
      </div>
    </div>

    <p class="mb-4 text-xs text-text-muted">
      {{ t().infra.fuente }} — {{ t().infra.registroServicios }}: {{ t().infra.configurado }}
      <span class="mx-1">·</span>
      {{ t().infra.ultimaLectura }}: {{ lastUpdatedLabel() }}
    </p>

    @if (services().length === 0 && !loading()) {
      <ui-empty-state [title]="t().infra.vacio" />
    } @else {
      <div uiCard class="overflow-x-auto">
        <table class="w-full min-w-[900px] text-left text-sm">
          <thead class="border-b border-border bg-surface-2 text-xs text-text-muted">
            <tr>
              <th class="px-4 py-3 font-medium">{{ t().infra.columnaServicio }}</th>
              <th class="px-4 py-3 font-medium">{{ t().infra.columnaEstado }}</th>
              <th class="px-4 py-3 font-medium">{{ t().infra.columnaCobertura }}</th>
              <th class="px-4 py-3 font-medium">{{ t().infra.columnaDisponibilidad }}</th>
              <th class="px-4 py-3 font-medium">{{ t().infra.columnaUptime }}</th>
              <th class="px-4 py-3 font-medium">{{ t().infra.columnaUltimaConexion }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            @for (group of serviceGroups(); track group.serviceId) {
              <tr>
                <td class="px-4 py-3">
                  <div class="font-medium">{{ group.representative.name }}</div>
                  <div class="mt-0.5 text-xs text-text-muted">
                    {{ t().infra.instancias }} {{ group.heartbeatCount }}
                    @if (group.heartbeatCount === 0) {
                      <span> · {{ t().infra.motivo }}: {{ group.representative.reason }}</span>
                    }
                  </div>
                </td>
                <td class="px-4 py-3">
                  <span uiBadge [tone]="statusTone(group.representative.status)">
                    {{ statusLabel(group.representative.status) }}
                  </span>
                </td>
                <td class="px-4 py-3 text-text-muted">
                  {{ group.heartbeatCount >= 1 ? t().infra.coberturaCompleta : t().infra.coberturaNoDisponible }}
                </td>
                <td class="px-4 py-3 text-text-muted">{{ availabilityLabel(group.representative) }}</td>
                <td class="px-4 py-3 text-text-muted">{{ group.representative.uptimeFormatted || t().infra.sinDato }}</td>
                <td class="px-4 py-3 text-text-muted">{{ group.representative.lastSeenRelative || t().infra.nunca }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    <section uiCard class="mt-4 overflow-hidden">
      <div class="px-4 py-3">
        <h2 class="text-lg font-semibold tracking-tight">{{ t().infra.nodos.titulo }}</h2>
        <p class="mt-1 text-sm text-text-muted">{{ t().infra.nodos.subtitulo }}</p>
      </div>
      @if (!frontendNodesStatus()?.available) {
        <p class="px-4 pb-4 text-sm text-text-muted">{{ t().infra.nodos.noDisponible }}</p>
      } @else {
        <p class="px-4 pb-3 text-xs text-text-muted">
          {{ t().infra.nodos.ultimaSincronizacion }}: {{ frontendNodesLastSyncLabel() }}
        </p>
        @if (frontendNodesStatus()!.nodes.length === 0) {
          <p class="px-4 pb-4 text-sm text-text-muted">{{ t().infra.nodos.sinNodos }}</p>
        } @else {
          <div class="overflow-x-auto">
            <table class="w-full min-w-[640px] text-left text-sm">
              <thead class="border-y border-border bg-surface-2 text-xs text-text-muted">
                <tr>
                  <th class="px-4 py-3 font-medium">{{ t().infra.nodos.columnaNodo }}</th>
                  <th class="px-4 py-3 font-medium">{{ t().infra.nodos.columnaIdentidad }}</th>
                  <th class="px-4 py-3 font-medium">{{ t().infra.nodos.columnaEstado }}</th>
                  <th class="px-4 py-3 font-medium">{{ t().infra.nodos.columnaUltimaConexion }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                @for (node of frontendNodesStatus()!.nodes; track node.hostname) {
                  <tr>
                    <td class="px-4 py-3 font-medium">{{ node.hostname }}</td>
                    <td class="px-4 py-3">
                      <span uiBadge [tone]="node.identityDeclared ? 'accent' : 'neutral'">
                        {{ node.identityDeclared ? t().infra.nodos.identidadDeclarada : t().infra.nodos.identidadSinIdentificar }}
                      </span>
                    </td>
                    <td class="px-4 py-3">
                      <span uiBadge [tone]="node.status === 'ONLINE' ? 'success' : 'neutral'">
                        {{ node.status === 'ONLINE' ? t().infra.nodos.estadoOnline : t().infra.nodos.estadoOffline }}
                      </span>
                    </td>
                    <td class="px-4 py-3 text-text-muted">{{ node.lastSeenRelative || t().infra.nodos.nunca }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </section>
  `,
})
export class Infra {
  private api = inject(Api);
  private i18n = inject(I18n);
  t = this.i18n.t;

  summary = signal<InfraOverviewDto | null>(null);
  services = signal<InfraServiceStatusDto[]>([]);
  frontendNodesStatus = signal<FrontendNodesStatusDto | null>(null);
  loading = signal(false);

  serviceGroups = computed<InfraServiceGroup[]>(() => {
    const groups = new Map<string, InfraServiceStatusDto[]>();
    for (const service of this.services()) {
      const group = groups.get(service.serviceId) ?? [];
      group.push(service);
      groups.set(service.serviceId, group);
    }

    return [...groups.entries()].map(([serviceId, rows]) => {
      const sorted = [...rows].sort((a, b) => this.heartbeatTime(b) - this.heartbeatTime(a));
      return {
        serviceId,
        rows,
        representative: sorted[0],
        heartbeatCount: rows.filter((row) => Boolean(row.lastHeartbeatAt)).length,
      };
    });
  });

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    void this.refreshFrontendNodes();
    try {
      const response = await firstValueFrom(this.api.get<InfraStatusResponse>('/infra/status'));
      this.summary.set(response.summary);
      this.services.set(response.services);
    } finally {
      this.loading.set(false);
    }
  }

  async refreshFrontendNodes(): Promise<void> {
    try {
      const status = await firstValueFrom(this.api.get<FrontendNodesStatusDto>('/infra/frontend-nodes'));
      this.frontendNodesStatus.set(status);
    } catch {
      this.frontendNodesStatus.set(null);
    }
  }

  frontendNodesLastSyncLabel(): string {
    const lastSync = this.frontendNodesStatus()?.lastSync;
    if (!lastSync) return this.t().infra.nodos.nunca;
    const timestamp = Date.parse(lastSync);
    if (Number.isFinite(timestamp) && Date.now() - timestamp < 60_000) return this.t().infra.recien;
    return lastSync;
  }

  statusTone(status: InfraServiceStatusDto['status']): 'success' | 'warning' | 'danger' | 'neutral' {
    switch (status) {
      case 'OK':
        return 'success';
      case 'DEGRADED':
        return 'warning';
      case 'DOWN':
        return 'danger';
      default:
        return 'neutral';
    }
  }

  statusLabel(status: InfraServiceStatusDto['status']): string {
    switch (status) {
      case 'OK':
        return this.t().infra.estadoOk;
      case 'DEGRADED':
        return this.t().infra.estadoDegradado;
      case 'DOWN':
        return this.t().infra.estadoCaido;
      default:
        return this.t().infra.estadoDesconocido;
    }
  }

  availabilityLabel(service: InfraServiceStatusDto): string {
    if (service.availability24h === null) return this.t().infra.sinDato;
    return `${Math.round(service.availability24h)}% ` +
      `(${service.degraded24h === null ? this.t().infra.sinDato : `${Math.round(service.degraded24h)}%`}) · ` +
      `${service.availability7d === null ? this.t().infra.sinDato : `${Math.round(service.availability7d)}%`} ` +
      `(${service.degraded7d === null ? this.t().infra.sinDato : `${Math.round(service.degraded7d)}%`})`;
  }

  lastUpdatedLabel(): string {
    const updatedAt = this.summary()?.lastUpdated;
    if (!updatedAt) return this.t().infra.sinDato;
    const timestamp = Date.parse(updatedAt);
    if (Number.isFinite(timestamp) && Date.now() - timestamp < 60_000) return this.t().infra.recien;
    return updatedAt;
  }

  private heartbeatTime(service: InfraServiceStatusDto): number {
    return service.lastHeartbeatAt ? Date.parse(service.lastHeartbeatAt) || 0 : 0;
  }
}

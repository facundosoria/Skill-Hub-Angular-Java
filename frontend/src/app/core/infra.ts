import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Api } from './api';

/**
 * Tipos de GET /api/infra (InfraDto.StateView del backend). El payload público
 * sólo trae nombres, estado/motivo saneado, disponibilidad/cobertura, uptime
 * cuando se conoce y frescura de la fuente: nunca IPs de la mesh, dominios del
 * tailnet, endpoints internos ni hosts/puertos del registro.
 */
export type InfraStateName = 'UP' | 'DOWN' | 'DEGRADED' | 'UNKNOWN' | 'NO_ACCESS';

export interface InfraAvailability {
  observedSeconds: number | null;
  availableSeconds: number | null;
  degradedSeconds: number | null;
  unobservedSeconds: number | null;
  availability: number | null;
  coverage: number | null;
  hasData: boolean;
}

export interface InfraServiceStatus {
  name: string;
  displayName: string;
  state: InfraStateName;
  reason: string | null;
  coverage: string | null;
  uptimeSeconds: number | null;
  instances: number;
  lastObservedAt: string | null;
  lastHealthyAt: string | null;
  lastRegistryLeaseAt: string | null;
  availability24h: InfraAvailability | null;
  availability7d: InfraAvailability | null;
}

export interface InfraSource {
  registryConfigured: boolean;
  registryOk: boolean;
  lastCheckAt: string | null;
}

export interface InfraSummary {
  total: number;
  up: number;
  down: number;
  degraded: number;
  unknown: number;
  noAccess: number;
}

export interface InfraFrontendNode {
  label: string;
  group: string | null;
  lastSeenAt: string | null;
  onlineHint: boolean | null;
  buildDataAvailable: boolean;
}

export interface InfraFrontendNodes {
  enabled: boolean;
  available: boolean;
  status: string;
  nodes: InfraFrontendNode[];
}

export interface InfraStateView {
  enabled: boolean;
  configured: boolean;
  generatedAt: string;
  source: InfraSource;
  summary: InfraSummary;
  services: InfraServiceStatus[];
  frontendNodes: InfraFrontendNodes;
}

@Injectable({ providedIn: 'root' })
export class InfraService {
  private api = inject(Api);

  state(): Observable<InfraStateView> {
    return this.api.get<InfraStateView>('/infra/state');
  }
}

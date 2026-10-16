import { inject, Injectable, Injector } from '@angular/core';
import { Api } from '../../core/api';
import { LogFilters, LogPage, LogStatus } from './infra-logs.models';

@Injectable({ providedIn: 'root' })
export class InfraLogsApi {
  private injector = inject(Injector);
  private readonly path = '/infra/logs/api-gateway';

  status() { return this.injector.get(Api).get<LogStatus>(`${this.path}/status`); }

  page(filters: LogFilters, cursors: { before?: string; after?: string; through?: string; at?: string } = {}) {
    return this.injector.get(Api).get<LogPage>(this.path, {
      limit: 150, levels: filters.levels.join(','), q: filters.q, traceId: filters.traceId,
      route: filters.route, method: filters.methods.join(','), status: filters.statuses.join(','),
      minDurationMs: filters.minDurationMs ?? '', ...cursors,
    });
  }
}

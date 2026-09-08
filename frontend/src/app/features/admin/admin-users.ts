import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import type { PendingUser } from '../../core/models';
import { UI } from '../../shared/ui';

/** Puerto de src/app/(app)/admin/users/page.tsx. */
@Component({
  selector: 'app-admin-users',
  imports: [...UI],
  template: `
    <div class="max-w-2xl">
      <h1 class="text-xl font-medium">{{ t().usuarios.titulo }}</h1>
      <p class="mt-1 mb-6 text-sm text-text-muted">{{ t().usuarios.subtitulo }}</p>

      @if (pending().length === 0) {
        <ui-empty-state [title]="t().usuarios.vacio" [hint]="t().usuarios.vacioHint" />
      } @else {
        <div class="space-y-3">
          @for (p of pending(); track p.id) {
            <div uiCard class="p-4">
              <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span class="text-[15px] font-medium">{{ p.name }}</span>
                <span class="text-sm text-text-muted">{{ p.username }}</span>
                @if (p.team) { <span uiBadge>{{ p.team }}</span> }
                <span uiBadge tone="accent">{{ p.legajo || t().usuarios.sinLegajo }}</span>
              </div>
              <div class="mt-3 flex gap-2">
                <button uiButton size="sm" (click)="approve(p.id)">{{ t().usuarios.aprobar }}</button>
                <button uiButton size="sm" variant="ghost" (click)="reject(p.id)">{{ t().usuarios.rechazar }}</button>
              </div>
            </div>
          }
        </div>
      }

      <h2 class="mt-10 mb-3 text-lg font-medium">{{ t().usuarios.activasTitulo }}</h2>
      <div uiCard class="divide-y divide-border">
        @for (u of active(); track u.id) {
          <div class="flex flex-wrap items-baseline gap-2 px-4 py-3">
            <span class="text-sm font-medium">{{ u.name }}</span>
            <span class="text-sm text-text-muted">{{ u.username }}</span>
            @if (u.team) { <span uiBadge>{{ u.team }}</span> }
          </div>
        }
      </div>
    </div>
  `,
})
export class AdminUsers {
  private api = inject(Api);
  private i18n = inject(I18n);
  t = this.i18n.t;
  pending = signal<PendingUser[]>([]);
  active = signal<PendingUser[]>([]);

  constructor() {
    this.load();
  }

  private load(): void {
    firstValueFrom(this.api.get<{ pending: PendingUser[]; active: PendingUser[] }>('/admin/users')).then((r) => {
      this.pending.set(r.pending);
      this.active.set(r.active);
    });
  }

  async approve(id: string): Promise<void> {
    await firstValueFrom(this.api.post(`/admin/users/${id}/approve`));
    this.load();
  }
  async reject(id: string): Promise<void> {
    await firstValueFrom(this.api.post(`/admin/users/${id}/reject`));
    this.load();
  }
}

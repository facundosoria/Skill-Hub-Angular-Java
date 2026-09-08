import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import type { ApiKey } from '../../core/models';
import { UI } from '../../shared/ui';
import { firstValueFrom } from 'rxjs';
import { apiError } from '../auth/login';

/** Puerto de src/app/(app)/keys/keys-manager.tsx. */
@Component({
  selector: 'app-keys',
  imports: [FormsModule, ...UI],
  template: `
    <div class="max-w-2xl">
      <h1 class="text-xl font-medium">{{ t().keys.titulo }}</h1>
      <p class="mt-1 mb-6 text-sm text-text-muted">{{ t().keys.subtitulo }}</p>

      <div class="flex flex-wrap items-end gap-2">
        <ui-field [label]="t().keys.nombreKey" [hint]="t().keys.nombreKeyHint" class="flex-1">
          <input uiInput [(ngModel)]="name" placeholder="mi-notebook" />
        </ui-field>
        <button uiButton (click)="generate()" [disabled]="busy()">
          {{ busy() ? t().keys.generando : t().keys.generar }}
        </button>
      </div>

      @if (created()) {
        <div class="mt-4 rounded-[var(--radius)] border border-accent/30 bg-accent-soft p-3"
             animate.enter="anim-panel-in">
          <p class="text-xs text-accent">{{ t().keys.copiaAhora }}</p>
          <code class="mt-1 block break-all font-mono text-sm">{{ created() }}</code>
          <p class="mt-1 text-xs text-text-faint">{{ t().keys.copiaAhoraHint }}</p>
        </div>
      }
      @if (error()) { <p class="mt-3 text-sm text-danger">{{ error() }}</p> }

      <h2 class="mt-8 mb-2 text-[13px] text-text-muted">{{ t().keys.tusKeys }}</h2>
      @if (keys().length === 0) {
        <ui-empty-state [title]="t().keys.ninguna" />
      } @else {
        <div uiCard class="divide-y divide-border">
          @for (k of keys(); track k.id) {
            <div class="flex flex-wrap items-baseline gap-2 px-4 py-3">
              <span class="text-sm font-medium">{{ k.name }}</span>
              <code class="font-mono text-xs text-text-faint">{{ k.prefix }}…</code>
              @if (k.revokedAt) {
                <span uiBadge tone="warning">{{ t().keys.revocada }}</span>
              } @else {
                <button uiButton size="sm" variant="ghost" class="ml-auto" (click)="revoke(k.id)">
                  {{ t().keys.revocar }}
                </button>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class Keys {
  private api = inject(Api);
  private i18n = inject(I18n);
  t = this.i18n.t;

  name = '';
  keys = signal<ApiKey[]>([]);
  created = signal<string | null>(null);
  error = signal<string | null>(null);
  busy = signal(false);

  constructor() {
    this.load();
  }

  private load(): void {
    firstValueFrom(this.api.get<{ keys: ApiKey[] }>('/keys')).then((r) => this.keys.set(r.keys));
  }

  async generate(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await firstValueFrom(this.api.post<{ created: string }>('/keys', { name: this.name }));
      this.created.set(r.created);
      this.name = '';
      this.load();
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }

  async revoke(id: string): Promise<void> {
    await firstValueFrom(this.api.delete(`/keys/${id}`));
    this.load();
  }
}

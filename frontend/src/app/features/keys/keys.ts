import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import type { ApiKey } from '../../core/models';
import { UI } from '../../shared/ui';
import { firstValueFrom } from 'rxjs';
import { apiError } from '../auth/login';

/**
 * Copia al portapapeles con fallback para contextos no seguros (http sin
 * localhost) donde `navigator.clipboard` no existe. Puerto de `copyToClipboard`
 * de src/app/(app)/keys/keys-manager.tsx.
 */
async function copyToClipboard(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // cae al fallback de abajo (p. ej. permiso denegado)
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

/** Puerto de `CopyRow`: el valor en mono + un boton que copia y confirma 1.6 s. */
@Component({
  selector: 'app-copy-row',
  imports: [...UI],
  template: `
    <div class="flex items-center gap-2">
      <code
        class="flex-1 overflow-x-auto rounded-[var(--radius)] border border-border bg-surface px-3 py-2 font-mono text-[13px] whitespace-pre"
        >{{ value() }}</code
      >
      <button uiButton variant="secondary" size="sm" (click)="copy()">
        {{ copied() ? t().keys.copiado : t().keys.copiar }}
      </button>
    </div>
  `,
})
export class CopyRow {
  private i18n = inject(I18n);
  t = this.i18n.t;
  value = input.required<string>();
  copied = signal(false);

  async copy(): Promise<void> {
    if (!(await copyToClipboard(this.value()))) return;
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1600);
  }
}

/** Puerto de src/app/(app)/keys/keys-manager.tsx. */
@Component({
  selector: 'app-keys',
  imports: [FormsModule, CopyRow, ...UI],
  template: `
    <div class="max-w-2xl space-y-8">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">{{ t().keys.titulo }}</h1>
        <p class="mt-1 text-sm text-text-muted">{{ t().keys.subtitulo }}</p>
      </div>

      <div class="flex flex-wrap items-end gap-2">
        <ui-field [label]="t().keys.nombreKey" [hint]="t().keys.nombreKeyHint" class="flex-1">
          <input uiInput [(ngModel)]="name" placeholder="mi-notebook" />
        </ui-field>
        <button uiButton (click)="generate()" [disabled]="busy()">
          {{ busy() ? t().keys.generando : t().keys.generar }}
        </button>
      </div>

      @if (created()) {
        <div class="rounded-[var(--radius)] border border-accent/30 bg-accent-soft p-3"
             animate.enter="anim-panel-in">
          <p class="text-xs text-accent">{{ t().keys.copiaAhora }}</p>
          <app-copy-row class="mt-2 block" [value]="created()!" />
          <p class="mt-1 text-xs text-text-faint">{{ t().keys.copiaAhoraHint }}</p>
        </div>
      }
      @if (error()) { <p class="text-sm text-danger">{{ error() }}</p> }

      <section>
        <h2 class="mb-2 text-[13px] text-text-muted">{{ t().keys.tusKeys }}</h2>
        @if (keys().length === 0) {
          <ui-empty-state [title]="t().keys.ninguna" />
        } @else {
          <div uiCard class="divide-y divide-border">
            @for (k of keys(); track k.id) {
              <div class="flex flex-wrap items-baseline gap-2 px-4 py-3">
                <span class="text-sm font-medium">{{ k.name }}</span>
                <code class="font-mono text-xs text-text-faint">{{ k.prefix }}…</code>
                @if (k.revokedAt) {
                  <span uiBadge tone="danger">{{ t().keys.revocada }}</span>
                } @else if (k.lastUsedAt) {
                  <span uiBadge tone="success">{{ t().keys.enUso }}</span>
                } @else {
                  <span uiBadge tone="neutral">{{ t().keys.sinUsar }}</span>
                }
                <span class="ml-auto text-xs text-text-faint">
                  @if (k.lastUsedAt) {
                    {{ t().keys.ultimoUso }} {{ fecha(k.lastUsedAt) }}
                  } @else {
                    {{ t().keys.creada }} {{ fecha(k.createdAt) }}
                  }
                </span>
                @if (!k.revokedAt) {
                  <button uiButton size="sm" variant="ghost" (click)="revoke(k.id)">
                    {{ t().keys.revocar }}
                  </button>
                }
              </div>
            }
          </div>
        }
      </section>

      <section>
        <h2 class="mb-2 text-[13px] text-text-muted">{{ t().keys.configPorIde }}</h2>
        <div class="space-y-4">
          <div>
            <p class="mb-1.5 text-xs text-text-faint">Claude Code</p>
            <app-copy-row [value]="claudeSnippet" />
          </div>
          <div>
            <p class="mb-1.5 text-xs text-text-faint">Cursor · .cursor/mcp.json</p>
            <app-copy-row [value]="cursorSnippet" />
          </div>
        </div>
        <p class="mt-3 text-xs text-text-faint">
          {{ t().keys.reemplaza }} <span class="font-mono">TU_KEY</span> {{ t().keys.porLaKey }}
        </p>
      </section>

      <section class="rounded-xl border border-border bg-surface-2 p-4">
        <h2 class="text-[13px] font-medium">{{ t().keys.queSeRegistra }}</h2>
        <p class="mt-1.5 text-sm text-text-muted">{{ t().keys.queSeRegistraDetalle }}</p>
      </section>
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

  private mcpUrl = `${location.origin}/api/mcp`;
  claudeSnippet =
    `claude mcp add --transport http skillhub ${this.mcpUrl} --header "Authorization: Bearer TU_KEY"`;
  cursorSnippet = JSON.stringify(
    { mcpServers: { skillhub: { url: this.mcpUrl, headers: { Authorization: 'Bearer TU_KEY' } } } },
    null,
    2,
  );

  constructor() {
    this.load();
  }

  private load(): void {
    firstValueFrom(this.api.get<{ keys: ApiKey[] }>('/keys')).then((r) => this.keys.set(r.keys));
  }

  fecha(iso: string): string {
    const d = new Date(iso.replace(' ', 'T'));
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString(this.i18n.intlLocale());
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

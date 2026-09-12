import { Component, computed, HostListener, inject, input, signal } from '@angular/core';
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
    @if (isMultiline()) {
      <div class="relative w-full">
        <code
          class="block w-full overflow-x-auto rounded-[var(--radius)] border border-border bg-surface-2 p-3.5 pr-12 font-mono text-[13px] whitespace-pre"
          >{{ value() }}</code
        >
        <button
          type="button"
          class="absolute top-2.5 right-2.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] border border-border-strong bg-surface text-text shadow-[var(--shadow-sm)] transition-[background-color,border-color,color,transform,box-shadow,filter] duration-[var(--dur)] ease-[var(--ease)] hover:-translate-y-px hover:border-text-faint hover:bg-surface-2 focus-visible:shadow-[var(--ring)] focus-visible:outline-none active:scale-[0.98] active:translate-y-0 cursor-pointer"
          (click)="copy()"
          [attr.aria-label]="copied() ? t().keys.copiado : t().keys.copiar"
          [attr.title]="copied() ? t().keys.copiado : t().keys.copiar"
        >
          @if (copied()) {
            <svg
              viewBox="0 0 24 24"
              class="h-3.5 w-3.5 text-success"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          } @else {
            <svg
              viewBox="0 0 24 24"
              class="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
          }
        </button>
      </div>
    } @else {
      <div class="relative w-full">
        <code
          class="block w-full overflow-x-auto rounded-[var(--radius)] border border-border bg-surface-2 py-2.5 pl-3.5 pr-12 font-mono text-[13px] whitespace-pre"
          >{{ value() }}</code
        >
        <button
          type="button"
          class="absolute top-1/2 -translate-y-1/2 right-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] border border-border-strong bg-surface text-text shadow-[var(--shadow-sm)] transition-[background-color,border-color,color,transform,box-shadow,filter] duration-[var(--dur)] ease-[var(--ease)] hover:-translate-y-px hover:border-text-faint hover:bg-surface-2 focus-visible:shadow-[var(--ring)] focus-visible:outline-none active:scale-[0.98] active:translate-y-0 cursor-pointer"
          (click)="copy()"
          [attr.aria-label]="copied() ? t().keys.copiado : t().keys.copiar"
          [attr.title]="copied() ? t().keys.copiado : t().keys.copiar"
        >
          @if (copied()) {
            <svg
              viewBox="0 0 24 24"
              class="h-3.5 w-3.5 text-success"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          } @else {
            <svg
              viewBox="0 0 24 24"
              class="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
          }
        </button>
      </div>
    }
  `,
})
export class CopyRow {
  private i18n = inject(I18n);
  t = this.i18n.t;
  value = input.required<string>();
  multiline = input<boolean | undefined>(undefined);
  isMultiline = computed(() => this.multiline() ?? this.value().includes('\n'));
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
    <div class="space-y-8">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">{{ t().keys.titulo }}</h1>
        <p class="mt-1 text-sm text-text-muted">{{ t().keys.subtitulo }}</p>
      </div>

      <!-- Grid principal en 2 columnas -->
      <div class="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <!-- Columna izquierda: Generador + Tus Keys -->
        <div uiCard class="p-5 sm:p-6 space-y-6 flex flex-col h-full !overflow-visible">
          <!-- Sección Generador -->
          <div class="space-y-3">
            <h2 class="text-sm font-semibold tracking-tight text-text">{{ t().keys.generar }}</h2>
            <div>
              <div class="flex flex-wrap items-end gap-2">
                <ui-field [label]="t().keys.nombreKey" class="flex-1">
                  <input uiInput [(ngModel)]="name" placeholder="mi-notebook" (keydown.enter)="generate()" />
                </ui-field>
                <button uiButton (click)="generate()" [disabled]="busy()">
                  {{ busy() ? t().keys.generando : t().keys.generar }}
                </button>
              </div>
              <p class="mt-1.5 text-xs text-text-faint">{{ t().keys.nombreKeyHint }}</p>
            </div>

            @if (created()) {
              <div class="relative rounded-[var(--radius)] border border-accent/30 bg-accent-soft p-3.5"
                   animate.enter="anim-panel-in" animate.leave="anim-panel-out">
                <div class="flex items-start justify-between gap-2 pr-7">
                  <div>
                    <p class="text-xs font-medium text-accent">{{ t().keys.copiaAhora }}</p>
                    <p class="mt-0.5 text-xs text-text-faint">{{ t().keys.copiaAhoraHint }}</p>
                  </div>
                  <button
                    type="button"
                    (click)="created.set(null)"
                    class="absolute top-2.5 right-2.5 inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius)] text-text-muted hover:text-text hover:bg-accent/15 transition-colors cursor-pointer"
                    [attr.aria-label]="t().keys.cerrar"
                    [attr.title]="t().keys.cerrar"
                  >
                    <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                <app-copy-row class="mt-2.5 block" [value]="created()!" />
              </div>
            }
            @if (error()) { <p class="text-sm text-danger">{{ error() }}</p> }
          </div>

          <div class="border-t border-border"></div>

          <!-- Sección Tus Keys -->
          <section class="space-y-3 flex-1 flex flex-col">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <h2 class="text-sm font-semibold tracking-tight text-text">{{ t().keys.tusKeys }}</h2>
                @if (keys().length > 0) {
                  <span uiBadge tone="neutral">{{ keys().length }}</span>
                }
              </div>
              @if (keys().length > 0) {
                <button
                  type="button"
                  (click)="modalOpen.set(true)"
                  class="text-xs text-accent hover:underline cursor-pointer inline-flex items-center gap-1"
                >
                  {{ t().keys.verTodas }}
                </button>
              }
            </div>

            @if (keys().length === 0) {
              <ui-empty-state [title]="t().keys.ninguna" class="my-auto" />
            } @else {
              <table class="w-full text-left border-collapse">
                <tbody>
                  @for (k of visibleKeys(); track k.id) {
                    <tr class="hover:bg-surface-2/40 transition-colors">
                      <td class="py-2.5 pr-2.5 whitespace-nowrap align-middle w-px">
                        @if (k.revokedAt) {
                          <span uiBadge tone="danger">{{ t().keys.revocada }}</span>
                        } @else if (k.lastUsedAt) {
                          <span uiBadge tone="success">{{ t().keys.enUso }}</span>
                        } @else {
                          <span uiBadge tone="neutral">{{ t().keys.sinUsar }}</span>
                        }
                      </td>
                      <td class="py-2.5 px-2.5 align-middle min-w-0">
                        <div class="flex items-baseline gap-2 min-w-0">
                          <span class="text-sm font-medium text-text truncate">{{ k.name }}</span>
                          <code class="font-mono text-xs text-text-faint truncate">{{ k.prefix }}…</code>
                        </div>
                      </td>
                      <td class="py-2.5 px-2.5 text-right align-middle whitespace-nowrap w-px">
                        <span class="text-xs text-text-faint">
                          @if (k.lastUsedAt) {
                            {{ t().keys.ultimoUso }} {{ fecha(k.lastUsedAt) }}
                          } @else {
                            {{ t().keys.creada }} {{ fecha(k.createdAt) }}
                          }
                        </span>
                      </td>
                      <td class="py-2.5 pl-2.5 pr-1 text-right align-middle whitespace-nowrap w-8">
                        @if (!k.revokedAt) {
                          <div class="relative group inline-flex items-center">
                            <button
                              type="button"
                              class="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius)] text-text-muted hover:text-danger hover:bg-danger-soft/40 transition-colors cursor-pointer"
                              (click)="revoke(k.id)"
                              [attr.aria-label]="t().keys.revocar"
                              [attr.title]="t().keys.revocar"
                            >
                              <svg
                                viewBox="0 0 24 24"
                                class="h-4 w-4"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                aria-hidden="true"
                              >
                                <path d="M3 6h18" />
                                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                                <line x1="10" x2="10" y1="11" y2="17" />
                                <line x1="14" x2="14" y1="17" y2="11" />
                              </svg>
                            </button>
                            <span
                              class="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden rounded bg-surface-2 border border-border px-2 py-0.5 text-xs text-text whitespace-nowrap shadow-lg group-hover:block z-30"
                            >
                              {{ t().keys.revocar }}
                            </span>
                          </div>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </section>
        </div>

        <!-- Columna derecha: Configuración por IDE -->
        <div uiCard class="p-5 sm:p-6 space-y-5 flex flex-col h-full">
          <h2 class="text-sm font-semibold tracking-tight text-text">{{ t().keys.configPorIde }}</h2>
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
          <p class="mt-auto pt-3 border-t border-border text-xs text-text-faint leading-relaxed">
            {{ t().keys.reemplaza }} <span class="font-mono text-text">TU_KEY</span> {{ t().keys.porLaKey }}
          </p>
        </div>
      </div>

      <!-- Cuadro: Qué se registra cuando usas tu key (100% width) -->
      <section uiCard class="p-4 sm:p-5">
        <div class="flex items-start gap-3.5">
          <div class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-muted border border-border">
            <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
          </div>
          <div class="space-y-1 min-w-0 flex-1">
            <h2 class="text-sm font-semibold tracking-tight text-text">{{ t().keys.queSeRegistra }}</h2>
            <p class="text-xs sm:text-sm text-text-muted leading-relaxed">{{ t().keys.queSeRegistraDetalle }}</p>
          </div>
        </div>
      </section>

      <!-- Modal grande de todas las keys con scroll si son muchas -->
      @if (modalOpen()) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm"
          (click)="modalOpen.set(false)"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="t().keys.todasLasKeys"
        >
          <div
            class="relative w-full max-w-3xl rounded-[var(--radius-lg)] border border-border bg-surface p-5 sm:p-6 shadow-2xl flex flex-col max-h-[85vh] anim-pop-in"
            (click)="$event.stopPropagation()"
          >
            <!-- Header del modal -->
            <div class="flex items-center justify-between border-b border-border pb-3.5 mb-4">
              <div class="flex items-center gap-2.5">
                <h2 class="text-base font-semibold tracking-tight">{{ t().keys.todasLasKeys }}</h2>
                <span uiBadge tone="neutral">{{ keys().length }}</span>
              </div>
              <button
                type="button"
                (click)="modalOpen.set(false)"
                class="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius)] text-text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
                [attr.aria-label]="t().keys.cerrar"
                [attr.title]="t().keys.cerrar"
              >
                <svg
                  viewBox="0 0 24 24"
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <!-- Lista con scroll vertical si son muchas -->
            <div class="flex-1 overflow-y-auto pr-1 pt-3">
              @if (keys().length === 0) {
                <ui-empty-state [title]="t().keys.ninguna" />
              } @else {
                <table class="w-full text-left border-collapse">
                  <tbody>
                    @for (k of sortedKeys(); track k.id) {
                      <tr class="hover:bg-surface-2/40 transition-colors">
                        <td class="py-2.5 pr-2.5 whitespace-nowrap align-middle w-px">
                          @if (k.revokedAt) {
                            <span uiBadge tone="danger">{{ t().keys.revocada }}</span>
                          } @else if (k.lastUsedAt) {
                            <span uiBadge tone="success">{{ t().keys.enUso }}</span>
                          } @else {
                            <span uiBadge tone="neutral">{{ t().keys.sinUsar }}</span>
                          }
                        </td>
                        <td class="py-2.5 px-2.5 align-middle min-w-0">
                          <div class="flex items-baseline gap-2 min-w-0">
                            <span class="text-sm font-medium text-text truncate">{{ k.name }}</span>
                            <code class="font-mono text-xs text-text-faint truncate">{{ k.prefix }}…</code>
                          </div>
                        </td>
                        <td class="py-2.5 px-2.5 text-right align-middle whitespace-nowrap w-px">
                          <span class="text-xs text-text-faint">
                            @if (k.lastUsedAt) {
                              {{ t().keys.ultimoUso }} {{ fecha(k.lastUsedAt) }}
                            } @else {
                              {{ t().keys.creada }} {{ fecha(k.createdAt) }}
                            }
                          </span>
                        </td>
                        <td class="py-2.5 pl-2.5 pr-2 text-right align-middle whitespace-nowrap w-8">
                          @if (!k.revokedAt) {
                            <div class="relative group inline-flex items-center">
                              <button
                                type="button"
                                class="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius)] text-text-muted hover:text-danger hover:bg-danger-soft/40 transition-colors cursor-pointer"
                                (click)="revoke(k.id)"
                                [attr.aria-label]="t().keys.revocar"
                                [attr.title]="t().keys.revocar"
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  class="h-4 w-4"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2"
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  aria-hidden="true"
                                >
                                  <path d="M3 6h18" />
                                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                                  <line x1="10" x2="10" y1="11" y2="17" />
                                  <line x1="14" x2="14" y1="17" y2="11" />
                                </svg>
                              </button>
                              <span
                                class="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden rounded bg-surface-2 border border-border px-2 py-0.5 text-xs text-text whitespace-nowrap shadow-lg group-hover:block z-30"
                              >
                                {{ t().keys.revocar }}
                              </span>
                            </div>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              }
            </div>

            <!-- Footer del modal -->
            <div class="mt-4 pt-3.5 border-t border-border flex justify-end">
              <button uiButton variant="secondary" size="sm" (click)="modalOpen.set(false)">
                {{ t().keys.cerrar }}
              </button>
            </div>
          </div>
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
  sortedKeys = computed(() => {
    return [...this.keys()].sort((a, b) => {
      const aRevoked = !!a.revokedAt;
      const bRevoked = !!b.revokedAt;
      const aInUse = !aRevoked && !!a.lastUsedAt;
      const bInUse = !bRevoked && !!b.lastUsedAt;

      // 1. Las que están en uso al principio de la lista
      if (aInUse !== bInUse) return aInUse ? -1 : 1;
      // 2. Activas sin usar antes que revocadas
      if (aRevoked !== bRevoked) return aRevoked ? 1 : -1;
      // 3. Entre las que están en uso: más reciente último uso primero
      if (aInUse && bInUse && a.lastUsedAt && b.lastUsedAt) {
        const diff = new Date(b.lastUsedAt.replace(' ', 'T')).getTime() - new Date(a.lastUsedAt.replace(' ', 'T')).getTime();
        if (diff !== 0) return diff;
      }
      // 4. Por defecto: más reciente creación primero
      return new Date(b.createdAt.replace(' ', 'T')).getTime() - new Date(a.createdAt.replace(' ', 'T')).getTime();
    });
  });
  visibleKeys = computed(() => this.sortedKeys().slice(0, 4));
  modalOpen = signal(false);
  created = signal<string | null>(null);
  error = signal<string | null>(null);
  busy = signal(false);

  @HostListener('window:keydown.escape')
  onEscape(): void {
    if (this.modalOpen()) {
      this.modalOpen.set(false);
    }
  }

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
    if (isNaN(d.getTime())) return iso;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    return `${day}/${month}/${year}`;
  }

  async generate(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await firstValueFrom(this.api.post<{ created: string }>('/keys', { name: this.name }));
      this.created.set(r.created);
      this.name = '';
      await copyToClipboard(r.created);
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

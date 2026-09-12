import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { UI } from '../../shared/ui';

type Top = { slug: string; title: string; hits: number; personas: number };
type Team = { team: string; hits: number; skills: number };
type Miss = { query_text: string; veces: number };

/** Puerto de src/app/(app)/insights/page.tsx con layout Bento Grid moderno. */
@Component({
  selector: 'app-insights',
  imports: [RouterLink, ...UI],
  template: `
    <div class="space-y-6">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">{{ t().insights.titulo }}</h1>
        <p class="mt-1 text-sm text-text-muted">{{ t().insights.subtitulo }}</p>
      </div>

      @if (loading()) {
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-pulse" aria-label="Cargando telemetría">
          <div class="lg:col-span-7 h-72 rounded-[var(--radius-lg)] bg-surface-2 border border-border"></div>
          <div class="lg:col-span-5 h-72 rounded-[var(--radius-lg)] bg-surface-2 border border-border"></div>
          <div class="lg:col-span-12 h-48 rounded-[var(--radius-lg)] bg-surface-2 border border-border"></div>
        </div>
      } @else {
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <!-- Panel 1: Top Skills (7 columnas) -->
          <section uiCard class="lg:col-span-7 flex flex-col justify-between">
            <div class="p-4 border-b border-border bg-surface-2/40 flex items-center justify-between">
              <h2 class="text-sm font-semibold text-text flex items-center gap-2">
                <svg viewBox="0 0 24 24" class="h-4 w-4 text-accent" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 20v-6M6 20V10M18 20V4" />
                </svg>
                <span>{{ t().insights.masConsultados }}</span>
              </h2>
              @if (top().length > 0) {
                <span uiBadge tone="accent">{{ top().length }}</span>
              }
            </div>

            @if (top().length === 0) {
              <div class="p-6">
                <ui-empty-state [title]="t().insights.sinConsultas" [hint]="t().insights.sinConsultasHint" />
              </div>
            } @else {
              <div class="divide-y divide-border">
                @for (r of top(); track r.slug; let i = $index) {
                  <div class="flex items-center justify-between gap-4 p-4 hover:bg-surface-2/60 transition-colors">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="font-mono text-xs text-text-faint w-4">{{ i + 1 }}</span>
                        <a [routerLink]="['/skills', r.slug]" class="text-sm font-medium text-text hover:text-accent hover:underline truncate">
                          {{ r.title }}
                        </a>
                      </div>
                      <div class="mt-2 h-1 w-full max-w-xs rounded-full bg-surface-2 border border-border/50 overflow-hidden">
                        <div class="h-full bg-accent rounded-full transition-all duration-500" [style.width.%]="(r.hits / maxHits()) * 100"></div>
                      </div>
                    </div>
                    <span uiBadge tone="neutral" class="font-mono text-xs shrink-0">
                      {{ r.hits }} {{ r.hits === 1 ? t().insights.consulta : t().insights.consultas }} · {{ r.personas }} {{ r.personas === 1 ? t().insights.persona : t().insights.personas }}
                    </span>
                  </div>
                }
              </div>
            }
          </section>

          <!-- Panel 2: Lo que falta / Búsquedas sin resultado (5 columnas) -->
          <section uiCard class="lg:col-span-5 flex flex-col justify-between border-warning/30">
            <div class="p-4 border-b border-border bg-warning-soft/20 flex items-center justify-between">
              <div>
                <h2 class="text-sm font-semibold text-warning flex items-center gap-2">
                  <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{{ t().insights.faltaTitulo }}</span>
                </h2>
                <p class="mt-0.5 text-xs text-text-faint">{{ t().insights.faltaSubtitulo }}</p>
              </div>
              @if (missed().length > 0) {
                <span uiBadge tone="warning">{{ missed().length }}</span>
              }
            </div>

            @if (missed().length === 0) {
              <div class="p-6">
                <ui-empty-state [title]="t().insights.faltaVacio" />
              </div>
            } @else {
              <div class="divide-y divide-border">
                @for (m of missed(); track m.query_text) {
                  <div class="flex items-center justify-between gap-3 p-3.5 hover:bg-surface-2/60 transition-colors">
                    <span class="font-mono text-xs text-text truncate">"{{ m.query_text }}"</span>
                    <span uiBadge tone="warning">{{ m.veces }}×</span>
                  </div>
                }
              </div>
            }
          </section>

          <!-- Panel 3: Adopción por equipo (12 columnas) -->
          <section uiCard class="lg:col-span-12">
            <div class="p-4 border-b border-border bg-surface-2/40 flex items-center justify-between">
              <div>
                <h2 class="text-sm font-semibold text-text flex items-center gap-2">
                  <svg viewBox="0 0 24 24" class="h-4 w-4 text-accent" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  <span>{{ t().insights.adopcion }}</span>
                </h2>
                <p class="mt-0.5 text-xs text-text-faint">{{ t().insights.adopcionSubtitulo }}</p>
              </div>
              @if (teams().length > 0) {
                <span uiBadge tone="neutral">{{ teams().length }}</span>
              }
            </div>

            @if (teams().length === 0) {
              <div class="p-6">
                <ui-empty-state [title]="t().insights.adopcionVacio" />
              </div>
            } @else {
              <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
                @for (row of teams(); track row.team) {
                  <div class="p-3.5 rounded-[var(--radius)] bg-surface-2 border border-border flex flex-col justify-between transition-[border-color,box-shadow,transform] duration-[var(--dur-fast)] hover:border-border-strong hover:bg-surface-2/80">
                    <span class="font-semibold text-sm truncate" [title]="row.team">{{ row.team }}</span>
                    <div class="mt-3 flex items-baseline justify-between">
                      <span class="font-mono text-xl font-bold" [class.text-text]="row.hits > 0" [class.text-text-faint]="row.hits === 0">
                        {{ row.hits }}
                      </span>
                      <span class="text-xs text-text-faint">
                        {{ row.hits === 1 ? t().insights.consulta : t().insights.consultas }}
                      </span>
                    </div>
                    <div class="mt-2 pt-2 border-t border-border text-xs text-text-faint flex items-center justify-between">
                      <span>{{ t().insights.sobre }} {{ row.skills }} {{ t().insights.skills }}</span>
                      @if (row.hits === 0) {
                        <span uiBadge tone="warning" class="text-[10px] py-0 px-1.5">0 {{ t().insights.consultas }}</span>
                      }
                    </div>
                  </div>
                }
              </div>
            }
          </section>
        </div>
      }
    </div>
  `,
})
export class Insights {
  private api = inject(Api);
  private i18n = inject(I18n);
  t = this.i18n.t;
  top = signal<Top[]>([]);
  teams = signal<Team[]>([]);
  missed = signal<Miss[]>([]);
  loading = signal(true);

  maxHits = computed(() => Math.max(...this.top().map((t) => t.hits), 1));

  constructor() {
    firstValueFrom(this.api.get<{ top: Top[]; teams: Team[]; missed: Miss[] }>('/insights'))
      .then((r) => {
        this.top.set(r.top);
        this.teams.set(r.teams);
        this.missed.set(r.missed);
      })
      .finally(() => this.loading.set(false));
  }
}


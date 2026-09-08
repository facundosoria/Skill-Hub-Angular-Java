import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { UI } from '../../shared/ui';

type Top = { slug: string; title: string; hits: number; personas: number };
type Team = { team: string; hits: number; skills: number };
type Miss = { query_text: string; veces: number };

/** Puerto de src/app/(app)/insights/page.tsx. */
@Component({
  selector: 'app-insights',
  imports: [RouterLink, ...UI],
  template: `
    <div class="space-y-10">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">{{ t().insights.titulo }}</h1>
        <p class="mt-1 text-sm text-text-muted">{{ t().insights.subtitulo }}</p>
      </div>

      <section>
        <h2 class="mb-2 text-[13px] text-text-muted">{{ t().insights.faltaTitulo }}</h2>
        <p class="mb-3 text-xs text-text-faint">{{ t().insights.faltaSubtitulo }}</p>
        @if (missed().length === 0) {
          <ui-empty-state [title]="t().insights.faltaVacio" />
        } @else {
          <div uiCard class="divide-y divide-border">
            @for (m of missed(); track m.query_text) {
              <div class="flex items-baseline gap-3 px-4 py-2.5">
                <span class="text-sm">{{ m.query_text }}</span>
                <span class="ml-auto font-mono text-xs text-text-faint">{{ m.veces }}×</span>
              </div>
            }
          </div>
        }
      </section>

      <section>
        <h2 class="mb-3 text-[13px] text-text-muted">{{ t().insights.masConsultados }}</h2>
        @if (top().length === 0) {
          <ui-empty-state [title]="t().insights.sinConsultas" [hint]="t().insights.sinConsultasHint" />
        } @else {
          <div uiCard class="divide-y divide-border">
            @for (r of top(); track r.slug) {
              <div class="flex items-baseline gap-3 px-4 py-2.5">
                <a [routerLink]="['/skills', r.slug]" class="text-sm hover:underline">{{ r.title }}</a>
                <span class="ml-auto text-xs text-text-faint">{{ r.hits }} · {{ r.personas }}</span>
              </div>
            }
          </div>
        }
      </section>

      <section>
        <h2 class="mb-2 text-[13px] text-text-muted">{{ t().insights.adopcion }}</h2>
        @if (teams().length === 0) {
          <ui-empty-state [title]="t().insights.adopcionVacio" />
        } @else {
          <div uiCard class="divide-y divide-border">
            @for (row of teams(); track row.team) {
              <div class="flex items-baseline gap-3 px-4 py-2.5">
                <span class="text-sm">{{ row.team }}</span>
                <span class="ml-auto text-xs text-text-faint">
                  {{ row.hits }} {{ t().insights.consultas }} {{ t().insights.sobre }} {{ row.skills }} {{ t().insights.skills }}
                </span>
              </div>
            }
          </div>
        }
      </section>
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

  constructor() {
    firstValueFrom(this.api.get<{ top: Top[]; teams: Team[]; missed: Miss[] }>('/insights')).then((r) => {
      this.top.set(r.top);
      this.teams.set(r.teams);
      this.missed.set(r.missed);
    });
  }
}

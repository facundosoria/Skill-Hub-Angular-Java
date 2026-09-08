import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { SkillService } from '../../core/skills';
import type { SkillListItem } from '../../core/models';
import { UI } from '../../shared/ui';
import { AnimDelayPipe } from '../../shared/anim-delay.pipe';

/** Puerto de src/app/(app)/skills/page.tsx + skill-browser.tsx. */
@Component({
  selector: 'app-skills-list',
  imports: [FormsModule, RouterLink, AnimDelayPipe, ...UI],
  template: `
    <div class="mb-7 flex items-end justify-between gap-4 anim-pop-in">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">{{ t().catalogo.titulo }}</h1>
        <p class="mt-1.5 text-sm text-text-muted">{{ t().catalogo.subtitulo }}</p>
      </div>
      <a routerLink="/skills/new"><button uiButton>{{ t().catalogo.nuevoSkill }}</button></a>
    </div>

    <div class="mb-4 flex flex-wrap items-center gap-2">
      <input uiInput class="max-w-xs" [(ngModel)]="query" [placeholder]="t().catalogo.buscar"
             [attr.aria-label]="t().catalogo.buscarAria" />
      <select uiSelect [(ngModel)]="stack">
        <option value="">{{ t().catalogo.todo }}</option>
        <option value="angular">Angular</option>
        <option value="java">Java</option>
        <option value="shared">{{ t().catalogo.compartido }}</option>
        <option value="infra">{{ t().catalogo.infra }}</option>
      </select>
    </div>

    @if (loading()) {
      <div class="space-y-2.5">
        @for (i of [1,2,3,4,5]; track i) {
          <div class="h-16 animate-pulse rounded-[var(--radius)] bg-surface-2"></div>
        }
      </div>
    } @else if (visible().length === 0) {
      <ui-empty-state [title]="t().catalogo.sinResultados" [hint]="t().catalogo.sinResultadosHint" />
    } @else {
      <div uiCard class="divide-y divide-border">
        @for (s of visible(); track s.slug; let i = $index) {
          <a [routerLink]="['/skills', s.slug]"
             animate.enter="anim-row-in" [style.animationDelay]="i | animDelay"
             class="group flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3.5 transition-colors duration-[var(--dur-fast)] hover:bg-surface-2">
            <span class="text-sm font-medium transition-transform duration-[var(--dur-fast)] group-hover:translate-x-0.5">{{ s.title }}</span>
            <span uiBadge tone="accent">{{ s.stack }}</span>
            @if (s.status !== 'published') { <ui-status-badge [status]="s.status" /> }
            <span class="font-mono text-xs text-text-faint">v{{ s.version }}</span>
            <span class="ml-auto text-xs text-text-faint">
              {{ s.usos90d }} {{ s.usos90d === 1 ? t().insights.consulta : t().insights.consultas }}
              @if (s.personas > 0) {
                · {{ s.personas }} {{ s.personas === 1 ? t().insights.persona : t().insights.personas }}
              }
            </span>
          </a>
        }
      </div>
    }
  `,
})
export class SkillsList {
  private skills = inject(SkillService);
  private i18n = inject(I18n);
  private auth = inject(AuthService);
  t = this.i18n.t;

  all = signal<SkillListItem[]>([]);
  loading = signal(true);
  query = signal('');
  stack = signal('');

  visible = computed(() => {
    const q = this.query().trim().toLowerCase();
    const st = this.stack();
    return this.all().filter((s) => {
      if (st && s.stack !== st) return false;
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.whenToUse.toLowerCase().includes(q) ||
        s.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  });

  constructor() {
    this.skills
      .list()
      .then((rows) => this.all.set(rows))
      .finally(() => this.loading.set(false));
  }
}

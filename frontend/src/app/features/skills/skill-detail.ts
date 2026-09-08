import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { SkillService } from '../../core/skills';
import type { SkillDetail } from '../../core/models';
import { UI } from '../../shared/ui';

/**
 * Puerto (parcial, solo lectura) de src/app/(app)/skills/[slug]/page.tsx.
 * Las acciones (publicar, deprecar, votar) y el render de markdown enriquecido
 * quedan para la siguiente iteracion.
 */
@Component({
  selector: 'app-skill-detail',
  imports: [RouterLink, ...UI],
  template: `
    <a routerLink="/skills" class="text-[13px] text-text-muted hover:text-text">{{ t().skill.volver }}</a>

    @if (data(); as d) {
      <div class="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <h1 class="text-xl font-medium">{{ d.skill.title }}</h1>
        <span uiBadge tone="accent">{{ d.skill.stack }}</span>
        <span uiBadge>{{ d.skill.type }}</span>
        <ui-status-badge [status]="d.skill.status" />
        <span class="ml-auto font-mono text-xs text-text-faint">v{{ d.skill.version?.version ?? 1 }}</span>
      </div>

      <p class="mt-2 text-sm text-text-muted">{{ d.skill.description }}</p>

      <div uiCard class="mt-4 bg-surface-2 p-3">
        <p class="text-[11px] uppercase tracking-wide text-text-faint">{{ t().skill.cuandoUsarlo }}</p>
        <p class="mt-1 text-sm">{{ d.skill.whenToUse }}</p>
      </div>

      @if (d.skill.status === 'deprecated') {
        <div class="mt-4 rounded-[var(--radius)] border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
          {{ t().skill.deprecadoAviso }}
          @if (d.skill.supersededBySlug) {
            {{ t().skill.deprecadoUsa }}
            <a [routerLink]="['/skills', d.skill.supersededBySlug]" class="underline">{{ d.skill.supersededBySlug }}</a>
          }
        </div>
      }

      <article class="prose-skill mt-6">
        <pre class="overflow-x-auto whitespace-pre-wrap rounded-[var(--radius)] border border-border bg-surface-2 p-4 text-[13px]">{{ d.skill.version?.content }}</pre>
      </article>

      @if (d.related.length) {
        <section class="mt-8">
          <h2 class="mb-2 text-[13px] text-text-muted">{{ t().skill.relacionados }}</h2>
          <div class="flex flex-wrap gap-2">
            @for (r of d.related; track r.slug) {
              <a [routerLink]="['/skills', r.slug]"
                 class="rounded-[var(--radius)] border border-border bg-surface px-3 py-1.5 text-sm hover:border-border-strong">
                {{ r.title }} <span class="text-xs text-text-faint">· {{ r.stack }}</span>
              </a>
            }
          </div>
        </section>
      }

      <section class="mt-8">
        <h2 class="mb-2 text-[13px] text-text-muted">{{ t().skill.historial }}</h2>
        <div uiCard class="divide-y divide-border text-sm">
          @for (h of d.history; track h.version) {
            <div class="flex items-baseline gap-3 px-4 py-2">
              <span class="font-mono text-xs">v{{ h.version }}</span>
              <span class="text-text-muted">{{ h.changelog || t().skill.sinNota }}</span>
              <span class="ml-auto text-xs text-text-faint">{{ h.authorName || h.authorUsername }}</span>
            </div>
          }
        </div>
      </section>

      @if (canEdit()) {
        <div class="mt-8 flex gap-2 border-t border-border pt-4">
          <a [routerLink]="['/skills', d.skill.slug, 'edit']">
            <button uiButton size="sm" variant="secondary">{{ t().skill.proponerCambio }}</button>
          </a>
        </div>
      }
    } @else if (error()) {
      <p class="mt-6 text-sm text-danger">{{ error() }}</p>
    } @else {
      <div class="mt-6 h-40 animate-pulse rounded-md bg-surface-2"></div>
    }
  `,
})
export class SkillDetailPage {
  slug = input.required<string>();

  private skills = inject(SkillService);
  private i18n = inject(I18n);
  private auth = inject(AuthService);
  t = this.i18n.t;

  data = signal<SkillDetail | null>(null);
  error = signal<string | null>(null);
  canEdit = computed(() => !!this.auth.user());

  constructor() {
    // input() como signal: el router lo setea via withComponentInputBinding()
    queueMicrotask(() => this.load());
  }

  private load(): void {
    this.skills
      .get(this.slug())
      .then((d) => this.data.set(d))
      .catch(() => this.error.set('No existe el skill'));
  }
}

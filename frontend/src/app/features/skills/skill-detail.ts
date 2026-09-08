import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { SkillService } from '../../core/skills';
import type { SkillDetail } from '../../core/models';
import { UI } from '../../shared/ui';
import { SkillMarkdown } from '../../shared/skill-markdown';
import { SkillPreview } from '../../shared/skill-preview';
import { AnimDelayPipe } from '../../shared/anim-delay.pipe';
import { apiError } from '../auth/login';

/** Puerto de src/app/(app)/skills/[slug]/page.tsx + skill-actions + edit-vote-banner. */
@Component({
  selector: 'app-skill-detail',
  imports: [FormsModule, RouterLink, SkillMarkdown, SkillPreview, AnimDelayPipe, ...UI],
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
            {{ t().skill.deprecadoEnLugar }}
          } @else {
            {{ t().skill.deprecadoSinReemplazo }}
          }
        </div>
      }

      <!-- Banner de votacion de una edicion pendiente -->
      @if (user() && d.voteStatus; as vs) {
        <div class="mt-4 rounded-[var(--radius)] border border-accent/30 bg-accent-soft p-3"
             animate.enter="anim-panel-in" animate.leave="anim-panel-out">
          <p class="text-sm">{{ t().votos.pendiente }}</p>
          <p class="mt-0.5 text-xs text-text-faint">{{ t().votos.pendienteHint }}</p>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <span class="text-sm font-medium">{{ vs.votes }} / {{ vs.required }} {{ t().votos.necesarios }}</span>
            @if (vs.esAutor) {
              <span class="text-xs text-text-faint">{{ t().votos.propioNoVota }}</span>
            } @else if (vs.yaVoto) {
              <span class="text-xs text-text-faint">{{ t().votos.yaVotaste }}</span>
            } @else {
              <button uiButton size="sm" [disabled]="busy()" (click)="act(skills.vote(slug()))">
                {{ busy() ? t().votos.votando : t().votos.votar }}
              </button>
            }
            @if (auth.isAdmin) {
              <button uiButton size="sm" variant="secondary" [disabled]="busy()"
                      [title]="t().votos.aplicarAhoraHint" (click)="act(skills.applyEdit(slug()))">
                {{ t().votos.aplicarAhora }}
              </button>
              <button uiButton size="sm" variant="ghost" [disabled]="busy()"
                      (click)="act(skills.discardEdit(slug()))">
                {{ t().votos.descartar }}
              </button>
            }
          </div>
        </div>
      }

      @if (d.skill.version?.preview) {
        <section class="mt-6">
          <h2 class="mb-2 text-[13px] text-text-muted">{{ t().skill.resultado }}</h2>
          <skill-preview [html]="d.skill.version!.preview!" />
        </section>
      }

      <article class="mt-6">
        <skill-markdown [content]="d.skill.version?.content ?? ''" />
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
        <ol class="space-y-1">
          @for (h of d.history; track h.version; let i = $index) {
            <li animate.enter="anim-row-in" [style.animationDelay]="i | animDelay:30:6"
                class="flex flex-wrap items-baseline gap-x-2 rounded-[var(--radius)] px-2 py-1.5 text-sm hover:bg-surface-2">
              <a [routerLink]="['/skills', slug()]" [queryParams]="{ v: h.version }" class="font-mono text-xs text-accent">v{{ h.version }}</a>
              @if (h.version === (d.skill.version?.version ?? 1)) { <span class="text-xs text-text-faint">{{ t().skill.viendo }}</span> }
              <span class="text-text-muted">{{ h.changelog || t().skill.sinNota }}</span>
              <span class="ml-auto text-xs text-text-faint">{{ h.authorName || h.authorUsername || '—' }}</span>
              @if (h.version > 1) {
                <a [routerLink]="['/skills', slug(), 'diff']" [queryParams]="{ a: h.version - 1, b: h.version }"
                   class="text-xs text-text-muted underline underline-offset-2 hover:text-text">{{ t().skill.verDiff }}</a>
              }
            </li>
          }
        </ol>
      </section>

      <!-- Acciones -->
      @if (user()) {
        <div class="mt-10 flex flex-wrap items-center gap-2 border-t border-border pt-6">
          <a [routerLink]="['/skills', slug(), 'edit']">
            <button uiButton size="sm" variant="secondary">{{ t().skill.proponerCambio }}</button>
          </a>
          @if (auth.isAdmin && d.skill.status === 'draft') {
            <button uiButton size="sm" [disabled]="busy()" (click)="act(skills.publish(slug()))">
              {{ busy() ? t().skill.publicando : t().skill.publicar }}
            </button>
          }
          @if (auth.isAdmin && d.skill.status !== 'deprecated') {
            <button uiButton size="sm" variant="ghost" (click)="deprecating.set(!deprecating())">
              {{ t().skill.deprecar }}
            </button>
          }

          @if (deprecating()) {
            <div class="mt-3 w-full rounded-[var(--radius)] border border-border bg-surface-2 p-3"
                 animate.enter="anim-panel-in" animate.leave="anim-panel-out">
              <p class="text-sm text-text-muted">{{ t().skill.deprecarExplicacion }}</p>
              <div class="mt-2 flex flex-wrap gap-2">
                <input uiInput class="max-w-xs" [(ngModel)]="replacement" [placeholder]="t().skill.slugReemplazo" />
                <button uiButton size="sm" variant="danger" [disabled]="busy()"
                        (click)="act(skills.deprecate(slug(), replacement.trim() || null)); deprecating.set(false)">
                  {{ t().skill.confirmar }}
                </button>
              </div>
            </div>
          }

          @if (error()) { <p class="w-full text-xs text-danger">{{ error() }}</p> }
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

  /** El query param `?v=` llega como input via withComponentInputBinding(). */
  v = input<string | undefined>(undefined);

  skills = inject(SkillService);
  auth = inject(AuthService);
  private i18n = inject(I18n);
  t = this.i18n.t;
  user = this.auth.user;

  data = signal<SkillDetail | null>(null);
  error = signal<string | null>(null);
  busy = signal(false);
  deprecating = signal(false);
  replacement = '';

  private version = computed(() => (this.v() ? Number(this.v()) : undefined));

  constructor() {
    // slug (input) y version (?v=) son signals: recargar cuando cambian.
    effect(() => {
      this.slug();
      this.version();
      untracked(() => this.load());
    });
  }

  private async load(): Promise<void> {
    this.data.set(null);
    this.error.set(null);
    try {
      this.data.set(await this.skills.get(this.slug(), this.version()));
    } catch {
      this.error.set('No existe el skill');
    }
  }

  /** Corre una accion (publish/deprecate/vote/...) y recarga. */
  async act(p: Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await p;
      await this.load();
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}

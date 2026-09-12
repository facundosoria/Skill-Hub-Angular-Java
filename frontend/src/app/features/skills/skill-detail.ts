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

type CatalogSection = 'skills' | 'plugins' | 'contracts';

/** Puerto de src/app/(app)/skills/[slug]/page.tsx + skill-actions + edit-vote-banner. */
@Component({
  selector: 'app-skill-detail',
  imports: [FormsModule, RouterLink, SkillMarkdown, SkillPreview, AnimDelayPipe, ...UI],
  template: `
    <a [routerLink]="basePath()" class="text-[13px] text-text-muted hover:text-text">← {{ sectionLabel() }}</a>

    @if (data(); as d) {
      <div class="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <h1 class="text-2xl font-semibold tracking-tight">{{ d.skill.title }}</h1>
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

      @if (d.skill.version?.artifact; as artifact) {
        <section uiCard class="mt-4 flex flex-wrap items-center gap-3 bg-surface-2 p-3" [attr.aria-label]="t().skill.archivoAdjunto">
          <div class="min-w-0 flex-1">
            <p class="text-[11px] uppercase tracking-wide text-text-faint">{{ t().skill.archivoAdjunto }}</p>
            <p class="truncate font-mono text-sm">{{ artifact.fileName }}</p>
            <p class="text-xs text-text-faint">{{ formatBytes(artifact.sizeBytes) }} · {{ artifact.contentType }}</p>
          </div>
          <a [href]="artifactUrl(d.skill.version!.version)"
             class="inline-flex h-9 items-center justify-center rounded-[var(--radius)] border border-accent bg-accent px-3.5 text-[13px] font-medium text-accent-fg shadow-[var(--shadow-sm)] transition hover:brightness-110 focus-visible:outline-none focus-visible:shadow-[var(--ring)]">
            {{ t().skill.descargarArchivo }}
          </a>
        </section>
      }

      @if (d.skill.status === 'deprecated') {
        <div class="mt-4 rounded-[var(--radius)] border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
          {{ t().skill.deprecadoAviso }}
          @if (d.skill.supersededBySlug) {
            {{ t().skill.deprecadoUsa }}
            <a [routerLink]="[basePath(), d.skill.supersededBySlug]" class="underline">{{ d.skill.supersededBySlug }}</a>
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

      <section uiCard class="mt-8 p-4" [attr.aria-label]="t().skill.calificaciones">
        <h2 class="text-[13px] text-text-muted">{{ t().skill.calificaciones }}</h2>

        @if (user()) {
          <form class="mt-3 border-b border-border pb-4" (ngSubmit)="submitRating()">
            <p class="text-sm font-medium">{{ t().skill.puntuar }}</p>
            <div class="rating-demo mt-2" role="radiogroup" [attr.aria-label]="t().skill.puntuar">
              @for (star of ratingStars; track star) {
                <input [class]="'rating-demo__input rating-demo__input-' + star" [id]="'rating-' + star" type="radio" name="skill-rating"
                       [value]="star" [checked]="selectedRating() === star" [disabled]="busy()"
                       (change)="selectRating(star)" />
              }
              @for (star of ratingStars; track star) {
                <label class="rating-demo__label" [for]="'rating-' + star"
                       [class.rating-demo__label--delay1]="ratingDelays()[star - 1] === 1"
                       [class.rating-demo__label--delay2]="ratingDelays()[star - 1] === 2"
                       [class.rating-demo__label--delay3]="ratingDelays()[star - 1] === 3"
                       [class.rating-demo__label--delay4]="ratingDelays()[star - 1] === 4">
                  <svg class="rating-star" viewBox="0 0 32 32" aria-hidden="true">
                    <g transform="translate(16,16)">
                      <circle class="rating-star__ring" fill="none" stroke-width="16" r="8" transform="scale(0)" />
                    </g>
                    <g stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <g transform="translate(16,16) rotate(180)">
                        <polygon class="rating-star__stroke" points="0,15 4.41,6.07 14.27,4.64 7.13,-2.32 8.82,-12.14 0,-7.5 -8.82,-12.14 -7.13,-2.32 -14.27,4.64 -4.41,6.07" fill="none" />
                        <polygon class="rating-star__fill" points="0,15 4.41,6.07 14.27,4.64 7.13,-2.32 8.82,-12.14 0,-7.5 -8.82,-12.14 -7.13,-2.32 -14.27,4.64 -4.41,6.07" />
                      </g>
                      <g class="rating-star__lines" transform="translate(16,16)">
                        <polyline transform="rotate(0)" points="0 4,0 16" />
                        <polyline transform="rotate(72)" points="0 4,0 16" />
                        <polyline transform="rotate(144)" points="0 4,0 16" />
                        <polyline transform="rotate(216)" points="0 4,0 16" />
                        <polyline transform="rotate(288)" points="0 4,0 16" />
                      </g>
                    </g>
                  </svg>
                  <span class="rating-demo__sr">{{ star }} {{ ratingLabel(star) }}</span>
                </label>
              }
              @if (selectedRating()) {
                <p class="rating-demo__display" aria-live="polite">{{ ratingLabel(selectedRating()) }}</p>
              }
            </div>
            <label class="mt-3 block text-[13px] font-medium text-text-muted" for="rating-comment">
              {{ t().skill.comentario }}
            </label>
            <textarea id="rating-comment" uiTextarea class="mt-1.5 min-h-24" name="rating-comment"
                      [(ngModel)]="ratingComment" [disabled]="busy()" maxlength="2000"
                      [placeholder]="t().skill.comentarioPlaceholder" required></textarea>
            <div class="mt-3 flex items-center gap-3">
              <button uiButton size="sm" type="submit" [disabled]="busy() || !selectedRating() || !ratingComment.trim()">
                {{ busy() ? t().skill.enviandoCalificacion : t().skill.enviarCalificacion }}
              </button>
              @if (error()) { <p class="text-xs text-danger">{{ error() }}</p> }
            </div>
          </form>
        }

        @if (d.ratings.length) {
          <ol class="mt-4 space-y-4">
            @for (rating of d.ratings; track rating.voterName + rating.updatedAt) {
              <li class="border-b border-border pb-4 last:border-0 last:pb-0">
                <div class="text-lg leading-none text-warning" role="img" [attr.aria-label]="rating.rating + ' / 5'">
                  {{ stars(rating.rating) }}
                </div>
                <p class="mt-2 text-sm font-medium">{{ rating.voterName }}</p>
                <p class="mt-1 whitespace-pre-wrap text-sm text-text-muted">{{ rating.comment }}</p>
              </li>
            }
          </ol>
        } @else {
          <p class="mt-3 text-sm text-text-faint">{{ t().skill.sinCalificaciones }}</p>
        }
      </section>

      @if (d.related.length) {
        <section class="mt-8">
          <h2 class="mb-2 text-[13px] text-text-muted">{{ t().skill.relacionados }}</h2>
          <div class="flex flex-wrap gap-2">
            @for (r of d.related; track r.slug) {
              <a [routerLink]="[basePath(), r.slug]"
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
              <a [routerLink]="[basePath(), slug()]" [queryParams]="{ v: h.version }" class="font-mono text-xs text-accent">v{{ h.version }}</a>
              @if (h.version === (d.skill.version?.version ?? 1)) { <span class="text-xs text-text-faint">{{ t().skill.viendo }}</span> }
              <span class="text-text-muted">{{ h.changelog || t().skill.sinNota }}</span>
              <span class="ml-auto text-xs text-text-faint">{{ h.authorName || h.authorUsername || '—' }}</span>
              @if (h.version > 1) {
                <a [routerLink]="[basePath(), slug(), 'diff']" [queryParams]="{ a: h.version - 1, b: h.version }"
                   class="text-xs text-text-muted underline underline-offset-2 hover:text-text">{{ t().skill.verDiff }}</a>
              }
            </li>
          }
        </ol>
      </section>

      <!-- Acciones -->
      @if (user()) {
        <div class="mt-10 flex flex-wrap items-center gap-2 border-t border-border pt-6">
          <a [routerLink]="[basePath(), slug(), 'edit']">
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
  styles: `
    .rating-demo { display: flex; align-items: center; }
    .rating-demo__input { position: absolute; appearance: none; }
    .rating-demo__label { cursor: pointer; padding: 0.125rem; }
    .rating-demo__input-1:focus-visible ~ .rating-demo__label:nth-of-type(1),
    .rating-demo__input-2:focus-visible ~ .rating-demo__label:nth-of-type(2),
    .rating-demo__input-3:focus-visible ~ .rating-demo__label:nth-of-type(3),
    .rating-demo__input-4:focus-visible ~ .rating-demo__label:nth-of-type(4),
    .rating-demo__input-5:focus-visible ~ .rating-demo__label:nth-of-type(5) {
      outline: 2px solid var(--accent); outline-offset: 2px; border-radius: var(--radius);
    }
    .rating-star { display: block; width: 2rem; height: 2rem; overflow: visible; pointer-events: none; }
    .rating-star__ring, .rating-star__fill, .rating-star__lines, .rating-star__stroke { animation-duration: 1s; animation-timing-function: ease-in-out; animation-fill-mode: forwards; }
    .rating-star__ring, .rating-star__lines { stroke: var(--warning); }
    .rating-star__stroke { stroke: currentColor; }
    .rating-star__fill { fill: var(--warning); transform: scale(0); transform-origin: center; }
    .rating-star__lines { stroke-dasharray: 12 13; stroke-dashoffset: -13; }
    .rating-demo__input-1:hover ~ .rating-demo__label:nth-of-type(-n + 1) .rating-star__stroke,
    .rating-demo__input-2:hover ~ .rating-demo__label:nth-of-type(-n + 2) .rating-star__stroke,
    .rating-demo__input-3:hover ~ .rating-demo__label:nth-of-type(-n + 3) .rating-star__stroke,
    .rating-demo__input-4:hover ~ .rating-demo__label:nth-of-type(-n + 4) .rating-star__stroke,
    .rating-demo__input-5:hover ~ .rating-demo__label:nth-of-type(-n + 5) .rating-star__stroke { stroke: var(--warning); transform: scale(1); }
    .rating-demo__input:nth-of-type(1):checked ~ .rating-demo__label:nth-of-type(-n + 1) .rating-star__ring,
    .rating-demo__input:nth-of-type(2):checked ~ .rating-demo__label:nth-of-type(-n + 2) .rating-star__ring,
    .rating-demo__input:nth-of-type(3):checked ~ .rating-demo__label:nth-of-type(-n + 3) .rating-star__ring,
    .rating-demo__input:nth-of-type(4):checked ~ .rating-demo__label:nth-of-type(-n + 4) .rating-star__ring,
    .rating-demo__input:nth-of-type(5):checked ~ .rating-demo__label:nth-of-type(-n + 5) .rating-star__ring { animation-name: rating-ring; }
    .rating-demo__input:nth-of-type(1):checked ~ .rating-demo__label:nth-of-type(-n + 1) .rating-star__stroke,
    .rating-demo__input:nth-of-type(2):checked ~ .rating-demo__label:nth-of-type(-n + 2) .rating-star__stroke,
    .rating-demo__input:nth-of-type(3):checked ~ .rating-demo__label:nth-of-type(-n + 3) .rating-star__stroke,
    .rating-demo__input:nth-of-type(4):checked ~ .rating-demo__label:nth-of-type(-n + 4) .rating-star__stroke,
    .rating-demo__input:nth-of-type(5):checked ~ .rating-demo__label:nth-of-type(-n + 5) .rating-star__stroke { animation-name: rating-stroke; }
    .rating-demo__input:nth-of-type(1):checked ~ .rating-demo__label:nth-of-type(-n + 1) .rating-star__fill,
    .rating-demo__input:nth-of-type(2):checked ~ .rating-demo__label:nth-of-type(-n + 2) .rating-star__fill,
    .rating-demo__input:nth-of-type(3):checked ~ .rating-demo__label:nth-of-type(-n + 3) .rating-star__fill,
    .rating-demo__input:nth-of-type(4):checked ~ .rating-demo__label:nth-of-type(-n + 4) .rating-star__fill,
    .rating-demo__input:nth-of-type(5):checked ~ .rating-demo__label:nth-of-type(-n + 5) .rating-star__fill { animation-name: rating-fill; }
    .rating-demo__input:nth-of-type(1):checked ~ .rating-demo__label:nth-of-type(-n + 1) .rating-star__lines,
    .rating-demo__input:nth-of-type(2):checked ~ .rating-demo__label:nth-of-type(-n + 2) .rating-star__lines,
    .rating-demo__input:nth-of-type(3):checked ~ .rating-demo__label:nth-of-type(-n + 3) .rating-star__lines,
    .rating-demo__input:nth-of-type(4):checked ~ .rating-demo__label:nth-of-type(-n + 4) .rating-star__lines,
    .rating-demo__input:nth-of-type(5):checked ~ .rating-demo__label:nth-of-type(-n + 5) .rating-star__lines { animation-name: rating-lines; }
    .rating-demo__label--delay1 .rating-star__ring, .rating-demo__label--delay1 .rating-star__fill, .rating-demo__label--delay1 .rating-star__lines, .rating-demo__label--delay1 .rating-star__stroke { animation-delay: 0.05s; }
    .rating-demo__label--delay2 .rating-star__ring, .rating-demo__label--delay2 .rating-star__fill, .rating-demo__label--delay2 .rating-star__lines, .rating-demo__label--delay2 .rating-star__stroke { animation-delay: 0.1s; }
    .rating-demo__label--delay3 .rating-star__ring, .rating-demo__label--delay3 .rating-star__fill, .rating-demo__label--delay3 .rating-star__lines, .rating-demo__label--delay3 .rating-star__stroke { animation-delay: 0.15s; }
    .rating-demo__label--delay4 .rating-star__ring, .rating-demo__label--delay4 .rating-star__fill, .rating-demo__label--delay4 .rating-star__lines, .rating-demo__label--delay4 .rating-star__stroke { animation-delay: 0.2s; }
    .rating-demo__display { margin-left: 0.5rem; font-size: 0.875rem; font-weight: 500; }
    .rating-demo__sr { clip: rect(1px, 1px, 1px, 1px); position: absolute; width: 1px; height: 1px; overflow: hidden; }
    @keyframes rating-ring { from, 20% { opacity: 1; r: 8px; stroke-width: 16px; transform: scale(0); } 35% { opacity: 0.5; r: 8px; stroke-width: 16px; transform: scale(1); } 50%, to { opacity: 0; r: 16px; stroke-width: 0; transform: scale(1); } }
    @keyframes rating-stroke { from { transform: scale(1); } 20%, to { transform: scale(0); } }
    @keyframes rating-fill { from, 40% { transform: scale(0); } 60% { transform: scale(1.2); } 80% { transform: scale(0.9); } to { transform: scale(1); } }
    @keyframes rating-lines { from, 40% { stroke-dasharray: 1 23; stroke-dashoffset: 1; } 60%, to { stroke-dasharray: 12 13; stroke-dashoffset: -13; } }
    @media (prefers-reduced-motion: reduce) {
      .rating-demo__input:checked ~ .rating-demo__label .rating-star__ring,
      .rating-demo__input:checked ~ .rating-demo__label .rating-star__stroke,
      .rating-demo__input:checked ~ .rating-demo__label .rating-star__fill,
      .rating-demo__input:checked ~ .rating-demo__label .rating-star__lines { animation: none; }
      .rating-demo__input:checked ~ .rating-demo__label .rating-star__fill { transform: scale(1); }
    }
  `,
})
export class SkillDetailPage {
  slug = input.required<string>();
  section = input<CatalogSection>('skills');

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
  ratingStars = [1, 2, 3, 4, 5];
  selectedRating = signal(0);
  ratingDelays = signal([0, 0, 0, 0, 0]);
  ratingComment = '';

  basePath = computed(() => this.section() === 'plugins' ? '/plugins' : this.section() === 'contracts' ? '/contracts' : '/skills');
  sectionLabel = computed(() => {
    const c = this.t().catalogo;
    return this.section() === 'plugins' ? c.plugins : this.section() === 'contracts' ? c.contratos : c.skills;
  });

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

  async submitRating(): Promise<void> {
    if (!this.ratingComment.trim()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.skills.rate(this.slug(), this.selectedRating(), this.ratingComment.trim());
      this.ratingComment = '';
      await this.load();
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }

  selectRating(rating: number): void {
    const previous = this.selectedRating();
    this.ratingDelays.set(this.ratingStars.map((star) =>
      star > previous + 1 && star <= rating ? star - previous : 0,
    ));
    this.selectedRating.set(rating);
  }

  ratingLabel(rating: number): string {
    const es = ['', 'Terrible', 'Mala', 'Aceptable', 'Buena', 'Excelente'];
    const en = ['', 'Terrible', 'Bad', 'OK', 'Good', 'Excellent'];
    return (this.i18n.locale() === 'es' ? es : en)[rating] ?? '';
  }

  stars(rating: number): string {
    return '★'.repeat(rating) + '☆'.repeat(5 - rating);
  }

  artifactUrl(version: number): string {
    return `/api/skills/${encodeURIComponent(this.slug())}/artifact?v=${version}`;
  }

  formatBytes(bytes: number): string {
    return bytes < 1024 * 1024
      ? `${Math.ceil(bytes / 1024)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { I18n } from '../../core/i18n/i18n';
import { SkillService } from '../../core/skills';
import { TEAM_OPTIONS, type Team } from '../../core/teams';
import type { SkillListItem, SkillType } from '../../core/models';
import { UI } from '../../shared/ui';
import { AnimDelayPipe } from '../../shared/anim-delay.pipe';

type CatalogSection = 'skills' | 'plugins' | 'contracts';
type StatusFilter = 'active' | 'deprecated' | 'all';
type SortOption = '' | 'az' | 'za' | 'rating-desc' | 'rating-asc';

/** Lista reutilizable para cada seccion del catalogo. */
@Component({
  selector: 'app-skills-list',
  imports: [FormsModule, RouterLink, NgOptimizedImage, AnimDelayPipe, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="catalog-hero anim-pop-in">
      <div class="catalog-hero__copy">
        <p class="catalog-hero__eyebrow">{{ catalogLabel() }}</p>
        <h1 class="catalog-hero__title">{{ title() }}</h1>
        <p class="catalog-hero__subtitle">{{ subtitle() }}</p>
      </div>
      <div class="catalog-hero__action">
        <p
          class="catalog-result-count"
          role="status"
          aria-live="polite"
          [attr.aria-busy]="loading()"
        >
          @if (loading()) {
            {{ t().catalogo.cargando }}
          } @else {
            {{ resultCountLabel() }}
          }
        </p>
        <a [routerLink]="newPath()"
          ><button uiButton>{{ newLabel() }}</button></a
        >
      </div>
    </header>

    <section class="catalog-toolbar mb-6" [attr.aria-label]="t().catalogo.controlesCatalogo">
      <label class="sr-only" for="catalog-query">{{ t().catalogo.buscarAria }}</label>
      <input
        id="catalog-query"
        uiInput
        class="catalog-toolbar__search"
        [(ngModel)]="query"
        [placeholder]="t().catalogo.buscar"
        [attr.aria-label]="t().catalogo.buscarAria"
      />
      <fieldset class="catalog-filter" [attr.aria-label]="t().form.stack">
        <legend class="sr-only">{{ t().form.stack }}</legend>
        <input
          class="sr-only"
          type="radio"
          id="stack-all"
          name="stack"
          value=""
          [(ngModel)]="stack"
        />
        <label
          for="stack-all"
          class="catalog-filter__segment catalog-filter__segment--icon"
          [class.catalog-filter__segment--selected]="stack() === ''"
          [attr.aria-label]="t().catalogo.todo"
        >
          <svg
            viewBox="0 0 24 24"
            class="catalog-filter__icon"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
          >
            <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
          </svg>
          <span class="catalog-filter__tooltip" aria-hidden="true">{{ t().catalogo.todo }}</span>
        </label>
        <input
          class="sr-only"
          type="radio"
          id="stack-angular"
          name="stack"
          value="angular"
          [(ngModel)]="stack"
        />
        <label
          for="stack-angular"
          class="catalog-filter__segment catalog-filter__segment--icon"
          [class.catalog-filter__segment--selected]="stack() === 'angular'"
          aria-label="Angular"
        >
          <img
            ngSrc="/icons/angular.svg"
            width="27"
            height="27"
            alt=""
            class="catalog-filter__brand"
          />
          <span class="catalog-filter__tooltip" aria-hidden="true">Angular</span>
        </label>
        <input
          class="sr-only"
          type="radio"
          id="stack-java"
          name="stack"
          value="java"
          [(ngModel)]="stack"
        />
        <label
          for="stack-java"
          class="catalog-filter__segment catalog-filter__segment--icon"
          [class.catalog-filter__segment--selected]="stack() === 'java'"
          aria-label="Java"
        >
          <img
            ngSrc="/icons/java.svg"
            width="27"
            height="27"
            alt=""
            class="catalog-filter__brand"
          />
          <span class="catalog-filter__tooltip" aria-hidden="true">Java</span>
        </label>
        <input
          class="sr-only"
          type="radio"
          id="stack-shared"
          name="stack"
          value="shared"
          [(ngModel)]="stack"
        />
        <label
          for="stack-shared"
          class="catalog-filter__segment catalog-filter__segment--icon"
          [class.catalog-filter__segment--selected]="stack() === 'shared'"
          [attr.aria-label]="t().catalogo.compartido"
        >
          <span class="catalog-filter__icon catalog-filter__icon--shared" aria-hidden="true"></span>
          <span class="catalog-filter__tooltip" aria-hidden="true">{{
            t().catalogo.compartido
          }}</span>
        </label>
        <input
          class="sr-only"
          type="radio"
          id="stack-infra"
          name="stack"
          value="infra"
          [(ngModel)]="stack"
        />
        <label
          for="stack-infra"
          class="catalog-filter__segment catalog-filter__segment--icon"
          [class.catalog-filter__segment--selected]="stack() === 'infra'"
          [attr.aria-label]="t().catalogo.infra"
        >
          <span class="catalog-filter__icon catalog-filter__icon--infra" aria-hidden="true"></span>
          <span class="catalog-filter__tooltip" aria-hidden="true">{{ t().catalogo.infra }}</span>
        </label>
      </fieldset>
      <fieldset class="catalog-filter" [attr.aria-label]="t().catalogo.estado">
        <legend class="sr-only">{{ t().catalogo.estado }}</legend>
        <input
          class="sr-only"
          type="radio"
          id="status-active"
          name="status"
          value="active"
          [(ngModel)]="status"
        />
        <label
          for="status-active"
          class="catalog-filter__segment"
          [class.catalog-filter__segment--selected]="status() === 'active'"
          >{{ t().catalogo.activos }}</label
        >
        <input
          class="sr-only"
          type="radio"
          id="status-deprecated"
          name="status"
          value="deprecated"
          [(ngModel)]="status"
        />
        <label
          for="status-deprecated"
          class="catalog-filter__segment"
          [class.catalog-filter__segment--selected]="status() === 'deprecated'"
          >{{ t().catalogo.deprecados }}</label
        >
        <input
          class="sr-only"
          type="radio"
          id="status-all"
          name="status"
          value="all"
          [(ngModel)]="status"
        />
        <label
          for="status-all"
          class="catalog-filter__segment"
          [class.catalog-filter__segment--selected]="status() === 'all'"
          >{{ t().catalogo.todo }}</label
        >
      </fieldset>
      <select
        uiSelect
        class="catalog-toolbar__team"
        [(ngModel)]="team"
        [attr.aria-label]="t().form.equipoDueno"
      >
        <option value="">{{ t().form.equipoDueno }} · {{ t().catalogo.todo }}</option>
        @for (option of teams; track option) {
          <option [value]="option">{{ option }}</option>
        }
      </select>
      <select
        uiSelect
        class="catalog-toolbar__sort"
        [(ngModel)]="sort"
        [attr.aria-label]="t().catalogo.ordenarPor"
      >
        <option value="">{{ t().catalogo.ordenarPor }}</option>
        <option value="az">{{ t().catalogo.ordenAZ }}</option>
        <option value="za">{{ t().catalogo.ordenZA }}</option>
        <option value="rating-desc">{{ t().catalogo.ordenRatingDesc }}</option>
        <option value="rating-asc">{{ t().catalogo.ordenRatingAsc }}</option>
      </select>
      @if (hasActiveFilters()) {
        <button uiButton variant="ghost" class="h-10 px-3 text-[13px]" type="button" (click)="clearFilters()">
          {{ t().catalogo.limpiarFiltros }}
        </button>
      }
    </section>

    @if (loading()) {
      @switch (section()) {
        @case ('plugins') {
          <div class="catalog-plugin-grid" aria-label="Cargando plugins">
            @for (i of [1, 2, 3, 4, 5, 6]; track i) {
              <div class="catalog-plugin-skeleton animate-pulse" aria-hidden="true"></div>
            }
          </div>
        }
        @case ('contracts') {
          <div uiCard class="overflow-hidden" aria-label="Cargando contratos">
            @for (i of [1, 2, 3, 4, 5]; track i) {
              <div class="catalog-contract-skeleton animate-pulse" aria-hidden="true"></div>
            }
          </div>
        }
        @default {
          <div class="space-y-2.5" aria-label="Cargando skills">
            @for (i of [1, 2, 3, 4, 5]; track i) {
              <div class="catalog-skill-skeleton animate-pulse" aria-hidden="true"></div>
            }
          </div>
        }
      }
    } @else if (visible().length === 0) {
      <div class="catalog-empty-state anim-pop-in">
        <p class="text-sm font-medium text-text-muted">{{ t().catalogo.sinResultados }}</p>
        <p class="mt-1.5 text-xs text-text-faint">{{ t().catalogo.sinResultadosHint }}</p>
        @if (hasActiveFilters()) {
          <button
            uiButton
            variant="secondary"
            size="sm"
            type="button"
            class="mt-4"
            (click)="clearFilters()"
          >
            {{ t().catalogo.limpiarFiltros }}
          </button>
        }
      </div>
    } @else {
      @switch (section()) {
        @case ('plugins') {
          <div class="catalog-plugin-grid">
            @for (s of visible(); track s.slug; let i = $index) {
              <article
                uiCard
                interactive
                animate.enter="anim-row-in"
                [style.animationDelay]="i | animDelay"
              >
                <a [routerLink]="[basePath(), s.slug]" class="catalog-plugin-card">
                  <div class="catalog-plugin-card__topline">
                    <span class="catalog-plugin-card__icon" aria-hidden="true">
                      @if (pluginIcon(s); as icon) {
                        <img [src]="icon" width="20" height="20" alt="" />
                      } @else {
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
                          <path d="M12 3 4.5 7.2v9.6L12 21l7.5-4.2V7.2L12 3Z" />
                          <path d="m4.8 7.4 7.2 4 7.2-4M12 11.4V21" />
                        </svg>
                      }
                    </span>
                    <span uiBadge tone="accent">{{ s.stack }}</span>
                    @if (s.status !== 'published') {
                      <ui-status-badge [status]="s.status" />
                    }
                  </div>
                  <h2 class="catalog-plugin-card__title">{{ s.title }}</h2>
                  <p class="catalog-plugin-card__description">{{ s.description }}</p>
                  <div class="catalog-plugin-card__footer">
                    <span class="font-mono text-xs text-text-faint">v{{ s.version }}</span>
                    <span class="text-xs text-text-faint">{{
                      s.ownerTeam ?? t().catalogo.sinEquipo
                    }}</span>
                    <span class="ml-auto text-xs font-medium text-accent"
                      >{{ t().catalogo.verPlugin }} <span aria-hidden="true">→</span></span
                    >
                  </div>
                </a>
              </article>
            }
          </div>
        }
        @case ('contracts') {
          <div uiCard class="catalog-contract-table hidden overflow-hidden sm:block">
            <table>
              <thead>
                <tr>
                  <th scope="col">{{ t().catalogo.contrato }}</th>
                  <th scope="col">{{ t().form.stack }}</th>
                  <th scope="col">{{ t().catalogo.version }}</th>
                  <th scope="col">{{ t().catalogo.equipo }}</th>
                  <th scope="col">{{ t().catalogo.estado }}</th>
                  <th scope="col" class="text-right">{{ t().catalogo.uso }}</th>
                </tr>
              </thead>
              <tbody>
                @for (s of visible(); track s.slug; let i = $index) {
                  <tr animate.enter="anim-row-in" [style.animationDelay]="i | animDelay">
                    <th scope="row">
                      <a
                        [routerLink]="[basePath(), s.slug]"
                        class="catalog-contract-table__title"
                        >{{ s.title }}</a
                      >
                      <p>{{ s.description }}</p>
                    </th>
                    <td>
                      <span uiBadge tone="accent">{{ s.stack }}</span>
                    </td>
                    <td class="font-mono text-xs text-text-faint">v{{ s.version }}</td>
                    <td>{{ s.ownerTeam ?? t().catalogo.sinEquipo }}</td>
                    <td><ui-status-badge [status]="s.status" /></td>
                    <td class="catalog-contract-table__usage">{{ s.usos90d }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <div class="space-y-2.5 sm:hidden">
            @for (s of visible(); track s.slug; let i = $index) {
              <article uiCard animate.enter="anim-row-in" [style.animationDelay]="i | animDelay">
                <a [routerLink]="[basePath(), s.slug]" class="catalog-contract-mobile">
                  <div class="flex flex-wrap items-center gap-2">
                    <h2 class="font-medium">{{ s.title }}</h2>
                    <span uiBadge tone="accent">{{ s.stack }}</span>
                    <ui-status-badge [status]="s.status" />
                  </div>
                  <p class="mt-2 text-sm text-text-muted">{{ s.description }}</p>
                  <div class="mt-3 flex items-center gap-3 text-xs text-text-faint">
                    <span class="font-mono">v{{ s.version }}</span>
                    <span>{{ s.ownerTeam ?? t().catalogo.sinEquipo }}</span>
                    <span class="ml-auto">{{ s.usos90d }} {{ t().catalogo.uso }}</span>
                  </div>
                </a>
              </article>
            }
          </div>
        }
        @default {
          <div uiCard class="catalog-skill-list">
            @for (s of visible(); track s.slug; let i = $index) {
              <article animate.enter="anim-row-in" [style.animationDelay]="i | animDelay" class="catalog-skill-entry">
                <div class="catalog-skill-row">
                  <a [routerLink]="[basePath(), s.slug]" class="catalog-skill-row__content">
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <h2 class="catalog-skill-row__title">{{ s.title }}</h2>
                        <span uiBadge tone="accent">{{ s.stack }}</span>
                        @if (s.status !== 'published') {
                          <ui-status-badge [status]="s.status" />
                        }
                        <span class="font-mono text-xs text-text-faint">v{{ s.version }}</span>
                      </div>
                      <p class="catalog-skill-row__description">{{ s.description }}</p>
                      @if (s.tags.length) {
                        <p class="catalog-skill-row__tags">{{ s.tags.join(' · ') }}</p>
                      }
                    </div>
                  </a>
                  <div class="catalog-skill-row__metrics">
                    @if (s.ratingCount > 0) {
                      <span
                        class="inline-flex items-center justify-end gap-1 text-xs text-warning"
                        [attr.aria-label]="ratingAria(s.ratingAverage, s.ratingCount)"
                      >
                        {{ formatRating(s.ratingAverage) }} <span aria-hidden="true">★</span>
                        <span class="text-text-faint" aria-hidden="true">({{ s.ratingCount }})</span>
                      </span>
                    }
                    <span
                      >{{ s.usos90d }}
                      {{ s.usos90d === 1 ? t().insights.consulta : t().insights.consultas }}</span
                    >
                    @if (s.personas > 0) {
                      <span
                        >{{ s.personas }}
                        {{ s.personas === 1 ? t().insights.persona : t().insights.personas }}</span
                      >
                    }
                  </div>
                  <button
                    type="button"
                    class="catalog-quick-trigger"
                    [class.catalog-quick-trigger--open]="quickPreviewSlug() === s.slug"
                    [attr.aria-expanded]="quickPreviewSlug() === s.slug"
                    [attr.aria-controls]="'quick-preview-' + s.slug"
                    [attr.aria-label]="(quickPreviewSlug() === s.slug ? t().catalogo.ocultarVistaRapida : t().catalogo.vistaRapida) + ': ' + s.title"
                    (click)="toggleQuickPreview(s.slug)"
                  >
                    <span>{{ quickPreviewSlug() === s.slug ? t().catalogo.ocultarVistaRapida : t().catalogo.vistaRapida }}</span>
                    <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m4 6 4 4 4-4" /></svg>
                  </button>
                </div>
                @if (quickPreviewSlug() === s.slug) {
                  <section
                    [id]="'quick-preview-' + s.slug"
                    class="catalog-quick-preview"
                    [attr.aria-label]="t().catalogo.vistaRapida + ': ' + s.title"
                    animate.enter="anim-panel-in"
                    animate.leave="anim-panel-out"
                  >
                    <div>
                      <p class="catalog-quick-preview__eyebrow">{{ t().skill.cuandoUsarlo }}</p>
                      <p class="catalog-quick-preview__when">{{ s.whenToUse }}</p>
                    </div>
                    <dl class="catalog-quick-preview__facts">
                      <div><dt>{{ t().catalogo.equipo }}</dt><dd>{{ s.ownerTeam ?? t().catalogo.sinEquipo }}</dd></div>
                      <div><dt>{{ t().catalogo.version }}</dt><dd class="font-mono">v{{ s.version }}</dd></div>
                      <div><dt>{{ t().catalogo.uso }}</dt><dd>{{ s.usos90d }}</dd></div>
                    </dl>
                    <a [routerLink]="[basePath(), s.slug]" class="catalog-quick-preview__detail">
                      {{ t().catalogo.verDetalle }} <span aria-hidden="true">→</span>
                    </a>
                  </section>
                }
              </article>
            }
          </div>
        }
      }
    }
  `,
})
export class SkillsList {
  section = input<CatalogSection>('skills');

  private skills = inject(SkillService);
  private i18n = inject(I18n);
  t = this.i18n.t;

  all = signal<SkillListItem[]>([]);
  loading = signal(true);
  query = signal('');
  stack = signal('');
  status = signal<StatusFilter>('active');
  team = signal<Team | ''>('');
  sort = signal<SortOption>('');
  quickPreviewSlug = signal<string | null>(null);
  teams = TEAM_OPTIONS;

  private config = computed(() => {
    switch (this.section()) {
      case 'plugins':
        return { types: ['plugin'] as SkillType[], path: '/plugins' };
      case 'contracts':
        return { types: ['contract'] as SkillType[], path: '/contracts' };
      default:
        return { types: ['skill', 'convention', 'reference'] as SkillType[], path: '/skills' };
    }
  });

  basePath = computed(() => this.config().path);
  newPath = computed(() => `${this.basePath()}/new`);
  title = computed(() => {
    const c = this.t().catalogo;
    const section =
      this.section() === 'plugins'
        ? c.plugins
        : this.section() === 'contracts'
          ? c.contratos
          : c.skills;
    const stack = this.stack();
    const stackLabel =
      stack === 'angular'
        ? 'Angular'
        : stack === 'java'
          ? 'Java'
          : stack === 'shared'
            ? c.compartido
            : stack === 'infra'
              ? c.infra
              : '';
    return stackLabel ? `${section} · ${stackLabel}` : section;
  });
  subtitle = computed(() => {
    const c = this.t().catalogo;
    return this.section() === 'plugins'
      ? c.subtituloPlugins
      : this.section() === 'contracts'
        ? c.subtituloContratos
        : c.subtitulo;
  });
  newLabel = computed(() => {
    const c = this.t().catalogo;
    return this.section() === 'plugins'
      ? c.nuevoPlugin
      : this.section() === 'contracts'
        ? c.nuevoContrato
        : c.nuevoSkill;
  });
  catalogLabel = computed(() => {
    const c = this.t().catalogo;
    return this.section() === 'plugins'
      ? c.etiquetaPlugins
      : this.section() === 'contracts'
        ? c.etiquetaContratos
        : c.etiquetaSkills;
  });
  resultCountLabel = computed(() => {
    const count = this.visible().length;
    return `${count} ${count === 1 ? this.t().catalogo.resultado : this.t().catalogo.resultados}`;
  });
  hasActiveFilters = computed(() =>
    Boolean(
      this.query().trim() ||
      this.stack() ||
      this.team() ||
      this.status() !== 'active' ||
      this.sort() !== '',
    ),
  );

  formatRating(value: number): string {
    return value.toFixed(1).replace('.', this.i18n.locale() === 'es' ? ',' : '.');
  }

  ratingAria(average: number, count: number): string {
    return `${this.formatRating(average)} / 5 · ${count}`;
  }

  clearFilters(): void {
    this.query.set('');
    this.stack.set('');
    this.team.set('');
    this.status.set('active');
    this.sort.set('');
  }

  toggleQuickPreview(slug: string): void {
    this.quickPreviewSlug.update((current) => current === slug ? null : slug);
  }

  visible = computed(() => {
    const q = this.query().trim().toLowerCase();
    const st = this.stack();
    const team = this.team();
    const status = this.status();
    const types = this.config().types;
    const sort = this.sort();

    const filtered = this.all().filter((s) => {
      if (!types.includes(s.type)) return false;
      if (st && s.stack !== st) return false;
      if (team && s.ownerTeam !== team) return false;
      if (status === 'active' && s.status === 'deprecated') return false;
      if (status === 'deprecated' && s.status !== 'deprecated') return false;
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.whenToUse.toLowerCase().includes(q) ||
        s.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });

    if (!sort) return filtered;

    return [...filtered].sort((a, b) => {
      if (sort === 'az') {
        return (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
      }
      if (sort === 'za') {
        return (b.title || '').localeCompare(a.title || '', undefined, { sensitivity: 'base' });
      }
      if (sort === 'rating-desc') {
        const aHas = a.ratingCount > 0 ? 1 : 0;
        const bHas = b.ratingCount > 0 ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
        return (
          b.ratingAverage - a.ratingAverage ||
          b.ratingCount - a.ratingCount ||
          (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
        );
      }
      if (sort === 'rating-asc') {
        const aHas = a.ratingCount > 0 ? 1 : 0;
        const bHas = b.ratingCount > 0 ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
        return (
          a.ratingAverage - b.ratingAverage ||
          a.ratingCount - b.ratingCount ||
          (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
        );
      }
      return 0;
    });
  });

  pluginIcon(item: SkillListItem): string | null {
    const tags = item.tags ?? [];
    const slug = (item.slug || '').toLowerCase();
    const title = (item.title || '').toLowerCase();

    if (tags.includes('github') || slug.includes('github') || title.includes('github')) return '/icons/github.svg';
    if (tags.includes('git') || slug.includes('git') || title.includes('git')) return '/icons/git.svg';
    if (tags.includes('docker') || slug.includes('docker') || title.includes('docker')) return '/icons/docker.svg';
    if (slug.includes('database') || tags.includes('database')) return '/icons/database.svg';
    if (tags.includes('postgres') || slug.includes('postgres') || slug.includes('postgresql')) return '/icons/postgresql.svg';
    if (tags.includes('mysql') || slug.includes('mysql')) return '/icons/mysql.svg';
    if (tags.includes('taiga') || slug.includes('taiga') || title.includes('taiga')) return '/icons/taiga.svg';
    if (tags.includes('memory') || tags.includes('knowledge-graph') || slug.includes('memory')) return '/icons/memory.svg';
    if (tags.includes('sequential-thinking') || tags.includes('reasoning') || slug.includes('sequential')) return '/icons/thinking.svg';
    if (tags.includes('fetch') || slug.includes('fetch')) return '/icons/fetch.svg';
    if (tags.includes('spring') || slug.includes('spring')) return '/icons/spring.svg';
    if (item.stack === 'angular') return '/icons/angular.svg';
    if (item.stack === 'java') return '/icons/java.svg';

    return null;
  }

  constructor() {
    this.skills
      .list()
      .then((rows) => this.all.set(rows))
      .finally(() => this.loading.set(false));
  }
}

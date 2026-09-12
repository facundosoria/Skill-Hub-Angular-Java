import { NgOptimizedImage } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { I18n } from '../../core/i18n/i18n';
import { SkillService } from '../../core/skills';
import type { SkillListItem, SkillType } from '../../core/models';
import { UI } from '../../shared/ui';
import { AnimDelayPipe } from '../../shared/anim-delay.pipe';

type CatalogSection = 'skills' | 'plugins' | 'contracts';
type StatusFilter = 'active' | 'deprecated' | 'all';

/** Lista reutilizable para cada seccion del catalogo. */
@Component({
  selector: 'app-skills-list',
  imports: [FormsModule, RouterLink, NgOptimizedImage, AnimDelayPipe, ...UI],
  template: `
    <div class="mb-7 flex items-end justify-between gap-4 anim-pop-in">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">{{ title() }}</h1>
        <p class="mt-1.5 text-sm text-text-muted">{{ subtitle() }}</p>
      </div>
      <a [routerLink]="newPath()"><button uiButton>{{ newLabel() }}</button></a>
    </div>

    <div class="mb-4 flex flex-wrap items-center gap-2">
      <input uiInput class="max-w-xs" [(ngModel)]="query" [placeholder]="t().catalogo.buscar"
             [attr.aria-label]="t().catalogo.buscarAria" />
      <fieldset class="catalog-filter" [attr.aria-label]="t().form.stack">
        <legend class="sr-only">{{ t().form.stack }}</legend>
        <input class="sr-only" type="radio" id="stack-all" name="stack" value="" [(ngModel)]="stack" />
        <label for="stack-all" class="catalog-filter__segment catalog-filter__segment--icon" [class.catalog-filter__segment--selected]="stack() === ''"
               [attr.aria-label]="t().catalogo.todo">
          <svg viewBox="0 0 24 24" class="catalog-filter__icon" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/></svg>
          <span class="catalog-filter__tooltip" aria-hidden="true">{{ t().catalogo.todo }}</span>
        </label>
        <input class="sr-only" type="radio" id="stack-angular" name="stack" value="angular" [(ngModel)]="stack" />
        <label for="stack-angular" class="catalog-filter__segment catalog-filter__segment--icon" [class.catalog-filter__segment--selected]="stack() === 'angular'"
               aria-label="Angular">
          <img ngSrc="/icons/angular.svg" width="18" height="18" alt="" class="catalog-filter__brand" />
          <span class="catalog-filter__tooltip" aria-hidden="true">Angular</span>
        </label>
        <input class="sr-only" type="radio" id="stack-java" name="stack" value="java" [(ngModel)]="stack" />
        <label for="stack-java" class="catalog-filter__segment catalog-filter__segment--icon" [class.catalog-filter__segment--selected]="stack() === 'java'"
               aria-label="Java">
          <img ngSrc="/icons/java.svg" width="18" height="18" alt="" class="catalog-filter__brand" />
          <span class="catalog-filter__tooltip" aria-hidden="true">Java</span>
        </label>
        <input class="sr-only" type="radio" id="stack-shared" name="stack" value="shared" [(ngModel)]="stack" />
        <label for="stack-shared" class="catalog-filter__segment catalog-filter__segment--icon" [class.catalog-filter__segment--selected]="stack() === 'shared'"
               [attr.aria-label]="t().catalogo.compartido">
          <span class="catalog-filter__icon catalog-filter__icon--shared" aria-hidden="true"></span>
          <span class="catalog-filter__tooltip" aria-hidden="true">{{ t().catalogo.compartido }}</span>
        </label>
        <input class="sr-only" type="radio" id="stack-infra" name="stack" value="infra" [(ngModel)]="stack" />
        <label for="stack-infra" class="catalog-filter__segment catalog-filter__segment--icon" [class.catalog-filter__segment--selected]="stack() === 'infra'"
               [attr.aria-label]="t().catalogo.infra">
          <span class="catalog-filter__icon catalog-filter__icon--infra" aria-hidden="true"></span>
          <span class="catalog-filter__tooltip" aria-hidden="true">{{ t().catalogo.infra }}</span>
        </label>
      </fieldset>
      <fieldset class="catalog-filter" [attr.aria-label]="t().catalogo.estado">
        <legend class="sr-only">{{ t().catalogo.estado }}</legend>
        <input class="sr-only" type="radio" id="status-active" name="status" value="active" [(ngModel)]="status" />
        <label for="status-active" class="catalog-filter__segment" [class.catalog-filter__segment--selected]="status() === 'active'">{{ t().catalogo.activos }}</label>
        <input class="sr-only" type="radio" id="status-deprecated" name="status" value="deprecated" [(ngModel)]="status" />
        <label for="status-deprecated" class="catalog-filter__segment" [class.catalog-filter__segment--selected]="status() === 'deprecated'">{{ t().catalogo.deprecados }}</label>
        <input class="sr-only" type="radio" id="status-all" name="status" value="all" [(ngModel)]="status" />
        <label for="status-all" class="catalog-filter__segment" [class.catalog-filter__segment--selected]="status() === 'all'">{{ t().catalogo.todo }}</label>
      </fieldset>
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
          <a [routerLink]="[basePath(), s.slug]"
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
  section = input<CatalogSection>('skills');

  private skills = inject(SkillService);
  private i18n = inject(I18n);
  t = this.i18n.t;

  all = signal<SkillListItem[]>([]);
  loading = signal(true);
  query = signal('');
  stack = signal('');
  status = signal<StatusFilter>('active');

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
    const section = this.section() === 'plugins' ? c.plugins : this.section() === 'contracts' ? c.contratos : c.skills;
    const stack = this.stack();
    const stackLabel = stack === 'angular' ? 'Angular'
      : stack === 'java' ? 'Java'
      : stack === 'shared' ? c.compartido
      : stack === 'infra' ? c.infra
      : '';
    return stackLabel ? `${section} · ${stackLabel}` : section;
  });
  subtitle = computed(() => {
    const c = this.t().catalogo;
    return this.section() === 'plugins' ? c.subtituloPlugins : this.section() === 'contracts' ? c.subtituloContratos : c.subtitulo;
  });
  newLabel = computed(() => {
    const c = this.t().catalogo;
    return this.section() === 'plugins' ? c.nuevoPlugin : this.section() === 'contracts' ? c.nuevoContrato : c.nuevoSkill;
  });

  visible = computed(() => {
    const q = this.query().trim().toLowerCase();
    const st = this.stack();
    const status = this.status();
    const types = this.config().types;
    return this.all().filter((s) => {
      if (!types.includes(s.type)) return false;
      if (st && s.stack !== st) return false;
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
  });

  constructor() {
    this.skills
      .list()
      .then((rows) => this.all.set(rows))
      .finally(() => this.loading.set(false));
  }
}

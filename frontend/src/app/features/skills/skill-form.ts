import {
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { I18n } from '../../core/i18n/i18n';
import { SkillService } from '../../core/skills';
import type { DuplicateCandidate, LanguageFlag, SkillFormValues, Stack, SkillType } from '../../core/models';
import { UI } from '../../shared/ui';

/**
 * Puerto de src/components/skill-form.tsx, incluidos los chequeos MIENTRAS se
 * escribe (decision 11a):
 *  - duplicados: debounce 350 ms sobre titulo+tags, solo en modo create. No
 *    bloquea; muestra los candidatos. Va antes del cuerpo a proposito.
 *  - idioma: debounce 600 ms sobre titulo/descripcion/cuando/contenido. Avisa
 *    en vivo y despues bloquea el submit (un skill en espanol es invisible).
 *
 * Lo que devuelve el backend al enviar gana sobre lo live: si el submit vino con
 * `duplicates`, esos son los que bloquean (hasta que se justifique).
 */
@Component({
  selector: 'app-skill-form',
  imports: [FormsModule, RouterLink, ...UI],
  template: `
    <div class="max-w-2xl">
      <h1 class="text-2xl font-semibold tracking-tight">{{ mode() === 'create' ? t().form.nuevoTitulo : t().form.editarTitulo }}</h1>
      <p class="mt-1 mb-6 text-sm text-text-muted">
        {{ mode() === 'create' ? t().form.nuevoSubtitulo : t().form.editarSubtitulo }}
      </p>

      @if (shownIdioma(); as ai) {
        <div class="mb-4 rounded-xl border border-danger/35 bg-danger-soft p-4"
             animate.enter="anim-panel-in" animate.leave="anim-panel-out">
          <p class="text-sm font-medium text-danger">{{ t().idioma.titulo }}</p>
          <p class="mt-1.5 text-sm text-danger/90">{{ t().idioma.porQue }}</p>
          <p class="mt-2 text-xs text-danger/80">
            {{ t().idioma.detectadoEn }}
            <strong>{{ campoLabel(ai.campo) }}</strong>. {{ t().idioma.senales }} {{ ai.senales.join(' · ') }}
          </p>
        </div>
      }

      @if (shownDuplicates().length) {
        <div class="mb-4 rounded-xl p-4"
             animate.enter="anim-panel-in" animate.leave="anim-panel-out"
             [class]="blocking() ? 'border border-warning/35 bg-warning-soft' : 'border border-warning/25 bg-warning-soft/60'">
          <p class="text-sm font-medium text-warning">{{ t().form.duplicadoTitulo }}</p>
          <div class="mt-3 space-y-2">
            @for (d of shownDuplicates(); track d.slug) {
              <div class="rounded-[var(--radius)] border border-border bg-surface p-2.5">
                <a [routerLink]="['/skills', d.slug]" class="text-sm font-medium hover:underline">{{ d.title }}</a>
                <span class="text-xs text-text-muted"> · {{ d.stack }} · v{{ d.version }}
                  @if (d.ownerTeam) { · {{ d.ownerTeam }} }
                </span>
                <p class="mt-1 text-xs text-text-faint">
                  @if (d.status === 'deprecated' && d.supersededBySlug) {
                    {{ t().form.reemplazadoPor }} {{ d.supersededBySlug }}
                  } @else if (d.usos90d > 0) {
                    {{ t().form.consultadoVeces }} {{ d.usos90d }} {{ d.usos90d === 1 ? t().form.vez : t().form.veces }}
                    {{ t().form.en90dias }} {{ d.personas }} {{ d.personas === 1 ? t().form.persona : t().form.personas }}
                  } @else {
                    {{ t().form.sinConsultas }}
                  }
                </p>
              </div>
            }
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            <a [routerLink]="['/skills', shownDuplicates()[0].slug, 'edit']">
              <button uiButton size="sm">{{ t().form.duplicadoProponer }} {{ shownDuplicates()[0].title }}</button>
            </a>
            @if (!justify()) {
              <button uiButton type="button" variant="secondary" size="sm" (click)="justify.set(true)">
                {{ t().form.duplicadoCrearIgual }}
              </button>
            }
          </div>
          <p class="mt-2.5 text-xs text-warning">{{ t().form.duplicadoNota }}</p>
        </div>
      }

      <form (ngSubmit)="submit()" class="space-y-5">
        <div class="grid gap-5 sm:grid-cols-2">
          <ui-field [label]="t().form.titulo">
            <input uiInput name="title" [(ngModel)]="v.title" (ngModelChange)="onTitle()" />
          </ui-field>
          <ui-field [label]="t().form.slug" [hint]="t().form.slugHint">
            <input uiInput name="slug" class="font-mono text-[13px]" [(ngModel)]="v.slug"
                   (ngModelChange)="slugTouched = true" [disabled]="mode() === 'edit'" />
          </ui-field>
        </div>
        <ui-field [label]="t().form.descripcion" [hint]="t().form.descripcionHint">
          <input uiInput name="description" maxlength="200" [(ngModel)]="v.description" (ngModelChange)="onLangField()" />
        </ui-field>
        <ui-field [label]="t().form.cuandoUsarlo" [hint]="t().form.cuandoUsarloHint">
          <textarea uiTextarea name="whenToUse" rows="2" maxlength="200" [(ngModel)]="v.whenToUse" (ngModelChange)="onLangField()"></textarea>
        </ui-field>
        <div class="grid gap-5 sm:grid-cols-3">
          <ui-field [label]="t().form.stack">
            <select uiSelect name="stack" [(ngModel)]="v.stack" class="w-full">
              <option value="angular">Angular</option><option value="java">Java</option>
              <option value="shared">{{ t().catalogo.compartido }}</option><option value="infra">Infra</option>
            </select>
          </ui-field>
          <ui-field [label]="t().form.tipo">
            <select uiSelect name="type" [(ngModel)]="v.type" class="w-full">
              <option value="skill">Skill</option><option value="convention">Convención</option><option value="reference">Referencia</option>
            </select>
          </ui-field>
          <ui-field [label]="t().form.tags" [hint]="t().form.tagsHint">
            <input uiInput name="tags" [(ngModel)]="tagsCsv" (ngModelChange)="onTitle()" />
          </ui-field>
        </div>
        <ui-field [label]="t().form.contenido" [hint]="t().form.contenidoHint">
          <textarea uiTextarea name="content" rows="16" class="font-mono text-[13px]" [(ngModel)]="v.content" (ngModelChange)="onLangField()"></textarea>
        </ui-field>
        <ui-field [label]="t().form.notaCambio" [hint]="t().form.notaCambioHint">
          <input uiInput name="changelog" [(ngModel)]="v.changelog" />
        </ui-field>

        @if (justify()) {
          <ui-field [label]="t().form.duplicadoJustificacion" [hint]="t().form.duplicadoJustificacionHint"
                    animate.enter="anim-panel-in" animate.leave="anim-panel-out">
            <textarea uiTextarea name="dupJust" rows="2" required [(ngModel)]="v.duplicateJustification"></textarea>
          </ui-field>
        }

        @if (error() && error() !== 'EN_SOLO_INGLES' && !blocking()) {
          <p class="text-sm text-danger">{{ error() }}</p>
        }

        <div class="flex items-center gap-2 border-t border-border pt-5">
          <button uiButton type="submit" [disabled]="busy() || !!shownIdioma()">
            {{ busy() ? t().form.guardando : mode() === 'create' ? t().form.crear : t().form.guardar }}
          </button>
          <a [routerLink]="mode() === 'edit' ? ['/skills', v.slug] : ['/skills']">
            <button uiButton type="button" variant="ghost">{{ t().form.cancelar }}</button>
          </a>
        </div>
      </form>
    </div>
  `,
})
export class SkillForm {
  mode = input<'create' | 'edit'>('create');
  slug = input<string>();

  private skills = inject(SkillService);
  private router = inject(Router);
  private i18n = inject(I18n);
  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);
  t = this.i18n.t;

  v: SkillFormValues = {
    slug: '',
    title: '',
    description: '',
    whenToUse: '',
    stack: 'angular' as Stack,
    type: 'skill' as SkillType,
    ownerTeam: null,
    tags: [],
    content: '## Rule\n\n',
    changelog: null,
    duplicateJustification: null,
  };
  tagsCsv = '';
  slugTouched = false;

  busy = signal(false);
  error = signal<string | null>(null);
  justify = signal(false);

  // Server (submit) vs live (mientras se escribe). El server gana.
  private serverIdioma = signal<LanguageFlag | null>(null);
  private serverDuplicates = signal<DuplicateCandidate[]>([]);
  private liveIdioma = signal<LanguageFlag | null>(null);
  private liveDuplicates = signal<DuplicateCandidate[]>([]);

  shownIdioma = computed(() => this.serverIdioma() ?? this.liveIdioma());
  shownDuplicates = computed(() =>
    this.serverDuplicates().length ? this.serverDuplicates() : this.liveDuplicates(),
  );
  /** Solo lo que devolvio el backend al enviar bloquea (hasta justificar). */
  blocking = computed(() => this.serverDuplicates().length > 0);

  private dupTimer?: ReturnType<typeof setTimeout>;
  private langTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.destroyRef.onDestroy(() => {
      clearTimeout(this.dupTimer);
      clearTimeout(this.langTimer);
    });

    // Igual que skill-detail / skill-diff: el slug (input) dispara la carga. En
    // modo edit trae la version vigente para precargar el form.
    effect(() => {
      const slug = this.slug();
      if (this.mode() !== 'edit' || !slug) return;
      untracked(() => this.loadForEdit(slug));
    });
  }

  private async loadForEdit(slug: string): Promise<void> {
    const d = await this.skills.get(slug);
    this.v = {
      slug: d.skill.slug,
      title: d.skill.title,
      description: d.skill.description,
      whenToUse: d.skill.whenToUse,
      stack: d.skill.stack,
      type: d.skill.type,
      ownerTeam: d.skill.ownerTeam,
      tags: d.skill.tags,
      content: d.skill.version?.content ?? '## Rule\n\n',
      changelog: null,
      duplicateJustification: null,
    };
    this.tagsCsv = d.skill.tags.join(', ');
    this.slugTouched = true;
    // App zoneless (sin zone.js): reasignar this.v tras el await no agenda
    // detección de cambios por sí solo, hay que empujarla o el form queda vacío.
    this.cdr.markForCheck();
  }

  // --- live checks ------------------------------------------------

  /** title o tags cambiaron -> deriva slug + rechequea duplicados (solo create). */
  onTitle(): void {
    this.deriveSlug();
    this.onLangField();
    if (this.mode() === 'edit') return;
    clearTimeout(this.dupTimer);
    this.dupTimer = setTimeout(() => {
      const title = this.v.title.trim();
      if (title.length < 3) {
        this.liveDuplicates.set([]);
        return;
      }
      this.skills
        .checkDuplicates(title, this.csvTags())
        .then((rows) => this.liveDuplicates.set(rows))
        .catch(() => this.liveDuplicates.set([]));
    }, 350);
  }

  onLangField(): void {
    clearTimeout(this.langTimer);
    this.langTimer = setTimeout(() => {
      this.skills
        .checkLanguage({
          title: this.v.title,
          description: this.v.description,
          whenToUse: this.v.whenToUse,
          content: this.v.content,
        })
        .then((flag) => this.liveIdioma.set(flag))
        .catch(() => this.liveIdioma.set(null));
    }, 600);
  }

  private deriveSlug(): void {
    if (this.slugTouched || this.mode() === 'edit') return;
    this.v.slug = this.v.title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
  }

  private csvTags(): string[] {
    return this.tagsCsv.split(',').map((x) => x.trim()).filter(Boolean);
  }

  campoLabel(campo: string): string {
    const map = this.t().idioma.campos as Record<string, string>;
    return map[campo] ?? campo;
  }

  // --- submit -----------------------------------------------------

  async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.serverIdioma.set(null);
    this.serverDuplicates.set([]);
    this.v.tags = this.csvTags();
    try {
      const res =
        this.mode() === 'create'
          ? await this.skills.create(this.v)
          : await this.skills.update(this.v.slug, this.v);

      if (res.error === 'EN_SOLO_INGLES') {
        this.serverIdioma.set(res.idioma ?? null);
        return;
      }
      if (res.duplicates?.length) {
        this.serverDuplicates.set(res.duplicates);
        this.error.set(res.error ?? null);
        return;
      }
      if (res.error) {
        this.error.set(res.error);
        return;
      }
      this.router.navigate(['/skills', res.slug ?? this.v.slug]);
    } catch (e: unknown) {
      const err = e as { error?: { error?: string } };
      this.error.set(err?.error?.error ?? 'No se pudo guardar');
    } finally {
      this.busy.set(false);
    }
  }
}

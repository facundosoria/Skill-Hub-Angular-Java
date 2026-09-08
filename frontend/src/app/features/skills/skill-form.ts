import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { I18n } from '../../core/i18n/i18n';
import { SkillService } from '../../core/skills';
import type { DuplicateCandidate, LanguageFlag, SkillFormValues, Stack, SkillType } from '../../core/models';
import { UI } from '../../shared/ui';

/**
 * Puerto (base) de src/components/skill-form.tsx. Falta el chequeo de duplicados
 * e idioma MIENTRAS se escribe (debounce); por ahora corre al enviar, con el
 * mismo shape de respuesta del backend.
 */
@Component({
  selector: 'app-skill-form',
  imports: [FormsModule, RouterLink, ...UI],
  template: `
    <div class="max-w-2xl">
      <h1 class="text-xl font-medium">{{ mode() === 'create' ? t().form.nuevoTitulo : t().form.editarTitulo }}</h1>
      <p class="mt-1 mb-6 text-sm text-text-muted">
        {{ mode() === 'create' ? t().form.nuevoSubtitulo : t().form.editarSubtitulo }}
      </p>

      @if (idioma()) {
        <div class="mb-4 rounded-xl border border-danger/35 bg-danger-soft p-4 text-sm text-danger">
          {{ t().idioma.titulo }} — {{ t().idioma.porQue }}
          <p class="mt-1 text-xs">{{ t().idioma.senales }} {{ idioma()!.senales.join(' · ') }}</p>
        </div>
      }

      @if (duplicates().length) {
        <div class="mb-4 rounded-xl border border-warning/35 bg-warning-soft p-4">
          <p class="text-sm font-medium text-warning">{{ t().form.duplicadoTitulo }}</p>
          <ul class="mt-2 space-y-1 text-sm">
            @for (d of duplicates(); track d.slug) {
              <li><a [routerLink]="['/skills', d.slug]" class="font-medium hover:underline">{{ d.title }}</a>
                <span class="text-xs text-text-muted"> · {{ d.stack }} · v{{ d.version }}</span></li>
            }
          </ul>
          <label class="mt-3 block text-xs text-warning">
            {{ t().form.duplicadoJustificacion }}
            <textarea uiTextarea rows="2" [(ngModel)]="v.duplicateJustification" name="dupJust"></textarea>
          </label>
        </div>
      }

      <form (ngSubmit)="submit()" class="space-y-5">
        <div class="grid gap-5 sm:grid-cols-2">
          <ui-field [label]="t().form.titulo"><input uiInput name="title" [(ngModel)]="v.title" (ngModelChange)="deriveSlug()" /></ui-field>
          <ui-field [label]="t().form.slug" [hint]="t().form.slugHint">
            <input uiInput name="slug" class="font-mono text-[13px]" [(ngModel)]="v.slug" [disabled]="mode() === 'edit'" />
          </ui-field>
        </div>
        <ui-field [label]="t().form.descripcion" [hint]="t().form.descripcionHint">
          <input uiInput name="description" maxlength="200" [(ngModel)]="v.description" />
        </ui-field>
        <ui-field [label]="t().form.cuandoUsarlo" [hint]="t().form.cuandoUsarloHint">
          <textarea uiTextarea name="whenToUse" rows="2" maxlength="200" [(ngModel)]="v.whenToUse"></textarea>
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
            <input uiInput name="tags" [(ngModel)]="tagsCsv" />
          </ui-field>
        </div>
        <ui-field [label]="t().form.contenido" [hint]="t().form.contenidoHint">
          <textarea uiTextarea name="content" rows="16" class="font-mono text-[13px]" [(ngModel)]="v.content"></textarea>
        </ui-field>
        <ui-field [label]="t().form.notaCambio" [hint]="t().form.notaCambioHint">
          <input uiInput name="changelog" [(ngModel)]="v.changelog" />
        </ui-field>

        @if (error() && error() !== 'EN_SOLO_INGLES') { <p class="text-sm text-danger">{{ error() }}</p> }

        <div class="flex items-center gap-2 border-t border-border pt-5">
          <button uiButton type="submit" [disabled]="busy()">
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
  idioma = signal<LanguageFlag | null>(null);
  duplicates = signal<DuplicateCandidate[]>([]);

  editing = computed(() => this.mode() === 'edit');

  constructor() {
    queueMicrotask(async () => {
      if (this.mode() === 'edit' && this.slug()) {
        const d = await this.skills.get(this.slug()!);
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
      }
    });
  }

  deriveSlug(): void {
    if (this.slugTouched || this.mode() === 'edit') return;
    this.v.slug = this.v.title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
  }

  async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.v.tags = this.tagsCsv.split(',').map((x) => x.trim()).filter(Boolean);
    try {
      const res =
        this.mode() === 'create'
          ? await this.skills.create(this.v)
          : await this.skills.update(this.v.slug, this.v);

      if (res.error === 'EN_SOLO_INGLES') {
        this.idioma.set(res.idioma ?? null);
        return;
      }
      if (res.duplicates?.length) {
        this.duplicates.set(res.duplicates);
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

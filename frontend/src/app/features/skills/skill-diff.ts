import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { diffLines } from 'diff';
import { I18n } from '../../core/i18n/i18n';
import { SkillService } from '../../core/skills';

type DiffRow = { kind: 'add' | 'del' | 'same'; line: string };

/**
 * Puerto de src/app/(app)/skills/[slug]/diff/page.tsx + diff-view.tsx.
 *
 * Las versiones son inmutables, asi que el diff siempre es reproducible: no hay
 * forma de que el "antes" cambie despues de los hechos. `a` y `b` llegan como
 * query params (via withComponentInputBinding).
 */
@Component({
  selector: 'app-skill-diff',
  imports: [RouterLink],
  template: `
    <a [routerLink]="['/skills', slug()]" class="text-[13px] text-text-muted hover:text-text">← {{ slug() }}</a>

    @if (data(); as d) {
      <h1 class="mt-4 text-xl font-medium">v{{ d.fromVersion }} → v{{ d.toVersion }}</h1>
      <p class="mt-1 mb-6 text-sm text-text-muted">
        <span class="text-success">+{{ added() }}</span>
        <span class="text-danger">−{{ removed() }}</span>
        {{ t().diff.lineas }}
      </p>

      <div class="overflow-x-auto rounded-xl border border-border bg-surface">
        <pre class="min-w-full font-mono text-[13px] leading-relaxed">@for (row of rows(); track $index) {<div
          class="flex gap-3 px-3 py-[1px] whitespace-pre"
          [class.bg-success-soft]="row.kind === 'add'"
          [class.bg-danger-soft]="row.kind === 'del'"
        ><span
          class="w-3 shrink-0 select-none"
          [class.text-success]="row.kind === 'add'"
          [class.text-danger]="row.kind === 'del'"
          [class.text-text-faint]="row.kind === 'same'"
          aria-hidden="true"
        >{{ row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' ' }}</span><span
          [class.text-text-muted]="row.kind === 'same'"
        >{{ row.line || ' ' }}</span></div>}</pre>
      </div>
    } @else if (error()) {
      <p class="mt-6 text-sm text-danger">{{ error() }}</p>
    } @else {
      <div class="mt-6 h-40 animate-pulse rounded-md bg-surface-2"></div>
    }
  `,
})
export class SkillDiff {
  slug = input.required<string>();
  a = input<string | undefined>(undefined);
  b = input<string | undefined>(undefined);

  private skills = inject(SkillService);
  private i18n = inject(I18n);
  t = this.i18n.t;

  data = signal<{ fromVersion: number; toVersion: number } | null>(null);
  rows = signal<DiffRow[]>([]);
  error = signal<string | null>(null);

  added = computed(() => this.rows().filter((r) => r.kind === 'add').length);
  removed = computed(() => this.rows().filter((r) => r.kind === 'del').length);

  constructor() {
    effect(() => {
      this.slug();
      this.a();
      this.b();
      untracked(() => this.load());
    });
  }

  private async load(): Promise<void> {
    this.data.set(null);
    this.error.set(null);
    const a = Number(this.a());
    const b = Number(this.b());
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      this.error.set('Versiones inválidas');
      return;
    }
    try {
      const res = (await this.skills.diff(this.slug(), a, b)) as {
        from: { version: number; content: string };
        to: { version: number; content: string };
      };
      this.data.set({ fromVersion: res.from.version, toVersion: res.to.version });
      this.rows.set(toRows(res.from.content, res.to.content));
    } catch {
      this.error.set('No existe esa comparación');
    }
  }
}

/** Puerto del flatMap de la page original. */
function toRows(from: string, to: string): DiffRow[] {
  return diffLines(from, to).flatMap((part) => {
    const kind: DiffRow['kind'] = part.added ? 'add' : part.removed ? 'del' : 'same';
    return part.value
      .split('\n')
      .filter((line, i, arr) => !(i === arr.length - 1 && line === ''))
      .map((line) => ({ kind, line }));
  });
}

import { Component, computed, input } from '@angular/core';

/*
 * Puerto de src/components/ui/primitives.tsx. Selectores de atributo para que el
 * uso lea parecido al JSX original: <button uiButton variant="primary">.
 */

const BTN_BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius)] text-sm font-medium ' +
  'transition-[background-color,border-color,color,transform] duration-[var(--dur-fast)] ' +
  'disabled:pointer-events-none disabled:opacity-50 active:scale-[0.985] cursor-pointer';
const BTN_VARIANT: Record<string, string> = {
  primary: 'bg-text text-bg border border-text hover:opacity-90',
  secondary: 'bg-surface text-text border border-border-strong hover:bg-surface-2',
  danger: 'bg-danger-soft text-danger border border-danger/40 hover:bg-danger-soft/70',
  ghost: 'text-text-muted hover:text-text hover:bg-surface-2 border border-transparent',
};
const BTN_SIZE: Record<string, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9 px-4',
  lg: 'h-10 px-5',
};

@Component({
  selector: 'button[uiButton]',
  template: `<ng-content />`,
  host: { '[class]': 'cls()' },
})
export class UiButton {
  variant = input<'primary' | 'secondary' | 'danger' | 'ghost'>('primary');
  size = input<'sm' | 'md' | 'lg'>('md');
  cls = computed(() => `${BTN_BASE} ${BTN_VARIANT[this.variant()]} ${BTN_SIZE[this.size()]}`);
}

const BADGE_BASE =
  'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap';
const BADGE_TONE: Record<string, string> = {
  neutral: 'bg-surface-2 text-text-muted border border-border',
  accent: 'bg-accent-soft text-accent border border-accent/25',
  success: 'bg-success-soft text-success border border-success/25',
  warning: 'bg-warning-soft text-warning border border-warning/25',
  danger: 'bg-danger-soft text-danger border border-danger/25',
};

@Component({
  selector: 'span[uiBadge]',
  template: `<ng-content />`,
  host: { '[class]': 'cls()' },
})
export class UiBadge {
  tone = input<'neutral' | 'accent' | 'success' | 'warning' | 'danger'>('neutral');
  cls = computed(() => `${BADGE_BASE} ${BADGE_TONE[this.tone()] ?? BADGE_TONE['neutral']}`);
}

/** Etiqueta de estado con el mismo color en toda la app. */
@Component({
  selector: 'ui-status-badge',
  imports: [UiBadge],
  template: `<span uiBadge [tone]="tone()">{{ label() }}</span>`,
})
export class UiStatusBadge {
  status = input.required<string>();
  private map: Record<string, { tone: 'success' | 'warning' | 'neutral'; label: string }> = {
    published: { tone: 'success', label: 'publicado' },
    proposed: { tone: 'warning', label: 'provisional' },
    draft: { tone: 'warning', label: 'borrador' },
    deprecated: { tone: 'neutral', label: 'deprecado' },
  };
  tone = computed(() => this.map[this.status()]?.tone ?? 'neutral');
  label = computed(() => this.map[this.status()]?.label ?? this.status());
}

@Component({
  selector: 'div[uiCard]',
  template: `<ng-content />`,
  host: { class: 'rounded-xl border border-border bg-surface overflow-hidden block' },
})
export class UiCard {}

@Component({
  selector: 'ui-empty-state',
  template: `
    <div class="rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <p class="text-sm text-text-muted">{{ title() }}</p>
      @if (hint()) {
        <p class="mt-1 text-xs text-text-faint">{{ hint() }}</p>
      }
    </div>
  `,
})
export class UiEmptyState {
  title = input.required<string>();
  hint = input<string>();
}

@Component({
  selector: 'ui-field',
  template: `
    <label class="block">
      <span class="mb-1.5 block text-[13px] text-text-muted">{{ label() }}</span>
      <ng-content />
      @if (error()) {
        <span class="mt-1.5 block text-xs text-danger">{{ error() }}</span>
      } @else if (hint()) {
        <span class="mt-1.5 block text-xs text-text-faint">{{ hint() }}</span>
      }
    </label>
  `,
})
export class UiField {
  label = input.required<string>();
  hint = input<string>();
  error = input<string | null>();
}

const INPUT_CLS =
  'h-9 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm ' +
  'placeholder:text-text-faint transition-colors duration-[var(--dur-fast)] ' +
  'focus:border-accent focus:outline-none';

@Component({
  selector: 'input[uiInput]',
  template: '',
  host: { '[class]': 'cls' },
})
export class UiInput {
  cls = INPUT_CLS;
}

@Component({
  selector: 'textarea[uiTextarea]',
  template: '',
  host: {
    '[class]':
      "'w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 py-2 text-sm placeholder:text-text-faint focus:border-accent focus:outline-none'",
  },
})
export class UiTextarea {}

@Component({
  selector: 'select[uiSelect]',
  template: `<ng-content />`,
  host: {
    '[class]':
      "'h-9 rounded-[var(--radius)] border border-border-strong bg-surface px-2.5 text-sm focus:border-accent focus:outline-none cursor-pointer'",
  },
})
export class UiSelect {}

/** Todas las primitivas juntas, para importar de una en las paginas. */
export const UI = [
  UiButton,
  UiBadge,
  UiStatusBadge,
  UiCard,
  UiEmptyState,
  UiField,
  UiInput,
  UiTextarea,
  UiSelect,
] as const;

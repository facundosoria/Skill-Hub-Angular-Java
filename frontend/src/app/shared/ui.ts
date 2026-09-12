import { booleanAttribute, Component, computed, input } from '@angular/core';

/*
 * Puerto de src/components/ui/primitives.tsx. Selectores de atributo para que el
 * uso lea parecido al JSX original: <button uiButton variant="primary">.
 */

const BTN_BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius)] font-medium ' +
  'shadow-[var(--shadow-sm)] ' +
  'transition-[background-color,border-color,color,transform,box-shadow,filter] duration-[var(--dur)] ease-[var(--ease)] ' +
  'hover:-translate-y-px active:translate-y-0 active:scale-[0.98] ' +
  'disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none cursor-pointer ' +
  'focus-visible:outline-none focus-visible:shadow-[var(--ring)]';
const BTN_VARIANT: Record<string, string> = {
  primary: 'bg-accent text-accent-fg border border-accent hover:brightness-110 hover:shadow-[var(--shadow)]',
  secondary: 'bg-surface text-text border border-border-strong hover:bg-surface-2 hover:border-text-faint',
  danger: 'bg-danger-soft text-danger border border-danger/40 hover:bg-danger-soft/70',
  ghost: 'text-text-muted hover:text-text hover:bg-surface-2 border border-transparent shadow-none',
};
const BTN_SIZE: Record<string, string> = {
  sm: 'h-9 px-3.5 text-[13px]',
  md: 'h-10 px-5 text-sm',
  lg: 'h-12 px-7 text-[15px]',
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
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium tracking-tight whitespace-nowrap';
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
  host: {
    '[class]': 'cls()',
  },
})
export class UiCard {
  /** Realza la tarjeta al pasar el mouse (sube 2px + sombra). */
  interactive = input(false, { transform: booleanAttribute });
  cls = computed(
    () =>
      'rounded-[var(--radius-lg)] border border-border bg-surface overflow-hidden block shadow-[var(--shadow-sm)]' +
      (this.interactive() ? ' card-lift' : ''),
  );
}

@Component({
  selector: 'ui-empty-state',
  template: `
    <div class="rounded-[var(--radius-lg)] border border-dashed border-border-strong bg-surface/40 px-6 py-16 text-center anim-pop-in">
      <p class="text-sm font-medium text-text-muted">{{ title() }}</p>
      @if (hint()) {
        <p class="mt-1.5 text-xs text-text-faint">{{ hint() }}</p>
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
  host: { class: 'block' },
  template: `
    <label class="block">
      <span class="mb-1.5 block text-[13px] font-medium text-text-muted">{{ label() }}</span>
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
  'h-10 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3.5 text-sm ' +
  'placeholder:text-text-faint transition-[border-color,box-shadow] duration-[var(--dur-fast)] ' +
  'focus:border-accent focus:outline-none focus:shadow-[var(--ring)]';

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
      "'w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3.5 py-2.5 text-sm placeholder:text-text-faint transition-[border-color,box-shadow] duration-[var(--dur-fast)] focus:border-accent focus:outline-none focus:shadow-[var(--ring)]'",
  },
})
export class UiTextarea {}

@Component({
  selector: 'select[uiSelect]',
  template: `<ng-content />`,
  host: {
    '[class]':
      "'h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm transition-[border-color,box-shadow] duration-[var(--dur-fast)] focus:border-accent focus:outline-none focus:shadow-[var(--ring)] cursor-pointer'",
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

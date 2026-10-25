import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';

export type ToastTone = 'success' | 'danger' | 'neutral';
export type Toast = { id: number; text: string; tone: ToastTone };

/**
 * Cola de avisos efimeros (copiado, guardado, error). Cada toast se va solo a
 * los `ms` indicados; el ToastHost del Shell los dibuja con animate.enter/leave.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  readonly toasts = signal<Toast[]>([]);

  show(text: string, tone: ToastTone = 'neutral', ms = 2200): void {
    const id = this.nextId++;
    // Maximo 3 visibles: el mas viejo cede su lugar.
    this.toasts.update((list) => [...list, { id, text, tone }].slice(-3));
    setTimeout(() => this.dismiss(id), ms);
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}

/** Pila de toasts abajo a la derecha. Va una sola vez, en el Shell. */
@Component({
  selector: 'ui-toast-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pointer-events-none fixed right-4 bottom-4 z-[90] flex flex-col items-end gap-2" role="status" aria-live="polite">
      @for (toast of toasts.toasts(); track toast.id) {
        <div
          class="pointer-events-auto flex items-center gap-2 rounded-full border border-border-strong bg-surface px-4 py-2 text-[13px] text-text shadow-[var(--shadow-lg)]"
          animate.enter="anim-toast-in"
          animate.leave="anim-toast-out"
        >
          <span
            class="h-1.5 w-1.5 shrink-0 rounded-full"
            [class.bg-success]="toast.tone === 'success'"
            [class.bg-danger]="toast.tone === 'danger'"
            [class.bg-accent]="toast.tone === 'neutral'"
            aria-hidden="true"
          ></span>
          <span>{{ toast.text }}</span>
        </div>
      }
    </div>
  `,
})
export class ToastHost {
  toasts = inject(ToastService);
}

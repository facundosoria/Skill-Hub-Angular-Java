import { DestroyRef, Directive, ElementRef, effect, inject, input } from '@angular/core';

/**
 * Escribe un numero en el elemento contando desde el valor anterior (0 la
 * primera vez) hasta `countUp`, con ease-out. Con prefers-reduced-motion pone
 * el valor final directo. Escribe el DOM sin pasar por change detection.
 */
@Directive({ selector: '[countUp]' })
export class CountUp {
  countUp = input.required<number>();
  /** Duracion en ms. */
  countUpMs = input(700);

  private el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private current = 0;
  private frame = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.frame));
    effect(() => this.animateTo(this.countUp(), this.countUpMs()));
  }

  private animateTo(target: number, ms: number): void {
    cancelAnimationFrame(this.frame);
    const reduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || ms <= 0 || typeof requestAnimationFrame !== 'function') {
      this.write(target);
      return;
    }
    const from = this.current;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min((now - start) / ms, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      this.write(Math.round(from + (target - from) * eased));
      if (p < 1) this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  private write(value: number): void {
    this.current = value;
    this.el.textContent = String(value);
  }
}

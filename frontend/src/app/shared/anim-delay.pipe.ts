import { Pipe, PipeTransform } from '@angular/core';

/**
 * Delay escalonado para la entrada de listas (`animate.enter="anim-row-in"`).
 * Puerto del `Math.min(i, N) * 0.0Xs` que motion/react hacía en el stagger.
 * Se topea para que una lista larga no arrastre medio segundo de delay.
 */
@Pipe({ name: 'animDelay' })
export class AnimDelayPipe implements PipeTransform {
  transform(index: number, stepMs = 24, cap = 12): string {
    return `${Math.min(index, cap) * stepMs}ms`;
  }
}

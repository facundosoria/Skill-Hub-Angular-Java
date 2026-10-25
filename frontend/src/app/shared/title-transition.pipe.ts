import { Pipe, PipeTransform } from '@angular/core';

/**
 * view-transition-name del titulo de un skill (`skill-title-<slug>`). La card
 * del catalogo y el h1 del detalle llevan el mismo nombre, asi el navegador
 * hace el morph al navegar (withViewTransitions). El slug se limpia a un ident
 * CSS valido.
 */
@Pipe({ name: 'titleTransition' })
export class TitleTransitionPipe implements PipeTransform {
  transform(slug: string): string {
    return `skill-title-${slug.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  }
}

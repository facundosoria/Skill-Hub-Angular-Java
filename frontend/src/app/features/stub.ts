import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Placeholder para las pantallas todavia no portadas (diff de versiones, docs).
 * El backend que las alimenta ya existe; falta el componente.
 */
@Component({
  selector: 'app-stub',
  imports: [RouterLink],
  template: `
    <div class="rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <h1 class="text-lg font-medium">{{ title() }}</h1>
      <p class="mt-2 text-sm text-text-muted">Pantalla pendiente de portar en la próxima iteración.</p>
      <a routerLink="/skills" class="mt-4 inline-block text-sm text-accent underline underline-offset-2">← Catálogo</a>
    </div>
  `,
})
export class Stub {
  title = input('Pendiente');
}

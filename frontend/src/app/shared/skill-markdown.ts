import { Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Puerto de src/components/skill-markdown.tsx.
 *
 * El cuerpo del skill lo escribe cualquiera de las 100 personas, asi que el HTML
 * NO se confia: se pasa por DOMPurify antes de renderizar (equivale a
 * rehype-sanitize del original). El unico HTML que se ejecuta es el bloque
 * ```preview, aislado en un iframe con sandbox (ver skill-preview.ts). Ese
 * bloque se saca del markdown para no mostrarlo dos veces.
 */
@Component({
  selector: 'skill-markdown',
  template: `<div class="prose-skill text-[15px]" [innerHTML]="html()"></div>`,
})
export class SkillMarkdown {
  private sanitizer = inject(DomSanitizer);
  content = input.required<string>();

  html = computed<SafeHtml>(() => {
    const withoutPreview = (this.content() ?? '').replace(/```preview\r?\n[\s\S]*?```/g, '').trim();
    const raw = marked.parse(withoutPreview, { async: false, gfm: true }) as string;
    const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
    // DOMPurify ya limpio; se evita la segunda pasada de Angular para no perder
    // formato legitimo (tablas, clases del prose).
    return this.sanitizer.bypassSecurityTrustHtml(clean);
  });
}

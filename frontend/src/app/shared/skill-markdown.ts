import {
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  inject,
  input,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Highlighter } from './highlighter';

/**
 * Puerto de src/components/skill-markdown.tsx, con resaltado de sintaxis (Shiki)
 * agregado — el original no lo tenia.
 *
 * El cuerpo del skill lo escribe cualquiera de las 100 personas, asi que el HTML
 * NO se confia: se pasa por DOMPurify (equivale a rehype-sanitize). El unico HTML
 * que se ejecuta es el bloque ```preview, aislado en un iframe con sandbox (ver
 * skill-preview.ts). Ese bloque se saca del markdown para no mostrarlo dos veces.
 *
 * Shiki es async: se renderiza el markdown ya (con los <pre><code> planos de
 * marked) y despues, en afterRender, se reemplaza cada bloque por su version
 * resaltada. Si Shiki falla, queda el bloque plano.
 */
@Component({
  selector: 'skill-markdown',
  template: `<div class="prose-skill text-[15px]" [innerHTML]="html()"></div>`,
})
export class SkillMarkdown {
  private sanitizer = inject(DomSanitizer);
  private host = inject(ElementRef<HTMLElement>);
  private highlighter = inject(Highlighter);

  content = input.required<string>();

  html = computed<SafeHtml>(() => {
    const withoutPreview = (this.content() ?? '').replace(/```preview\r?\n[\s\S]*?```/g, '').trim();
    const raw = marked.parse(withoutPreview, { async: false, gfm: true }) as string;
    const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
    return this.sanitizer.bypassSecurityTrustHtml(clean);
  });

  constructor() {
    afterRenderEffect(() => {
      this.html(); // reprocesar cuando cambia el contenido
      queueMicrotask(() => this.highlight());
    });
  }

  private highlight(): void {
    const root = this.host.nativeElement as HTMLElement;
    const blocks = root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]:not([data-hl])');
    blocks.forEach((code) => {
      code.setAttribute('data-hl', '');
      const lang = (code.className.match(/language-([\w-]+)/)?.[1] ?? 'text').toLowerCase();
      const pre = code.parentElement;
      if (!pre) return;
      void this.highlighter.codeToHtml(code.textContent ?? '', lang).then((shikiHtml) => {
        if (!shikiHtml || !pre.isConnected) return;
        const tpl = document.createElement('template');
        tpl.innerHTML = shikiHtml.trim();
        const replacement = tpl.content.firstElementChild;
        if (replacement) pre.replaceWith(replacement);
      });
    });
  }
}

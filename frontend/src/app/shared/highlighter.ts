import { Injectable } from '@angular/core';
import type { HighlighterCore } from 'shiki';

/**
 * Singleton perezoso de Shiki. Se carga una sola vez, con un set acotado de
 * lenguajes (stack Angular + Java) y doble tema (claro/oscuro con variables CSS,
 * ver styles.css). Es una mejora sobre el original, que no resaltaba codigo.
 */
@Injectable({ providedIn: 'root' })
export class Highlighter {
  static readonly LIGHT = 'github-light';
  static readonly DARK = 'github-dark';

  private static readonly LANGS = [
    'typescript', 'javascript', 'java', 'html', 'css', 'scss', 'json', 'yaml',
    'bash', 'shell', 'sql', 'xml', 'markdown', 'diff', 'properties', 'dockerfile',
    'kotlin', 'groovy', 'http', 'text',
  ];

  private hl?: Promise<HighlighterCore>;

  private load(): Promise<HighlighterCore> {
    if (!this.hl) {
      this.hl = import('shiki').then((shiki) =>
        shiki.createHighlighter({
          themes: [Highlighter.LIGHT, Highlighter.DARK],
          langs: Highlighter.LANGS,
        }),
      );
    }
    return this.hl;
  }

  /** HTML `<pre class="shiki">…</pre>` con doble tema, o null si algo falla. */
  async codeToHtml(code: string, lang: string): Promise<string | null> {
    try {
      const hl = await this.load();
      const known = hl.getLoadedLanguages().includes(lang as never) ? lang : 'text';
      return hl.codeToHtml(code, {
        lang: known,
        themes: { light: Highlighter.LIGHT, dark: Highlighter.DARK },
        defaultColor: 'light',
      });
    } catch {
      return null;
    }
  }
}

import {
  afterRenderEffect,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { I18n } from '../../core/i18n/i18n';
import { SkillMarkdown } from '../../shared/skill-markdown';

type TocItem = { id: string; text: string };

/**
 * Puerto de src/app/(app)/docs/*. El original justificaba tener el contenido
 * como componentes JSX en vez de en el diccionario: "es un texto, se edita como
 * un texto". Aca se lleva esa idea hasta el final — el contenido son dos .md
 * (public/content/docs.es.md, docs.en.md) que se renderizan con el mismo
 * pipeline de markdown que los skills (marked + DOMPurify + Shiki).
 *
 * El indice lateral con scroll-spy es el puerto de IndiceLateral (doc-parts.tsx):
 * se genera de los <h2> y sigue la seccion visible con un IntersectionObserver.
 *
 * Se pierden respecto del original: el acordeon de las tools (ahora son ###) y
 * la linea de continuidad animada de la secuencia (ahora es una lista numerada).
 */
@Component({
  selector: 'app-docs',
  imports: [SkillMarkdown],
  template: `
    <div class="flex gap-10">
      <nav class="sticky top-6 hidden w-52 shrink-0 self-start lg:block" [attr.aria-label]="t().docs.contenido">
        <p class="mb-2 text-[11px] uppercase tracking-wider text-text-faint">{{ t().docs.contenido }}</p>
        <ul class="space-y-0.5 border-l border-border">
          @for (item of toc(); track item.id) {
            <li>
              <a [href]="'#' + item.id" (click)="jump($event, item.id)"
                 class="-ml-px block border-l py-1 pl-3 text-[13px] transition-colors"
                 [class]="active() === item.id ? 'border-accent text-text' : 'border-transparent text-text-muted hover:text-text'">
                {{ item.text }}
              </a>
            </li>
          }
        </ul>
      </nav>

      <div class="min-w-0 max-w-3xl flex-1">
        @if (content(); as md) {
          <skill-markdown [content]="md" />
        } @else {
          <div class="h-64 animate-pulse rounded-md bg-surface-2"></div>
        }
      </div>
    </div>
  `,
})
export class Docs {
  private i18n = inject(I18n);
  private host = inject(ElementRef<HTMLElement>);
  private destroyRef = inject(DestroyRef);
  t = this.i18n.t;

  private mcpUrl = typeof location !== 'undefined' ? `${location.origin}/api/mcp` : '/api/mcp';

  content = signal<string | null>(null);
  toc = signal<TocItem[]>([]);
  active = signal<string>('');

  private headings: HTMLHeadingElement[] = [];
  private onScroll = () => this.spy();

  constructor() {
    this.destroyRef.onDestroy(() => window.removeEventListener('scroll', this.onScroll));
    window.addEventListener('scroll', this.onScroll, { passive: true });

    // Recarga el .md cuando cambia el idioma.
    effect(() => {
      const locale = this.i18n.locale();
      untracked(() => this.load(locale));
    });

    afterRenderEffect(() => {
      this.content(); // reconstruir el indice cuando cambia el contenido
      queueMicrotask(() => this.buildToc());
    });
  }

  /**
   * Seccion activa segun cual encabezado esta mas cerca del tope (con un
   * offset). Es el mismo efecto que el IntersectionObserver del original
   * (IndiceLateral), pero por scroll: mas predecible y sin depender de que el
   * navegador compute intersecciones.
   */
  private spy(): void {
    if (this.headings.length === 0) return;
    const offset = 96;
    let current = this.headings[0].id;
    for (const h of this.headings) {
      if (h.getBoundingClientRect().top - offset <= 0) current = h.id;
      else break;
    }
    if (current !== this.active()) this.active.set(current);
  }

  private async load(locale: string): Promise<void> {
    this.content.set(null);
    try {
      const res = await fetch(`content/docs.${locale}.md`);
      const raw = await res.text();
      this.content.set(raw.replaceAll('{{MCP_URL}}', this.mcpUrl));
    } catch {
      this.content.set('# Cómo funciona\n\nNo se pudo cargar la documentación.');
    }
  }

  private buildToc(): void {
    const root = this.host.nativeElement as HTMLElement;
    const hs = Array.from(root.querySelectorAll<HTMLHeadingElement>('skill-markdown h2'));
    if (hs.length === 0) return;

    const items: TocItem[] = hs.map((h) => {
      const id = slugify(h.textContent ?? '');
      h.id = id;
      return { id, text: h.textContent ?? '' };
    });
    // Evitar reconstruir si no cambio nada (afterRender corre seguido).
    if (JSON.stringify(items) === JSON.stringify(this.toc())) return;
    this.headings = hs;
    this.toc.set(items);
    this.active.set(items[0].id);
    this.spy();
  }

  jump(ev: Event, id: string): void {
    ev.preventDefault();
    this.host.nativeElement
      .querySelector(`#${CSS.escape(id)}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.active.set(id);
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

import {
  afterRenderEffect,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  ViewChild,
} from '@angular/core';
import gsap from 'gsap';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import { I18n } from '../../core/i18n/i18n';
import { SkillMarkdown } from '../../shared/skill-markdown';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollToPlugin);
}

type TocItem = { id: string; text: string };

interface TocGroup {
  id: string;
  title: string;
  items: TocItem[];
}

/**
 * Vista de documentación ("Cómo funciona"):
 * Renderiza el 100% del markdown canónico (public/content/docs.{es,en}.md)
 * utilizando el pipeline completo de Shiki + DOMPurify + marked.
 *
 * Adopta la arquitectura visual y dinámica de la Propuesta 3 (Stripe / Linear Docs):
 * - Barra lateral agrupada con indicador líquido elástico GSAP (liquid stretch)
 * - Desplazamiento suave con GSAP ScrollToPlugin compensando el header fijo
 * - Anclaje visual con destello sutil (.doc-heading-flash) en los encabezados
 * - Microinteracciones de hover en los ítems de navegación
 */
@Component({
  selector: 'app-docs',
  imports: [SkillMarkdown],
  template: `
    <div class="mb-6 flex items-center gap-2 text-xs font-semibold tracking-wider uppercase text-accent">
      <span class="inline-flex items-center gap-1.5">
        <svg
          class="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        Docs
      </span>
      <span class="text-text-faint">/</span>
      <span class="text-text-muted">{{ t().docs.contenido }}</span>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-8 xl:gap-12 items-start">
      <!-- Barra lateral estilo Linear / Stripe con Liquid Stretch Indicator -->
      <aside
        class="sticky top-20 hidden lg:block self-start w-64 shrink-0"
        [attr.aria-label]="t().docs.contenido"
      >
        <div
          class="rounded-[var(--radius-lg)] border border-border/80 bg-surface/80 p-4.5 backdrop-blur-md shadow-[var(--shadow-sm)]"
        >
          <div class="nav-list-wrapper relative border-l border-border pl-0.5" #navWrapper>
            <!-- Barra indicadora líquida animada con GSAP -->
            <div class="liquid-bar" #liquidBar></div>

            @for (group of tocGroups(); track group.id) {
              <div class="nav-group mb-5 last:mb-0">
                <div
                  class="nav-group__title mb-1.5 pl-3 text-[11px] font-bold uppercase tracking-wider text-text-faint"
                >
                  {{ group.title }}
                </div>
                <div class="space-y-0.5">
                  @for (item of group.items; track item.id) {
                    <a
                      [href]="'#' + item.id"
                      [id]="'toc-' + item.id"
                      (click)="jump($event, item.id)"
                      (mouseenter)="onHover($event, true)"
                      (mouseleave)="onHover($event, false)"
                      class="nav-item block rounded-r-[calc(var(--radius)-2px)] px-3 py-1.5 text-[13px] text-text-muted transition-colors hover:text-text truncate select-none cursor-pointer"
                      [class.active]="active() === item.id"
                      [title]="item.text"
                    >
                      {{ item.text }}
                    </a>
                  }
                </div>
              </div>
            }
          </div>
        </div>
      </aside>

      <!-- Panel lector principal con 100% del contenido Markdown sin resumir -->
      <article class="min-w-0 max-w-4xl flex-1">
        <div
          class="rounded-[var(--radius-lg)] border border-border/80 bg-surface/60 p-6 sm:p-10 shadow-[var(--shadow-sm)] backdrop-blur-sm"
        >
          @if (content(); as md) {
            <skill-markdown [content]="md" />
          } @else {
            <div class="space-y-4 animate-pulse">
              <div class="h-8 w-1/3 rounded bg-surface-2"></div>
              <div class="h-4 w-2/3 rounded bg-surface-2"></div>
              <div class="h-48 rounded bg-surface-2"></div>
            </div>
          }
        </div>
      </article>
    </div>
  `,
  styles: [
    `
      .liquid-bar {
        position: absolute;
        left: -1px;
        top: 0;
        width: 2.5px;
        height: 28px;
        background: var(--accent);
        border-radius: 2px;
        box-shadow: 0 0 10px var(--accent);
        z-index: 5;
        pointer-events: none;
        opacity: 0;
        will-change: transform, height;
      }

      .nav-item {
        position: relative;
        transition: color 0.15s ease, background-color 0.15s ease;
      }

      .nav-item.active {
        color: var(--accent);
        font-weight: 600;
        background: var(--accent-soft);
      }

      :host ::ng-deep .prose-skill {
        line-height: 1.75;
      }

      :host ::ng-deep .prose-skill h1 {
        font-size: 2rem;
        font-weight: 750;
        letter-spacing: -0.035em;
        color: var(--text);
        margin-top: 0;
        margin-bottom: 0.75rem;
        padding-bottom: 1.25rem;
        border-bottom: 1px solid var(--border);
      }

      :host ::ng-deep .prose-skill h1 + p {
        font-size: 1.05rem;
        color: var(--text-muted);
        line-height: 1.6;
        margin-top: 0;
        margin-bottom: 2.25rem;
      }

      :host ::ng-deep .prose-skill h2 {
        font-size: 1.45rem;
        font-weight: 700;
        letter-spacing: -0.025em;
        color: var(--text);
        margin-top: 3rem;
        margin-bottom: 1rem;
        padding-top: 1.25rem;
        border-top: 1px solid var(--border);
        scroll-margin-top: 5.5rem;
        transition: color 0.3s ease, text-shadow 0.3s ease;
      }

      :host ::ng-deep .prose-skill h2:first-of-type {
        margin-top: 1.5rem;
        border-top: none;
        padding-top: 0;
      }

      :host ::ng-deep .prose-skill h2.doc-heading-flash {
        color: var(--accent) !important;
        text-shadow: 0 0 16px color-mix(in srgb, var(--accent) 50%, transparent);
      }

      :host ::ng-deep .prose-skill h3 {
        font-size: 1.05rem;
        font-weight: 600;
        color: var(--text);
        margin-top: 1.75rem;
        margin-bottom: 0.5rem;
        scroll-margin-top: 5.5rem;
      }

      :host ::ng-deep .prose-skill p {
        color: var(--text-muted);
        font-size: 0.95rem;
        line-height: 1.7;
        margin: 0.85rem 0;
      }

      :host ::ng-deep .prose-skill p strong {
        color: var(--text);
      }

      :host ::ng-deep .prose-skill ul,
      :host ::ng-deep .prose-skill ol {
        color: var(--text-muted);
        font-size: 0.95rem;
        margin: 0.85rem 0;
        padding-left: 1.35rem;
      }

      :host ::ng-deep .prose-skill li {
        margin-bottom: 0.4rem;
      }

      :host ::ng-deep .prose-skill li strong {
        color: var(--text);
      }

      :host ::ng-deep .prose-skill blockquote {
        border-left: 3px solid var(--accent);
        background: var(--surface-2);
        border-radius: 0 var(--radius) var(--radius) 0;
        padding: 0.85rem 1.15rem;
        margin: 1.25rem 0;
        color: var(--text-muted);
      }

      :host ::ng-deep .prose-skill blockquote strong {
        color: var(--text);
      }

      :host ::ng-deep .prose-skill table {
        width: 100%;
        border-collapse: collapse;
        margin: 1.5rem 0;
        font-size: 0.88rem;
        border-radius: var(--radius);
        overflow: hidden;
        border: 1px solid var(--border);
      }

      :host ::ng-deep .prose-skill th {
        background: var(--surface-2);
        color: var(--text);
        font-weight: 600;
        border: 1px solid var(--border);
        padding: 0.65rem 0.9rem;
      }

      :host ::ng-deep .prose-skill td {
        border: 1px solid var(--border);
        padding: 0.65rem 0.9rem;
        color: var(--text-muted);
      }

      :host ::ng-deep .prose-skill pre {
        margin: 1.25rem 0;
        border-radius: var(--radius);
        border: 1px solid var(--border);
      }
    `,
  ],
})
export class Docs {
  private i18n = inject(I18n);
  private host = inject(ElementRef<HTMLElement>);
  private destroyRef = inject(DestroyRef);
  t = this.i18n.t;

  @ViewChild('liquidBar') private liquidBarRef?: ElementRef<HTMLElement>;
  @ViewChild('navWrapper') private navWrapperRef?: ElementRef<HTMLElement>;

  private mcpUrl = typeof location !== 'undefined' ? `${location.origin}/api/mcp` : '/api/mcp';

  content = signal<string | null>(null);
  toc = signal<TocItem[]>([]);
  active = signal<string>('');

  tocGroups = computed<TocGroup[]>(() => {
    const items = this.toc();
    if (items.length === 0) return [];
    const isEn = this.i18n.locale() === 'en';

    if (items.length >= 8) {
      const g1Items = items.slice(0, 3);
      const g2Items = items.slice(3, 8);
      const g3Items = items.slice(8);

      const groups: TocGroup[] = [
        {
          id: 'fundamentos',
          title: isEn ? '1. Fundamentals' : '1. Fundamentos',
          items: g1Items,
        },
        {
          id: 'arquitectura',
          title: isEn ? '2. Architecture & MCP' : '2. Arquitectura & MCP',
          items: g2Items,
        },
      ];
      if (g3Items.length > 0) {
        groups.push({
          id: 'agentes',
          title: isEn ? '3. Agents in Action' : '3. Agentes en Acción',
          items: g3Items,
        });
      }
      return groups;
    }

    return [
      {
        id: 'general',
        title: isEn ? 'Index' : 'Contenido',
        items,
      },
    ];
  });

  private headings: HTMLHeadingElement[] = [];
  private isClickScrolling = false;
  private currentBarY: number | null = null;
  private onScroll = () => this.spy();
  private onResize = () => {
    const current = this.active();
    if (!current) return;
    const navItem = this.host.nativeElement.querySelector(
      `#toc-${CSS.escape(current)}`
    ) as HTMLElement | null;
    if (navItem) {
      this.moveLiquidBar(navItem, false);
    }
  };

  constructor() {
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('scroll', this.onScroll);
      window.removeEventListener('resize', this.onResize);
      const bar = this.liquidBarRef?.nativeElement;
      if (bar) gsap.killTweensOf(bar);
    });
    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onResize, { passive: true });

    // Recarga el .md cuando cambia el idioma.
    effect(() => {
      const locale = this.i18n.locale();
      this.currentBarY = null;
      untracked(() => this.load(locale));
    });

    afterRenderEffect(() => {
      this.content(); // reconstruir el indice cuando cambia el contenido
      queueMicrotask(() => this.buildToc());
    });

    // Mueve la barra liquida de forma reactiva ante cambios en active()
    effect(() => {
      const activeId = this.active();
      if (!activeId) return;
      untracked(() => {
        requestAnimationFrame(() => {
          const navItem = this.host.nativeElement.querySelector(
            `#toc-${CSS.escape(activeId)}`
          ) as HTMLElement | null;
          if (navItem) {
            this.moveLiquidBar(navItem, this.currentBarY !== null);
          }
        });
      });
    });
  }

  /**
   * Sigue la sección activa según la posición de scroll en la ventana.
   */
  private spy(): void {
    if (this.isClickScrolling || this.headings.length === 0) return;
    const offset = 120;
    let current = this.headings[0].id;

    // Si llegamos cerca del final del documento, seleccionar el último encabezado
    const scrollPosition = window.innerHeight + window.scrollY;
    const documentHeight = document.documentElement.scrollHeight;
    if (documentHeight - scrollPosition < 40) {
      current = this.headings[this.headings.length - 1].id;
    } else {
      for (const h of this.headings) {
        if (h.getBoundingClientRect().top - offset <= 0) {
          current = h.id;
        } else {
          break;
        }
      }
    }

    if (current !== this.active()) {
      this.active.set(current);
    }
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

    if (JSON.stringify(items) === JSON.stringify(this.toc())) return;
    this.headings = hs;
    this.toc.set(items);
    this.active.set(items[0].id);
    this.spy();
  }

  /**
   * Efecto liquid stretch de GSAP en la barra indicadora vertical.
   */
  private moveLiquidBar(targetItem: HTMLElement, animate = true): void {
    const bar = this.liquidBarRef?.nativeElement;
    const wrapper = this.navWrapperRef?.nativeElement;
    if (!bar || !wrapper || !targetItem) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const itemRect = targetItem.getBoundingClientRect();
    const targetY = itemRect.top - wrapperRect.top + wrapper.scrollTop;
    const targetH = itemRect.height || 28;

    const prevY = this.currentBarY ?? targetY;
    const distance = Math.abs(targetY - prevY);
    this.currentBarY = targetY;

    gsap.killTweensOf(bar);

    // Asegurar que items activos vuelvan a su posición X base
    gsap.set(targetItem, { x: 0 });

    if (!animate || distance === 0) {
      gsap.set(bar, { y: targetY, height: targetH, opacity: 1 });
      return;
    }

    // Efecto de estiramiento líquido: la barra se estira en altura antes de encogerse en destino
    const tl = gsap.timeline();
    if (distance > 35) {
      tl.to(bar, {
        y: Math.min(prevY, targetY),
        height: distance + targetH,
        duration: 0.18,
        ease: 'power2.in',
        opacity: 1,
      }).to(bar, {
        y: targetY,
        height: targetH,
        duration: 0.28,
        ease: 'elastic.out(1, 0.75)',
      });
    } else {
      tl.to(bar, {
        y: targetY,
        height: targetH,
        duration: 0.32,
        ease: 'power3.out',
        opacity: 1,
      });
    }
  }

  /**
   * Microinteracción al pasar el mouse por un ítem inactivo.
   */
  onHover(ev: MouseEvent, isEnter: boolean): void {
    const el = ev.currentTarget as HTMLElement | null;
    if (!el || el.classList.contains('active')) return;
    gsap.to(el, {
      x: isEnter ? 4 : 0,
      duration: 0.2,
      ease: 'power2.out',
    });
  }

  /**
   * Navegación suave con GSAP ScrollToPlugin y destello sutil en el encabezado destino.
   */
  jump(ev: Event, id: string): void {
    ev.preventDefault();
    const targetEl = this.host.nativeElement.querySelector(
      `#${CSS.escape(id)}`
    ) as HTMLElement | null;
    if (!targetEl) return;

    this.isClickScrolling = true;
    this.active.set(id);

    // Destello de anclaje visual en el encabezado
    targetEl.classList.remove('doc-heading-flash');
    void targetEl.offsetWidth; // fuerza reflow
    targetEl.classList.add('doc-heading-flash');
    setTimeout(() => targetEl.classList.remove('doc-heading-flash'), 900);

    // Desplazamiento suave con ScrollToPlugin compensando el header fijo (84px)
    gsap.to(window, {
      duration: 0.65,
      scrollTo: { y: targetEl, offsetY: 84 },
      ease: 'expo.out',
      overwrite: 'auto',
      onComplete: () => {
        setTimeout(() => {
          this.isClickScrolling = false;
        }, 50);
      },
    });
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

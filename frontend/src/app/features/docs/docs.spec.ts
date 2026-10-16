import { TestBed } from '@angular/core/testing';
import { I18n } from '../../core/i18n/i18n';
import { Highlighter } from '../../shared/highlighter';
import { Docs } from './docs';

describe('Docs', () => {
  const fetchMock = vi.fn();
  const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

  beforeAll(() => {
    // jsdom no implementa CSS.escape; los ids del índice ya son slugs seguros.
    (globalThis as { CSS?: unknown }).CSS ??= { escape: (value: string) => value };
  });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('scrollTo', vi.fn());
    TestBed.configureTestingModule({
      imports: [Docs],
      providers: [{ provide: Highlighter, useValue: { codeToHtml: vi.fn().mockResolvedValue(null) } }],
    });
  });

  afterEach(() => {
    TestBed.inject(I18n).setLocale('es');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function markdown(sections: string[]): string {
    return sections.map((s) => `## ${s}\n\nTexto de ${s} en {{MCP_URL}}.`).join('\n\n');
  }

  async function render(body: string) {
    fetchMock.mockResolvedValue({ text: () => Promise.resolve(body) });
    const fixture = TestBed.createComponent(Docs);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.animate-pulse')).not.toBeNull();
    await flush();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('loads the localized markdown and builds a single index', async () => {
    const { component, el } = await render(markdown(['Qué es', 'Cómo usarlo']));
    expect(fetchMock).toHaveBeenCalledWith('content/docs.es.md');
    expect(el.textContent).toContain(`${location.origin}/api/mcp`);
    expect(component.toc().map((i) => i.id)).toEqual(['que-es', 'como-usarlo']);
    expect(component.tocGroups()).toEqual([expect.objectContaining({ id: 'general', title: 'Contenido' })]);
    // jsdom no tiene layout: la página "entra" entera y el spy marca el último título.
    expect(component.active()).toBe('como-usarlo');
    expect(el.querySelector('#toc-como-usarlo')?.classList.contains('active')).toBe(true);
  });

  it('groups long indexes in three sections and in English', async () => {
    const sections = Array.from({ length: 9 }, (_, i) => `Section ${i + 1}`);
    const { fixture, component } = await render(markdown(sections));
    expect(component.tocGroups().map((g) => g.items.length)).toEqual([3, 5, 1]);
    expect(component.tocGroups()[0].title).toBe('1. Fundamentos');

    TestBed.inject(I18n).setLocale('en');
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    await flush();
    expect(fetchMock).toHaveBeenLastCalledWith('content/docs.en.md');
    expect(component.tocGroups()[2].title).toBe('3. Agents in Action');
  });

  it('uses two groups when there are exactly eight headings', async () => {
    const { component } = await render(markdown(Array.from({ length: 8 }, (_, i) => `S${i}`)));
    expect(component.tocGroups().map((g) => g.id)).toEqual(['fundamentos', 'arquitectura']);
  });

  it('falls back to an error document when fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const fixture = TestBed.createComponent(Docs);
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No se pudo cargar la documentación.');
  });

  it('jumps to a heading with a flash and updates the active item', async () => {
    const { fixture, component, el } = await render(markdown(['Uno', 'Dos', 'Tres']));
    const link = el.querySelector('#toc-tres') as HTMLAnchorElement;
    const event = new MouseEvent('click', { cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(component.active()).toBe('tres');
    expect(el.querySelector('#tres')?.classList.contains('doc-heading-flash')).toBe(true);
    fixture.detectChanges();
    await flush();

    component.jump(new Event('click'), 'no-existe');
    expect(component.active()).toBe('tres');
  });

  it('animates hover only on inactive items', async () => {
    const { component, el } = await render(markdown(['Uno', 'Dos']));
    const inactive = el.querySelector('#toc-uno') as HTMLElement;
    inactive.dispatchEvent(new MouseEvent('mouseenter'));
    inactive.dispatchEvent(new MouseEvent('mouseleave'));
    const active = el.querySelector('#toc-dos') as HTMLElement;
    active.dispatchEvent(new MouseEvent('mouseenter'));
    component.onHover({ currentTarget: null } as unknown as MouseEvent, true);
    expect(component.active()).toBe('dos');
  });

  it('follows the scroll position and handles resize', async () => {
    const { component, el } = await render(markdown(['Uno', 'Dos', 'Tres']));
    const headings = [...el.querySelectorAll('skill-markdown h2')] as HTMLElement[];
    const tops = [-200, -10, 400];
    headings.forEach((h, i) => (h.getBoundingClientRect = () => ({ top: tops[i] }) as DOMRect));
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 5000 });

    window.dispatchEvent(new Event('scroll'));
    expect(component.active()).toBe('dos');

    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 0 });
    window.dispatchEvent(new Event('scroll'));
    expect(component.active()).toBe('tres');
    window.dispatchEvent(new Event('resize'));
    await flush();

    component.active.set('');
    window.dispatchEvent(new Event('resize'));
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 5000 });
    headings.forEach((h) => (h.getBoundingClientRect = () => ({ top: 500 }) as DOMRect));
    window.dispatchEvent(new Event('scroll'));
    expect(component.active()).toBe('uno');
  });

  it('stretches the liquid bar across distant items', async () => {
    const { component, el } = await render(markdown(['Uno', 'Dos', 'Tres']));
    await flush();
    const tops: Record<string, number> = { 'toc-uno': 0, 'toc-dos': 20, 'toc-tres': 200 };
    for (const id of Object.keys(tops)) {
      (el.querySelector(`#${id}`) as HTMLElement).getBoundingClientRect = () => ({ top: tops[id], height: 0 }) as DOMRect;
    }
    component.active.set('dos');
    TestBed.tick();
    await flush();
    component.active.set('tres');
    TestBed.tick();
    await flush();
    expect(component.active()).toBe('tres');
  });

  it('removes listeners on destroy', async () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { fixture } = await render(markdown(['Uno']));
    fixture.destroy();
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});

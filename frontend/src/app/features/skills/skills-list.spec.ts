import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18n } from '../../core/i18n/i18n';
import type { SkillListItem } from '../../core/models';
import { SkillService } from '../../core/skills';
import { SkillsList } from './skills-list';

describe('SkillsList', () => {
  const skills = { list: vi.fn() };

  beforeEach(() => {
    skills.list.mockReset();
    TestBed.configureTestingModule({
      imports: [SkillsList],
      providers: [provideRouter([]), { provide: SkillService, useValue: skills }],
    });
  });

  async function render(section: 'skills' | 'plugins' | 'contracts', rows: SkillListItem[]) {
    skills.list.mockResolvedValue(rows);
    const fixture = TestBed.createComponent(SkillsList);
    fixture.componentRef.setInput('section', section);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('shows section skeletons while loading', () => {
    skills.list.mockReturnValue(new Promise(() => {}));
    for (const [section, selector] of [
      ['skills', '.catalog-skill-skeleton'],
      ['plugins', '.catalog-plugin-skeleton'],
      ['contracts', '.catalog-contract-skeleton'],
    ] as const) {
      const fixture = TestBed.createComponent(SkillsList);
      fixture.componentRef.setInput('section', section);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector(selector)).not.toBeNull();
    }
  });

  it('lists skill-like types, hides deprecated ones and shows metrics', async () => {
    const { component, el } = await render('skills', [
      item({ slug: 'a', title: 'Alpha', ratingCount: 2, ratingAverage: 4.5, personas: 1, usos90d: 1 }),
      item({ slug: 'b', title: 'Beta', status: 'deprecated' }),
      item({ slug: 'c', title: 'Plugin', type: 'plugin' }),
      item({ slug: 'd', title: 'Draft', status: 'draft', personas: 3, usos90d: 5, tags: [] }),
    ]);

    expect(component.visible().map((s) => s.slug)).toEqual(['a', 'd']);
    expect(el.textContent).toContain('4,5');
    expect(el.querySelector('.catalog-skill-row__tags')?.textContent).toContain('java · api');
    expect(component.resultCountLabel()).toContain('2');
    expect(component.hasActiveFilters()).toBe(false);
    expect(component.title()).toBe(component.t().catalogo.skills);
    expect(component.newPath()).toBe('/skills/new');
  });

  it('toggles the quick preview', async () => {
    const { fixture, component, el } = await render('skills', [item({ slug: 'a' })]);

    (el.querySelector('.catalog-quick-trigger') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component.quickPreviewSlug()).toBe('a');
    expect(el.querySelector('#quick-preview-a')).not.toBeNull();

    component.toggleQuickPreview('a');
    expect(component.quickPreviewSlug()).toBeNull();
  });

  it('filters by query, stack, team and status and clears filters', async () => {
    const { fixture, component, el } = await render('skills', [
      item({ slug: 'a', title: 'Alpha', stack: 'angular', ownerTeam: 'Banco' }),
      item({ slug: 'b', title: 'Beta', description: 'busqueda especial' }),
      item({ slug: 'c', title: 'Gamma', whenToUse: 'cuando migrar' }),
      item({ slug: 'd', title: 'Delta', tags: ['Docker'] }),
      item({ slug: 'e', title: 'Old', status: 'deprecated' }),
    ]);

    component.query.set('especial');
    expect(component.visible().map((s) => s.slug)).toEqual(['b']);
    component.query.set('migrar');
    expect(component.visible().map((s) => s.slug)).toEqual(['c']);
    component.query.set('docker');
    expect(component.visible().map((s) => s.slug)).toEqual(['d']);
    component.query.set('nothing-matches');
    fixture.detectChanges();
    expect(el.querySelector('.catalog-empty-state button')).not.toBeNull();

    component.clearFilters();
    component.stack.set('angular');
    expect(component.visible().map((s) => s.slug)).toEqual(['a']);
    component.stack.set('');
    component.team.set('Banco');
    expect(component.visible().map((s) => s.slug)).toEqual(['a']);
    component.team.set('');
    component.status.set('deprecated');
    expect(component.visible().map((s) => s.slug)).toEqual(['e']);
    component.status.set('all');
    expect(component.visible().length).toBe(5);
    expect(component.hasActiveFilters()).toBe(true);
    fixture.detectChanges();

    (el.querySelector('.catalog-toolbar button') as HTMLButtonElement).click();
    expect(component.hasActiveFilters()).toBe(false);
  });

  it('labels the title with the selected stack', async () => {
    const { component } = await render('skills', []);
    const c = component.t().catalogo;
    for (const [stack, label] of [
      ['angular', 'Angular'],
      ['java', 'Java'],
      ['shared', c.compartido],
      ['infra', c.infra],
    ]) {
      component.stack.set(stack);
      expect(component.title()).toBe(`${c.skills} · ${label}`);
    }
  });

  it('sorts by title and rating', async () => {
    const { component } = await render('skills', [
      item({ slug: 'b', title: 'beta', ratingCount: 1, ratingAverage: 3 }),
      item({ slug: 'a', title: 'Alpha', ratingCount: 0, ratingAverage: 0 }),
      item({ slug: 'c', title: 'gamma', ratingCount: 4, ratingAverage: 5 }),
      item({ slug: 'd', title: 'delta', ratingCount: 2, ratingAverage: 3 }),
      item({ slug: 'e', title: '', ratingCount: 2, ratingAverage: 3 }),
    ]);
    const order = () => component.visible().map((s) => s.slug);

    component.sort.set('az');
    expect(order()).toEqual(['e', 'a', 'b', 'd', 'c']);
    component.sort.set('za');
    expect(order()).toEqual(['c', 'd', 'b', 'a', 'e']);
    component.sort.set('rating-desc');
    expect(order()).toEqual(['c', 'e', 'd', 'b', 'a']);
    component.sort.set('rating-asc');
    expect(order()).toEqual(['b', 'e', 'd', 'c', 'a']);
    component.sort.set('bogus' as never);
    expect(order()).toEqual(['b', 'a', 'c', 'd', 'e']);
  });

  it('renders plugins as cards with brand icons', async () => {
    const { component, el } = await render('plugins', [
      item({ slug: 'gh', type: 'plugin', tags: ['github'] }),
      item({ slug: 'other', type: 'plugin', stack: 'shared', status: 'proposed', ownerTeam: null }),
    ]);

    expect(el.querySelectorAll('.catalog-plugin-card').length).toBe(2);
    expect(el.querySelector('.catalog-plugin-card img')?.getAttribute('src')).toBe('/icons/github.svg');
    expect(el.querySelector('.catalog-plugin-card svg')).not.toBeNull();
    expect(component.subtitle()).toBe(component.t().catalogo.subtituloPlugins);
    expect(component.newLabel()).toBe(component.t().catalogo.nuevoPlugin);
    expect(component.catalogLabel()).toBe(component.t().catalogo.etiquetaPlugins);
    expect(component.title()).toBe(component.t().catalogo.plugins);
  });

  it('renders contracts in a table and a mobile list', async () => {
    const { component, el } = await render('contracts', [
      item({ slug: 'k', type: 'contract', ownerTeam: null }),
    ]);

    expect(el.querySelectorAll('.catalog-contract-table tbody tr').length).toBe(1);
    expect(el.querySelectorAll('.catalog-contract-mobile').length).toBe(1);
    expect(component.basePath()).toBe('/contracts');
    expect(component.subtitle()).toBe(component.t().catalogo.subtituloContratos);
    expect(component.newLabel()).toBe(component.t().catalogo.nuevoContrato);
    expect(component.catalogLabel()).toBe(component.t().catalogo.etiquetaContratos);
    expect(component.title()).toBe(component.t().catalogo.contratos);
  });

  it('picks a plugin icon from tags, slug, title or stack', async () => {
    const { component } = await render('plugins', []);
    const icon = (over: Partial<SkillListItem>) =>
      component.pluginIcon(item({ slug: 'x', title: 'x', tags: [], stack: 'shared', ...over }));

    expect(icon({ title: 'GitHub tools' })).toBe('/icons/github.svg');
    expect(icon({ slug: 'git-flow' })).toBe('/icons/git.svg');
    expect(icon({ tags: ['docker'] })).toBe('/icons/docker.svg');
    expect(icon({ slug: 'database-x' })).toBe('/icons/database.svg');
    expect(icon({ slug: 'postgresql' })).toBe('/icons/postgresql.svg');
    expect(icon({ tags: ['mysql'] })).toBe('/icons/mysql.svg');
    expect(icon({ title: 'Taiga' })).toBe('/icons/taiga.svg');
    expect(icon({ tags: ['knowledge-graph'] })).toBe('/icons/memory.svg');
    expect(icon({ tags: ['reasoning'] })).toBe('/icons/thinking.svg');
    expect(icon({ slug: 'fetch' })).toBe('/icons/fetch.svg');
    expect(icon({ tags: ['spring'] })).toBe('/icons/spring.svg');
    expect(icon({ stack: 'angular' })).toBe('/icons/angular.svg');
    expect(icon({ stack: 'java' })).toBe('/icons/java.svg');
    expect(icon({})).toBeNull();
    expect(component.pluginIcon({ ...item({ stack: 'shared' }), tags: undefined as never, slug: '', title: '' })).toBeNull();
  });

  it('formats ratings for the English locale', async () => {
    const { component } = await render('skills', []);
    TestBed.inject(I18n).setLocale('en');

    expect(component.formatRating(4.25)).toBe('4.3');
    expect(component.ratingAria(4, 2)).toBe('4.0 / 5 · 2');
    TestBed.inject(I18n).setLocale('es');
  });

  describe('toolbar controls through the DOM', () => {
    const rows = () => [
      item({ slug: 'b', title: 'beta', stack: 'angular', ratingCount: 1, ratingAverage: 3, ownerTeam: 'Banco' }),
      item({ slug: 'a', title: 'Alpha', stack: 'java', ratingCount: 2, ratingAverage: 5 }),
      item({ slug: 'c', title: 'Charlie', stack: 'java', ratingCount: 0, ratingAverage: 0 }),
      item({ slug: 'd', title: 'Delta', stack: 'java', ratingCount: 3, ratingAverage: 3 }),
    ];

    it('binds the search box, stack and status radios, team and sort selects', async () => {
      const { fixture, component, el } = await render('skills', rows());
      await fixture.whenStable();

      const search = el.querySelector('#catalog-query') as HTMLInputElement;
      search.value = 'alp';
      search.dispatchEvent(new Event('input'));
      expect(component.query()).toBe('alp');

      for (const id of ['stack-angular', 'stack-java', 'stack-shared', 'stack-infra', 'stack-all']) {
        (el.querySelector(`#${id}`) as HTMLInputElement).click();
      }
      expect(component.stack()).toBe('');

      for (const id of ['status-deprecated', 'status-all', 'status-active']) {
        (el.querySelector(`#${id}`) as HTMLInputElement).click();
      }
      expect(component.status()).toBe('active');

      const team = el.querySelector('.catalog-toolbar__team') as HTMLSelectElement;
      team.value = team.options[1].value;
      team.dispatchEvent(new Event('change'));
      expect(component.team()).toBe(team.options[1].value);

      const sort = el.querySelector('.catalog-toolbar__sort') as HTMLSelectElement;
      sort.value = 'az';
      sort.dispatchEvent(new Event('change'));
      expect(component.sort()).toBe('az');
    });

    it('sorts by title in both directions', async () => {
      const { component } = await render('skills', rows());

      component.sort.set('az');
      expect(component.visible().map((row) => row.slug)).toEqual(['a', 'b', 'c', 'd']);

      component.sort.set('za');
      expect(component.visible().map((row) => row.slug)).toEqual(['d', 'c', 'b', 'a']);
    });

    it('sorts by rating, leaving unrated skills last', async () => {
      const { component } = await render('skills', rows());

      component.sort.set('rating-desc');
      expect(component.visible().map((row) => row.slug)).toEqual(['a', 'd', 'b', 'c']);

      component.sort.set('rating-asc');
      expect(component.visible().map((row) => row.slug)).toEqual(['b', 'd', 'a', 'c']);
    });

    it('clears every filter from the empty state', async () => {
      const { fixture, component, el } = await render('skills', rows());
      component.query.set('no existe nada');
      fixture.detectChanges();

      const clear = [...el.querySelectorAll('button')].find((button) => button.textContent?.includes(component.t().catalogo.limpiarFiltros)) as HTMLButtonElement;
      clear.click();

      expect(component.query()).toBe('');
      expect(component.visible().length).toBeGreaterThan(0);
    });
  });

  describe('plugin icons', () => {
    it('picks an icon from tags, slug, title or stack', async () => {
      const { component } = await render('plugins', []);
      const icon = (over: Partial<SkillListItem>) => component.pluginIcon(item({ tags: [], stack: 'shared', slug: 'x', title: 'x', ...over }));

      expect(icon({ tags: ['github'] })).toBe('/icons/github.svg');
      expect(icon({ title: 'Git tools' })).toBe('/icons/git.svg');
      expect(icon({ slug: 'docker-mcp' })).toBe('/icons/docker.svg');
      expect(icon({ tags: ['database'] })).toBe('/icons/database.svg');
      expect(icon({ slug: 'postgresql' })).toBe('/icons/postgresql.svg');
      expect(icon({ tags: ['mysql'] })).toBe('/icons/mysql.svg');
      expect(icon({ title: 'Taiga board' })).toBe('/icons/taiga.svg');
      expect(icon({ tags: ['knowledge-graph'] })).toBe('/icons/memory.svg');
      expect(icon({ tags: ['reasoning'] })).toBe('/icons/thinking.svg');
      expect(icon({ slug: 'fetch' })).toBe('/icons/fetch.svg');
      expect(icon({ tags: ['spring'] })).toBe('/icons/spring.svg');
      expect(icon({ stack: 'angular' })).toBe('/icons/angular.svg');
      expect(icon({ stack: 'java' })).toBe('/icons/java.svg');
      expect(icon({})).toBeNull();
      expect(component.pluginIcon({ ...item(), tags: undefined as unknown as string[], slug: '', title: '', stack: 'shared' })).toBeNull();
    });
  });
});

function item(over: Partial<SkillListItem> = {}): SkillListItem {
  return {
    slug: 'skill',
    title: 'Skill',
    description: 'Descripción',
    whenToUse: 'Siempre',
    stack: 'java',
    type: 'skill',
    status: 'published',
    ownerTeam: 'Profesor',
    updatedAt: '2026-10-01T00:00:00Z',
    version: 1,
    preview: null,
    usos90d: 0,
    personas: 0,
    actividad: [],
    tags: ['java', 'api'],
    creatorName: null,
    creatorId: null,
    ratingAverage: 0,
    ratingCount: 0,
    ...over,
  };
}

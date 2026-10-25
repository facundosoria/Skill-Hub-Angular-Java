import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { DuplicateCandidate, SkillDetail } from '../../core/models';
import { SkillService } from '../../core/skills';
import { SkillForm } from './skill-form';

describe('SkillForm', () => {
  const skills = {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    checkDuplicates: vi.fn(),
    checkLanguage: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    skills.checkDuplicates.mockResolvedValue([]);
    skills.checkLanguage.mockResolvedValue({ idioma: 'es', consistente: true, camposEnMinoria: [] });
    TestBed.configureTestingModule({
      imports: [SkillForm],
      providers: [provideRouter([]), { provide: SkillService, useValue: skills }],
    });
  });

  afterEach(() => vi.useRealTimers());

  async function render(
    inputs: { mode?: 'create' | 'edit'; slug?: string; section?: 'skills' | 'plugins' | 'contracts' } = {},
  ) {
    const fixture = TestBed.createComponent(SkillForm);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    await fixture.whenStable();
    await flush();
    fixture.detectChanges();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, navigate };
  }

  it('creates a skill, deriving the slug from the title', async () => {
    skills.create.mockResolvedValue({ slug: 'mi-regla' });
    const { component, el, navigate } = await render();

    expect(el.querySelector('h1')?.textContent).toContain(component.t().form.nuevoTitulo);
    expect(component.typeLabel()).toBe('Skill');
    component.v.title = 'Mí Regla!';
    component.onTitle();
    expect(component.v.slug).toBe('mi-regla');
    component.tagsCsv = 'java, , api';

    await component.submit();

    expect(skills.create).toHaveBeenCalledWith(expect.objectContaining({ tags: ['java', 'api'] }), null);
    expect(navigate).toHaveBeenCalledWith(['/skills', 'mi-regla']);
    expect(component.busy()).toBe(false);
  });

  it('keeps a manually edited slug', async () => {
    const { component } = await render();
    component.slugTouched = true;
    component.v.slug = 'propio';
    component.v.title = 'Otro título';
    component.onTitle();
    expect(component.v.slug).toBe('propio');
  });

  it('runs debounced duplicate and language checks', async () => {
    vi.useFakeTimers();
    const { fixture, component, el } = await render();
    skills.checkDuplicates.mockResolvedValue([dup({ usos90d: 1, personas: 1, ownerTeam: 'Banco' })]);
    skills.checkLanguage.mockResolvedValue({ idioma: 'es', consistente: false, camposEnMinoria: ['title', 'otro'] });

    component.v.title = 'Ab';
    component.onTitle();
    vi.advanceTimersByTime(350);
    expect(skills.checkDuplicates).not.toHaveBeenCalled();

    component.v.title = 'Regla de logs';
    component.tagsCsv = 'logs';
    component.onTitle();
    vi.advanceTimersByTime(600);
    await flush();
    fixture.detectChanges();

    expect(skills.checkDuplicates).toHaveBeenCalledWith('Regla de logs', ['logs']);
    expect(component.shownDuplicates().length).toBe(1);
    expect(component.blocking()).toBe(false);
    expect(component.shownIdiomaInconsistente()).not.toBeNull();
    expect(component.camposLabel(['otro'])).toBe('otro');
    expect(el.textContent).toContain(component.t().idioma.titulo);
    expect(el.textContent).toContain('Banco');

    (
      [...el.querySelectorAll('button')].find((b) =>
        b.textContent?.includes(component.t().form.duplicadoCrearIgual),
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(component.justify()).toBe(true);
    expect(el.querySelector('textarea[name="dupJust"]')).not.toBeNull();
  });

  it('clears live results when the checks fail', async () => {
    vi.useFakeTimers();
    const { component } = await render();
    skills.checkDuplicates.mockRejectedValue(new Error('x'));
    skills.checkLanguage.mockRejectedValue(new Error('x'));

    component.v.title = 'Regla nueva';
    component.onTitle();
    vi.advanceTimersByTime(600);
    await flush();

    expect(component.shownDuplicates()).toEqual([]);
    expect(component.shownIdioma()).toBeNull();
  });

  it('describes duplicates that were replaced or never used', async () => {
    vi.useFakeTimers();
    const { fixture, component, el } = await render();
    skills.checkDuplicates.mockResolvedValue([
      dup({ slug: 'a', status: 'deprecated', supersededBySlug: 'nuevo' }),
      dup({ slug: 'b', usos90d: 3, personas: 2 }),
      dup({ slug: 'c' }),
    ]);
    component.v.title = 'Regla';
    component.onTitle();
    vi.advanceTimersByTime(350);
    await flush();
    fixture.detectChanges();

    expect(el.textContent).toContain('nuevo');
    expect(el.textContent).toContain(component.t().form.veces);
    expect(el.textContent).toContain(component.t().form.sinConsultas);
  });

  it('loads the current version in edit mode and updates it', async () => {
    skills.get.mockResolvedValue(detail());
    skills.update.mockResolvedValue({});
    const { fixture, component, el, navigate } = await render({ mode: 'edit', slug: 'alpha' });

    expect(component.v.title).toBe('Alpha');
    expect(component.tagsCsv).toBe('java, api');
    expect(component.existingArtifactName()).toBe('pkg.zip');
    expect(el.querySelector('h1')?.textContent).toContain(component.t().form.editarTitulo);
    expect(el.textContent).toContain('pkg.zip');

    component.onTitle();
    expect(skills.checkDuplicates).not.toHaveBeenCalled();

    await component.submit();
    fixture.detectChanges();
    expect(skills.update).toHaveBeenCalledWith('alpha', component.v, null);
    expect(navigate).toHaveBeenCalledWith(['/skills', 'alpha']);
  });

  it('defaults content when the edited skill has no version', async () => {
    skills.get.mockResolvedValue(detail(true));
    const { component } = await render({ mode: 'edit', slug: 'alpha' });

    expect(component.v.content).toBe('## Rule\n\n');
    expect(component.existingArtifactName()).toBeNull();
  });

  it('requires a package for plugins and contracts', async () => {
    const { component, el } = await render({ section: 'plugins' });
    expect(component.v.type).toBe('plugin');
    expect(component.typeLabel()).toBe('Plugin');
    expect(component.createTitle()).toBe(component.t().catalogo.nuevoPlugin);
    expect(component.packageStructure()).toBe(component.t().catalogo.estructuraPlugin);
    expect(component.fileHint()).toBe(component.t().form.archivoObligatorio);
    expect(el.querySelector('select[name="type"]')).toBeNull();

    await component.submit();

    expect(skills.create).not.toHaveBeenCalled();
    expect(component.fileError()).toBe(component.t().form.archivoRequerido);

    const contract = await render({ section: 'contracts' });
    expect(contract.component.typeLabel()).toBe('Contrato');
    expect(contract.component.basePath()).toBe('/contracts');
    expect(contract.component.createTitle()).toBe(contract.component.t().catalogo.nuevoContrato);
    expect(contract.component.packageStructure()).toBe(contract.component.t().catalogo.estructuraContrato);
  });

  it('validates the selected file size', async () => {
    const { fixture, component, el } = await render();
    expect(component.fileHint()).toBe(component.t().form.archivoOpcional);
    const big = { name: 'big.zip', size: 26 * 1024 * 1024 } as File;
    const small = new File(['x'], 'small.zip');

    component.onFileSelected({ target: { files: { item: () => big } } } as unknown as Event);
    expect(component.fileError()).toBe(component.t().form.archivoGrande);
    expect(component.selectedFile()).toBeNull();

    await component.submit();
    expect(skills.create).not.toHaveBeenCalled();

    component.onFileSelected({ target: { files: { item: () => small } } } as unknown as Event);
    fixture.detectChanges();
    expect(component.selectedFile()).toBe(small);
    expect(el.textContent).toContain('small.zip · 1 KB');
    expect(component.formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');

    component.onFileSelected({ target: {} } as unknown as Event);
    expect(component.selectedFile()).toBeNull();
  });

  it('surfaces server-side rejections', async () => {
    const { fixture, component, el } = await render();

    skills.create.mockResolvedValueOnce({
      error: 'IDIOMA_INCONSISTENTE',
      idioma: { idioma: 'en', consistente: false, camposEnMinoria: ['title'] },
    });
    await component.submit();
    expect(component.shownIdiomaInconsistente()?.idioma).toBe('en');

    skills.create.mockResolvedValueOnce({ error: 'IDIOMA_INCONSISTENTE' });
    await component.submit();
    expect(component.shownIdioma()).toBeNull();

    skills.create.mockResolvedValueOnce({ error: 'DUP', duplicates: [dup()] });
    await component.submit();
    expect(component.blocking()).toBe(true);
    expect(component.error()).toBe('DUP');

    skills.create.mockResolvedValueOnce({ duplicates: [dup()] });
    await component.submit();
    expect(component.error()).toBeNull();

    skills.create.mockResolvedValueOnce({ error: 'Slug en uso' });
    await component.submit();
    fixture.detectChanges();
    expect(el.textContent).toContain('Slug en uso');

    skills.create.mockRejectedValueOnce({ error: { error: 'Sin sesión' } });
    await component.submit();
    expect(component.error()).toBe('Sin sesión');

    skills.create.mockRejectedValueOnce(new Error('red'));
    await component.submit();
    expect(component.error()).toBe('No se pudo guardar');
  });

  it('clears pending timers on destroy', async () => {
    vi.useFakeTimers();
    const { fixture, component } = await render();
    component.v.title = 'Regla larga';
    component.onTitle();

    fixture.destroy();
    vi.advanceTimersByTime(1000);

    expect(skills.checkDuplicates).not.toHaveBeenCalled();
    expect(skills.checkLanguage).not.toHaveBeenCalled();
  });
});

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function dup(over: Partial<DuplicateCandidate> = {}): DuplicateCandidate {
  return {
    slug: 'dup',
    title: 'Duplicado',
    description: '',
    stack: 'java',
    status: 'published',
    ownerTeam: null,
    version: 1,
    supersededBySlug: null,
    usos90d: 0,
    personas: 0,
    similarity: 0.9,
    ...over,
  };
}

function detail(noVersion = false): SkillDetail {
  return {
    skill: {
      id: 's1',
      slug: 'alpha',
      title: 'Alpha',
      description: 'Desc',
      whenToUse: 'Siempre',
      stack: 'java',
      type: 'skill',
      status: 'published',
      ownerTeam: null,
      origin: 'human',
      pendingVersionId: null,
      supersededBySlug: null,
      tags: ['java', 'api'],
      version: noVersion
        ? null
        : {
            version: 1,
            content: '## Body',
            preview: null,
            artifact: { fileName: 'pkg.zip', contentType: 'application/zip', sizeBytes: 1, sha256: 'x' },
          },
    },
    history: [],
    related: [],
    ratings: [],
    voteStatus: null,
  };
}

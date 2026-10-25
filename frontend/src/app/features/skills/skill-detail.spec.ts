import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import type { Skill, SkillDetail, User } from '../../core/models';
import { SkillService } from '../../core/skills';
import { Highlighter } from '../../shared/highlighter';
import { SkillDetailPage } from './skill-detail';

describe('SkillDetailPage', () => {
  const currentUser = signal<User | null>(null);
  const auth = {
    user: currentUser.asReadonly(),
    get isAdmin() {
      return currentUser()?.role === 'admin';
    },
  };
  const skills = {
    get: vi.fn(),
    vote: vi.fn((..._args: unknown[]) => Promise.resolve({})),
    applyEdit: vi.fn((..._args: unknown[]) => Promise.resolve({})),
    discardEdit: vi.fn((..._args: unknown[]) => Promise.resolve({})),
    publish: vi.fn((..._args: unknown[]) => Promise.resolve({})),
    deprecate: vi.fn((..._args: unknown[]) => Promise.resolve({})),
    rate: vi.fn((..._args: unknown[]) => Promise.resolve({})),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    currentUser.set(null);
    TestBed.configureTestingModule({
      imports: [SkillDetailPage],
      providers: [
        provideRouter([]),
        { provide: SkillService, useValue: skills },
        { provide: AuthService, useValue: auth },
        { provide: Highlighter, useValue: { codeToHtml: () => Promise.resolve(null) } },
      ],
    });
  });

  async function render(
    detail: SkillDetail | Error,
    opts: { section?: 'skills' | 'plugins' | 'contracts'; v?: string } = {},
  ) {
    if (detail instanceof Error) skills.get.mockRejectedValue(detail);
    else skills.get.mockResolvedValue(detail);
    const fixture = TestBed.createComponent(SkillDetailPage);
    fixture.componentRef.setInput('slug', 'alpha');
    if (opts.section) fixture.componentRef.setInput('section', opts.section);
    if (opts.v) fixture.componentRef.setInput('v', opts.v);
    await settle(fixture);
    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  async function settle(fixture: ComponentFixture<unknown>) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows a loading placeholder and then the error', async () => {
    skills.get.mockReturnValue(new Promise(() => {}));
    const pending = TestBed.createComponent(SkillDetailPage);
    pending.componentRef.setInput('slug', 'alpha');
    pending.detectChanges();
    expect(pending.nativeElement.querySelector('[class*="skeleton-shimmer"]')).not.toBeNull();

    const { el } = await render(new Error('404'));
    expect(el.textContent).toContain('No existe el skill');
  });

  it('renders an anonymous view with artifact, preview, related and history', async () => {
    const { component, el } = await render(
      detail({
        skill: skill({
          version: {
            version: 2,
            content: '# Body',
            preview: '<b>p</b>',
            artifact: { fileName: 'pkg.zip', contentType: 'application/zip', sizeBytes: 2048, sha256: 'x' },
          },
        }),
        related: [{ slug: 'beta', title: 'Beta', stack: 'java' }],
        history: [
          { version: 2, changelog: null, createdAt: '', authorName: null, authorUsername: 'ana' },
          { version: 1, changelog: 'Inicial', createdAt: '', authorName: 'Ana', authorUsername: null },
        ],
      }),
      { v: '2' },
    );

    expect(skills.get).toHaveBeenCalledWith('alpha', 2);
    expect(el.textContent).toContain('pkg.zip');
    expect(el.textContent).toContain('2 KB');
    expect(el.querySelector('skill-preview')).not.toBeNull();
    expect(el.textContent).toContain('Beta');
    expect(el.textContent).toContain('ana');
    expect(el.querySelector('form')).toBeNull();
    expect(component.artifactUrl(2)).toBe('/api/skills/alpha/artifact?v=2');
    expect(component.formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(component.sectionLabel()).toBe(component.t().catalogo.skills);
  });

  it('explains deprecations with and without replacement', async () => {
    const { el } = await render(detail({ skill: skill({ status: 'deprecated', supersededBySlug: 'beta' }) }));
    expect(el.textContent).toContain('beta');

    const second = await render(detail({ skill: skill({ status: 'deprecated', version: null }) }));
    expect(second.el.textContent).toContain(second.component.t().skill.deprecadoSinReemplazo);
  });

  it('lets a member vote a pending edit', async () => {
    currentUser.set(user('member'));
    const { fixture, el } = await render(
      detail({ voteStatus: { pendingVersionId: 'p', votes: 1, required: 3, yaVoto: false, esAutor: false } }),
    );

    const vote = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('1') === false && b.closest('.bg-accent-soft'));
    vote!.click();
    await settle(fixture);

    expect(skills.vote).toHaveBeenCalledWith('alpha');
    expect(skills.get).toHaveBeenCalledTimes(2);
  });

  it('shows author and already-voted states and admin actions', async () => {
    currentUser.set(user('admin'));
    const { fixture, component, el } = await render(
      detail({
        skill: skill({ status: 'draft' }),
        voteStatus: { pendingVersionId: 'p', votes: 1, required: 3, yaVoto: false, esAutor: true },
      }),
    );
    expect(el.textContent).toContain(component.t().votos.propioNoVota);
    expect(el.textContent).toContain(component.t().votos.aplicarAhora);
    expect(el.textContent).toContain(component.t().skill.publicar);

    component.data.set(
      detail({ voteStatus: { pendingVersionId: 'p', votes: 1, required: 3, yaVoto: true, esAutor: false } }),
    );
    fixture.detectChanges();
    expect(el.textContent).toContain(component.t().votos.yaVotaste);
  });

  it('runs admin actions and reports API errors', async () => {
    currentUser.set(user('admin'));
    const { fixture, component, el } = await render(detail({}));

    await component.act(skills.applyEdit('alpha'));
    await component.act(skills.discardEdit('alpha'));
    await component.act(skills.publish('alpha'));
    expect(skills.get).toHaveBeenCalledTimes(4);

    await component.act(Promise.reject({ error: { error: 'Sin permiso' } }));
    fixture.detectChanges();
    expect(component.error()).toBe('Sin permiso');
    expect(el.textContent).toContain('Sin permiso');
  });

  it('deprecates with an optional replacement', async () => {
    currentUser.set(user('admin'));
    const { fixture, component, el } = await render(detail({}));

    const toggle = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(component.t().skill.deprecar),
    )!;
    toggle.click();
    fixture.detectChanges();
    expect(component.deprecating()).toBe(true);

    component.replacement = '  beta ';
    const confirm = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(component.t().skill.confirmar),
    )!;
    confirm.click();
    await settle(fixture);

    expect(skills.deprecate).toHaveBeenCalledWith('alpha', 'beta');
    expect(component.deprecating()).toBe(false);
  });

  it('submits a star rating with a comment', async () => {
    currentUser.set(user('member'));
    const { fixture, component, el } = await render(
      detail({ ratings: [{ rating: 4, comment: 'Bien', updatedAt: 'x', voterName: 'Ana' }] }),
    );
    expect(el.textContent).toContain('★★★★☆');

    await component.submitRating();
    expect(skills.rate).not.toHaveBeenCalled();

    component.ratingComment = 'Muy útil';
    await component.submitRating();
    expect(skills.rate).not.toHaveBeenCalled();

    (el.querySelector('#rating-3') as HTMLInputElement).dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(component.selectedRating()).toBe(3);
    expect(component.ratingDelays()).toEqual([0, 2, 3, 0, 0]);
    expect(el.querySelector('.rating-demo__display')?.textContent).toContain('Aceptable');

    await component.submitRating();
    expect(skills.rate).toHaveBeenCalledWith('alpha', 3, 'Muy útil');
    expect(component.ratingComment).toBe('');
    expect(component.selectedRating()).toBe(0);
  });

  it('submits plain comments on contracts and surfaces failures', async () => {
    currentUser.set(user('member'));
    const { fixture, component, el } = await render(detail({ skill: skill({ type: 'contract' }) }), {
      section: 'contracts',
    });
    expect(component.isContract()).toBe(true);
    expect(component.basePath()).toBe('/contracts');
    expect(component.sectionLabel()).toBe(component.t().catalogo.contratos);
    expect(el.querySelector('.rating-demo')).toBeNull();
    expect(el.textContent).toContain(component.t().skill.sinComentarios);

    component.ratingComment = 'Revisar campos';
    await component.submitRating();
    expect(skills.rate).toHaveBeenCalledWith('alpha', null, 'Revisar campos');

    skills.rate.mockRejectedValueOnce(new Error('caido'));
    component.ratingComment = 'otra';
    await component.submitRating();
    fixture.detectChanges();
    expect(component.error()).toBe('caido');
  });

  it('adapts labels for plugins and English', async () => {
    currentUser.set(user('member'));
    const { component } = await render(detail({ skill: skill({ type: 'plugin' }) }), { section: 'plugins' });

    expect(component.isPlugin()).toBe(true);
    expect(component.basePath()).toBe('/plugins');
    expect(component.sectionLabel()).toBe(component.t().catalogo.plugins);
    expect(component.stars(null)).toBe('');

    TestBed.inject(I18n).setLocale('en');
    expect(component.ratingLabel(5)).toBe('Excellent');
    expect(component.ratingLabel(9)).toBe('');
    TestBed.inject(I18n).setLocale('es');
  });
});

function user(role: User['role']): User {
  return { id: 'u1', username: 'u', name: 'U', team: null, role, mustChangePassword: false };
}

function skill(over: Partial<Skill> = {}): Skill {
  return {
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
    tags: [],
    version: { version: 1, content: 'Hola', preview: null, artifact: null },
    ...over,
  };
}

function detail(over: Partial<SkillDetail> = {}): SkillDetail {
  return { skill: skill(), history: [], related: [], ratings: [], voteStatus: null, ...over };
}

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { Api } from '../../core/api';
import type { Proposal, RevisionProposal } from '../../core/models';
import { Review } from './review';

describe('Review', () => {
  const api = { get: vi.fn(), post: vi.fn() };

  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset().mockReturnValue(of({}));
    TestBed.configureTestingModule({
      imports: [Review],
      providers: [provideRouter([]), { provide: Api, useValue: api }],
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  const flush = () => new Promise((resolve) => setTimeout(resolve));

  async function render(proposals: Proposal[] = [], revisions?: RevisionProposal[]) {
    api.get.mockReturnValue(of({ proposals, revisions }));
    const fixture = TestBed.createComponent(Review);
    await flush();
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('shows the empty state when nothing is pending', async () => {
    const { el, component } = await render();
    expect(api.get).toHaveBeenCalledWith('/review');
    expect(el.querySelector('ui-empty-state')).not.toBeNull();
    expect(component.revisions()).toEqual([]);
  });

  it('shows the load error', async () => {
    api.get.mockReturnValue(throwError(() => ({ message: 'offline' })));
    const fixture = TestBed.createComponent(Review);
    await flush();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('offline');
  });

  it('renders proposals and revisions', async () => {
    const { el, component } = await render(
      [
        proposal({ slug: 'a', title: 'Alpha', usos: 3, proposedFromQuery: 'como testear', changelog: 'Ajustes' }),
        proposal({ slug: 'b', title: 'Beta' }),
      ],
      [
        revision({ slug: 'r', title: 'Rev', usos: 2, proposedSlug: 'r2', proposedTitle: 'Rev 2', changelog: 'Mejora' }),
        revision({ slug: 's', title: 'Same', proposedSlug: 's', proposedTitle: 'Same' }),
      ],
    );

    expect(el.textContent).toContain('Alpha');
    expect(el.textContent).toContain('3×');
    expect(el.textContent).toContain('"como testear"');
    expect(el.textContent).toContain('Ajustes');
    expect(el.textContent).toContain('«Rev» → «Rev 2»');
    expect(el.textContent).toContain('Mejora');
    expect(el.textContent).toContain(component.t().review.verDiff);
  });

  it('approves a proposal and reloads', async () => {
    const { component } = await render([proposal({ slug: 'a' })]);
    await component.approve('a');
    expect(api.post).toHaveBeenCalledWith('/review/a/approve');
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('shows approval errors', async () => {
    const { component } = await render([proposal({ slug: 'a' })]);
    api.post.mockReturnValue(throwError(() => ({ error: { error: 'No autorizado' } })));
    await component.approve('a');
    expect(component.error()).toBe('No autorizado');
  });

  it('rejects proposals and revisions with a reason', async () => {
    const { component } = await render([proposal({ slug: 'a' })]);
    const prompt = vi.fn(() => '  no sirve  ');
    vi.stubGlobal('prompt', prompt);

    await component.reject('a');
    await component.rejectRevision('r');

    expect(api.post).toHaveBeenCalledWith('/review/a/reject', { motivo: 'no sirve' });
    expect(api.post).toHaveBeenCalledWith('/review/r/reject', { motivo: 'no sirve' });
  });

  it('ignores short or cancelled reasons', async () => {
    const { component } = await render([proposal({ slug: 'a' })]);
    vi.stubGlobal('prompt', vi.fn(() => 'no'));
    await component.reject('a');
    vi.stubGlobal('prompt', vi.fn(() => null));
    await component.rejectRevision('a');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows reject errors', async () => {
    const { component } = await render([proposal({ slug: 'a' })]);
    vi.stubGlobal('prompt', vi.fn(() => 'motivo largo'));
    api.post.mockReturnValue(throwError(() => ({ error: { error: 'Falló' } })));

    await component.reject('a');
    expect(component.error()).toBe('Falló');
    component.error.set(null);
    await component.rejectRevision('a');
    expect(component.error()).toBe('Falló');
  });
});

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    slug: 'p',
    title: 'Propuesta',
    description: 'Descripción',
    whenToUse: 'Siempre',
    stack: 'java',
    ownerTeam: null,
    proposedFromQuery: null,
    createdAt: '2026-01-01',
    changelog: null,
    content: '# P',
    usos: 0,
    personas: 0,
    ...overrides,
  };
}

function revision(overrides: Partial<RevisionProposal> = {}): RevisionProposal {
  return {
    slug: 'r',
    title: 'Revisión',
    stack: 'java',
    ownerTeam: null,
    currentVersion: 1,
    currentContent: '# A',
    proposedVersion: 2,
    proposedContent: '# B',
    proposedSlug: null,
    proposedTitle: null,
    changelog: null,
    createdAt: '2026-01-01',
    authorName: null,
    usos: 0,
    ...overrides,
  };
}

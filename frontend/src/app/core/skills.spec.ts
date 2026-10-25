import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Api } from './api';
import type { SkillFormValues } from './models';
import { SkillService } from './skills';

describe('SkillService', () => {
  const api = {
    get: vi.fn(),
    post: vi.fn((..._args: unknown[]) => of({ ok: true })),
    postForm: vi.fn((..._args: unknown[]) => of({ slug: 'a' })),
    putForm: vi.fn((..._args: unknown[]) => of({ slug: 'a' })),
  };
  let skills: SkillService;

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({ providers: [{ provide: Api, useValue: api }] });
    skills = TestBed.inject(SkillService);
  });

  it('lists skills with filters', async () => {
    api.get.mockReturnValue(of({ skills: [{ slug: 'a' }] }));

    expect(await skills.list({ stack: 'java' })).toEqual([{ slug: 'a' }]);
    expect(api.get).toHaveBeenCalledWith('/skills', { stack: 'java' });
  });

  it('gets a skill, a version and a diff', async () => {
    api.get.mockReturnValue(of({ slug: 'a' }));

    await skills.get('a');
    await skills.get('a', 3);
    await skills.diff('a', 1, 2);

    expect(api.get).toHaveBeenNthCalledWith(1, '/skills/a', { v: undefined });
    expect(api.get).toHaveBeenNthCalledWith(2, '/skills/a', { v: 3 });
    expect(api.get).toHaveBeenNthCalledWith(3, '/skills/a/diff', { a: 1, b: 2 });
  });

  it('creates and updates with a multipart package', async () => {
    const values = { title: 'T' } as unknown as SkillFormValues;
    const file = new File(['zip'], 'pkg.zip');

    await skills.create(values, file);
    await skills.update('a', values, null);

    const [createPath, created] = api.postForm.mock.calls[0] as [string, FormData];
    expect(createPath).toBe('/skills');
    expect(created.get('metadata')).toBeInstanceOf(Blob);
    expect((created.get('file') as File).name).toBe('pkg.zip');
    const [updatePath, updated] = api.putForm.mock.calls[0] as [string, FormData];
    expect(updatePath).toBe('/skills/a');
    expect(updated.has('file')).toBe(false);
  });

  it('posts lifecycle actions', async () => {
    await skills.publish('a');
    await skills.deprecate('a', 'b');
    await skills.vote('a');
    await skills.rate('a', 4, 'good');
    await skills.applyEdit('a');
    await skills.discardEdit('a');
    await skills.checkLanguage({ title: 't', description: 'd', whenToUse: 'w', content: 'c' });

    expect(api.post.mock.calls).toEqual([
      ['/skills/a/publish'],
      ['/skills/a/deprecate', { supersededBy: 'b' }],
      ['/skills/a/vote'],
      ['/skills/a/ratings', { rating: 4, comment: 'good' }],
      ['/skills/a/apply-edit'],
      ['/skills/a/discard-edit'],
      ['/skills/check-language', { title: 't', description: 'd', whenToUse: 'w', content: 'c' }],
    ]);
  });

  it('checks duplicates joining tags', async () => {
    api.get.mockReturnValue(of([]));

    expect(await skills.checkDuplicates('Title', ['a', 'b'])).toEqual([]);
    expect(api.get).toHaveBeenCalledWith('/skills/duplicates', { title: 'Title', tags: 'a,b' });
  });
});

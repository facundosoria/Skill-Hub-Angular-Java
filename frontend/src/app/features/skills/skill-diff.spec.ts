import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SkillService } from '../../core/skills';
import { SkillDiff } from './skill-diff';

describe('SkillDiff', () => {
  const skills = { diff: vi.fn() };

  beforeEach(() => {
    skills.diff.mockReset();
    TestBed.configureTestingModule({
      imports: [SkillDiff],
      providers: [provideRouter([]), { provide: SkillService, useValue: skills }],
    });
  });

  async function render(a?: string, b?: string, section?: 'plugins' | 'contracts') {
    const fixture = TestBed.createComponent(SkillDiff);
    fixture.componentRef.setInput('slug', 'alpha');
    if (a) fixture.componentRef.setInput('a', a);
    if (b) fixture.componentRef.setInput('b', b);
    if (section) fixture.componentRef.setInput('section', section);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('renders added, removed and unchanged lines', async () => {
    skills.diff.mockResolvedValue({
      from: { version: 1, content: 'a\nb\n\nc\n' },
      to: { version: 2, content: 'a\nB\n\nc\nd\n' },
    });

    const { component, el } = await render('1', '2');

    expect(skills.diff).toHaveBeenCalledWith('alpha', 1, 2);
    expect(el.querySelector('h1')?.textContent).toContain('v1 → v2');
    expect(component.added()).toBe(2);
    expect(component.removed()).toBe(1);
    expect(el.querySelectorAll('.bg-success-soft').length).toBe(2);
    expect(el.querySelectorAll('.bg-danger-soft').length).toBe(1);
    expect(component.basePath()).toBe('/skills');
  });

  it('rejects invalid versions without calling the API', async () => {
    const { el } = await render('x', '2');

    expect(skills.diff).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Versiones inválidas');
  });

  it('reports a missing comparison', async () => {
    skills.diff.mockRejectedValue(new Error('404'));

    const { component, el } = await render('1', '9', 'plugins');

    expect(el.textContent).toContain('No existe esa comparación');
    expect(component.basePath()).toBe('/plugins');
  });

  it('shows a placeholder while loading', () => {
    skills.diff.mockReturnValue(new Promise(() => {}));
    const fixture = TestBed.createComponent(SkillDiff);
    fixture.componentRef.setInput('slug', 'alpha');
    fixture.componentRef.setInput('a', '1');
    fixture.componentRef.setInput('b', '2');
    fixture.componentRef.setInput('section', 'contracts');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[class*="skeleton-shimmer"]')).not.toBeNull();
    expect(fixture.componentInstance.basePath()).toBe('/contracts');
  });
});

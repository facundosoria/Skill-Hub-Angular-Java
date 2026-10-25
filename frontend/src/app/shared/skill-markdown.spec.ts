import { TestBed } from '@angular/core/testing';
import { Highlighter } from './highlighter';
import { SkillMarkdown } from './skill-markdown';

describe('SkillMarkdown', () => {
  const highlighter = { codeToHtml: vi.fn() };

  beforeEach(() => {
    highlighter.codeToHtml.mockReset();
    TestBed.configureTestingModule({
      imports: [SkillMarkdown],
      providers: [{ provide: Highlighter, useValue: highlighter }],
    });
  });

  async function render(content: string) {
    const fixture = TestBed.createComponent(SkillMarkdown);
    fixture.componentRef.setInput('content', content);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    return fixture.nativeElement as HTMLElement;
  }

  it('renders sanitized markdown without the preview block', async () => {
    highlighter.codeToHtml.mockResolvedValue(null);

    const el = await render('# Hola\n\n<img src=x onerror="alert(1)">\n\n```preview\n<b>demo</b>\n```');

    expect(el.querySelector('h1')?.textContent).toBe('Hola');
    expect(el.querySelector('img')?.getAttribute('onerror')).toBeNull();
    expect(el.textContent).not.toContain('demo');
  });

  it('replaces fenced code with the highlighted version', async () => {
    highlighter.codeToHtml.mockResolvedValue('<pre class="shiki"><code>x</code></pre>');

    const el = await render('```java\nint x;\n```');

    expect(highlighter.codeToHtml).toHaveBeenCalledWith('int x;\n', 'java');
    expect(el.querySelector('pre.shiki')).not.toBeNull();
  });

  it('keeps the plain block when highlighting fails', async () => {
    highlighter.codeToHtml.mockResolvedValue(null);

    const el = await render('```ts\nlet a;\n```');

    expect(el.querySelector('pre > code[data-hl]')).not.toBeNull();
  });

  it('keeps the plain block when Shiki returns no element', async () => {
    highlighter.codeToHtml.mockResolvedValue('   ');

    const el = await render('```ts\nlet a;\n```');

    expect(el.querySelector('pre > code[data-hl]')).not.toBeNull();
  });
});

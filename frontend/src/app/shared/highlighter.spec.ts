import { TestBed } from '@angular/core/testing';
import { Highlighter } from './highlighter';

describe('Highlighter', () => {
  it('highlights known languages with both themes', async () => {
    const hl = TestBed.inject(Highlighter);

    const html = await hl.codeToHtml('const a = 1;', 'typescript');

    expect(html).toContain('<pre class="shiki');
    expect(html).toContain('--shiki-dark');
  }, 30_000);

  it('falls back to plain text for unknown languages and reuses the instance', async () => {
    const hl = TestBed.inject(Highlighter);

    const first = await hl.codeToHtml('hola', 'klingon');
    const second = await hl.codeToHtml('chau', 'text');

    expect(first).toContain('hola');
    expect(second).toContain('chau');
  }, 30_000);

  it('returns null when Shiki cannot load', async () => {
    const hl = TestBed.inject(Highlighter);
    (hl as unknown as { hl: Promise<never> }).hl = Promise.reject(new Error('offline'));

    expect(await hl.codeToHtml('x', 'java')).toBeNull();
  });
});

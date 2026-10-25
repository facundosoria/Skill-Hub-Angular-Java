import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { Api } from '../../core/api';
import type { ApiKey } from '../../core/models';
import { CopyRow, Keys } from './keys';

describe('Keys', () => {
  const api = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
  const router = { navigate: vi.fn() };
  const writeText = vi.fn();
  const flush = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    api.get.mockReset().mockReturnValue(of({ keys: [] }));
    api.post.mockReset();
    api.delete.mockReset().mockReturnValue(of({}));
    router.navigate.mockReset().mockResolvedValue(true);
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    TestBed.configureTestingModule({
      imports: [Keys],
      providers: [
        { provide: Api, useValue: api },
        { provide: Router, useValue: router },
      ],
    });
  });

  afterEach(() => vi.useRealTimers());

  async function render(keys: ApiKey[] = [], tab?: string) {
    api.get.mockReturnValue(of({ keys }));
    const fixture = TestBed.createComponent(Keys);
    if (tab) fixture.componentRef.setInput('tab', tab);
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('shows the empty state and the setup snippets', async () => {
    const { component, el } = await render();
    expect(api.get).toHaveBeenCalledWith('/keys');
    expect(component.activeTab()).toBe('keys');
    expect(el.querySelector('ui-empty-state')).not.toBeNull();
    expect(component.claudeSnippet).toContain('/api/mcp');
    expect(JSON.parse(component.cursorSnippet).mcpServers.skillhub.url).toContain('/api/mcp');
    expect(el.querySelectorAll('app-copy-row').length).toBe(2);
  });

  it('renders the tutorial tab with its heading', async () => {
    const { fixture, component, el } = await render([], 'tutorial');
    expect(component.activeTab()).toBe('tutorial');
    expect(el.querySelector('app-mcp-tutorial')).not.toBeNull();
    const tutorial = component.tutorialComponent()!;
    expect(el.querySelector('#mcp-tutorial-title')?.textContent).toContain(tutorial.text().titleCli);
    tutorial.selectSurface('prompt');
    fixture.detectChanges();
    expect(el.querySelector('#mcp-tutorial-title')?.textContent).toContain(tutorial.text().titlePrompt);
  });

  it('navigates between tabs through the query string', async () => {
    const { el, component } = await render();
    const buttons = [...el.querySelectorAll('nav button')] as HTMLButtonElement[];
    buttons[1].click();
    expect(router.navigate).toHaveBeenCalledWith([], { queryParams: { tab: 'tutorial' }, queryParamsHandling: 'merge' });
    buttons[0].click();
    expect(router.navigate).toHaveBeenCalledWith([], { queryParams: { tab: null }, queryParamsHandling: 'merge' });
    component.selectTab('keys');
    expect(router.navigate).toHaveBeenCalledTimes(3);
  });

  it('sorts keys by use, state and dates and opens the full list', async () => {
    const { fixture, component, el } = await render([
      key({ id: 'revoked', revokedAt: '2026-01-05 10:00:00', lastUsedAt: '2026-01-06 10:00:00' }),
      key({ id: 'unused-old', createdAt: '2026-01-01 10:00:00' }),
      key({ id: 'unused-new', createdAt: '2026-01-03 10:00:00' }),
      key({ id: 'used-old', lastUsedAt: '2026-01-02 10:00:00' }),
      key({ id: 'used-new', lastUsedAt: '2026-01-04 10:00:00' }),
      key({ id: 'used-same', lastUsedAt: '2026-01-04 10:00:00', createdAt: '2025-12-01 10:00:00' }),
      key({ id: 'revoked-2', revokedAt: '2026-01-05 10:00:00' }),
    ]);

    expect(component.sortedKeys().map((k) => k.id)).toEqual([
      'used-new',
      'used-same',
      'used-old',
      'unused-new',
      'unused-old',
      'revoked',
      'revoked-2',
    ]);
    expect(component.visibleKeys().length).toBe(4);

    component.modalOpen.set(true);
    fixture.detectChanges();
    const dialog = el.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain(component.t().keys.revocada);
    (dialog.firstElementChild as HTMLElement).click();
    expect(component.modalOpen()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(component.modalOpen()).toBe(false);
    component.onEscape();
    component.modalOpen.set(true);
    fixture.detectChanges();
    (el.querySelector('[role="dialog"]') as HTMLElement).click();
    expect(component.modalOpen()).toBe(false);
  });

  it('opens the full list from the header and revokes keys from both lists', async () => {
    const { fixture, component, el } = await render([key({ id: 'k1', name: 'notebook' })]);
    const openAll = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(component.t().keys.verTodas));
    openAll?.click();
    component.modalOpen.set(true);
    fixture.detectChanges();

    const revokeButtons = [...el.querySelectorAll(`button[aria-label="${component.t().keys.revocar}"]`)] as HTMLButtonElement[];
    expect(revokeButtons.length).toBe(2);
    revokeButtons.forEach((b) => b.click());
    await flush();
    expect(api.delete).toHaveBeenCalledWith('/keys/k1');
    expect(api.delete).toHaveBeenCalledTimes(2);
  });

  it('formats dates and keeps invalid input as is', async () => {
    const { component } = await render();
    expect(component.fecha('2026-03-04 10:00:00')).toBe('04/03/26');
    expect(component.fecha('ayer')).toBe('ayer');
  });

  it('generates a key, copies it and dismisses the banner', async () => {
    api.post.mockReturnValue(of({ created: 'sk_new' }));
    const { fixture, component, el } = await render();
    const input = el.querySelector('input') as HTMLInputElement;
    input.value = 'laptop';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await vi.waitFor(() => expect(component.created()).toBe('sk_new'));

    expect(api.post).toHaveBeenCalledWith('/keys', { name: 'laptop' });
    expect(writeText).toHaveBeenCalledWith('sk_new');
    expect(component.name).toBe('');
    fixture.detectChanges();
    expect(el.textContent).toContain('sk_new');

    const dismiss = el.querySelector('app-copy-row')!.parentElement!.querySelector('button') as HTMLButtonElement;
    dismiss.click();
    fixture.detectChanges();
    expect(component.created()).toBeNull();
  });

  it('shows generation errors', async () => {
    api.post.mockReturnValue(throwError(() => ({ error: { error: 'Nombre requerido' } })));
    const { fixture, component, el } = await render();
    await component.generate();
    fixture.detectChanges();
    expect(el.textContent).toContain('Nombre requerido');
    expect(component.busy()).toBe(false);
  });
});

describe('CopyRow', () => {
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  });

  function render(value: string, multiline?: boolean) {
    const fixture = TestBed.createComponent(CopyRow);
    fixture.componentRef.setInput('value', value);
    if (multiline !== undefined) fixture.componentRef.setInput('multiline', multiline);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('copies single and multi-line values and resets the confirmation', async () => {
    vi.useFakeTimers();
    const multi = render('a\nb');
    expect(multi.component.isMultiline()).toBe(true);
    (multi.el.querySelector('button') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(multi.component.copied()).toBe(true));
    multi.fixture.detectChanges();
    expect(multi.el.querySelector('button')?.getAttribute('aria-label')).toBe(multi.component.t().keys.copiado);
    vi.advanceTimersByTime(1600);
    expect(multi.component.copied()).toBe(false);

    const single = render('abc', false);
    expect(single.component.isMultiline()).toBe(false);
    await single.component.copy();
    single.fixture.detectChanges();
    expect(writeText).toHaveBeenCalledWith('abc');
    expect(single.el.textContent).toContain('abc');
  });

  it('falls back to execCommand when the clipboard API fails or is missing', async () => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    writeText.mockRejectedValue(new Error('denied'));
    const { component } = render('valor');
    await component.copy();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(component.copied()).toBe(true);

    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    execCommand.mockImplementation(() => {
      throw new Error('blocked');
    });
    const other = render('otro');
    await other.component.copy();
    expect(other.component.copied()).toBe(false);
  });
});

function key(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'k',
    name: 'key',
    prefix: 'sk_abc',
    lastUsedAt: null,
    revokedAt: null,
    createdAt: '2026-01-01 00:00:00',
    ...overrides,
  };
}

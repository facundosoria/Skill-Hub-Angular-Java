import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Api } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { McpTutorial } from './mcp-tutorial';

describe('McpTutorial', () => {
  const api = { post: vi.fn() };
  const writeText = vi.fn();

  beforeEach(() => {
    api.post.mockReset();
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    TestBed.configureTestingModule({
      imports: [McpTutorial],
      providers: [{ provide: Api, useValue: api }],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.inject(I18n).setLocale('es');
  });

  function render() {
    const fixture = TestBed.createComponent(McpTutorial);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  const buttonByText = (el: HTMLElement, text: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

  it('walks every step of every provider, surface and OS in both locales', () => {
    const { fixture, component, el } = render();
    for (const locale of ['es', 'en'] as const) {
      TestBed.inject(I18n).setLocale(locale);
      for (const provider of component.providers()) {
        component.selectProvider(provider.id);
        for (const surface of provider.surfaces) {
          component.selectSurface(surface.id);
          for (const os of ['unix', 'windows'] as const) {
            component.terminalOs.set(os);
            for (let i = 0; i < component.surface().steps.length; i++) {
              component.goToStep(i);
              fixture.detectChanges();
              expect(el.textContent).toContain(component.step().title);
            }
          }
        }
      }
    }
    expect(component.configSourcePath()).toContain('\\');
    expect(component.claudeMcpCommand()).toContain('"Authorization');
    component.terminalOs.set('unix');
    expect(component.claudeMcpCommand()).toContain("'Authorization");
  });

  it('forces the prompt surface for the generic provider', () => {
    const { component } = render();
    component.selectProvider('generic');
    expect(component.selectedSurface()).toBe('prompt');
    expect(component.getProviderIconPath('generic')).toBeNull();
    expect(component.getProviderIconPath('claude')).toContain('claude');
    expect(component.getProviderIconPath('antigravity')).toContain('antigravity');
    expect(component.getProviderIconPath('codex')).toContain('codex');
    expect(component.getProviderIconPath('opencode')).toContain('opencode');
  });

  it('navigates with previous and next within bounds', () => {
    const { fixture, component, el } = render();
    const last = component.surface().steps.length - 1;
    component.previous();
    expect(component.currentStep()).toBe(0);
    for (let i = 0; i <= last + 1; i++) buttonByText(el, component.text().next).click();
    expect(component.currentStep()).toBe(last);
    expect(component.progressPercent()).toBe(100);
    fixture.detectChanges();
    buttonByText(el, component.text().previous).click();
    expect(component.currentStep()).toBe(last - 1);
  });

  it('uses the mode, provider and OS controls', () => {
    const { fixture, component, el } = render();
    buttonByText(el, component.text().modePrompt).click();
    expect(component.selectedSurface()).toBe('prompt');
    buttonByText(el, component.text().modeCli).click();
    expect(component.selectedSurface()).toBe('cli');
    buttonByText(el, 'Codex').click();
    expect(component.selectedProvider()).toBe('codex');
    fixture.detectChanges();
    buttonByText(el, component.text().windows).click();
    expect(component.terminalOs()).toBe('windows');
    buttonByText(el, component.text().macLinux).click();
    expect(component.terminalOs()).toBe('unix');
  });

  it('opens the steps navigator and jumps to a step', () => {
    const { fixture, component, el } = render();
    component.goToStep(2);
    buttonByText(el, component.text().viewSteps).click();
    fixture.detectChanges();
    const dialog = el.querySelector(`[aria-labelledby="${component.stepsNavigatorTitleId}"]`) as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('✓');

    (dialog.firstElementChild as HTMLElement).click();
    expect(component.stepsNavigatorOpen()).toBe(true);

    const options = [...dialog.querySelectorAll('button')].filter((b) => b.textContent?.includes(component.surface().steps[1].title));
    options[0].click();
    expect(component.currentStep()).toBe(1);
    expect(component.stepsNavigatorOpen()).toBe(false);

    component.openStepsNavigator();
    fixture.detectChanges();
    const overlay = el.querySelector(`[aria-labelledby="${component.stepsNavigatorTitleId}"]`) as HTMLElement;
    overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(component.stepsNavigatorOpen()).toBe(false);
    component.openStepsNavigator();
    fixture.detectChanges();
    (el.querySelector(`[aria-labelledby="${component.stepsNavigatorTitleId}"]`) as HTMLElement).click();
    expect(component.stepsNavigatorOpen()).toBe(false);
  });

  it('copies code, prompts and the test prompt', async () => {
    vi.useFakeTimers();
    const { fixture, component, el } = render();

    component.goToStep(component.surface().steps.findIndex((s) => !s.code));
    await component.copy();
    await component.copyPrompt();
    expect(writeText).not.toHaveBeenCalled();

    const cli = component.surface().steps.findIndex((s) => s.code && !s.noCopy);
    component.goToStep(cli);
    fixture.detectChanges();
    buttonByText(el, component.text().copy).click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(component.step().code));
    expect(component.copied()).toBe(true);
    vi.advanceTimersByTime(1600);
    expect(component.copied()).toBe(false);

    component.selectSurface('prompt');
    const promptStep = component.surface().steps.findIndex((s) => s.prompt);
    component.goToStep(promptStep);
    fixture.detectChanges();
    buttonByText(el, component.text().copyPrompt).click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(component.securePrompt()));

    component.goToStep(component.surface().steps.length - 1);
    fixture.detectChanges();
    (el.querySelector('code + button.absolute') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(component.text().testPrompt));
  });

  it('ignores clipboard failures', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    const { component } = render();
    await component.copyValue('x');
    expect(component.copied()).toBe(false);
  });

  it('generates a key from the modal and keeps it active', async () => {
    api.post.mockReturnValue(of({ created: 'sk_live_123' }));
    const { fixture, component, el } = render();
    const keyStep = component.surface().steps.findIndex((s) => s.keyAction);
    component.goToStep(keyStep);
    fixture.detectChanges();

    buttonByText(el, component.text().createKeyBtn).click();
    fixture.detectChanges();
    expect(component.keyModalOpen()).toBe(true);

    const modal = el.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement;
    (modal.firstElementChild as HTMLElement).click();
    expect(component.keyModalOpen()).toBe(true);

    component.keyName.set('   ');
    buttonByText(el, component.text().generateAndApply).click();
    await vi.waitFor(() => expect(component.generatedKey()).toBe('sk_live_123'));
    expect(api.post).toHaveBeenCalledWith('/keys', { name: 'mi-notebook' });
    expect(writeText).toHaveBeenCalledWith('sk_live_123');
    fixture.detectChanges();
    expect(el.textContent).toContain('sk_live_123');
    expect(el.textContent).toContain(component.text().keyGeneratedSuccess);

    const modalButtons = [...el.querySelectorAll('[role="dialog"] button')] as HTMLButtonElement[];
    modalButtons.forEach((b) => b.textContent?.includes(component.text().copy) && b.click());
    buttonByText(el, component.text().continueTutorial).click();
    fixture.detectChanges();
    expect(component.keyModalOpen()).toBe(false);
    expect(el.textContent).toContain(component.text().keyActiveLabel);
    expect(el.textContent).toContain(component.text().createAnotherKeyBtn);
  });

  it('shows key generation errors and closes the modal', async () => {
    api.post.mockReturnValue(throwError(() => ({ error: { error: 'Límite de keys' } })));
    const { fixture, component, el } = render();
    component.openKeyModal();
    fixture.detectChanges();
    const input = el.querySelector('[role="dialog"] input') as HTMLInputElement;
    input.value = 'laptop';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await vi.waitFor(() => expect(component.keyError()).toBe('Límite de keys'));
    expect(api.post).toHaveBeenCalledWith('/keys', { name: 'laptop' });
    fixture.detectChanges();
    expect(el.textContent).toContain('Límite de keys');

    buttonByText(el, component.text().cancel).click();
    expect(component.keyModalOpen()).toBe(false);
    component.openKeyModal();
    fixture.detectChanges();
    (el.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement).click();
    expect(component.keyModalOpen()).toBe(false);
  });
});

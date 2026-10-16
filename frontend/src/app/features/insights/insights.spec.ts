import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER, of } from 'rxjs';
import { Api } from '../../core/api';
import { Insights } from './insights';

describe('Insights', () => {
  const api = { get: vi.fn() };

  beforeEach(() => {
    api.get.mockReset();
    TestBed.configureTestingModule({
      imports: [Insights],
      providers: [provideRouter([]), { provide: Api, useValue: api }],
    });
  });

  async function render(data: { top: unknown[]; teams: unknown[]; missed: unknown[] }) {
    api.get.mockReturnValue(of(data));
    const fixture = TestBed.createComponent(Insights);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('shows the skeleton while loading', () => {
    api.get.mockReturnValue(NEVER);
    const fixture = TestBed.createComponent(Insights);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows empty states without telemetry', async () => {
    const { el, component } = await render({ top: [], teams: [], missed: [] });
    expect(api.get).toHaveBeenCalledWith('/insights');
    expect(component.loading()).toBe(false);
    expect(component.maxHits()).toBe(1);
    expect(el.querySelectorAll('ui-empty-state').length).toBe(2);
  });

  it('ranks top skills and opens the missed-search modal', async () => {
    const missed = Array.from({ length: 7 }, (_, i) => ({ query_text: `q${i}`, veces: i + 1 }));
    const { fixture, component, el } = await render({
      top: [
        { slug: 'a', title: 'Alpha', hits: 4, personas: 1 },
        { slug: 'b', title: 'Beta', hits: 1, personas: 2 },
      ],
      teams: [{ team: 'Banco', hits: 5, skills: 2 }],
      missed,
    });

    expect(component.maxHits()).toBe(4);
    expect(component.topMissed().length).toBe(5);
    expect(component.teams().length).toBe(1);
    expect(el.textContent).toContain('Alpha');
    expect(el.textContent).toContain(`4 ${component.t().insights.consultas} · 1 ${component.t().insights.persona}`);
    expect(el.textContent).toContain(`1 ${component.t().insights.consulta} · 2 ${component.t().insights.personas}`);

    (el.querySelector('button[uiButton]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const dialog = el.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('"q6"');

    (dialog.firstElementChild as HTMLElement).click();
    fixture.detectChanges();
    expect(component.modalMissedOpen()).toBe(true);

    dialog.click();
    expect(component.modalMissedOpen()).toBe(false);

    component.onEscape();
    component.modalMissedOpen.set(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(component.modalMissedOpen()).toBe(false);
  });

  it('labels a single missed search in the modal footer', async () => {
    const { fixture, component, el } = await render({
      top: [],
      teams: [],
      missed: [{ query_text: 'solo', veces: 1 }],
    });
    (el.querySelector('button[type="button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[role="dialog"]')?.textContent).toContain(`1 ${component.t().insights.consulta}`);
  });
});

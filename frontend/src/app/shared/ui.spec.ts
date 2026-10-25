import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UI } from './ui';

@Component({
  imports: [UI],
  template: `
    <button uiButton id="default">Default</button>
    <button uiButton id="danger" variant="danger" size="sm">Danger</button>
    <span uiBadge id="badge" [tone]="$any(tone())">Badge</span>
    <ui-status-badge id="published" status="published" />
    <ui-status-badge id="unknown" status="archived" />
    <div uiCard id="card"></div>
    <div uiCard id="lift" interactive></div>
    <ui-empty-state id="empty" title="Nada" [hint]="hint()" />
    <ui-field id="field" label="Nombre" [hint]="'Ayuda'" [error]="error()"><input uiInput /></ui-field>
    <textarea uiTextarea></textarea>
    <select uiSelect><option>a</option></select>
  `,
})
class Host {
  tone = signal<string>('accent');
  hint = signal<string | undefined>('Probá otro filtro');
  error = signal<string | null>(null);
}

describe('UI primitives', () => {
  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, q: (s: string) => el.querySelector(s) as HTMLElement };
  }

  it('applies button variants and sizes', () => {
    const { q } = render();
    expect(q('#default').className).toContain('bg-accent');
    expect(q('#default').className).toContain('h-10');
    expect(q('#danger').className).toContain('bg-danger-soft');
    expect(q('#danger').className).toContain('h-9');
  });

  it('falls back to the neutral badge tone', () => {
    const { fixture, q } = render();
    expect(q('#badge').className).toContain('bg-accent-soft');
    fixture.componentInstance.tone.set('missing');
    fixture.detectChanges();
    expect(q('#badge').className).toContain('bg-surface-2');
  });

  it('maps known statuses and echoes unknown ones', () => {
    const { q } = render();
    expect(q('#published').textContent?.trim()).toBe('publicado');
    expect(q('#published span').className).toContain('bg-success-soft');
    expect(q('#unknown').textContent?.trim()).toBe('archived');
    expect(q('#unknown span').className).toContain('bg-surface-2');
  });

  it('lifts interactive cards only', () => {
    const { q } = render();
    expect(q('#card').className).not.toContain('card-lift');
    expect(q('#lift').className).toContain('card-lift');
  });

  it('shows the empty-state hint when present', () => {
    const { fixture, q } = render();
    expect(q('#empty').textContent).toContain('Probá otro filtro');
    fixture.componentInstance.hint.set(undefined);
    fixture.detectChanges();
    expect(q('#empty').querySelectorAll('p').length).toBe(1);
  });

  it('prefers the field error over the hint', () => {
    const { fixture, q } = render();
    expect(q('#field').textContent).toContain('Ayuda');
    fixture.componentInstance.error.set('Requerido');
    fixture.detectChanges();
    expect(q('#field').textContent).toContain('Requerido');
    expect(q('#field').textContent).not.toContain('Ayuda');
  });

  it('styles inputs, textareas and selects', () => {
    const { q } = render();
    expect(q('input').className).toContain('h-10');
    expect(q('textarea').className).toContain('py-2.5');
    expect(q('select').className).toContain('cursor-pointer');
  });
});

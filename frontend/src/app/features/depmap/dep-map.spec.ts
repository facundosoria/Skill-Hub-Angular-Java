import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { throwError } from 'rxjs';
import { Api } from '../../core/api';
import { AuthService } from '../../core/auth';
import { DepMap, estimateMapScale, shouldFitMap } from './dep-map';

describe('DepMap fit-height estimation', () => {
  const baseMeasurements = {
    cardWidth: 1400,
    horizontalPadding: 16,
    viewportHeight: 777,
    cardTop: 246.6,
    scrollY: 0,
    verticalPadding: 16,
    shellPaddingBottom: 42.5,
    legendHeight: 51.5,
  };

  it('subtracts the shell bottom padding from available height', () => {
    expect(estimateMapScale(baseMeasurements)).toBeCloseTo(0.564, 2);
  });

  it('uses document coordinates, keeping the estimate stable across scroll', () => {
    const scrolled = { ...baseMeasurements, cardTop: baseMeasurements.cardTop - 300, scrollY: 300 };
    expect(estimateMapScale(scrolled)).toBeCloseTo(estimateMapScale(baseMeasurements), 10);
  });

  it('uses the last known legend height when the graph is not rendered', () => {
    expect(estimateMapScale({ ...baseMeasurements, legendHeight: 51.5 }))
      .toBeCloseTo(estimateMapScale({ ...baseMeasurements, legendHeight: 0 }) - 51.5 / 745, 10);
  });

  it('applies the entry and exit hysteresis thresholds', () => {
    expect(shouldFitMap(0.60, false)).toBe(true);
    expect(shouldFitMap(0.59, false)).toBe(false);
    expect(shouldFitMap(0.59, true)).toBe(true);
    expect(shouldFitMap(0.57, true)).toBe(false);
  });
});

describe('DepMap offline controls', () => {
  let fixture: ComponentFixture<DepMap>;
  let api: { get: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.useFakeTimers();
    localStorage.clear();
    localStorage.setItem('depmap-cache-v2', JSON.stringify({
      nodes: { usr: { n: 'Usuarios', s: 'usr', x: 0, y: 0 }, ops: { n: 'Operaciones', s: 'ops', x: 1, y: 1 } },
      kinds: { bloqueante: 'Bloqueante' },
      info: {},
      edges: [{ id: 'edge-1', from: 'usr', to: 'ops', kind: 'bloqueante', state: 'pendiente', text: 'Prueba' }],
      done: {}, activity: [], presence: [], version: 1, updatedAt: null, updatedBy: null,
    }));
    api = { get: vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 }))) };
    await TestBed.configureTestingModule({
      imports: [DepMap],
      providers: [
        { provide: Api, useValue: api },
        { provide: AuthService, useValue: { user: signal({ role: 'admin' }) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DepMap);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('disables every mutation control while keeping copy/data access available', () => {
    const root = fixture.nativeElement as HTMLElement;
    const buttons = [...root.querySelectorAll('button')];
    const matching = (text: string) => buttons.filter((button) => button.textContent?.includes(text));

    expect(matching('Agregar').every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(matching('Aplicar').every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(matching('Restaurar').every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect([...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((input) => input.disabled)).toBe(true);
    expect([...root.querySelectorAll<HTMLButtonElement>('button[aria-label="Eliminar dependencia"]')].every((button) => button.disabled)).toBe(true);
    expect(matching('Datos').every((button) => !button.disabled)).toBe(true);
    expect(matching('Copiar').every((button) => !button.disabled)).toBe(true);
  });

  it('clears the pair with Escape while preserving its node selection', () => {
    fixture.componentInstance.store.selectNode('usr');
    fixture.componentInstance.store.selectPair(['usr', 'ops']);
    fixture.nativeElement.querySelector('.dep-map')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(fixture.componentInstance.store.node()).toBe('usr');
    expect(fixture.componentInstance.store.pair()).toBeNull();
  });

  it('returns a non-default node selection to My group with Escape', () => {
    fixture.componentInstance.store.selectNode('ops');
    fixture.nativeElement.querySelector('.dep-map')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(fixture.componentInstance.store.node()).toBe(fixture.componentInstance.store.mine());
    expect(fixture.componentInstance.store.pair()).toBeNull();
  });

  it('moves and activates tabs with arrow keys using roving tabindex', () => {
    const tabs = [...fixture.nativeElement.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
    expect(tabs[0].getAttribute('tabindex')).toBe('0');
    expect(tabs[1].getAttribute('tabindex')).toBe('-1');

    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.store.view()).toBe('matriz');
    expect((fixture.nativeElement.querySelector('[role="tab"][aria-selected="true"]') as HTMLButtonElement | null)?.id).toBe('depmap-tab-matriz');
    const panels = [...(fixture.nativeElement as HTMLElement).querySelectorAll('[role="tabpanel"]')] as HTMLElement[];
    expect(panels).toHaveLength(3);
    expect(panels.map((panel) => panel.id)).toEqual(['depmap-panel-mapa', 'depmap-panel-matriz', 'depmap-panel-lista']);
    expect(panels.map((panel) => panel.getAttribute('aria-labelledby'))).toEqual(['depmap-tab-mapa', 'depmap-tab-matriz', 'depmap-tab-lista']);
    expect(panels.find((panel) => panel.id === 'depmap-panel-mapa')?.hidden).toBe(true);
    expect(panels.find((panel) => panel.id === 'depmap-panel-matriz')?.hidden).toBe(false);
  });

  it('renders the store error in an alert with a retry action', () => {
    fixture.componentInstance.store.error.set('network failure');
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector('[role="alert"]') as HTMLElement | null;
    expect(alert?.textContent).toContain('network failure');
    expect(alert?.querySelector('button')?.textContent).toContain('Reintentar');
  });
});

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { throwError } from 'rxjs';
import { Api } from '../../core/api';
import { AuthService } from '../../core/auth';
import { DepMap } from './dep-map';

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
});

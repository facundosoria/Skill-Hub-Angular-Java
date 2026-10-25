import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { NEVER, of, throwError } from 'rxjs';
import { Api } from '../../core/api';
import { AuthService } from '../../core/auth';
import type { User } from '../../core/models';
import type { RoomSummary } from './room-models';
import { Rooms } from './rooms';

describe('Rooms', () => {
  const user = signal<User | null>(null);
  const api = { get: vi.fn(), post: vi.fn() };
  const flush = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    user.set({ id: 'u', username: 'ana', name: 'Ana', team: 'Banco', role: 'member', mustChangePassword: false } as User);
    api.get.mockReset().mockReturnValue(of([]));
    api.post.mockReset();
    TestBed.configureTestingModule({
      imports: [Rooms],
      providers: [
        provideRouter([]),
        { provide: Api, useValue: api },
        { provide: AuthService, useValue: { user: user.asReadonly() } },
      ],
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(Rooms);
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('shows the loading message', () => {
    api.get.mockReturnValue(NEVER);
    const fixture = TestBed.createComponent(Rooms);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(fixture.componentInstance.t().salas.cargando);
  });

  it('shows the empty state and the load error', async () => {
    const empty = await render();
    expect(api.get).toHaveBeenCalledWith('/rooms');
    expect(empty.el.querySelector('ui-empty-state')).not.toBeNull();

    api.get.mockReturnValue(throwError(() => ({})));
    const failed = await render();
    expect(failed.el.querySelector('[role="alert"]')?.textContent).toContain(failed.component.t().salas.errorCarga);
  });

  it('lists rooms with status, teams and message count', async () => {
    api.get.mockReturnValue(
      of([
        room({ id: 'r1', title: 'Pagos', status: 'agreed', topic: 'Contrato de pagos', teams: ['Banco', 'Mercado'], lastSeq: 7 }),
        room({ id: 'r2', title: 'Notas', status: 'closed', topic: '' }),
      ]),
    );
    const { component, el } = await render();
    expect(el.textContent).toContain('Pagos');
    expect(el.textContent).toContain('Contrato de pagos');
    expect(el.textContent).toContain(`7 ${component.t().salas.mensajes}`);
    expect(el.textContent).toContain(component.t().salas.estado.agreed);
    expect(el.querySelector('a[href="/salas/r1"]')).not.toBeNull();
    expect(component.tone('agreed')).toBe('success');
    expect(component.tone('open')).toBe('accent');
    expect(component.tone('closed')).toBe('neutral');
  });

  it('asks for a team before creating rooms', async () => {
    user.set({ id: 'u', username: 'ana', name: 'Ana', team: null, role: 'member', mustChangePassword: false } as User);
    const { component, el } = await render();
    expect(el.textContent).toContain(component.t().salas.sinEquipo);
    expect(el.textContent).not.toContain(component.t().salas.nueva);
  });

  it('creates a room with invited teams and opens it', async () => {
    api.post.mockReturnValue(of({ id: 'nueva' }));
    const { fixture, component, el } = await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const t = component.t().salas;
    expect(component.otherTeams()).not.toContain('Banco');

    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(t.nueva))!.click();
    fixture.detectChanges();
    const checkboxes = el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    checkboxes[0].click();
    checkboxes[1].click();
    checkboxes[1].click();
    component.title.set('  Contrato  ');
    component.topic.set(' tema ');
    await component.create();

    expect(api.post).toHaveBeenCalledWith('/rooms', { title: 'Contrato', topic: 'tema', teams: [component.otherTeams()[0]] });
    expect(navigate).toHaveBeenCalledWith(['/salas', 'nueva']);
    expect(component.pending()).toBe(false);

    fixture.detectChanges();
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(t.cancelar))!.click();
    expect(component.creating()).toBe(false);
  });

  it('shows creation errors', async () => {
    api.post.mockReturnValue(throwError(() => ({ error: { error: 'Título repetido' } })));
    const { fixture, component, el } = await render();
    await component.create();
    fixture.detectChanges();
    expect(el.textContent).toContain('Título repetido');
  });
});

function room(overrides: Partial<RoomSummary> = {}): RoomSummary {
  return {
    id: 'r',
    title: 'Sala',
    topic: 'Tema',
    createdByTeam: 'Banco',
    status: 'open',
    lastSeq: 0,
    teams: ['Banco'],
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-02T10:00:00Z',
    ...overrides,
  };
}

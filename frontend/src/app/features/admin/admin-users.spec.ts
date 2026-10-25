import { ElementRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Api } from '../../core/api';
import { AuthService } from '../../core/auth';
import type { AdminUser, User } from '../../core/models';
import { AdminUsers } from './admin-users';

describe('AdminUsers component', () => {
  const admin = signal<User>({
    id: 'admin-1',
    username: 'admin',
    name: 'Admin',
    team: null,
    role: 'admin',
    mustChangePassword: false,
  });
  const api = {
    get: vi.fn(() => of({ pending: [], active: [], inactive: [] })),
    post: vi.fn(() => of({ ok: true })),
    patch: vi.fn(() => of({ ok: true })),
  };

  beforeEach(async () => {
    api.get.mockClear();
    api.post.mockClear();
    api.patch.mockClear();
    await TestBed.configureTestingModule({
      imports: [AdminUsers],
      providers: [
        { provide: Api, useValue: api },
        { provide: AuthService, useValue: { user: admin.asReadonly() } },
      ],
    }).compileComponents();
  });

  it('sends the temporary password to the reset endpoint', async () => {
    const component = TestBed.createComponent(AdminUsers).componentInstance;
    component.resetTarget.set(targetUser());
    component.temporaryPassword = 'Temporary-Password-1';
    component.temporaryPasswordConfirmation = 'Temporary-Password-1';

    await component.submitReset();

    expect(api.post).toHaveBeenCalledWith('/admin/users/user-1/reset-password', {
      password: 'Temporary-Password-1',
    });
    expect(component.actionSuccess()).toBeTruthy();
  });

  it('does not call the API when confirmation differs', async () => {
    const component = TestBed.createComponent(AdminUsers).componentInstance;
    component.resetTarget.set(targetUser());
    component.temporaryPassword = 'Temporary-Password-1';
    component.temporaryPasswordConfirmation = 'Temporary-Password-2';

    await component.submitReset();

    expect(api.post).not.toHaveBeenCalled();
    expect(component.resetFieldError()).toBeTruthy();
  });

  it('updates team with PATCH /admin/users/:id/team', async () => {
    const component = TestBed.createComponent(AdminUsers).componentInstance;
    component.teamTarget.set(targetUser());
    component.selectedTeam = 'Profesor';

    await component.submitTeam();

    expect(api.patch).toHaveBeenCalledWith('/admin/users/user-1/team', {
      team: 'Profesor',
    });
    expect(component.actionSuccess()).toBeTruthy();
  });

  it('deactivates user with POST /admin/users/:id/deactivate', async () => {
    const component = TestBed.createComponent(AdminUsers).componentInstance;
    component.deactivateTarget.set(targetUser());

    await component.confirmDeactivate();

    expect(api.post).toHaveBeenCalledWith('/admin/users/user-1/deactivate');
    expect(component.actionSuccess()).toBeTruthy();
  });

  it('reactivates user with POST /admin/users/:id/reactivate', async () => {
    const component = TestBed.createComponent(AdminUsers).componentInstance;
    const inactiveUser = { ...targetUser(), status: 'inactive' as const };

    await component.reactivate(inactiveUser);

    expect(api.post).toHaveBeenCalledWith('/admin/users/user-1/reactivate');
    expect(component.actionSuccess()).toBeTruthy();
  });

  it('filters registered users by active, inactive and all', () => {
    const component = TestBed.createComponent(AdminUsers).componentInstance;
    const activeU = targetUser();
    const inactiveU = { ...targetUser(), id: 'user-2', username: 'inactivo', status: 'inactive' as const };

    component.active.set([activeU]);
    component.inactive.set([inactiveU]);

    component.statusFilter.set('active');
    expect(component.filteredUsers()).toEqual([activeU]);

    component.statusFilter.set('inactive');
    expect(component.filteredUsers()).toEqual([inactiveU]);

    component.statusFilter.set('all');
    expect(component.filteredUsers()).toEqual([activeU, inactiveU]);
  });
});

describe('AdminUsers screen', () => {
  const admin = signal<User>({ id: 'admin-1', username: 'admin', name: 'Admin', team: null, role: 'admin', mustChangePassword: false });
  const api = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
  const flush = () => new Promise((resolve) => setTimeout(resolve));

  beforeAll(() => {
    // jsdom no implementa showModal/close de <dialog>.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  });

  beforeEach(() => {
    api.get.mockReset().mockReturnValue(
      of({
        pending: [{ ...targetUser(), id: 'p1', username: 'nuevo', team: 'Banco', status: 'pending' }],
        active: [
          { ...targetUser(), team: 'Banco', mustChangePassword: true },
          { ...targetUser(), id: 'admin-1', username: 'admin', role: 'admin' },
        ],
        inactive: undefined,
      }),
    );
    api.post.mockReset().mockReturnValue(of({}));
    api.patch.mockReset().mockReturnValue(of({}));
    TestBed.configureTestingModule({
      imports: [AdminUsers],
      providers: [
        { provide: Api, useValue: api },
        { provide: AuthService, useValue: { user: admin.asReadonly() } },
      ],
    });
  });

  // `#ref` sobre input[uiInput]/select[uiSelect] resuelve al componente y no a un ElementRef;
  // se inyecta el ElementRef que el código espera para poder abrir los diálogos.
  function focusRef(component: object, field: string, tag = 'input'): HTMLElement {
    const element = document.createElement(tag);
    document.body.appendChild(element);
    (component as Record<string, unknown>)[field] = new ElementRef(element);
    return element;
  }

  async function render() {
    const fixture = TestBed.createComponent(AdminUsers);
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    focusRef(component, 'temporaryPasswordInput');
    focusRef(component, 'teamSelect', 'select');
    return { fixture, component, el: fixture.nativeElement as HTMLElement };
  }

  const byText = (root: Element, text: string) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

  it('lists pending and registered users and approves or rejects requests', async () => {
    const { component, el } = await render();
    const t = component.t().usuarios;
    expect(component.inactive()).toEqual([]);
    expect(el.textContent).toContain('nuevo');
    expect(el.textContent).toContain(t.rolAdmin);

    byText(el, t.aprobar).click();
    byText(el, t.rechazar).click();
    await flush();
    expect(api.post).toHaveBeenCalledWith('/admin/users/p1/approve');
    expect(api.post).toHaveBeenCalledWith('/admin/users/p1/reject');
  });

  it('shows empty states and switches the status filter', async () => {
    api.get.mockReturnValue(of({ pending: [], active: [], inactive: [{ ...targetUser(), status: 'inactive' }] }));
    const { fixture, component, el } = await render();
    expect(el.querySelectorAll('ui-empty-state').length).toBe(2);

    const t = component.t().usuarios;
    const filter = (label: string) =>
      [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
    filter(t.filtroInactivas).click();
    fixture.detectChanges();
    expect(component.statusFilter()).toBe('inactive');
    expect(el.textContent).toContain(t.reactivar);
    filter(t.filtroTodas).click();
    expect(component.statusFilter()).toBe('all');
    filter(t.filtroActivas).click();
    expect(component.statusFilter()).toBe('active');
  });

  it('resets a password through the dialog and restores focus', async () => {
    const { fixture, component, el } = await render();
    const t = component.t().usuarios;
    const trigger = el.querySelector(`button[aria-label*="member"], button`) as HTMLButtonElement;
    component.openReset(component.active()[0], { currentTarget: trigger } as unknown as Event);
    await flush();
    fixture.detectChanges();
    const dialog = el.querySelector('dialog[aria-labelledby="reset-password-title"]') as HTMLDialogElement;
    expect(dialog.open).toBe(true);

    component.temporaryPassword = 'corta';
    await component.submitReset();
    fixture.detectChanges();
    expect(dialog.textContent).toContain(t.passwordHint);

    component.temporaryPassword = 'Temporal-12345';
    component.temporaryPasswordConfirmation = 'Otra-12345678';
    await component.submitReset();
    expect(component.resetFieldError()).toBe(t.passwordsNoCoinciden);

    api.post.mockReturnValueOnce(throwError(() => ({ error: { error: 'Política' } })));
    component.temporaryPasswordConfirmation = 'Temporal-12345';
    await component.submitReset();
    fixture.detectChanges();
    expect(dialog.textContent).toContain('Política');

    await component.submitReset();
    fixture.detectChanges();
    expect(dialog.open).toBe(false);
    expect(component.resetTarget()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(el.textContent).toContain(t.restablecerOk);

    await component.submitReset();
    component.openReset(component.active()[0], { currentTarget: trigger } as unknown as Event);
    fixture.detectChanges();
    byText(dialog, t.restablecerCancelar)?.click();
    component.closeReset();
    expect(dialog.open).toBe(false);
  });

  it('changes the team and reports errors', async () => {
    const { fixture, component, el } = await render();
    const t = component.t().usuarios;
    const trigger = document.createElement('button');
    component.openChangeTeam(component.active()[1], { currentTarget: trigger } as unknown as Event);
    await flush();
    fixture.detectChanges();
    expect(component.selectedTeam).toBe(component.teamOptions[0]);
    const dialog = el.querySelector('dialog[aria-labelledby="team-dialog-title"]') as HTMLDialogElement;
    expect(dialog.open).toBe(true);

    api.patch.mockReturnValueOnce(throwError(() => ({})));
    await component.submitTeam();
    fixture.detectChanges();
    expect(dialog.textContent).toContain(t.equipoError);

    await component.submitTeam();
    expect(dialog.open).toBe(false);
    expect(component.actionSuccess()).toBe(t.equipoOk);
    await component.submitTeam();
    expect(api.patch).toHaveBeenCalledTimes(2);

    component.openChangeTeam(component.active()[0], { currentTarget: trigger } as unknown as Event);
    expect(component.selectedTeam).toBe('Banco');
    component.closeChangeTeam();
    expect(component.teamTarget()).toBeNull();
  });

  it('deactivates and reactivates users with error handling', async () => {
    const { fixture, component, el } = await render();
    const t = component.t().usuarios;
    component.openDeactivate(component.active()[0], { currentTarget: null } as unknown as Event);
    fixture.detectChanges();
    const dialog = el.querySelector('dialog[aria-labelledby="deactivate-dialog-title"]') as HTMLDialogElement;
    expect(dialog.open).toBe(true);

    api.post.mockReturnValueOnce(throwError(() => ({ error: { error: 'No se puede' } })));
    await component.confirmDeactivate();
    fixture.detectChanges();
    expect(dialog.textContent).toContain('No se puede');

    component.closeDeactivate();
    expect(component.deactivateTarget()).toBeNull();
    await component.confirmDeactivate();

    api.post.mockReturnValueOnce(throwError(() => ({})));
    await component.reactivate({ ...targetUser(), status: 'inactive' });
    fixture.detectChanges();
    expect(component.actionError()).toBe(t.reactivarError);
    expect(el.textContent).toContain(t.reactivarError);
  });

  it('opens each dialog from the row actions', async () => {
    const { fixture, component, el } = await render();
    const rowButtons = [...el.querySelectorAll('li button, [uiCard] button')] as HTMLButtonElement[];
    rowButtons.forEach((button) => button.click());
    await flush();
    fixture.detectChanges();
    expect(api.post).toHaveBeenCalled();
    expect(component.deactivateTarget() ?? component.teamTarget() ?? component.resetTarget()).not.toBeNull();
  });
});

function targetUser(): AdminUser {
  return {
    id: 'user-1',
    username: 'member',
    name: 'Member',
    team: null,
    legajo: null,
    createdAt: '2026-09-13T00:00:00Z',
    role: 'member',
    status: 'active',
    mustChangePassword: false,
  };
}

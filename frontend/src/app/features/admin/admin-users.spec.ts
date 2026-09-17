import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
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

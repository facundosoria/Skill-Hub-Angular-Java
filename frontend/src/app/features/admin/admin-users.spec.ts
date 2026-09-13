import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Api } from '../../core/api';
import { AuthService } from '../../core/auth';
import type { AdminUser, User } from '../../core/models';
import { AdminUsers } from './admin-users';

describe('AdminUsers password reset', () => {
  const admin = signal<User>({
    id: 'admin-1',
    username: 'admin',
    name: 'Admin',
    team: null,
    role: 'admin',
    mustChangePassword: false,
  });
  const api = {
    get: vi.fn(() => of({ pending: [], active: [] })),
    post: vi.fn(() => of({ ok: true })),
  };

  beforeEach(async () => {
    api.get.mockClear();
    api.post.mockClear();
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
    expect(component.resetSuccess()).toBeTruthy();
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

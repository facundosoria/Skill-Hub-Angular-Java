import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from '../../core/auth';
import type { User } from '../../core/models';
import { ChangePassword } from './change-password';

describe('ChangePassword', () => {
  const currentUser = signal<User | null>({
    id: 'user-1',
    username: 'member',
    name: 'Member',
    team: null,
    role: 'member',
    mustChangePassword: true,
  });
  const auth = {
    user: currentUser.asReadonly(),
    changeRequiredPassword: vi.fn(),
    logout: vi.fn(),
  };

  beforeEach(async () => {
    auth.changeRequiredPassword.mockReset();
    auth.logout.mockReset();
    await TestBed.configureTestingModule({
      imports: [ChangePassword],
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    }).compileComponents();
  });

  it('requires ten characters and matching confirmation', async () => {
    const component = TestBed.createComponent(ChangePassword).componentInstance;
    component.newPassword = 'short';
    component.confirmPassword = 'short';

    await component.submit();
    expect(component.fieldError()).toBeTruthy();
    expect(auth.changeRequiredPassword).not.toHaveBeenCalled();

    component.newPassword = 'new-password-1';
    component.confirmPassword = 'different-1';
    await component.submit();
    expect(component.fieldError()).toBeTruthy();
    expect(auth.changeRequiredPassword).not.toHaveBeenCalled();
  });

  it('changes the password and leaves the forced screen', async () => {
    auth.changeRequiredPassword.mockResolvedValue({ ...currentUser()!, mustChangePassword: false });
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const component = TestBed.createComponent(ChangePassword).componentInstance;
    component.newPassword = 'new-password-1';
    component.confirmPassword = 'new-password-1';

    await component.submit();

    expect(auth.changeRequiredPassword).toHaveBeenCalledWith('new-password-1');
    expect(router.navigate).toHaveBeenCalledWith(['/']);
    expect(component.busy()).toBe(false);
  });
});

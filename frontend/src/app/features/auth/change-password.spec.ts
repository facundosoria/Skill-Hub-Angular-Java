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

  it('shows the field error with the matching message and focuses the new password', async () => {
    const fixture = TestBed.createComponent(ChangePassword);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const input = fixture.nativeElement.querySelector('input[name="newPassword"]') as HTMLInputElement;
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    component.newPassword = 'new-password-1';
    component.confirmPassword = 'other-password-1';
    await component.submit();
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector('#new-password-error') as HTMLElement;
    expect(component.fieldError()).toBe(component.t().cambioPassword.noCoinciden);
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent?.trim()).toBe(component.t().cambioPassword.noCoinciden);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(input);
    outside.remove();
  });

  it('uses the minimum length message for short passwords', async () => {
    const component = TestBed.createComponent(ChangePassword).componentInstance;
    component.newPassword = '123456789';
    component.confirmPassword = '123456789';

    await component.submit();

    expect(component.fieldError()).toBe(component.t().cambioPassword.minimo);
  });

  it('accepts a password of exactly ten characters', async () => {
    auth.changeRequiredPassword.mockResolvedValue({ ...currentUser()!, mustChangePassword: false });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const component = TestBed.createComponent(ChangePassword).componentInstance;
    component.newPassword = '1234567890';
    component.confirmPassword = '1234567890';

    await component.submit();

    expect(component.fieldError()).toBeNull();
    expect(auth.changeRequiredPassword).toHaveBeenCalledWith('1234567890');
  });

  it('shows the server message when the change is rejected', async () => {
    auth.changeRequiredPassword.mockRejectedValue({ error: { error: 'Igual a la temporal' } });
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ChangePassword);
    const component = fixture.componentInstance;
    component.newPassword = 'new-password-1';
    component.confirmPassword = 'new-password-1';

    await component.submit();
    fixture.detectChanges();

    expect(component.serverError()).toBe('Igual a la temporal');
    expect(component.busy()).toBe(false);
    expect(router.navigate).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent.trim()).toBe('Igual a la temporal');
  });

  it('falls back to the generic message when the error has no text', async () => {
    auth.changeRequiredPassword.mockRejectedValue({});
    const component = TestBed.createComponent(ChangePassword).componentInstance;
    component.newPassword = 'new-password-1';
    component.confirmPassword = 'new-password-1';

    await component.submit();

    expect(component.serverError()).toBe(component.t().cambioPassword.errorGenerico);
  });

  it('clears a previous server error on the next submit', async () => {
    auth.changeRequiredPassword.mockRejectedValueOnce(new Error('caido'));
    const component = TestBed.createComponent(ChangePassword).componentInstance;
    component.newPassword = 'new-password-1';
    component.confirmPassword = 'new-password-1';
    await component.submit();
    expect(component.serverError()).toBe('caido');

    component.confirmPassword = 'otra';
    await component.submit();

    expect(component.serverError()).toBeNull();
    expect(component.fieldError()).toBe(component.t().cambioPassword.noCoinciden);
  });

  it('disables both buttons and shows the saving label while busy', async () => {
    let resolveChange!: () => void;
    auth.changeRequiredPassword.mockReturnValue(new Promise<void>((resolve) => { resolveChange = resolve; }));
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ChangePassword);
    const component = fixture.componentInstance;
    component.newPassword = 'new-password-1';
    component.confirmPassword = 'new-password-1';

    const pending = component.submit();
    fixture.detectChanges();
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];

    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(buttons[0].textContent?.trim()).toBe(component.t().cambioPassword.guardando);

    resolveChange();
    await pending;
    fixture.detectChanges();
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[0].textContent?.trim()).toBe(component.t().cambioPassword.cambiar);
  });

  it('shows the username of the signed-in user', () => {
    const fixture = TestBed.createComponent(ChangePassword);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('member');
  });

  it('logs out and goes to the login screen', async () => {
    auth.logout.mockResolvedValue(undefined);
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const component = TestBed.createComponent(ChangePassword).componentInstance;

    await component.logout();

    expect(auth.logout).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
    expect(component.busy()).toBe(false);
  });

  it('logs out from the ghost button', async () => {
    auth.logout.mockResolvedValue(undefined);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ChangePassword);
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;

    buttons[1].click();
    await fixture.whenStable();

    expect(auth.logout).toHaveBeenCalled();
  });

  it('keeps the user on the screen and shows the error when logout fails', async () => {
    auth.logout.mockRejectedValue({ error: { error: 'Sin conexion' } });
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const component = TestBed.createComponent(ChangePassword).componentInstance;

    await component.logout();

    expect(router.navigate).not.toHaveBeenCalled();
    expect(component.serverError()).toBe('Sin conexion');
    expect(component.busy()).toBe(false);
  });
});

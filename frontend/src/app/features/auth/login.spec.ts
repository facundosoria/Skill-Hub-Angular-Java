import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import type { User } from '../../core/models';
import { apiError, Login } from './login';

describe('Login', () => {
  const auth = { login: vi.fn(), register: vi.fn() };
  const router = { navigate: vi.fn() };
  let reducedMotion = true;

  beforeEach(() => {
    reducedMotion = true;
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: reducedMotion,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }));
    auth.login.mockReset();
    auth.register.mockReset();
    router.navigate.mockReset().mockResolvedValue(true);
    TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: router },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function render() {
    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('maps API errors to readable messages', () => {
    expect(apiError({ error: { error: 'Credenciales' } })).toBe('Credenciales');
    expect(apiError({ message: 'offline' })).toBe('offline');
    expect(apiError(null, 'fallback')).toBe('fallback');
    expect(apiError(undefined)).toBe('Algo salio mal');
  });

  it('switches between login and register modes', () => {
    const { fixture, component, el } = render();
    const t = component.t().login;

    component.setMode('login');
    expect(component.mode()).toBe('login');

    component.toggle();
    fixture.detectChanges();
    expect(component.mode()).toBe('register');
    expect(component.displayTitle()).toBe(t.crearCuenta);
    expect(component.displaySubmit()).toBe(t.crearCuenta);
    expect(el.querySelectorAll('ui-field').length).toBeGreaterThan(2);

    component.toggle();
    fixture.detectChanges();
    expect(component.mode()).toBe('login');
    expect(component.displayTitle()).toBe(t.entrar);
  });

  it('animates the mode change when motion is allowed', () => {
    reducedMotion = false;
    const { component } = render();
    component.setMode('register');
    expect(component.mode()).toBe('register');
    component.setMode('login');
    expect(component.mode()).toBe('login');
  });

  it('changes the locale only when it differs', () => {
    const { component } = render();
    const i18n = TestBed.inject(I18n);
    const setLocale = vi.spyOn(i18n, 'setLocale');
    const current = component.currentLocale();
    component.setLocale(current);
    expect(setLocale).not.toHaveBeenCalled();

    const other = current === 'es' ? 'en' : 'es';
    component.setMode('register');
    component.setLocale(other);
    expect(setLocale).toHaveBeenCalledWith(other);
    expect(component.displayTitle()).toBe(component.t().login.crearCuenta);
    component.setLocale(current);
  });

  it('logs in and navigates home after the success transition', async () => {
    vi.useFakeTimers();
    auth.login.mockResolvedValue(user({ name: 'Ana' }));
    const { component } = render();
    component.username = 'ana';
    component.password = 'secret';

    const done = component.submit();
    await vi.advanceTimersByTimeAsync(1000);
    await done;

    expect(auth.login).toHaveBeenCalledWith('ana', 'secret');
    expect(component.accessGrantedText()).toBe(`${component.t().login.bienvenido} Ana`);
    expect(component.successAnnouncement()).toBe(component.t().login.accesoConcedido);
    expect(router.navigate).toHaveBeenCalledWith(['/']);
    expect(component.pending()).toBe(false);
  });

  it('plays the animated success timeline', async () => {
    reducedMotion = false;
    auth.login.mockResolvedValue(user({ name: '', username: 'ana' }));
    const { component } = render();

    const done = component.submit();
    await vi.waitFor(() => expect((component as unknown as { successTimeline?: unknown }).successTimeline).toBeTruthy());
    (component as unknown as { successTimeline: { progress(v: number): void } }).successTimeline.progress(1);
    await done;

    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });

  it('redirects to the password change when required', async () => {
    auth.login.mockResolvedValue(user({ mustChangePassword: true }));
    const { component } = render();
    await component.submit();
    expect(router.navigate).toHaveBeenCalledWith(['/change-password']);
  });

  it('shows the error and shakes the card when login fails', async () => {
    auth.login.mockRejectedValue({ error: { error: 'Usuario o contraseña inválidos' } });
    const { fixture, component, el } = render();
    await component.submit();
    fixture.detectChanges();
    expect(component.error()).toBe('Usuario o contraseña inválidos');
    expect(el.textContent).toContain('Usuario o contraseña inválidos');
  });

  it('registers and shows the pending-approval info', async () => {
    auth.register.mockResolvedValue({ info: 'Pendiente de aprobación' });
    const { fixture, component, el } = render();
    component.setMode('register');
    component.username = 'nuevo';
    component.password = 'secret';
    component.team = 'Banco' as never;
    await component.submit();
    fixture.detectChanges();

    expect(auth.register).toHaveBeenCalledWith({ username: 'nuevo', password: 'secret', team: 'Banco', legajo: undefined });
    expect(el.textContent).toContain('Pendiente de aprobación');
  });

  it('registers without info', async () => {
    auth.register.mockResolvedValue({});
    const { component } = render();
    component.setMode('register');
    component.legajo = '321';
    await component.submit();
    expect(auth.register).toHaveBeenCalledWith(expect.objectContaining({ legajo: '321' }));
    expect(component.info()).toBeNull();
  });

  it('logs in directly when registration returns an active user', async () => {
    vi.useFakeTimers();
    auth.register.mockResolvedValue({ user: user({ name: '', username: 'primero' }) });
    const { component } = render();
    component.setMode('register');
    const done = component.submit();
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(component.accessGrantedText()).toContain('primero');
    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });

  it('cleans up animations on destroy', () => {
    reducedMotion = false;
    const { fixture, component } = render();
    component.setMode('register');
    fixture.destroy();
    expect(component.mode()).toBe('register');
  });
});

function user(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    username: 'ana',
    name: 'Ana',
    team: null,
    role: 'member',
    mustChangePassword: false,
    ...overrides,
  } as User;
}

import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Api } from '../../core/api';
import { AuthService } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { ThemeService } from '../../core/theme';
import { Profile } from './profile';

describe('Profile', () => {
  const api = { get: vi.fn(), put: vi.fn() };
  const auth = { refresh: vi.fn() };
  const theme = { theme: vi.fn(() => 'system'), setTheme: vi.fn() };

  beforeEach(() => {
    api.get.mockReset().mockReturnValue(of({ name: 'Ana', team: 'Banco', theme: 'dark', locale: 'en' }));
    api.put.mockReset().mockReturnValue(of({}));
    auth.refresh.mockReset().mockResolvedValue(null);
    theme.setTheme.mockReset();
    TestBed.configureTestingModule({
      imports: [Profile],
      providers: [
        { provide: Api, useValue: api },
        { provide: AuthService, useValue: auth },
        { provide: ThemeService, useValue: theme },
      ],
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(Profile);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('loads the profile into the form', async () => {
    const { component } = await render();
    expect(component.name()).toBe('Ana');
    expect(component.team).toBe('Banco');
    expect(component.theme).toBe('dark');
    expect(component.locale).toBe('en');
  });

  it('falls back to no team', async () => {
    api.get.mockReturnValue(of({ name: 'Ana', team: null, theme: 'light', locale: 'es' }));
    const { component } = await render();
    expect(component.team).toBe('');
  });

  it('applies theme and locale changes immediately', async () => {
    const { component } = await render();
    const i18n = TestBed.inject(I18n);
    const setLocale = vi.spyOn(i18n, 'setLocale').mockImplementation(() => {});
    component.onTheme('light');
    component.onLocale('es');
    expect(theme.setTheme).toHaveBeenCalledWith('light');
    expect(setLocale).toHaveBeenCalledWith('es');
  });

  it('saves and refreshes the session', async () => {
    const { fixture, component, el } = await render();
    component.team = '';
    await component.save();
    fixture.detectChanges();

    expect(api.put).toHaveBeenCalledWith('/profile', { name: 'Ana', team: null, theme: 'dark', locale: 'en' });
    expect(auth.refresh).toHaveBeenCalled();
    expect(component.saved()).toBe(true);
    expect(component.busy()).toBe(false);
    expect(el.textContent).toContain(component.t().perfil.guardado);
  });

  it('shows the API error when saving fails', async () => {
    api.put.mockReturnValue(throwError(() => ({ error: { error: 'Nombre inválido' } })));
    const { fixture, component, el } = await render();
    await component.save();
    fixture.detectChanges();

    expect(component.saved()).toBe(false);
    expect(el.textContent).toContain('Nombre inválido');
  });
});

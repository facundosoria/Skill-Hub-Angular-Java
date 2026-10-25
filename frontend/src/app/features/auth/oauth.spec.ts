import { ElementRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { NEVER, of, throwError } from 'rxjs';
import { Api } from '../../core/api';
import { OauthConsent } from './oauth-consent';
import { OauthLogout } from './oauth-logout';
import { OauthPasswordChange } from './oauth-password-change';

describe('OAuth screens', () => {
  const api = { get: vi.fn(), post: vi.fn() };
  const flush = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    window.location.hash = '';
  });

  // `#ref` sobre input[uiInput] resuelve al componente UiInput y no a un ElementRef;
  // se inyecta el ElementRef que el código espera para cubrir el foco.
  function focusRef(component: object, field: string): HTMLInputElement {
    const input = document.createElement('input');
    document.body.appendChild(input);
    (component as Record<string, unknown>)[field] = new ElementRef(input);
    return input;
  }

  function configure(params: Record<string, string>, data: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({
      providers: [
        { provide: Api, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { data, queryParamMap: convertToParamMap(params) } } },
      ],
    });
  }

  describe('OauthConsent login step', () => {
    it('requires a login challenge', async () => {
      configure({});
      const fixture = TestBed.createComponent(OauthConsent);
      fixture.detectChanges();
      await fixture.componentInstance.submit();
      expect(fixture.nativeElement.textContent).toContain(fixture.componentInstance.t().oauthConsent.faltaChallenge);
      expect(api.post).not.toHaveBeenCalled();
    });

    it('accepts the login and redirects', async () => {
      configure({ login_challenge: 'lc' });
      api.post.mockReturnValue(of({ redirectTo: '#logged' }));
      const fixture = TestBed.createComponent(OauthConsent);
      fixture.detectChanges();
      const component = fixture.componentInstance;
      component.username = 'ana';
      component.password = 'pw';
      await component.submit();

      expect(api.post).toHaveBeenCalledWith('/oauth/accept-login', { loginChallenge: 'lc', username: 'ana', password: 'pw' });
      expect(window.location.hash).toBe('#logged');
      expect(component.busy()).toBe(false);
    });

    it('shows login errors and ignores submits while busy', async () => {
      configure({ login_challenge: 'lc' });
      api.post.mockReturnValue(throwError(() => ({ error: { error: 'Credenciales inválidas' } })));
      const fixture = TestBed.createComponent(OauthConsent);
      fixture.detectChanges();
      const component = fixture.componentInstance;
      const input = focusRef(component, 'usernameInput');
      await component.submit();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Credenciales inválidas');
      expect(document.activeElement).toBe(input);

      component.busy.set(true);
      await component.submit();
      expect(api.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('OauthConsent consent step', () => {
    it('reports a missing consent challenge', async () => {
      configure({}, { oauthStep: 'consent' });
      const fixture = TestBed.createComponent(OauthConsent);
      fixture.detectChanges();
      await fixture.componentInstance.acceptConsent();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(fixture.componentInstance.t().oauthConsent.faltaChallenge);
      expect(api.post).not.toHaveBeenCalled();
    });

    it('shows a loading message', () => {
      configure({ consent_challenge: 'cc' }, { oauthStep: 'consent' });
      api.get.mockReturnValue(NEVER);
      const fixture = TestBed.createComponent(OauthConsent);
      fixture.detectChanges();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(fixture.componentInstance.t().oauthConsent.cargandoConsentimiento);
    });

    it('loads the request and accepts or rejects it', async () => {
      configure({ consent_challenge: 'cc' }, { oauthStep: 'consent' });
      api.get.mockReturnValue(of({ clientName: 'Cliente MCP', requestedScopes: ['openid', 'skills'] }));
      api.post.mockReturnValue(of({ redirectTo: '#consented' }));
      const fixture = TestBed.createComponent(OauthConsent);
      fixture.detectChanges();
      await flush();
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      expect(api.get).toHaveBeenCalledWith('/oauth/consent-request', { consentChallenge: 'cc' });
      expect(el.textContent).toContain('Cliente MCP');
      expect(el.querySelectorAll('li').length).toBe(2);

      await fixture.componentInstance.acceptConsent();
      expect(api.post).toHaveBeenCalledWith('/oauth/accept-consent', { consentChallenge: 'cc' });
      await fixture.componentInstance.rejectConsent();
      expect(api.post).toHaveBeenCalledWith('/oauth/reject-consent', { consentChallenge: 'cc' });
      expect(window.location.hash).toBe('#consented');
    });

    it('shows requests without scopes and consent errors', async () => {
      configure({ consent_challenge: 'cc' }, { oauthStep: 'consent' });
      api.get.mockReturnValue(of({ clientName: 'Cliente', requestedScopes: [] }));
      api.post.mockReturnValue(throwError(() => ({ message: 'Hydra caído' })));
      const fixture = TestBed.createComponent(OauthConsent);
      fixture.detectChanges();
      await flush();
      await fixture.componentInstance.acceptConsent();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(fixture.componentInstance.t().oauthConsent.sinPermisos);
      expect(fixture.nativeElement.textContent).toContain('Hydra caído');
    });

    it('shows load errors', async () => {
      configure({ consent_challenge: 'cc' }, { oauthStep: 'consent' });
      api.get.mockReturnValue(throwError(() => ({})));
      const fixture = TestBed.createComponent(OauthConsent);
      fixture.detectChanges();
      await flush();
      fixture.detectChanges();
      expect(fixture.componentInstance.consentError()).toBe(fixture.componentInstance.t().oauthConsent.errorConsentimiento);
    });
  });

  describe('OauthLogout', () => {
    it('rejects links without a challenge', async () => {
      configure({});
      const fixture = TestBed.createComponent(OauthLogout);
      fixture.detectChanges();
      await fixture.componentInstance.accept();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Este enlace no es válido');
      expect(api.post).not.toHaveBeenCalled();
    });

    it('loads the request and confirms or rejects the logout', async () => {
      configure({ logout_challenge: 'lo' });
      api.get.mockReturnValue(of({ clientName: 'Cliente MCP' }));
      api.post.mockReturnValue(of({ redirectTo: '#bye' }));
      const fixture = TestBed.createComponent(OauthLogout);
      fixture.detectChanges();
      fixture.detectChanges();
      await flush();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Cliente MCP');

      await fixture.componentInstance.accept();
      expect(api.post).toHaveBeenCalledWith('/oauth/accept-logout', { logoutChallenge: 'lo' });
      await fixture.componentInstance.reject();
      expect(api.post).toHaveBeenCalledWith('/oauth/reject-logout', { logoutChallenge: 'lo' });
      expect(window.location.hash).toBe('#bye');

      fixture.componentInstance.busy.set(true);
      await fixture.componentInstance.accept();
      expect(api.post).toHaveBeenCalledTimes(2);
    });

    it('shows loading, load and submit errors', async () => {
      configure({ logout_challenge: 'lo' });
      api.get.mockReturnValue(NEVER);
      const loading = TestBed.createComponent(OauthLogout);
      loading.detectChanges();
      loading.detectChanges();
      expect(loading.componentInstance.loading()).toBe(true);

      api.get.mockReturnValue(throwError(() => ({})));
      const failed = TestBed.createComponent(OauthLogout);
      failed.detectChanges();
      await flush();
      expect(failed.componentInstance.error()).toContain('No se pudo cargar');

      api.get.mockReturnValue(of({ clientName: 'C' }));
      api.post.mockReturnValue(throwError(() => ({ error: { error: 'Expirado' } })));
      const fixture = TestBed.createComponent(OauthLogout);
      fixture.detectChanges();
      await flush();
      await fixture.componentInstance.reject();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Expirado');
    });
  });

  describe('OauthPasswordChange', () => {
    it('requires a transaction', async () => {
      configure({});
      const fixture = TestBed.createComponent(OauthPasswordChange);
      fixture.detectChanges();
      await fixture.componentInstance.submit();
      await fixture.componentInstance.reject();
      expect(fixture.nativeElement.textContent).toContain(fixture.componentInstance.t().oauthConsent.faltaChallenge);
      expect(api.post).not.toHaveBeenCalled();
    });

    it('validates length and confirmation', async () => {
      configure({ transaction: 'tx' });
      const fixture = TestBed.createComponent(OauthPasswordChange);
      fixture.detectChanges();
      const component = fixture.componentInstance;
      const t = component.t().cambioPassword;
      const input = focusRef(component, 'newPasswordInput');

      component.newPassword = 'corta';
      await component.submit();
      expect(component.fieldError()).toBe(t.minimo);
      expect(document.activeElement).toBe(input);

      component.newPassword = 'una-clave-larga';
      component.confirmPassword = 'otra-clave-larga';
      await component.submit();
      fixture.detectChanges();
      expect(component.fieldError()).toBe(t.noCoinciden);
      expect(fixture.nativeElement.textContent).toContain(t.noCoinciden);
      expect(api.post).not.toHaveBeenCalled();
    });

    it('changes the password and redirects', async () => {
      configure({ transaction: 'tx' });
      api.post.mockReturnValue(of({ redirectTo: '#changed' }));
      const fixture = TestBed.createComponent(OauthPasswordChange);
      fixture.detectChanges();
      const component = fixture.componentInstance;
      component.newPassword = component.confirmPassword = 'una-clave-larga';
      await component.submit();
      expect(api.post).toHaveBeenCalledWith('/oauth/password-change', { transaction: 'tx', password: 'una-clave-larga' });
      expect(window.location.hash).toBe('#changed');

      await component.reject();
      expect(api.post).toHaveBeenCalledWith('/oauth/password-change/reject', { transaction: 'tx' });
    });

    it('shows server errors', async () => {
      configure({ transaction: 'tx' });
      api.post.mockReturnValue(throwError(() => ({ error: { error: 'Transacción vencida' } })));
      const fixture = TestBed.createComponent(OauthPasswordChange);
      fixture.detectChanges();
      const component = fixture.componentInstance;
      focusRef(component, 'newPasswordInput');
      component.newPassword = component.confirmPassword = 'una-clave-larga';
      await component.submit();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Transacción vencida');

      component.serverError.set(null);
      await component.reject();
      expect(component.serverError()).toBe('Transacción vencida');

      component.busy.set(true);
      await component.reject();
      expect(api.post).toHaveBeenCalledTimes(2);
    });
  });
});

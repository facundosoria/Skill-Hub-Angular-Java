import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../core/api';
import { UI } from '../../shared/ui';
import { apiError } from './login';
import { clearDepMapCache } from '../depmap/dep-map-cache';

interface LogoutRequest {
  clientName: string;
}

/** Pantalla de confirmacion del logout OAuth iniciado por Hydra. */
@Component({
  selector: 'app-oauth-logout',
  imports: [...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      min-height: 100dvh;
    }
  `,
  template: `
    <main class="relative mx-auto flex min-h-dvh max-w-md items-center px-4 py-10 sm:px-6">
      <div class="pointer-events-none absolute -top-24 left-1/2 -z-10 h-80 w-80 -translate-x-1/2 rounded-full bg-accent/10 blur-3xl"
           aria-hidden="true"></div>

      <section uiCard class="w-full p-6 sm:p-8" aria-labelledby="oauth-logout-title">
        <h1 id="oauth-logout-title" class="text-2xl font-semibold tracking-tight">Cerrar sesión</h1>
        <p class="mt-2 text-sm leading-relaxed text-text-muted">
          Confirmá el cierre de sesión de tu conexión OAuth.
        </p>

        @if (error()) {
          <p class="mt-6 text-sm text-danger" role="alert">{{ error() }}</p>
        } @else if (loading()) {
          <p class="mt-6 text-sm text-text-muted" aria-live="polite">Cargando solicitud…</p>
        } @else if (logoutRequest()) {
          <div class="mt-6 rounded-lg border border-border bg-surface-2 p-4">
            <p class="text-sm text-text-muted">Cliente</p>
            <p class="font-medium">{{ logoutRequest()!.clientName }}</p>
          </div>

          @if (serverError()) {
            <p class="mt-5 text-sm text-danger" role="alert">{{ serverError() }}</p>
          }

          <div class="mt-6 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end">
            <button uiButton variant="ghost" type="button" [disabled]="busy()" (click)="reject()">
              {{ busy() ? 'Procesando…' : 'Rechazar' }}
            </button>
            <button uiButton type="button" [disabled]="busy()" (click)="accept()">
              {{ busy() ? 'Procesando…' : 'Cerrar sesión' }}
            </button>
          </div>
        }
      </section>
    </main>
  `,
})
export class OauthLogout implements OnInit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);

  readonly logoutChallenge = signal<string | null>(
    this.route.snapshot.queryParamMap.get('logout_challenge'),
  );
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly serverError = signal<string | null>(null);
  readonly logoutRequest = signal<LogoutRequest | null>(null);

  ngOnInit(): void {
    void this.loadRequest();
  }

  private async loadRequest(): Promise<void> {
    const logoutChallenge = this.logoutChallenge();
    if (!logoutChallenge) {
      this.error.set('Este enlace no es válido. Volvé a iniciar el cierre de sesión desde tu cliente.');
      return;
    }

    this.loading.set(true);
    try {
      const request = await firstValueFrom(
        this.api.get<LogoutRequest>('/oauth/logout-request', { logoutChallenge }),
      );
      this.logoutRequest.set(request);
    } catch (error: unknown) {
      this.error.set(apiError(error, 'No se pudo cargar la solicitud de cierre de sesión.'));
    } finally {
      this.loading.set(false);
    }
  }

  async accept(): Promise<void> {
    await this.finish('/oauth/accept-logout', true);
  }

  async reject(): Promise<void> {
    await this.finish('/oauth/reject-logout');
  }

  private async finish(endpoint: string, clearCache = false): Promise<void> {
    const logoutChallenge = this.logoutChallenge();
    if (!logoutChallenge || this.busy()) return;

    this.serverError.set(null);
    this.busy.set(true);
    try {
      const response = await firstValueFrom(
        this.api.post<{ redirectTo: string }>(endpoint, { logoutChallenge }),
      );
      if (clearCache) clearDepMapCache();
      window.location.href = response.redirectTo;
    } catch (error: unknown) {
      this.serverError.set(apiError(error, 'No se pudo completar el cierre de sesión.'));
    } finally {
      this.busy.set(false);
    }
  }
}

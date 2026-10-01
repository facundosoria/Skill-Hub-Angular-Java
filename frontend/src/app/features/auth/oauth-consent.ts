import { ChangeDetectionStrategy, Component, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { UI } from '../../shared/ui';
import { apiError } from './login';

interface ConsentRequest {
  clientName: string;
  requestedScopes: string[];
}

/** Login y consentimiento del flujo OAuth de Hydra. */
@Component({
  selector: 'app-oauth-consent',
  imports: [FormsModule, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="relative mx-auto flex min-h-dvh max-w-md items-center px-4 py-10 sm:px-6">
      <div class="pointer-events-none absolute -top-24 left-1/2 -z-10 h-80 w-80 -translate-x-1/2 rounded-full bg-accent/10 blur-3xl"
           aria-hidden="true"></div>

      <section uiCard class="w-full p-6 sm:p-8" aria-labelledby="oauth-consent-title">
        @if (isConsentStep) {
          <h1 id="oauth-consent-title" class="text-2xl font-semibold tracking-tight">
            {{ t().oauthConsent.consentimientoTitulo }}
          </h1>
          <p class="mt-2 text-sm leading-relaxed text-text-muted">{{ t().oauthConsent.consentimientoSubtitulo }}</p>

          @if (consentError()) {
            <p class="mt-6 text-sm text-danger" role="alert">{{ consentError() }}</p>
          } @else if (loadingConsent()) {
            <p class="mt-6 text-sm text-text-muted" aria-live="polite">{{ t().oauthConsent.cargandoConsentimiento }}</p>
          } @else if (consentRequest()) {
            <div class="mt-6 space-y-4 rounded-lg border border-border bg-surface-2 p-4">
              <div>
                <p class="text-sm text-text-muted">{{ t().oauthConsent.cliente }}</p>
                <p class="font-medium">{{ consentRequest()!.clientName }}</p>
              </div>

              <div>
                <p class="text-sm text-text-muted">{{ t().oauthConsent.permisos }}</p>
                @if (consentRequest()!.requestedScopes.length) {
                  <ul class="mt-2 list-disc space-y-1 pl-5 text-sm">
                    @for (scope of consentRequest()!.requestedScopes; track scope) {
                      <li>{{ scope }}</li>
                    }
                  </ul>
                } @else {
                  <p class="mt-2 text-sm">{{ t().oauthConsent.sinPermisos }}</p>
                }
              </div>
            </div>

            @if (serverError()) {
              <p class="mt-5 text-sm text-danger" role="alert">{{ serverError() }}</p>
            }

            <div class="mt-6 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end">
              <button uiButton type="button" [disabled]="busy()" (click)="rejectConsent()">
                {{ busy() ? t().oauthConsent.procesando : t().oauthConsent.rechazar }}
              </button>
              <button uiButton type="button" [disabled]="busy()" (click)="acceptConsent()">
                {{ busy() ? t().oauthConsent.procesando : t().oauthConsent.autorizar }}
              </button>
            </div>
          }
        } @else {
          <h1 id="oauth-consent-title" class="text-2xl font-semibold tracking-tight">
            {{ t().oauthConsent.titulo }}
          </h1>
          <p class="mt-2 text-sm leading-relaxed text-text-muted">{{ t().oauthConsent.subtitulo }}</p>

          @if (!loginChallenge()) {
            <p class="mt-6 text-sm text-danger" role="alert">{{ t().oauthConsent.faltaChallenge }}</p>
          } @else {
            <form class="mt-7 space-y-5" (ngSubmit)="submit()" novalidate>
              <ui-field [label]="t().oauthConsent.usuario">
                <input #usernameInput uiInput type="text" name="username"
                       [(ngModel)]="username" autocomplete="username" required autofocus
                       [attr.aria-invalid]="serverError() ? 'true' : null" />
              </ui-field>

              <ui-field [label]="t().oauthConsent.password">
                <input uiInput type="password" name="password"
                       [(ngModel)]="password" autocomplete="current-password" required
                       [attr.aria-invalid]="serverError() ? 'true' : null" />
              </ui-field>

              @if (serverError()) {
                <p class="text-sm text-danger" role="alert">{{ serverError() }}</p>
              }

              <div class="border-t border-border pt-5">
                <button uiButton type="submit" [disabled]="busy()">
                  {{ busy() ? t().oauthConsent.conectando : t().oauthConsent.conectar }}
                </button>
              </div>
            </form>
          }
        }
      </section>
    </main>
  `,
})
export class OauthConsent implements OnInit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private i18n = inject(I18n);
  t = this.i18n.t;

  readonly isConsentStep = this.route.snapshot.data['oauthStep'] === 'consent';

  @ViewChild('usernameInput') private usernameInput?: ElementRef<HTMLInputElement>;

  loginChallenge = signal<string | null>(
    this.route.snapshot.queryParamMap.get('login_challenge'),
  );
  consentChallenge = signal<string | null>(
    this.route.snapshot.queryParamMap.get('consent_challenge'),
  );

  username = '';
  password = '';
  busy = signal(false);
  serverError = signal<string | null>(null);
  loadingConsent = signal(false);
  consentRequest = signal<ConsentRequest | null>(null);
  consentError = signal<string | null>(null);

  ngOnInit(): void {
    if (this.isConsentStep) void this.loadConsentRequest();
  }

  private async loadConsentRequest(): Promise<void> {
    const consentChallenge = this.consentChallenge();
    if (!consentChallenge) {
      this.consentError.set(this.t().oauthConsent.faltaChallenge);
      return;
    }

    this.loadingConsent.set(true);
    try {
      const request = await firstValueFrom(
        this.api.get<ConsentRequest>('/oauth/consent-request', { consentChallenge }),
      );
      this.consentRequest.set(request);
    } catch (error: unknown) {
      this.consentError.set(apiError(error, this.t().oauthConsent.errorConsentimiento));
    } finally {
      this.loadingConsent.set(false);
    }
  }

  async submit(): Promise<void> {
    const loginChallenge = this.loginChallenge();
    if (!loginChallenge || this.busy()) return;

    this.serverError.set(null);
    this.busy.set(true);
    try {
      const res = await firstValueFrom(
        this.api.post<{ redirectTo: string }>('/oauth/accept-login', {
          loginChallenge,
          username: this.username,
          password: this.password,
        }),
      );
      window.location.href = res.redirectTo;
    } catch (error: unknown) {
      this.serverError.set(apiError(error, this.t().oauthConsent.errorGenerico));
      this.usernameInput?.nativeElement.focus();
    } finally {
      this.busy.set(false);
    }
  }

  async acceptConsent(): Promise<void> {
    await this.finishConsent('/oauth/accept-consent');
  }

  async rejectConsent(): Promise<void> {
    await this.finishConsent('/oauth/reject-consent');
  }

  private async finishConsent(endpoint: string): Promise<void> {
    const consentChallenge = this.consentChallenge();
    if (!consentChallenge || this.busy()) return;

    this.serverError.set(null);
    this.busy.set(true);
    try {
      const res = await firstValueFrom(
        this.api.post<{ redirectTo: string }>(endpoint, { consentChallenge }),
      );
      window.location.href = res.redirectTo;
    } catch (error: unknown) {
      this.serverError.set(apiError(error, this.t().oauthConsent.errorConsentimiento));
    } finally {
      this.busy.set(false);
    }
  }
}

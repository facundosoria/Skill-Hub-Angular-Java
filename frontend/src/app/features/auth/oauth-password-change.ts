import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { UI } from '../../shared/ui';
import { apiError } from './login';

/** Cambio obligatorio de contrasena para un login OAuth pendiente de Hydra. */
@Component({
  selector: 'app-oauth-password-change',
  imports: [FormsModule, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="relative mx-auto flex min-h-dvh max-w-md items-center px-4 py-10 sm:px-6">
      <div class="pointer-events-none absolute -top-24 left-1/2 -z-10 h-80 w-80 -translate-x-1/2 rounded-full bg-accent/10 blur-3xl"
           aria-hidden="true"></div>

      <section uiCard class="w-full p-6 sm:p-8" aria-labelledby="oauth-password-change-title">
        <h1 id="oauth-password-change-title" class="text-2xl font-semibold tracking-tight">
          {{ t().cambioPassword.titulo }}
        </h1>
        <p class="mt-2 text-sm leading-relaxed text-text-muted">{{ t().cambioPassword.subtitulo }}</p>

        @if (!transaction()) {
          <p class="mt-6 text-sm text-danger" role="alert">{{ t().oauthConsent.faltaChallenge }}</p>
        } @else {
          <form class="mt-7 space-y-5" (ngSubmit)="submit()" novalidate>
            <ui-field [label]="t().cambioPassword.nuevaPassword" [hint]="t().cambioPassword.minimo">
              <input #newPasswordInput uiInput type="password" name="newPassword"
                     [(ngModel)]="newPassword" autocomplete="new-password" required minlength="10"
                     autofocus aria-describedby="oauth-new-password-help oauth-password-error"
                     [attr.aria-invalid]="fieldError() || serverError() ? 'true' : null" />
            </ui-field>
            <span id="oauth-new-password-help" class="sr-only">{{ t().cambioPassword.minimo }}</span>

            <ui-field [label]="t().cambioPassword.confirmarPassword">
              <input uiInput type="password" name="confirmPassword"
                     [(ngModel)]="confirmPassword" autocomplete="new-password" required minlength="10"
                     aria-describedby="oauth-password-error"
                     [attr.aria-invalid]="fieldError() || serverError() ? 'true' : null" />
            </ui-field>

            @if (fieldError()) {
              <p id="oauth-password-error" class="text-sm text-danger" role="alert">{{ fieldError() }}</p>
            } @else if (serverError()) {
              <p id="oauth-password-error" class="text-sm text-danger" role="alert">{{ serverError() }}</p>
            }

            <div class="flex flex-col gap-2 border-t border-border pt-5 sm:flex-row sm:items-center">
              <button uiButton type="submit" [disabled]="busy()">
                {{ busy() ? t().cambioPassword.guardando : t().cambioPassword.cambiar }}
              </button>
              <button uiButton type="button" variant="ghost" [disabled]="busy()" (click)="reject()">
                {{ t().cambioPassword.salir }}
              </button>
            </div>
          </form>
        }
      </section>
    </main>
  `,
})
export class OauthPasswordChange {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private i18n = inject(I18n);
  t = this.i18n.t;

  @ViewChild('newPasswordInput') private newPasswordInput?: ElementRef<HTMLInputElement>;

  transaction = signal<string | null>(this.route.snapshot.queryParamMap.get('transaction'));
  newPassword = '';
  confirmPassword = '';
  busy = signal(false);
  fieldError = signal<string | null>(null);
  serverError = signal<string | null>(null);

  async submit(): Promise<void> {
    this.fieldError.set(null);
    this.serverError.set(null);
    if (!this.transaction()) return;
    if (this.newPassword.length < 10) {
      this.fieldError.set(this.t().cambioPassword.minimo);
      this.newPasswordInput?.nativeElement.focus();
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.fieldError.set(this.t().cambioPassword.noCoinciden);
      this.newPasswordInput?.nativeElement.focus();
      return;
    }

    this.busy.set(true);
    try {
      const response = await firstValueFrom(this.api.post<{ redirectTo: string }>(
        '/oauth/password-change',
        { transaction: this.transaction(), password: this.newPassword },
      ));
      window.location.href = response.redirectTo;
    } catch (error: unknown) {
      this.serverError.set(apiError(error, this.t().cambioPassword.errorGenerico));
      this.newPasswordInput?.nativeElement.focus();
    } finally {
      this.busy.set(false);
    }
  }

  async reject(): Promise<void> {
    const transaction = this.transaction();
    if (!transaction || this.busy()) return;

    this.serverError.set(null);
    this.busy.set(true);
    try {
      const response = await firstValueFrom(this.api.post<{ redirectTo: string }>(
        '/oauth/password-change/reject', { transaction },
      ));
      window.location.href = response.redirectTo;
    } catch (error: unknown) {
      this.serverError.set(apiError(error, this.t().cambioPassword.errorGenerico));
    } finally {
      this.busy.set(false);
    }
  }
}

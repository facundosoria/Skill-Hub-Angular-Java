import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { UI } from '../../shared/ui';
import { apiError } from './login';

@Component({
  selector: 'app-change-password',
  imports: [FormsModule, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="relative mx-auto flex min-h-dvh max-w-md items-center px-4 py-10 sm:px-6">
      <div class="pointer-events-none absolute -top-24 left-1/2 -z-10 h-80 w-80 -translate-x-1/2 rounded-full bg-accent/10 blur-3xl"
           aria-hidden="true"></div>

      <section uiCard class="w-full p-6 sm:p-8" aria-labelledby="change-password-title">
        <div class="mb-6 inline-flex items-center gap-2 rounded-full border border-warning/30 bg-warning-soft px-3 py-1 text-xs font-medium text-warning">
          <span class="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true"></span>
          {{ auth.user()?.username }}
        </div>

        <h1 id="change-password-title" class="text-2xl font-semibold tracking-tight">
          {{ t().cambioPassword.titulo }}
        </h1>
        <p class="mt-2 text-sm leading-relaxed text-text-muted">{{ t().cambioPassword.subtitulo }}</p>

        <form class="mt-7 space-y-5" (ngSubmit)="submit()" novalidate>
          <div>
            <ui-field [label]="t().cambioPassword.nuevaPassword" [hint]="t().cambioPassword.minimo">
              <input #newPasswordInput uiInput type="password" name="newPassword"
                     [(ngModel)]="newPassword" autocomplete="new-password" required minlength="10"
                     autofocus
                     aria-describedby="new-password-help new-password-error"
                     [attr.aria-invalid]="fieldError() ? 'true' : null" />
            </ui-field>
            <span id="new-password-help" class="sr-only">{{ t().cambioPassword.minimo }}</span>
          </div>

          <div>
            <ui-field [label]="t().cambioPassword.confirmarPassword">
              <input uiInput type="password" name="confirmPassword"
                     [(ngModel)]="confirmPassword" autocomplete="new-password" required minlength="10"
                     aria-describedby="new-password-error"
                     [attr.aria-invalid]="fieldError() ? 'true' : null" />
            </ui-field>
          </div>

          @if (fieldError()) {
            <p id="new-password-error" class="text-sm text-danger" role="alert">{{ fieldError() }}</p>
          } @else if (serverError()) {
            <p class="text-sm text-danger" role="alert">{{ serverError() }}</p>
          }

          <div class="flex flex-col gap-2 border-t border-border pt-5 sm:flex-row sm:items-center">
            <button uiButton type="submit" [disabled]="busy()">
              {{ busy() ? t().cambioPassword.guardando : t().cambioPassword.cambiar }}
            </button>
            <button uiButton type="button" variant="ghost" [disabled]="busy()" (click)="logout()">
              {{ t().cambioPassword.salir }}
            </button>
          </div>
        </form>
      </section>
    </main>
  `,
})
export class ChangePassword {
  private router = inject(Router);
  auth = inject(AuthService);
  private i18n = inject(I18n);
  t = this.i18n.t;

  @ViewChild('newPasswordInput') private newPasswordInput?: ElementRef<HTMLInputElement>;

  newPassword = '';
  confirmPassword = '';
  busy = signal(false);
  fieldError = signal<string | null>(null);
  serverError = signal<string | null>(null);

  async submit(): Promise<void> {
    this.fieldError.set(null);
    this.serverError.set(null);
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
      await this.auth.changeRequiredPassword(this.newPassword);
      await this.router.navigate(['/']);
    } catch (error: unknown) {
      this.serverError.set(apiError(error, this.t().cambioPassword.errorGenerico));
    } finally {
      this.busy.set(false);
    }
  }

  async logout(): Promise<void> {
    this.busy.set(true);
    try {
      await this.auth.logout();
      await this.router.navigate(['/login']);
    } catch (error: unknown) {
      this.serverError.set(apiError(error, this.t().cambioPassword.errorGenerico));
    } finally {
      this.busy.set(false);
    }
  }
}

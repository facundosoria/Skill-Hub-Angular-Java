import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { UI } from '../../shared/ui';

/** Puerto de src/app/(auth)/login/login-form.tsx. */
@Component({
  selector: 'app-login',
  imports: [FormsModule, ...UI],
  template: `
    <main class="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
      <div class="mb-8">
        <h1 class="text-2xl font-semibold tracking-tight">Skill Hub</h1>
        <p class="mt-1.5 text-sm text-text-muted">{{ t().login.subtitulo }}</p>
      </div>

      <form (ngSubmit)="submit()" class="space-y-4">
        @if (mode() === 'register') {
          <div class="space-y-4" animate.enter="anim-panel-in" animate.leave="anim-panel-out">
            <ui-field [label]="t().login.equipo">
              <input uiInput name="team" [(ngModel)]="team" placeholder="backoffice" />
            </ui-field>
            <ui-field [label]="t().login.legajo" [hint]="t().login.legajoHint">
              <input uiInput name="legajo" [(ngModel)]="legajo" placeholder="321333" />
            </ui-field>
          </div>
        }

        <ui-field [label]="t().login.usuario">
          <input uiInput name="username" [(ngModel)]="username" autocomplete="username"
                 placeholder="421496-Facundo Soria" />
        </ui-field>

        <ui-field [label]="t().login.password" [hint]="mode() === 'register' ? t().login.minimo : undefined">
          <input uiInput name="password" type="password" [(ngModel)]="password"
                 [autocomplete]="mode() === 'login' ? 'current-password' : 'new-password'" />
        </ui-field>

        @if (error()) {
          <p class="text-sm text-danger" role="alert" animate.enter="anim-panel-in">{{ error() }}</p>
        } @else if (info()) {
          <p class="text-sm text-success" role="status" animate.enter="anim-panel-in">{{ info() }}</p>
        }

        <button uiButton type="submit" [disabled]="pending()" class="w-full">
          {{ pending() ? t().login.esperando : mode() === 'login' ? t().login.entrar : t().login.crearCuenta }}
        </button>
      </form>

      <p class="mt-6 text-center text-sm text-text-muted">
        {{ mode() === 'login' ? t().login.sinCuenta : t().login.yaTengo }}
        <button type="button" (click)="toggle()"
                class="text-accent underline underline-offset-2 cursor-pointer">
          {{ mode() === 'login' ? t().login.registrate : t().login.entra }}
        </button>
      </p>
    </main>
  `,
})
export class Login {
  private auth = inject(AuthService);
  private router = inject(Router);
  private i18n = inject(I18n);
  t = this.i18n.t;

  mode = signal<'login' | 'register'>('login');
  username = '';
  password = '';
  team = '';
  legajo = '';
  pending = signal(false);
  error = signal<string | null>(null);
  info = signal<string | null>(null);

  toggle(): void {
    this.mode.set(this.mode() === 'login' ? 'register' : 'login');
    this.error.set(null);
    this.info.set(null);
  }

  async submit(): Promise<void> {
    this.pending.set(true);
    this.error.set(null);
    this.info.set(null);
    try {
      if (this.mode() === 'login') {
        await this.auth.login(this.username, this.password);
        this.router.navigate(['/skills']);
      } else {
        const res = await this.auth.register({
          username: this.username,
          password: this.password,
          team: this.team,
          legajo: this.legajo || undefined,
        });
        if (res.user) this.router.navigate(['/skills']);
        else this.info.set(res.info ?? null);
      }
    } catch (e: unknown) {
      this.error.set(apiError(e));
    } finally {
      this.pending.set(false);
    }
  }
}

/** El backend manda { error } con 4xx; HttpClient lo envuelve en HttpErrorResponse. */
export function apiError(e: unknown): string {
  const err = e as { error?: { error?: string }; message?: string };
  return err?.error?.error ?? err?.message ?? 'Algo salio mal';
}

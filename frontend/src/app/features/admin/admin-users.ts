import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../core/api';
import { AuthService } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import type { AdminUser } from '../../core/models';
import { UI } from '../../shared/ui';
import { apiError } from '../auth/login';

/** Puerto de src/app/(app)/admin/users/page.tsx (el original no anima). */
@Component({
  selector: 'app-admin-users',
  imports: [FormsModule, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    dialog::backdrop {
      background: color-mix(in srgb, #000 60%, transparent);
      backdrop-filter: blur(4px);
    }
  `,
  template: `
    <div class="max-w-2xl">
      <h1 class="text-2xl font-semibold tracking-tight">{{ t().usuarios.titulo }}</h1>
      <p class="mt-1 mb-6 text-sm text-text-muted">{{ t().usuarios.subtitulo }}</p>

      @if (pending().length === 0) {
        <ui-empty-state [title]="t().usuarios.vacio" [hint]="t().usuarios.vacioHint" />
      } @else {
        <div class="space-y-3">
          @for (p of pending(); track p.id) {
            <div uiCard class="p-4">
              <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span class="text-[15px] font-medium">{{ p.name }}</span>
                <span class="text-sm text-text-muted">{{ p.username }}</span>
                @if (p.team) { <span uiBadge>{{ p.team }}</span> }
                <span uiBadge tone="accent">{{ p.legajo || t().usuarios.sinLegajo }}</span>
              </div>
              <div class="mt-3 flex gap-2">
                <button uiButton size="sm" (click)="approve(p.id)">{{ t().usuarios.aprobar }}</button>
                <button uiButton size="sm" variant="ghost" (click)="reject(p.id)">{{ t().usuarios.rechazar }}</button>
              </div>
            </div>
          }
        </div>
      }

      <div class="mt-10 mb-3">
        <h2 class="text-lg font-semibold">{{ t().usuarios.activasTitulo }}</h2>
        <p class="mt-1 text-sm text-text-muted">{{ t().usuarios.activasSubtitulo }}</p>
      </div>

      @if (resetSuccess()) {
        <p class="mb-3 rounded-[var(--radius)] border border-success/25 bg-success-soft px-3 py-2 text-sm text-success"
           role="status">{{ resetSuccess() }}</p>
      }

      @if (active().length === 0) {
        <ui-empty-state [title]="t().usuarios.activasVacio" />
      } @else {
        <div uiCard class="divide-y divide-border">
          @for (u of active(); track u.id) {
            <div class="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div class="flex min-w-0 flex-wrap items-baseline gap-2">
                <span class="text-sm font-medium">{{ u.name }}</span>
                <span class="text-sm text-text-muted">{{ u.username }}</span>
                @if (u.team) { <span uiBadge>{{ u.team }}</span> }
                @if (u.role === 'admin') { <span uiBadge tone="accent">{{ t().usuarios.rolAdmin }}</span> }
                @if (u.mustChangePassword) {
                  <span uiBadge tone="warning">{{ t().usuarios.cambioPendiente }}</span>
                }
              </div>
              @if (u.id !== auth.user()?.id) {
                <button uiButton type="button" size="sm" variant="secondary"
                        (click)="openReset(u, $event)">
                  {{ t().usuarios.restablecer }}
                </button>
              }
            </div>
          }
        </div>
      }
    </div>

    <dialog #resetDialog
            class="m-auto w-[calc(100%-2rem)] max-w-md rounded-[var(--radius-lg)] border border-border bg-surface p-0 text-text shadow-[var(--shadow-lg)]"
            aria-labelledby="reset-password-title" (close)="onDialogClosed()">
      <form class="p-5 sm:p-6" (ngSubmit)="submitReset()" novalidate>
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 id="reset-password-title" class="text-lg font-semibold tracking-tight">
              {{ t().usuarios.restablecerTitulo }}
            </h2>
            <p class="mt-1 text-sm text-text-muted">
              {{ resetTarget()?.name }} · {{ resetTarget()?.username }}
            </p>
          </div>
          <button type="button" class="cursor-pointer rounded-[var(--radius)] p-2 text-text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:shadow-[var(--ring)]"
                  [attr.aria-label]="t().usuarios.restablecerCancelar" (click)="closeReset()">
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div class="mt-5 space-y-4">
          <ui-field [label]="t().usuarios.passwordTemporal" [hint]="t().usuarios.passwordHint">
            <input #temporaryPasswordInput uiInput type="password" name="temporaryPassword"
                   [(ngModel)]="temporaryPassword" autocomplete="new-password" required minlength="10"
                   aria-describedby="temporary-password-error"
                   [attr.aria-invalid]="resetFieldError() ? 'true' : null" />
          </ui-field>
          <ui-field [label]="t().usuarios.confirmarPasswordTemporal">
            <input uiInput type="password" name="temporaryPasswordConfirmation"
                   [(ngModel)]="temporaryPasswordConfirmation" autocomplete="new-password" required minlength="10"
                   aria-describedby="temporary-password-error"
                   [attr.aria-invalid]="resetFieldError() ? 'true' : null" />
          </ui-field>
          @if (resetFieldError()) {
            <p id="temporary-password-error" class="text-sm text-danger" role="alert">{{ resetFieldError() }}</p>
          } @else if (resetServerError()) {
            <p class="text-sm text-danger" role="alert">{{ resetServerError() }}</p>
          }
        </div>

        <div class="mt-6 flex justify-end gap-2 border-t border-border pt-4">
          <button uiButton type="button" variant="secondary" [disabled]="resetBusy()" (click)="closeReset()">
            {{ t().usuarios.restablecerCancelar }}
          </button>
          <button uiButton type="submit" [disabled]="resetBusy()">
            {{ t().usuarios.restablecerConfirmar }}
          </button>
        </div>
      </form>
    </dialog>
  `,
})
export class AdminUsers {
  private api = inject(Api);
  private i18n = inject(I18n);
  auth = inject(AuthService);
  t = this.i18n.t;

  @ViewChild('resetDialog') private resetDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('temporaryPasswordInput') private temporaryPasswordInput?: ElementRef<HTMLInputElement>;

  pending = signal<AdminUser[]>([]);
  active = signal<AdminUser[]>([]);
  resetTarget = signal<AdminUser | null>(null);
  resetBusy = signal(false);
  resetFieldError = signal<string | null>(null);
  resetServerError = signal<string | null>(null);
  resetSuccess = signal<string | null>(null);
  temporaryPassword = '';
  temporaryPasswordConfirmation = '';
  private resetTrigger?: HTMLElement;

  constructor() {
    this.load();
  }

  private load(): void {
    firstValueFrom(this.api.get<{ pending: AdminUser[]; active: AdminUser[] }>('/admin/users')).then((r) => {
      this.pending.set(r.pending);
      this.active.set(r.active);
    });
  }

  async approve(id: string): Promise<void> {
    await firstValueFrom(this.api.post(`/admin/users/${id}/approve`));
    this.load();
  }

  async reject(id: string): Promise<void> {
    await firstValueFrom(this.api.post(`/admin/users/${id}/reject`));
    this.load();
  }

  openReset(user: AdminUser, event: Event): void {
    this.resetTrigger = event.currentTarget as HTMLElement;
    this.resetTarget.set(user);
    this.resetSuccess.set(null);
    this.resetFieldError.set(null);
    this.resetServerError.set(null);
    this.temporaryPassword = '';
    this.temporaryPasswordConfirmation = '';
    this.resetDialog?.nativeElement.showModal();
    queueMicrotask(() => this.temporaryPasswordInput?.nativeElement.focus());
  }

  closeReset(): void {
    this.resetDialog?.nativeElement.close();
  }

  onDialogClosed(): void {
    this.resetTarget.set(null);
    this.temporaryPassword = '';
    this.temporaryPasswordConfirmation = '';
    this.resetFieldError.set(null);
    this.resetServerError.set(null);
    this.resetTrigger?.focus();
    this.resetTrigger = undefined;
  }

  async submitReset(): Promise<void> {
    const target = this.resetTarget();
    if (!target) return;
    this.resetFieldError.set(null);
    this.resetServerError.set(null);
    if (this.temporaryPassword.length < 10) {
      this.resetFieldError.set(this.t().usuarios.passwordHint);
      this.temporaryPasswordInput?.nativeElement.focus();
      return;
    }
    if (this.temporaryPassword !== this.temporaryPasswordConfirmation) {
      this.resetFieldError.set(this.t().usuarios.passwordsNoCoinciden);
      this.temporaryPasswordInput?.nativeElement.focus();
      return;
    }

    this.resetBusy.set(true);
    try {
      await firstValueFrom(
        this.api.post(`/admin/users/${target.id}/reset-password`, { password: this.temporaryPassword }),
      );
      this.closeReset();
      this.resetSuccess.set(this.t().usuarios.restablecerOk);
      this.load();
    } catch (error: unknown) {
      this.resetServerError.set(apiError(error, this.t().usuarios.restablecerError));
    } finally {
      this.resetBusy.set(false);
    }
  }
}

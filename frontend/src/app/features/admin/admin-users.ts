import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../core/api';
import { AuthService } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import type { AdminUser } from '../../core/models';
import { TEAM_OPTIONS, type Team } from '../../core/teams';
import { UI } from '../../shared/ui';
import { apiError } from '../auth/login';

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
    <div class="max-w-3xl">
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

      <div class="mt-10 mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-lg font-semibold">{{ t().usuarios.cuentasTitulo }}</h2>
          <p class="mt-1 text-sm text-text-muted">{{ t().usuarios.cuentasSubtitulo }}</p>
        </div>
        <div class="flex items-center gap-1 rounded-[var(--radius)] border border-border p-1 bg-surface-2 self-start sm:self-auto"
             role="group" [attr.aria-label]="t().usuarios.cuentasTitulo">
          <button type="button" class="cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors"
                  [class.bg-surface]="statusFilter() === 'active'"
                  [class.text-text]="statusFilter() === 'active'"
                  [class.shadow-sm]="statusFilter() === 'active'"
                  [class.text-text-muted]="statusFilter() !== 'active'"
                  (click)="statusFilter.set('active')">
            {{ t().usuarios.filtroActivas }} ({{ active().length }})
          </button>
          <button type="button" class="cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors"
                  [class.bg-surface]="statusFilter() === 'inactive'"
                  [class.text-text]="statusFilter() === 'inactive'"
                  [class.shadow-sm]="statusFilter() === 'inactive'"
                  [class.text-text-muted]="statusFilter() !== 'inactive'"
                  (click)="statusFilter.set('inactive')">
            {{ t().usuarios.filtroInactivas }} ({{ inactive().length }})
          </button>
          <button type="button" class="cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors"
                  [class.bg-surface]="statusFilter() === 'all'"
                  [class.text-text]="statusFilter() === 'all'"
                  [class.shadow-sm]="statusFilter() === 'all'"
                  [class.text-text-muted]="statusFilter() !== 'all'"
                  (click)="statusFilter.set('all')">
            {{ t().usuarios.filtroTodas }} ({{ active().length + inactive().length }})
          </button>
        </div>
      </div>

      @if (actionSuccess()) {
        <p class="mb-3 rounded-[var(--radius)] border border-success/25 bg-success-soft px-3 py-2 text-sm text-success"
           role="status">{{ actionSuccess() }}</p>
      }

      @if (actionError()) {
        <p class="mb-3 rounded-[var(--radius)] border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger"
           role="alert">{{ actionError() }}</p>
      }

      @if (filteredUsers().length === 0) {
        <ui-empty-state [title]="t().usuarios.cuentasVacio" />
      } @else {
        <div uiCard class="divide-y divide-border">
          @for (u of filteredUsers(); track u.id) {
            <div class="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div class="flex min-w-0 flex-wrap items-baseline gap-2">
                <span class="text-sm font-medium">{{ u.name }}</span>
                <span class="text-sm text-text-muted">{{ u.username }}</span>
                @if (u.team) { <span uiBadge>{{ u.team }}</span> }
                @if (u.status === 'inactive') {
                  <span uiBadge tone="warning">{{ t().usuarios.estadoInactiva }}</span>
                }
                @if (u.role === 'admin') { <span uiBadge tone="accent">{{ t().usuarios.rolAdmin }}</span> }
                @if (u.mustChangePassword) {
                  <span uiBadge tone="warning">{{ t().usuarios.cambioPendiente }}</span>
                }
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <button uiButton type="button" size="sm" variant="ghost"
                        (click)="openChangeTeam(u, $event)">
                  {{ t().usuarios.cambiarEquipo }}
                </button>

                @if (u.status === 'active') {
                  @if (u.id !== auth.user()?.id) {
                    <button uiButton type="button" size="sm" variant="secondary"
                            (click)="openReset(u, $event)">
                      {{ t().usuarios.restablecer }}
                    </button>
                    <button uiButton type="button" size="sm" variant="ghost" class="text-danger hover:text-danger"
                            (click)="openDeactivate(u, $event)">
                      {{ t().usuarios.darDeBaja }}
                    </button>
                  }
                } @else if (u.status === 'inactive') {
                  <button uiButton type="button" size="sm" variant="secondary"
                          (click)="reactivate(u)">
                    {{ t().usuarios.reactivar }}
                  </button>
                }
              </div>
            </div>
          }
        </div>
      }
    </div>

    <!-- Dialog: Restablecer Contraseña -->
    <dialog #resetDialog
            class="m-auto w-[calc(100%-2rem)] max-w-md rounded-[var(--radius-lg)] border border-border bg-surface p-0 text-text shadow-[var(--shadow-lg)]"
            aria-labelledby="reset-password-title" (close)="onResetDialogClosed()">
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

    <!-- Dialog: Cambiar Equipo -->
    <dialog #teamDialog
            class="m-auto w-[calc(100%-2rem)] max-w-md rounded-[var(--radius-lg)] border border-border bg-surface p-0 text-text shadow-[var(--shadow-lg)]"
            aria-labelledby="team-dialog-title" (close)="onTeamDialogClosed()">
      <form class="p-5 sm:p-6" (ngSubmit)="submitTeam()" novalidate>
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 id="team-dialog-title" class="text-lg font-semibold tracking-tight">
              {{ t().usuarios.cambiarEquipoTitulo }}
            </h2>
            <p class="mt-1 text-sm text-text-muted">
              {{ teamTarget()?.name }} · {{ teamTarget()?.username }}
            </p>
          </div>
          <button type="button" class="cursor-pointer rounded-[var(--radius)] p-2 text-text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:shadow-[var(--ring)]"
                  [attr.aria-label]="t().usuarios.equipoCancelar" (click)="closeChangeTeam()">
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div class="mt-5 space-y-4">
          <ui-field [label]="t().usuarios.equipo">
            <select #teamSelect uiSelect name="selectedTeam" [(ngModel)]="selectedTeam" class="w-full">
              @for (team of teamOptions; track team) {
                <option [value]="team">{{ team }}</option>
              }
            </select>
          </ui-field>
          @if (teamError()) {
            <p class="text-sm text-danger" role="alert">{{ teamError() }}</p>
          }
        </div>

        <div class="mt-6 flex justify-end gap-2 border-t border-border pt-4">
          <button uiButton type="button" variant="secondary" [disabled]="teamBusy()" (click)="closeChangeTeam()">
            {{ t().usuarios.equipoCancelar }}
          </button>
          <button uiButton type="submit" [disabled]="teamBusy()">
            {{ t().usuarios.equipoGuardar }}
          </button>
        </div>
      </form>
    </dialog>

    <!-- Dialog: Confirmar Baja (Borrado Lógico) -->
    <dialog #deactivateDialog
            class="m-auto w-[calc(100%-2rem)] max-w-md rounded-[var(--radius-lg)] border border-border bg-surface p-0 text-text shadow-[var(--shadow-lg)]"
            aria-labelledby="deactivate-dialog-title" (close)="onDeactivateDialogClosed()">
      <div class="p-5 sm:p-6">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 id="deactivate-dialog-title" class="text-lg font-semibold tracking-tight text-danger">
              {{ t().usuarios.darDeBajaTitulo }}
            </h2>
            <p class="mt-1 text-sm text-text-muted">
              {{ deactivateTarget()?.name }} · {{ deactivateTarget()?.username }}
            </p>
          </div>
          <button type="button" class="cursor-pointer rounded-[var(--radius)] p-2 text-text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:shadow-[var(--ring)]"
                  [attr.aria-label]="t().usuarios.darDeBajaCancelar" (click)="closeDeactivate()">
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <p class="mt-4 text-sm text-text-muted">
          {{ t().usuarios.darDeBajaMensaje }}
        </p>

        @if (deactivateError()) {
          <p class="mt-3 text-sm text-danger" role="alert">{{ deactivateError() }}</p>
        }

        <div class="mt-6 flex justify-end gap-2 border-t border-border pt-4">
          <button uiButton type="button" variant="secondary" [disabled]="deactivateBusy()" (click)="closeDeactivate()">
            {{ t().usuarios.darDeBajaCancelar }}
          </button>
          <button uiButton type="button" class="bg-danger text-white hover:bg-danger/90" [disabled]="deactivateBusy()"
                  (click)="confirmDeactivate()">
            {{ t().usuarios.darDeBajaConfirmar }}
          </button>
        </div>
      </div>
    </dialog>
  `,
})
export class AdminUsers {
  private api = inject(Api);
  private i18n = inject(I18n);
  auth = inject(AuthService);
  t = this.i18n.t;

  readonly teamOptions = TEAM_OPTIONS;

  @ViewChild('resetDialog') private resetDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('temporaryPasswordInput') private temporaryPasswordInput?: ElementRef<HTMLInputElement>;
  @ViewChild('teamDialog') private teamDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('teamSelect') private teamSelect?: ElementRef<HTMLSelectElement>;
  @ViewChild('deactivateDialog') private deactivateDialog?: ElementRef<HTMLDialogElement>;

  pending = signal<AdminUser[]>([]);
  active = signal<AdminUser[]>([]);
  inactive = signal<AdminUser[]>([]);

  statusFilter = signal<'active' | 'inactive' | 'all'>('active');

  filteredUsers = computed(() => {
    const f = this.statusFilter();
    if (f === 'active') return this.active();
    if (f === 'inactive') return this.inactive();
    return [...this.active(), ...this.inactive()];
  });

  actionSuccess = signal<string | null>(null);
  actionError = signal<string | null>(null);

  // Password reset state
  resetTarget = signal<AdminUser | null>(null);
  resetBusy = signal(false);
  resetFieldError = signal<string | null>(null);
  resetServerError = signal<string | null>(null);
  temporaryPassword = '';
  temporaryPasswordConfirmation = '';
  private resetTrigger?: HTMLElement;

  // Team change state
  teamTarget = signal<AdminUser | null>(null);
  selectedTeam: Team | '' = '';
  teamBusy = signal(false);
  teamError = signal<string | null>(null);
  private teamTrigger?: HTMLElement;

  // Deactivate state
  deactivateTarget = signal<AdminUser | null>(null);
  deactivateBusy = signal(false);
  deactivateError = signal<string | null>(null);
  private deactivateTrigger?: HTMLElement;

  constructor() {
    this.load();
  }

  private load(): void {
    firstValueFrom(
      this.api.get<{ pending: AdminUser[]; active: AdminUser[]; inactive: AdminUser[] }>('/admin/users'),
    ).then((r) => {
      this.pending.set(r.pending);
      this.active.set(r.active);
      this.inactive.set(r.inactive ?? []);
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

  // --- Reset Password ---
  openReset(user: AdminUser, event: Event): void {
    this.resetTrigger = event.currentTarget as HTMLElement;
    this.resetTarget.set(user);
    this.actionSuccess.set(null);
    this.actionError.set(null);
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

  onResetDialogClosed(): void {
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
      this.actionSuccess.set(this.t().usuarios.restablecerOk);
      this.load();
    } catch (error: unknown) {
      this.resetServerError.set(apiError(error, this.t().usuarios.restablecerError));
    } finally {
      this.resetBusy.set(false);
    }
  }

  // --- Change Team ---
  openChangeTeam(user: AdminUser, event: Event): void {
    this.teamTrigger = event.currentTarget as HTMLElement;
    this.teamTarget.set(user);
    this.selectedTeam = (user.team ?? this.teamOptions[0]) as Team;
    this.actionSuccess.set(null);
    this.actionError.set(null);
    this.teamError.set(null);
    this.teamDialog?.nativeElement.showModal();
    queueMicrotask(() => this.teamSelect?.nativeElement.focus());
  }

  closeChangeTeam(): void {
    this.teamDialog?.nativeElement.close();
  }

  onTeamDialogClosed(): void {
    this.teamTarget.set(null);
    this.teamError.set(null);
    this.teamTrigger?.focus();
    this.teamTrigger = undefined;
  }

  async submitTeam(): Promise<void> {
    const target = this.teamTarget();
    if (!target || !this.selectedTeam) return;
    this.teamBusy.set(true);
    this.teamError.set(null);
    try {
      await firstValueFrom(
        this.api.patch(`/admin/users/${target.id}/team`, { team: this.selectedTeam }),
      );
      this.closeChangeTeam();
      this.actionSuccess.set(this.t().usuarios.equipoOk);
      this.load();
    } catch (error: unknown) {
      this.teamError.set(apiError(error, this.t().usuarios.equipoError));
    } finally {
      this.teamBusy.set(false);
    }
  }

  // --- Deactivate (Soft Delete) ---
  openDeactivate(user: AdminUser, event: Event): void {
    this.deactivateTrigger = event.currentTarget as HTMLElement;
    this.deactivateTarget.set(user);
    this.actionSuccess.set(null);
    this.actionError.set(null);
    this.deactivateError.set(null);
    this.deactivateDialog?.nativeElement.showModal();
  }

  closeDeactivate(): void {
    this.deactivateDialog?.nativeElement.close();
  }

  onDeactivateDialogClosed(): void {
    this.deactivateTarget.set(null);
    this.deactivateError.set(null);
    this.deactivateTrigger?.focus();
    this.deactivateTrigger = undefined;
  }

  async confirmDeactivate(): Promise<void> {
    const target = this.deactivateTarget();
    if (!target) return;
    this.deactivateBusy.set(true);
    this.deactivateError.set(null);
    try {
      await firstValueFrom(this.api.post(`/admin/users/${target.id}/deactivate`));
      this.closeDeactivate();
      this.actionSuccess.set(this.t().usuarios.darDeBajaOk);
      this.load();
    } catch (error: unknown) {
      this.deactivateError.set(apiError(error, this.t().usuarios.darDeBajaError));
    } finally {
      this.deactivateBusy.set(false);
    }
  }

  // --- Reactivate ---
  async reactivate(user: AdminUser): Promise<void> {
    this.actionSuccess.set(null);
    this.actionError.set(null);
    try {
      await firstValueFrom(this.api.post(`/admin/users/${user.id}/reactivate`));
      this.actionSuccess.set(this.t().usuarios.reactivarOk);
      this.load();
    } catch (error: unknown) {
      this.actionError.set(apiError(error, this.t().usuarios.reactivarError));
    }
  }
}

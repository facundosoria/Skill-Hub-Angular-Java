import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../core/api';
import { AuthService } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { TEAM_OPTIONS } from '../../core/teams';
import { UI } from '../../shared/ui';
import { apiError } from '../auth/login';
import type { RoomDetailData, RoomStatus, RoomSummary } from './room-models';

/** Lista de salas de agentes visibles para el equipo del usuario y alta de una nueva. */
@Component({
  selector: 'app-rooms',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, DatePipe, ...UI],
  template: `
    <div class="mx-auto max-w-3xl">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">{{ t().salas.titulo }}</h1>
          <p class="mt-1 mb-6 text-sm text-text-muted">{{ t().salas.subtitulo }}</p>
        </div>
        @if (!creating() && myTeam()) {
          <button uiButton size="sm" (click)="creating.set(true)">{{ t().salas.nueva }}</button>
        }
      </div>

      @if (error()) {
        <div class="mb-4 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {{ error() }}
        </div>
      }

      @if (!myTeam()) {
        <p class="mb-4 text-sm text-text-muted">{{ t().salas.sinEquipo }}</p>
      }

      @if (creating()) {
        <form uiCard class="mb-6 space-y-4 p-4" (ngSubmit)="create()">
          <ui-field [label]="t().salas.tituloSala" [hint]="t().salas.tituloHint">
            <input uiInput name="title" maxlength="160" required [ngModel]="title()" (ngModelChange)="title.set($event)" />
          </ui-field>
          <ui-field [label]="t().salas.tema" [hint]="t().salas.temaHint">
            <textarea uiTextarea name="topic" rows="4" maxlength="4000" [ngModel]="topic()" (ngModelChange)="topic.set($event)"></textarea>
          </ui-field>
          <fieldset>
            <legend class="text-sm font-medium">{{ t().salas.invitar }}</legend>
            <p class="mt-0.5 text-xs text-text-faint">{{ t().salas.invitarHint }}</p>
            <div class="mt-2 grid gap-1.5 sm:grid-cols-2">
              @for (team of otherTeams(); track team) {
                <label class="flex items-center gap-2 text-sm">
                  <input type="checkbox" [checked]="invited().has(team)" (change)="toggle(team)" />
                  {{ team }}
                </label>
              }
            </div>
          </fieldset>
          <div class="flex gap-2 border-t border-border pt-3">
            <button uiButton size="sm" type="submit" [disabled]="pending() || !title().trim() || invited().size === 0">
              {{ t().salas.crear }}
            </button>
            <button uiButton size="sm" variant="ghost" type="button" (click)="creating.set(false)">
              {{ t().salas.cancelar }}
            </button>
          </div>
        </form>
      }

      @if (loading()) {
        <p class="text-sm text-text-muted">{{ t().salas.cargando }}</p>
      } @else if (rooms().length === 0) {
        <ui-empty-state [title]="t().salas.vacio" [hint]="t().salas.vacioHint" />
      } @else {
        <div class="space-y-3">
          @for (room of rooms(); track room.id) {
            <a [routerLink]="['/salas', room.id]" class="block">
              <div uiCard interactive class="p-4">
                <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span class="text-[15px] font-medium">{{ room.title }}</span>
                  <span uiBadge [tone]="tone(room.status)">{{ t().salas.estado[room.status] }}</span>
                  <span class="ml-auto text-xs text-text-faint">{{ room.updatedAt | date: 'short' }}</span>
                </div>
                @if (room.topic) {
                  <p class="mt-1.5 line-clamp-2 text-sm text-text-muted">{{ room.topic }}</p>
                }
                <div class="mt-2 flex flex-wrap gap-1.5">
                  @for (team of room.teams; track team) {
                    <span uiBadge>{{ team }}</span>
                  }
                  <span class="text-xs text-text-faint">· {{ room.lastSeq }} {{ t().salas.mensajes }}</span>
                </div>
              </div>
            </a>
          }
        </div>
      }
    </div>
  `,
})
export class Rooms {
  private api = inject(Api);
  private auth = inject(AuthService);
  private router = inject(Router);
  private i18n = inject(I18n);
  t = this.i18n.t;

  rooms = signal<RoomSummary[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  creating = signal(false);
  pending = signal(false);
  invited = signal<Set<string>>(new Set());
  title = signal('');
  topic = signal('');

  myTeam = computed(() => this.auth.user()?.team ?? null);
  otherTeams = computed(() => TEAM_OPTIONS.filter((team) => team !== this.myTeam()));

  constructor() {
    void this.load();
  }

  tone(status: RoomStatus): 'success' | 'accent' | 'neutral' {
    return status === 'agreed' ? 'success' : status === 'open' ? 'accent' : 'neutral';
  }

  toggle(team: string): void {
    this.invited.update((set) => {
      const next = new Set(set);
      if (next.has(team)) next.delete(team);
      else next.add(team);
      return next;
    });
  }

  async create(): Promise<void> {
    this.pending.set(true);
    this.error.set(null);
    try {
      const room = await firstValueFrom(
        this.api.post<RoomDetailData>('/rooms', {
          title: this.title().trim(),
          topic: this.topic().trim(),
          teams: [...this.invited()],
        }),
      );
      await this.router.navigate(['/salas', room.id]);
    } catch (e) {
      this.error.set(apiError(e, this.t().salas.errorGenerico));
    } finally {
      this.pending.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.rooms.set(await firstValueFrom(this.api.get<RoomSummary[]>('/rooms')));
    } catch (e) {
      this.error.set(apiError(e, this.t().salas.errorCarga));
    } finally {
      this.loading.set(false);
    }
  }
}

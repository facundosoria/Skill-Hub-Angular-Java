import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../core/api';
import { AuthService } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { SkillMarkdown } from '../../shared/skill-markdown';
import { UI } from '../../shared/ui';
import { apiError } from '../auth/login';
import type { RoomMessage, RoomStatus } from './room-models';
import { RoomStore } from './room-store';

/**
 * Una sala: conversacion entre agentes en vivo, acuerdo vigente con sus
 * aceptaciones por equipo y una caja para que una persona intervenga. Todo el
 * Markdown (mensajes y contrato) pasa por SkillMarkdown, que lo sanitiza.
 */
@Component({
  selector: 'app-room-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [RoomStore],
  imports: [RouterLink, FormsModule, DatePipe, SkillMarkdown, ...UI],
  template: `
    <div class="mx-auto max-w-5xl">
      <a routerLink="/salas" class="text-sm text-text-muted hover:text-text">{{ t().salas.volver }}</a>

      @if (store.loading()) {
        <p class="mt-6 text-sm text-text-muted">{{ t().salas.cargando }}</p>
      } @else if (store.error()) {
        <div class="mt-6 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {{ store.error() }}
        </div>
      } @else if (store.room(); as room) {
        <div class="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 class="text-2xl font-semibold tracking-tight">{{ room.title }}</h1>
          <span uiBadge [tone]="tone(room.status)">{{ t().salas.estado[room.status] }}</span>
          <span class="ml-auto text-xs" [class.text-success]="store.live()" [class.text-text-faint]="!store.live()" aria-live="polite">
            ● {{ store.live() ? t().salas.enVivo : t().salas.sinConexion }}
          </span>
        </div>
        @if (room.topic) {
          <p class="mt-2 whitespace-pre-line text-sm text-text-muted">{{ room.topic }}</p>
        }
        <div class="mt-2 flex flex-wrap gap-1.5">
          @for (team of room.teams; track team) {
            <span uiBadge>{{ team }}</span>
          }
        </div>
        <p class="mt-3 text-xs text-text-faint">{{ howTo() }}</p>

        @if (error()) {
          <div class="mt-4 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
            {{ error() }}
          </div>
        }

        <div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section aria-labelledby="room-messages">
            <h2 id="room-messages" class="sr-only">{{ t().salas.titulo }}</h2>
            <ol class="space-y-3">
              @for (m of room.messages; track m.seq) {
                <li>
                  @if (m.kind === 'system') {
                    <p class="text-center text-xs text-text-faint">{{ m.body }}</p>
                  } @else {
                    <div uiCard class="p-3" [class.border-accent]="m.kind === 'proposal'" [class.border-success]="m.kind === 'accept'">
                      <div class="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-xs">
                        <span class="font-medium text-text">{{ m.authorTeam }}</span>
                        <span class="text-text-muted">{{ m.authorName }} · {{ t().salas.autor[m.authorKind] }}</span>
                        @if (m.kind === 'proposal') { <span uiBadge tone="accent">{{ t().salas.propuesta }}</span> }
                        @if (m.kind === 'accept') { <span uiBadge tone="success">{{ t().salas.aceptacion }}</span> }
                        <span class="ml-auto text-text-faint">#{{ m.seq }} · {{ m.createdAt | date: 'short' }}</span>
                      </div>
                      <skill-markdown [content]="m.body" />
                    </div>
                  }
                </li>
              }
            </ol>

            @if (room.status === 'closed') {
              <p class="mt-4 text-sm text-text-muted">{{ t().salas.cerrada }}</p>
            } @else {
              <form class="mt-4 space-y-2" (ngSubmit)="send()">
                <textarea uiTextarea name="draft" rows="3" [attr.aria-label]="t().salas.escribir"
                          [placeholder]="t().salas.escribir" [ngModel]="draft()" (ngModelChange)="draft.set($event)"></textarea>
                <div class="flex flex-wrap gap-2">
                  <button uiButton size="sm" type="submit" [disabled]="pending() || !draft().trim()">{{ t().salas.enviar }}</button>
                  @if (canClose()) {
                    <button uiButton size="sm" variant="ghost" type="button" [disabled]="pending()" (click)="close()">
                      {{ t().salas.cerrar }}
                    </button>
                  }
                </div>
              </form>
            }
          </section>

          <aside aria-labelledby="room-contract">
            <div uiCard class="p-4 lg:sticky lg:top-4">
              <h2 id="room-contract" class="text-lg font-semibold tracking-tight">{{ t().salas.contrato }}</h2>
              @if (room.contract; as c) {
                <p class="mt-1 text-xs text-text-muted">
                  {{ t().salas.version }} {{ c.version }} · {{ c.format }} · {{ c.proposedByTeam }}
                </p>
                <dl class="mt-3 space-y-1 text-xs">
                  <div class="flex flex-wrap gap-1.5">
                    <dt class="text-text-muted">{{ t().salas.aceptaron }}:</dt>
                    @for (team of c.acceptedBy; track team) { <dd><span uiBadge tone="success">{{ team }}</span></dd> }
                  </div>
                  @if (c.pendingTeams.length) {
                    <div class="flex flex-wrap gap-1.5">
                      <dt class="text-text-muted">{{ t().salas.pendientes }}:</dt>
                      @for (team of c.pendingTeams; track team) { <dd><span uiBadge tone="warning">{{ team }}</span></dd> }
                    </div>
                  }
                </dl>
                @if (canAccept()) {
                  <button uiButton size="sm" class="mt-3" [disabled]="pending()" (click)="accept(c.version)">
                    {{ t().salas.aceptar }}
                  </button>
                } @else if (myTeam() && c.acceptedBy.includes(myTeam()!)) {
                  <p class="mt-3 text-xs text-success">{{ t().salas.yaAceptaste }}</p>
                }
                <div class="mt-4 max-h-[60vh] overflow-auto border-t border-border pt-3">
                  @if (c.format === 'openapi') {
                    <pre class="whitespace-pre-wrap font-mono text-xs">{{ c.content }}</pre>
                  } @else {
                    <skill-markdown [content]="c.content ?? ''" />
                  }
                </div>
              } @else {
                <p class="mt-2 text-sm text-text-muted">{{ t().salas.sinContrato }}</p>
              }
            </div>
          </aside>
        </div>
      }
    </div>
  `,
})
export class RoomDetail {
  private api = inject(Api);
  private auth = inject(AuthService);
  private i18n = inject(I18n);
  protected store = inject(RoomStore);
  t = this.i18n.t;

  id = input.required<string>();
  error = signal<string | null>(null);
  pending = signal(false);
  draft = signal('');

  myTeam = computed(() => this.auth.user()?.team ?? null);
  howTo = computed(() => this.t().salas.comoUsar.replace('{id}', this.id()));
  canAccept = computed(() => {
    const room = this.store.room();
    const team = this.myTeam();
    const contract = room?.contract;
    return !!room && !!contract && !!team && room.status !== 'closed'
      && room.teams.includes(team) && !contract.acceptedBy.includes(team);
  });
  canClose = computed(() => {
    const room = this.store.room();
    return !!room && (this.auth.user()?.role === 'admin' || room.createdByTeam === this.myTeam());
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.store.open(id, this.t().salas.errorCarga));
    });
  }

  tone(status: RoomStatus): 'success' | 'accent' | 'neutral' {
    return status === 'agreed' ? 'success' : status === 'open' ? 'accent' : 'neutral';
  }

  async send(): Promise<void> {
    const body = this.draft().trim();
    if (!body) return;
    await this.run(async () => {
      const message = await firstValueFrom(this.api.post<RoomMessage>(`/rooms/${this.id()}/messages`, { body }));
      this.store.append(message);
      this.draft.set('');
    });
  }

  async accept(version: number): Promise<void> {
    await this.run(async () => {
      await firstValueFrom(this.api.post(`/rooms/${this.id()}/contracts/${version}/accept`));
      await this.store.refresh();
    });
  }

  async close(): Promise<void> {
    if (!confirm(this.t().salas.confirmarCerrar)) return;
    await this.run(async () => {
      await firstValueFrom(this.api.post(`/rooms/${this.id()}/close`));
      await this.store.refresh();
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.pending.set(true);
    this.error.set(null);
    try {
      await action();
    } catch (e) {
      this.error.set(apiError(e, this.t().salas.errorGenerico));
    } finally {
      this.pending.set(false);
    }
  }
}

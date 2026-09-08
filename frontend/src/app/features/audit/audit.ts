import { SlicePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import type { AuditEvent } from '../../core/models';
import { UI } from '../../shared/ui';
import { AnimDelayPipe } from '../../shared/anim-delay.pipe';

/** Puerto (parcial) de src/app/(app)/audit/page.tsx + audit-list.tsx. */
@Component({
  selector: 'app-audit',
  imports: [RouterLink, SlicePipe, AnimDelayPipe, ...UI],
  template: `
    <h1 class="text-xl font-medium">{{ t().audit.titulo }}</h1>
    <p class="mt-1 mb-5 text-sm text-text-muted">{{ t().audit.subtitulo }}</p>

    @if (events().length === 0) {
      <ui-empty-state [title]="t().audit.sinEventos" />
    } @else {
      <div uiCard class="divide-y divide-border">
        @for (e of events(); track e.id; let i = $index) {
          <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-3"
               animate.enter="anim-row-in" [style.animationDelay]="i | animDelay">
            <span class="text-sm font-medium">{{ e.actorName || snap(e)?.name || t().audit.sistema }}</span>
            @if (e.actorTeam) { <span class="text-xs text-text-faint">{{ e.actorTeam }}</span> }
            <span uiBadge [tone]="tone(e.action)">{{ label(e.action) }}</span>
            @if (slug(e); as s) {
              <a [routerLink]="['/skills', s]" class="font-mono text-[13px] text-accent hover:underline">{{ s }}</a>
            }
            <span class="ml-auto text-xs text-text-faint">{{ e.createdAt | slice: 0 : 16 }}</span>
          </div>
        }
      </div>
      <p class="mt-3 text-xs text-text-faint">{{ t().audit.mostrando }} {{ events().length }} {{ t().audit.masRecientes }}</p>
    }
  `,
})
export class Audit {
  private api = inject(Api);
  private i18n = inject(I18n);
  t = this.i18n.t;
  events = signal<AuditEvent[]>([]);

  private tones: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'accent'> = {
    'skill.published': 'success',
    'skill.approved': 'success',
    'skill.deprecated': 'warning',
    'skill.rejected': 'warning',
    'apikey.revoked': 'warning',
    'skill.duplicate_forced': 'danger',
    'skill.proposed': 'accent',
  };

  constructor() {
    firstValueFrom(this.api.get<{ events: AuditEvent[] }>('/audit')).then((r) => this.events.set(r.events));
  }

  tone(action: string): 'success' | 'warning' | 'danger' | 'neutral' | 'accent' {
    return this.tones[action] ?? 'neutral';
  }
  label(action: string): string {
    return (this.t().acciones as Record<string, string>)[action] ?? action;
  }
  snap(e: AuditEvent): { name: string } | null {
    try {
      return e.actorSnapshot ? JSON.parse(e.actorSnapshot) : null;
    } catch {
      return null;
    }
  }
  slug(e: AuditEvent): string | null {
    try {
      const m = e.metadata ? JSON.parse(e.metadata) : {};
      return typeof m.slug === 'string' ? m.slug : null;
    } catch {
      return null;
    }
  }
}

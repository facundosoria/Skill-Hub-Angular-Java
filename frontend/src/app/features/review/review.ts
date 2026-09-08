import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import type { Proposal, RevisionProposal } from '../../core/models';
import { UI } from '../../shared/ui';

/** Puerto de src/app/(app)/review/page.tsx + review-actions.tsx. */
@Component({
  selector: 'app-review',
  imports: [RouterLink, ...UI],
  template: `
    <div class="max-w-3xl">
      <h1 class="text-2xl font-semibold tracking-tight">{{ t().review.titulo }}</h1>
      <p class="mt-1 mb-6 text-sm text-text-muted">{{ t().review.subtitulo }}</p>

      @if (proposals().length === 0) {
        <ui-empty-state [title]="t().review.vacio" [hint]="t().review.vacioHint" />
      } @else {
        <div class="space-y-3">
          @for (p of proposals(); track p.slug) {
            <div uiCard class="p-4">
              <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <a [routerLink]="['/skills', p.slug]" class="text-[15px] font-medium hover:underline">{{ p.title }}</a>
                <span uiBadge tone="accent">{{ p.stack }}</span>
                <span uiBadge tone="warning">{{ t().review.provisional }}</span>
                @if (p.usos > 0) {
                  <span class="ml-auto text-xs text-text-faint">{{ t().review.yaSeguida }} {{ p.usos }}×</span>
                }
              </div>
              <p class="mt-1.5 text-sm text-text-muted">{{ p.description }}</p>
              @if (p.proposedFromQuery) {
                <p class="mt-2 text-xs text-text-faint">{{ t().review.nacioDe }} <span class="font-mono">"{{ p.proposedFromQuery }}"</span></p>
              }
              @if (p.changelog) { <p class="mt-1 text-xs text-warning">{{ p.changelog }}</p> }
              <div class="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <button uiButton size="sm" (click)="approve(p.slug)">{{ t().review.aprobar }}</button>
                <a [routerLink]="['/skills', p.slug, 'edit']">
                  <button uiButton size="sm" variant="secondary">{{ t().review.corregir }}</button>
                </a>
                <button uiButton size="sm" variant="ghost" (click)="reject(p.slug)">{{ t().review.rechazar }}</button>
              </div>
            </div>
          }
        </div>
      }

      @if (revisions().length > 0) {
        <h2 class="mt-10 text-lg font-semibold tracking-tight">{{ t().review.revisionesTitulo }}</h2>
        <p class="mt-1 mb-4 text-sm text-text-muted">{{ t().review.revisionesSubtitulo }}</p>
        <div class="space-y-3">
          @for (r of revisions(); track r.slug) {
            <div uiCard class="p-4">
              <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <a [routerLink]="['/skills', r.slug]" class="text-[15px] font-medium hover:underline">{{ r.title }}</a>
                <span uiBadge tone="accent">{{ r.stack }}</span>
                <span uiBadge tone="warning">{{ t().review.reviseAgente }}</span>
                <span class="text-xs text-text-faint">{{ t().review.baseVersion }}{{ r.currentVersion }} → v{{ r.proposedVersion }}</span>
                @if (r.usos > 0) {
                  <span class="ml-auto text-xs text-text-faint">{{ t().review.yaSeguida }} {{ r.usos }}×</span>
                }
              </div>
              @if (r.changelog) { <p class="mt-1.5 text-xs text-warning">{{ r.changelog }}</p> }
              <div class="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <a
                  [routerLink]="['/skills', r.slug, 'diff']"
                  [queryParams]="{ a: r.currentVersion, b: r.proposedVersion }"
                >
                  <button uiButton size="sm" variant="secondary">{{ t().review.verDiff }}</button>
                </a>
                <button uiButton size="sm" (click)="approve(r.slug)">{{ t().review.aceptarRevision }}</button>
                <button uiButton size="sm" variant="ghost" (click)="rejectRevision(r.slug)">
                  {{ t().review.descartarRevision }}
                </button>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class Review {
  private api = inject(Api);
  private i18n = inject(I18n);
  t = this.i18n.t;
  proposals = signal<Proposal[]>([]);
  revisions = signal<RevisionProposal[]>([]);

  constructor() {
    this.load();
  }

  private load(): void {
    firstValueFrom(
      this.api.get<{ proposals: Proposal[]; revisions: RevisionProposal[] }>('/review'),
    ).then((r) => {
      this.proposals.set(r.proposals);
      this.revisions.set(r.revisions ?? []);
    });
  }

  async approve(slug: string): Promise<void> {
    await firstValueFrom(this.api.post(`/review/${slug}/approve`));
    this.load();
  }

  async reject(slug: string): Promise<void> {
    const motivo = prompt(this.t().review.porQueNoSirve) ?? '';
    if (motivo.trim().length < 3) return;
    await firstValueFrom(this.api.post(`/review/${slug}/reject`, { motivo: motivo.trim() }));
    this.load();
  }

  async rejectRevision(slug: string): Promise<void> {
    const motivo = prompt(this.t().review.porQueDescartar) ?? '';
    if (motivo.trim().length < 3) return;
    await firstValueFrom(this.api.post(`/review/${slug}/reject`, { motivo: motivo.trim() }));
    this.load();
  }
}

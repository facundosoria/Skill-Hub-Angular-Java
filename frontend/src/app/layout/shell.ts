import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { AuthService } from '../core/auth';
import { I18n } from '../core/i18n/i18n';

/**
 * Puerto de src/app/(app)/layout.tsx: la barra de navegacion y el <router-outlet>
 * para todo lo que va detras de login.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  styles: `
    .logout-fade {
      position: fixed;
      z-index: 100;
      inset: 0;
      visibility: hidden;
      pointer-events: none;
      background: #000;
      opacity: 0;
      transition: opacity 360ms var(--ease), visibility 0s linear 360ms;
    }

    .logout-fade--active {
      visibility: visible;
      opacity: 1;
      transition-delay: 0s;
    }

    @media (prefers-reduced-motion: reduce) {
      .logout-fade { transition: none; }
    }
  `,
  template: `
    <div class="logout-fade" [class.logout-fade--active]="loggingOut()" aria-hidden="true"></div>
    <div class="mx-auto flex min-h-screen max-w-6xl flex-col px-4 sm:px-6">
      <header
        class="relative sticky top-0 z-30 -mx-4 flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3.5 sm:-mx-6 sm:px-6"
      >
        <div aria-hidden="true"
             class="pointer-events-none absolute inset-y-0 left-1/2 -z-10 w-screen -translate-x-1/2 border-b border-border bg-bg/75 backdrop-blur-md"></div>
        <a routerLink="/" class="text-base font-semibold tracking-tight">
          <span class="bg-gradient-to-r from-accent to-text bg-clip-text text-transparent">Skill Hub</span>
        </a>
        <nav class="flex flex-wrap items-center gap-x-1 gap-y-1 text-[13px]" aria-label="Navegación principal">
          <div class="relative" data-catalog-menu>
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-text-muted transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:shadow-[var(--ring)]"
              [class.bg-surface-2]="catalogOpen()"
              [class.text-text]="catalogOpen()"
              [attr.aria-expanded]="catalogOpen()"
              aria-haspopup="menu"
              aria-controls="catalog-menu"
              (click)="toggleCatalog()"
              (keydown.escape)="closeCatalog()"
            >
              {{ t().nav.catalogo }}
            </button>
            @if (catalogOpen()) {
              <div id="catalog-menu" role="menu"
                   class="absolute left-0 top-full z-40 mt-2 min-w-40 rounded-[var(--radius)] border border-border bg-surface p-1 shadow-[var(--shadow)]">
                @for (item of catalogLinks(); track item.path) {
                  <a [routerLink]="item.path" role="menuitem"
                     class="block rounded-[calc(var(--radius)-2px)] px-3 py-2 text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:shadow-[var(--ring)]"
                     (click)="closeCatalog()">{{ item.label }}</a>
                }
              </div>
            }
          </div>
          @for (l of navLinks(); track l.path) {
            <a
              [routerLink]="l.path"
              routerLinkActive="bg-surface-2 text-text shadow-[var(--shadow-sm)]"
              class="rounded-full px-3 py-1.5 text-text-muted transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-text"
              >{{ l.label }}</a
            >
          }
        </nav>
        <div class="ml-auto flex items-center gap-1 text-[13px]">
          <a
            routerLink="/profile"
            routerLinkActive="bg-surface-2 text-text"
            class="rounded-full px-3 py-1.5 text-text-muted transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-text"
            >{{ user()?.name }}</a
          >
          <button
            (click)="logout()"
            [disabled]="loggingOut()"
            class="cursor-pointer rounded-full px-3 py-1.5 text-text-muted transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-text disabled:cursor-default disabled:opacity-60"
          >
            {{ t().nav.salir }}
          </button>
        </div>
      </header>

      <main class="flex-1 py-10 anim-rise-in">
        <router-outlet />
      </main>
    </div>
  `,
})
export class Shell {
  private auth = inject(AuthService);
  private router = inject(Router);
  private i18n = inject(I18n);
  private destroyRef = inject(DestroyRef);

  user = this.auth.user;
  t = this.i18n.t;
  isAdmin = computed(() => this.auth.user()?.role === 'admin');
  catalogOpen = signal(false);
  loggingOut = signal(false);

  catalogLinks = computed(() => {
    const n = this.t().nav;
    return [
      { path: '/skills', label: n.skills },
      { path: '/plugins', label: n.plugins },
      { path: '/contracts', label: n.contratos },
    ];
  });

  navLinks = computed(() => {
    const n = this.t().nav;
    const base = [
      { path: '/keys', label: n.miKey },
      { path: '/docs', label: n.comoFunciona },
    ];
    if (!this.isAdmin()) return base;
    return [
      ...base,
      { path: '/review', label: n.revisar },
      { path: '/insights', label: n.uso },
      { path: '/audit', label: n.auditoria },
      { path: '/admin/users', label: n.usuarios },
    ];
  });

  constructor() {
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && !target.closest('[data-catalog-menu]')) this.closeCatalog();
    };
    document.addEventListener('click', closeOnOutsideClick);
    this.destroyRef.onDestroy(() => document.removeEventListener('click', closeOnOutsideClick));
  }

  toggleCatalog(): void {
    this.catalogOpen.update((open) => !open);
  }

  closeCatalog(): void {
    this.catalogOpen.set(false);
  }

  async logout(): Promise<void> {
    if (this.loggingOut()) return;
    await this.auth.logout();
    this.loggingOut.set(true);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reducedMotion) await new Promise(resolve => setTimeout(resolve, 360));
    this.router.navigate(['/login']);
  }
}

import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
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
              class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-text-muted transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:shadow-[var(--ring)] cursor-pointer select-none"
              [class.bg-surface-2]="catalogOpen() || isCatalogActive()"
              [class.text-text]="catalogOpen() || isCatalogActive()"
              [class.shadow-[var(--shadow-sm)]]="isCatalogActive()"
              [attr.aria-expanded]="catalogOpen()"
              aria-haspopup="menu"
              aria-controls="catalog-menu"
              (click)="toggleCatalog()"
              (keydown.escape)="closeCatalog()"
            >
              @switch (activeSection()) {
                @case ('skills') {
                  <svg class="w-4 h-4 text-accent stroke-[1.9] flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
                  </svg>
                }
                @case ('plugins') {
                  <svg class="w-4 h-4 text-accent stroke-[1.9] flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 0 1-.657.643 48.39 48.39 0 0 1-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 0 1-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 0 0-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 0 1-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 0 0 .657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 0 1-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 0 0 5.427-.63 48.05 48.05 0 0 0 .582-4.717.532.532 0 0 0-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 0 0 .658-.663 48.422 48.422 0 0 0-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 0 1-.61-.58v0Z" />
                  </svg>
                }
                @case ('contracts') {
                  <svg class="w-4 h-4 text-accent stroke-[1.9] flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                }
                @default {
                  <svg class="w-4 h-4 text-accent stroke-[1.9] flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
                  </svg>
                }
              }
              <span>{{ t().nav.catalogo }}</span>
              <svg
                class="w-3.5 h-3.5 transition-transform duration-[var(--dur-fast)] text-text-muted opacity-80"
                [class.rotate-180]="catalogOpen()"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
              </svg>
            </button>
            @if (catalogOpen()) {
              <div id="catalog-menu" role="menu"
                   class="absolute left-0 top-full z-40 mt-2 w-80 rounded-[var(--radius-lg)] border border-border-strong bg-surface p-1.5 shadow-[var(--shadow-lg)]">
                <div class="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wider text-text-faint uppercase" aria-hidden="true">
                  {{ t().nav.recursosCanonicos }}
                </div>
                @for (item of catalogItems(); track item.path) {
                  <a [routerLink]="item.path" role="menuitem"
                     class="flex items-center gap-3 rounded-[calc(var(--radius)-2px)] p-2 text-text transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:shadow-[var(--ring)]"
                     [class.bg-accent-soft]="activeSection() === item.section"
                     (click)="closeCatalog()">
                    <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-accent"
                         [class.border-accent]="activeSection() === item.section"
                         [class.bg-surface]="activeSection() === item.section">
                      @switch (item.section) {
                        @case ('skills') {
                          <svg class="w-4 h-4 stroke-[1.9]" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
                          </svg>
                        }
                        @case ('plugins') {
                          <svg class="w-4 h-4 stroke-[1.9]" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 0 1-.657.643 48.39 48.39 0 0 1-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 0 1-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 0 0-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 0 1-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 0 0 .657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 0 1-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 0 0 5.427-.63 48.05 48.05 0 0 0 .582-4.717.532.532 0 0 0-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 0 0 .658-.663 48.422 48.422 0 0 0-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 0 1-.61-.58v0Z" />
                          </svg>
                        }
                        @case ('contracts') {
                          <svg class="w-4 h-4 stroke-[1.9]" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                          </svg>
                        }
                      }
                    </div>
                    <div class="flex flex-1 flex-col">
                      <span class="text-xs font-semibold leading-tight text-text">{{ item.label }}</span>
                      <span class="text-[11px] leading-snug text-text-muted">{{ item.desc }}</span>
                    </div>
                    @if (activeSection() === item.section) {
                      <svg class="h-4 w-4 flex-shrink-0 text-accent" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                      </svg>
                    }
                  </a>
                }
              </div>
            }
          </div>
          <span class="mx-1 h-3.5 w-px bg-border-strong/60" aria-hidden="true"></span>
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

  currentUrl = signal(this.router.url);

  activeSection = computed<'skills' | 'plugins' | 'contracts' | null>(() => {
    const url = this.currentUrl();
    if (url.startsWith('/skills')) return 'skills';
    if (url.startsWith('/plugins')) return 'plugins';
    if (url.startsWith('/contracts')) return 'contracts';
    return null;
  });

  isCatalogActive = computed(() => this.activeSection() !== null);

  catalogItems = computed(() => {
    const n = this.t().nav;
    return [
      {
        path: '/skills',
        section: 'skills' as const,
        label: n.skills,
        desc: n.skillsDesc,
      },
      {
        path: '/plugins',
        section: 'plugins' as const,
        label: n.plugins,
        desc: n.pluginsDesc,
      },
      {
        path: '/contracts',
        section: 'contracts' as const,
        label: n.contratos,
        desc: n.contratosDesc,
      },
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
    const sub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.currentUrl.set(e.urlAfterRedirects));
    this.destroyRef.onDestroy(() => sub.unsubscribe());

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

import { Component, computed, inject } from '@angular/core';
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
  template: `
    <div class="mx-auto flex min-h-screen max-w-6xl flex-col px-4 sm:px-6">
      <header
        class="sticky top-0 z-30 -mx-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-bg/75 px-4 py-3.5 backdrop-blur-md sm:-mx-6 sm:px-6"
      >
        <a routerLink="/skills" class="text-base font-semibold tracking-tight">
          <span class="bg-gradient-to-r from-accent to-text bg-clip-text text-transparent">Skill Hub</span>
        </a>
        <nav class="flex flex-wrap items-center gap-x-1 gap-y-1 text-[13px]">
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
            class="cursor-pointer rounded-full px-3 py-1.5 text-text-muted transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-text"
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

  user = this.auth.user;
  t = this.i18n.t;
  isAdmin = computed(() => this.auth.user()?.role === 'admin');

  navLinks = computed(() => {
    const n = this.t().nav;
    const base = [
      { path: '/skills', label: n.catalogo },
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

  async logout(): Promise<void> {
    await this.auth.logout();
    this.router.navigate(['/login']);
  }
}

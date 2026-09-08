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
    <div class="mx-auto flex min-h-screen max-w-5xl flex-col px-4">
      <header class="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border py-3">
        <a routerLink="/skills" class="text-sm font-semibold tracking-tight">Skill Hub</a>
        <nav class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          <a routerLink="/skills" routerLinkActive="text-text" class="text-text-muted hover:text-text">{{ t().nav.catalogo }}</a>
          <a routerLink="/keys" routerLinkActive="text-text" class="text-text-muted hover:text-text">{{ t().nav.miKey }}</a>
          <a routerLink="/docs" routerLinkActive="text-text" class="text-text-muted hover:text-text">{{ t().nav.comoFunciona }}</a>
          @if (isAdmin()) {
            <a routerLink="/review" routerLinkActive="text-text" class="text-text-muted hover:text-text">{{ t().nav.revisar }}</a>
            <a routerLink="/insights" routerLinkActive="text-text" class="text-text-muted hover:text-text">{{ t().nav.uso }}</a>
            <a routerLink="/audit" routerLinkActive="text-text" class="text-text-muted hover:text-text">{{ t().nav.auditoria }}</a>
            <a routerLink="/admin/users" routerLinkActive="text-text" class="text-text-muted hover:text-text">{{ t().nav.usuarios }}</a>
          }
        </nav>
        <div class="ml-auto flex items-center gap-3 text-[13px]">
          <a routerLink="/profile" class="text-text-muted hover:text-text">{{ user()?.name }}</a>
          <button (click)="logout()" class="text-text-muted hover:text-text cursor-pointer">{{ t().nav.salir }}</button>
        </div>
      </header>

      <main class="flex-1 py-8">
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

  async logout(): Promise<void> {
    await this.auth.logout();
    this.router.navigate(['/login']);
  }
}

import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../core/api';
import { AuthService } from '../../core/auth';
import { I18n, type Locale } from '../../core/i18n/i18n';
import { ThemeService } from '../../core/theme';
import type { Theme } from '../../core/models';
import { TEAM_OPTIONS, type Team } from '../../core/teams';
import { UI } from '../../shared/ui';
import { apiError } from '../auth/login';

/** Puerto de src/app/(app)/profile/profile-form.tsx. */
@Component({
  selector: 'app-profile',
  imports: [FormsModule, ...UI],
  template: `
    <div class="max-w-lg">
      <h1 class="text-2xl font-semibold tracking-tight">{{ t().perfil.titulo }}</h1>
      <p class="mt-1 mb-6 text-sm text-text-muted">{{ t().perfil.subtitulo }}</p>

      <form (ngSubmit)="save()" class="space-y-4">
        <ui-field [label]="t().perfil.nombre">
          <input uiInput [(ngModel)]="name" name="name" />
        </ui-field>
        <ui-field [label]="t().perfil.equipo" [hint]="t().perfil.equipoHint">
          <select uiSelect [(ngModel)]="team" name="team" class="w-full">
            <option value="">{{ t().catalogo.sinEquipo }}</option>
            @for (option of teams; track option) {
              <option [value]="option">{{ option }}</option>
            }
          </select>
        </ui-field>

        <ui-field [label]="t().perfil.tema">
          <select uiSelect [(ngModel)]="theme" name="theme" (ngModelChange)="onTheme($event)">
            <option value="system">{{ t().perfil.temaSystem }}</option>
            <option value="light">{{ t().perfil.temaLight }}</option>
            <option value="dark">{{ t().perfil.temaDark }}</option>
          </select>
        </ui-field>
        <ui-field [label]="t().perfil.idioma" [hint]="t().perfil.idiomaHint">
          <select uiSelect [(ngModel)]="locale" name="locale" (ngModelChange)="onLocale($event)">
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </ui-field>

        <div class="flex items-center gap-3 pt-2">
          <button uiButton type="submit" [disabled]="busy()">
            {{ busy() ? t().perfil.guardando : t().perfil.guardar }}
          </button>
          @if (saved()) { <span class="text-sm text-success" animate.enter="anim-fade-in">{{ t().perfil.guardado }}</span> }
          @if (error()) { <span class="text-sm text-danger" animate.enter="anim-fade-in">{{ error() }}</span> }
        </div>
      </form>
    </div>
  `,
})
export class Profile {
  private api = inject(Api);
  private auth = inject(AuthService);
  private i18n = inject(I18n);
  private themeSvc = inject(ThemeService);
  t = this.i18n.t;

  name = '';
  team: Team | '' = '';
  teams = TEAM_OPTIONS;
  theme: Theme = this.themeSvc.theme();
  locale: Locale = this.i18n.locale();
  busy = signal(false);
  saved = signal(false);
  error = signal<string | null>(null);

  constructor() {
    firstValueFrom(this.api.get<{ name: string; team: Team | null; theme: Theme; locale: Locale }>('/profile'))
      .then((p) => {
        this.name = p.name;
        this.team = p.team ?? '';
        this.theme = p.theme;
        this.locale = p.locale;
      });
  }

  onTheme(v: Theme): void {
    this.themeSvc.setTheme(v);
  }
  onLocale(v: Locale): void {
    this.i18n.setLocale(v);
  }

  async save(): Promise<void> {
    this.busy.set(true);
    this.saved.set(false);
    this.error.set(null);
    try {
      await firstValueFrom(
        this.api.put('/profile', {
          name: this.name,
          team: this.team || null,
          theme: this.theme,
          locale: this.locale,
        }),
      );
      this.saved.set(true);
      await this.auth.refresh();
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}

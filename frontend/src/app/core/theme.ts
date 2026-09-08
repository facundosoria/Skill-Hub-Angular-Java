import { Injectable, signal } from '@angular/core';
import type { Theme } from './models';

const THEME_COOKIE = 'skillhub_theme';

/**
 * Puerto de src/components/theme-script.tsx + la parte de tema de profile.
 *
 * Tres estados: sin data-theme -> manda el sistema; data-theme="light"/"dark"
 * fuerza. El valor inicial lo aplica un script inline en index.html ANTES del
 * primer paint (sin parpadeo); este servicio solo lo cambia en runtime.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private _theme = signal<Theme>(readCookieTheme());
  readonly theme = this._theme.asReadonly();

  setTheme(theme: Theme): void {
    this._theme.set(theme);
    apply(theme);
    try {
      document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    } catch {
      /* noop */
    }
  }
}

function apply(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

function readCookieTheme(): Theme {
  try {
    const m = document.cookie.match(/(?:^|; )skillhub_theme=(system|light|dark)/);
    return (m?.[1] as Theme) ?? 'system';
  } catch {
    return 'system';
  }
}

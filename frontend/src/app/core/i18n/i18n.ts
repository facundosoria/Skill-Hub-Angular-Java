import { computed, Injectable, signal } from '@angular/core';
import { es, type Dict } from './es';
import { en } from './en';

export type { Dict } from './es';
export type Locale = 'es' | 'en';

const LOCALE_COOKIE = 'skillhub_locale';
const DICTS: Record<Locale, Dict> = { es, en };
const INTL_LOCALE: Record<Locale, string> = { es: 'es-AR', en: 'en-US' };

/**
 * Puerto de src/i18n/*. El diccionario que en Next bajaba del servidor una vez
 * aca es un signal: cambiar el idioma re-renderiza todo lo que consume `t()`.
 * La preferencia real vive en la cuenta (/api/profile); la cookie es el atajo
 * para el primer paint.
 */
@Injectable({ providedIn: 'root' })
export class I18n {
  private _locale = signal<Locale>(readCookieLocale());

  readonly locale = this._locale.asReadonly();
  /** El diccionario del idioma actual. En las plantillas: `i18n.t().catalogo.titulo`. */
  readonly t = computed(() => DICTS[this._locale()]);
  readonly intlLocale = computed(() => INTL_LOCALE[this._locale()]);

  setLocale(locale: Locale): void {
    this._locale.set(locale);
    try {
      document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
      document.documentElement.lang = locale;
    } catch {
      /* SSR / storage bloqueado */
    }
  }
}

function readCookieLocale(): Locale {
  try {
    const m = document.cookie.match(/(?:^|; )skillhub_locale=(es|en)/);
    return (m?.[1] as Locale) ?? 'es';
  } catch {
    return 'es';
  }
}

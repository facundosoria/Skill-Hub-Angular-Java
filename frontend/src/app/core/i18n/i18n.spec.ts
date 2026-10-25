import { TestBed } from '@angular/core/testing';
import { en } from './en';
import { es } from './es';
import { I18n } from './i18n';

describe('I18n', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.cookie = 'skillhub_locale=; max-age=0; path=/';
  });

  it('defaults to Spanish', () => {
    const i18n = TestBed.inject(I18n);
    expect(i18n.locale()).toBe('es');
    expect(i18n.t()).toBe(es);
    expect(i18n.intlLocale()).toBe('es-AR');
  });

  it('reads the locale cookie', () => {
    document.cookie = 'skillhub_locale=en; path=/';
    expect(TestBed.inject(I18n).locale()).toBe('en');
  });

  it('switches dictionary, cookie and document language', () => {
    const i18n = TestBed.inject(I18n);

    i18n.setLocale('en');

    expect(i18n.t()).toBe(en);
    expect(i18n.intlLocale()).toBe('en-US');
    expect(document.cookie).toContain('skillhub_locale=en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('falls back when cookies are blocked', () => {
    vi.spyOn(document, 'cookie', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {
      throw new Error('blocked');
    });
    const i18n = TestBed.inject(I18n);

    expect(i18n.locale()).toBe('es');
    expect(() => i18n.setLocale('en')).not.toThrow();
    expect(i18n.locale()).toBe('en');
  });
});

import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme';

describe('ThemeService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.cookie = 'skillhub_theme=; max-age=0; path=/';
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to system without cookie', () => {
    expect(TestBed.inject(ThemeService).theme()).toBe('system');
  });

  it('reads the initial theme from the cookie', () => {
    document.cookie = 'skillhub_theme=dark; path=/';
    expect(TestBed.inject(ThemeService).theme()).toBe('dark');
  });

  it('applies and persists the theme', () => {
    const theme = TestBed.inject(ThemeService);

    theme.setTheme('light');
    expect(theme.theme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.cookie).toContain('skillhub_theme=light');

    theme.setTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('survives a blocked cookie store', () => {
    vi.spyOn(document, 'cookie', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {
      throw new Error('blocked');
    });
    const theme = TestBed.inject(ThemeService);

    expect(theme.theme()).toBe('system');
    expect(() => theme.setTheme('dark')).not.toThrow();
    expect(theme.theme()).toBe('dark');
  });
});

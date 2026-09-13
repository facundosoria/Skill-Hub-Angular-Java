import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { AuthService } from './auth';
import { authGuard, passwordChangeGuard } from './guards';
import type { User } from './models';

describe('password change guards', () => {
  const currentUser = signal<User | null>(null);
  const loaded = signal(true);
  const auth = {
    user: currentUser.asReadonly(),
    loaded: loaded.asReadonly(),
    refresh: vi.fn(),
  };

  beforeEach(() => {
    currentUser.set(null);
    loaded.set(true);
    auth.refresh.mockReset();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    });
  });

  it('redirects a temporary-password session away from protected routes', async () => {
    currentUser.set(user(true));

    const result = await runGuard(authGuard);

    expect(url(result)).toBe('/change-password');
  });

  it('allows only temporary-password sessions into the change screen', async () => {
    currentUser.set(user(true));
    expect(await runGuard(passwordChangeGuard)).toBe(true);

    currentUser.set(user(false));
    expect(url(await runGuard(passwordChangeGuard))).toBe('/');

    currentUser.set(null);
    expect(url(await runGuard(passwordChangeGuard))).toBe('/login');
  });

  function runGuard(guard: typeof authGuard): Promise<boolean | UrlTree> {
    return TestBed.runInInjectionContext(() =>
      Promise.resolve(guard({} as never, {} as never) as boolean | UrlTree),
    );
  }

  function url(result: boolean | UrlTree): string {
    expect(result).toBeInstanceOf(UrlTree);
    return TestBed.inject(Router).serializeUrl(result as UrlTree);
  }
});

function user(mustChangePassword: boolean): User {
  return {
    id: 'user-1',
    username: 'member',
    name: 'Member',
    team: null,
    role: 'member',
    mustChangePassword,
  };
}

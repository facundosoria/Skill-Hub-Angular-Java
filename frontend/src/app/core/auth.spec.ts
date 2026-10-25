import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Api } from './api';
import { AuthService } from './auth';
import type { User } from './models';
import { DEP_MAP_CACHE_KEY } from '../features/depmap/dep-map-cache';

describe('AuthService', () => {
  const api = { get: vi.fn(), post: vi.fn() };
  let auth: AuthService;

  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [{ provide: Api, useValue: api }] });
    auth = TestBed.inject(AuthService);
  });

  it('resolves the current session on refresh', async () => {
    api.get.mockReturnValue(of({ user: user('admin') }));

    expect(auth.loaded()).toBe(false);
    expect(await auth.refresh()).toEqual(user('admin'));

    expect(api.get).toHaveBeenCalledWith('/auth/me');
    expect(auth.user()).toEqual(user('admin'));
    expect(auth.loaded()).toBe(true);
    expect(auth.isAdmin).toBe(true);
  });

  it('clears the dependency-map cache when the session is gone', async () => {
    localStorage.setItem(DEP_MAP_CACHE_KEY, 'cached');
    api.get.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 401 })));

    expect(await auth.refresh()).toBeNull();

    expect(localStorage.getItem(DEP_MAP_CACHE_KEY)).toBeNull();
    expect(auth.user()).toBeNull();
    expect(auth.loaded()).toBe(true);
    expect(auth.isAdmin).toBe(false);
  });

  it('keeps the cache on other refresh errors', async () => {
    localStorage.setItem(DEP_MAP_CACHE_KEY, 'cached');
    api.get.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

    expect(await auth.refresh()).toBeNull();

    expect(localStorage.getItem(DEP_MAP_CACHE_KEY)).toBe('cached');
  });

  it('logs in and stores the user', async () => {
    api.post.mockReturnValue(of({ user: user('member') }));

    expect(await auth.login('member', 'secret')).toEqual(user('member'));

    expect(api.post).toHaveBeenCalledWith('/auth/login', { username: 'member', password: 'secret' });
    expect(auth.user()).toEqual(user('member'));
    expect(auth.isAdmin).toBe(false);
  });

  it('registers with and without an active account', async () => {
    const body = { username: 'new', password: 'pw', team: 'Profesor' as never };
    api.post.mockReturnValueOnce(of({ info: 'pending' }));
    expect(await auth.register(body)).toEqual({ info: 'pending' });
    expect(auth.user()).toBeNull();

    api.post.mockReturnValueOnce(of({ user: user('admin') }));
    await auth.register(body);
    expect(api.post).toHaveBeenCalledWith('/auth/register', body);
    expect(auth.user()).toEqual(user('admin'));
  });

  it('logs out and clears cache and user', async () => {
    api.post.mockReturnValueOnce(of({ user: user('member') }));
    await auth.login('member', 'secret');
    localStorage.setItem(DEP_MAP_CACHE_KEY, 'cached');
    api.post.mockReturnValueOnce(of({}));

    await auth.logout();

    expect(api.post).toHaveBeenLastCalledWith('/auth/logout');
    expect(localStorage.getItem(DEP_MAP_CACHE_KEY)).toBeNull();
    expect(auth.user()).toBeNull();
  });

  it('changes the required password', async () => {
    api.post.mockReturnValue(of({ user: user('member') }));

    await auth.changeRequiredPassword('new-password');

    expect(api.post).toHaveBeenCalledWith('/auth/change-password', { password: 'new-password' });
    expect(auth.user()).toEqual(user('member'));
  });
});

function user(role: User['role']): User {
  return { id: 'u1', username: 'u', name: 'U', team: null, role, mustChangePassword: false };
}

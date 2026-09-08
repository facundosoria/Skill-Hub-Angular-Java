import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Api } from './api';
import type { User } from './models';

/**
 * Puerto de src/server/auth/index.ts (lado cliente). La sesion vive en la cookie
 * httpOnly que emite el backend; aca solo cacheamos el usuario resuelto.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(Api);

  private _user = signal<User | null>(null);
  private _loaded = signal(false);
  readonly user = this._user.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  get isAdmin(): boolean {
    return this._user()?.role === 'admin';
  }

  /** Se llama una vez al arrancar la app (APP_INITIALIZER) y tras login/logout. */
  async refresh(): Promise<User | null> {
    try {
      const { user } = await firstValueFrom(this.api.get<{ user: User }>('/auth/me'));
      this._user.set(user);
      return user;
    } catch {
      this._user.set(null);
      return null;
    } finally {
      this._loaded.set(true);
    }
  }

  async login(username: string, password: string): Promise<User> {
    const { user } = await firstValueFrom(
      this.api.post<{ user: User }>('/auth/login', { username, password }),
    );
    this._user.set(user);
    return user;
  }

  /** Devuelve el usuario si la cuenta fue creada activa (primer usuario), o el texto informativo. */
  async register(body: {
    username: string;
    password: string;
    team: string;
    legajo?: string;
  }): Promise<{ user?: User; info?: string }> {
    const res = await firstValueFrom(
      this.api.post<{ user?: User; info?: string }>('/auth/register', body),
    );
    if (res.user) this._user.set(res.user);
    return res;
  }

  async logout(): Promise<void> {
    await firstValueFrom(this.api.post('/auth/logout'));
    this._user.set(null);
  }
}

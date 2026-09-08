import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

/**
 * Wrapper fino sobre HttpClient. Todas las requests van con `withCredentials`
 * para que viaje la cookie de sesion `skillhub_session` (el backend la lee de
 * ahi). La base es relativa: en dev el proxy de Angular reenvia /api al :8080,
 * en prod el bundle se sirve desde el mismo origen que la API.
 */
@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  private base = '/api';

  get<T>(path: string, params?: Record<string, string | number | undefined>): Observable<T> {
    return this.http.get<T>(this.base + path, {
      withCredentials: true,
      params: toParams(params),
    });
  }

  post<T>(path: string, body?: unknown): Observable<T> {
    return this.http.post<T>(this.base + path, body ?? {}, { withCredentials: true });
  }

  put<T>(path: string, body?: unknown): Observable<T> {
    return this.http.put<T>(this.base + path, body ?? {}, { withCredentials: true });
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(this.base + path, { withCredentials: true });
  }
}

function toParams(params?: Record<string, string | number | undefined>): HttpParams {
  let p = new HttpParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
    }
  }
  return p;
}

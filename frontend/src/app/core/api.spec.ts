import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { Api } from './api';

describe('Api', () => {
  let api: Api;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(Api);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('prefixes /api, sends credentials and drops empty params', async () => {
    const result = firstValueFrom(
      api.get<{ ok: boolean }>('/skills', { a: 'x', b: 2, c: undefined, d: '' }),
    );

    const req = http.expectOne((r) => r.url === '/api/skills');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.params.get('a')).toBe('x');
    expect(req.request.params.get('b')).toBe('2');
    expect(req.request.params.has('c')).toBe(false);
    expect(req.request.params.has('d')).toBe(false);
    req.flush({ ok: true });
    expect(await result).toEqual({ ok: true });
  });

  it('sends GET without params', () => {
    api.get('/me').subscribe();
    const req = http.expectOne('/api/me');
    expect(req.request.params.keys()).toEqual([]);
    req.flush({});
  });

  it('defaults the body of post, put and patch to an empty object', () => {
    api.post('/a').subscribe();
    api.put('/b').subscribe();
    api.patch('/c').subscribe();
    for (const [url, method] of [
      ['/api/a', 'POST'],
      ['/api/b', 'PUT'],
      ['/api/c', 'PATCH'],
    ]) {
      const req = http.expectOne(url);
      expect(req.request.method).toBe(method);
      expect(req.request.body).toEqual({});
      expect(req.request.withCredentials).toBe(true);
      req.flush({});
    }
  });

  it('keeps explicit bodies', () => {
    api.post('/a', { x: 1 }).subscribe();
    api.put('/b', { y: 2 }).subscribe();
    api.patch('/c', { z: 3 }).subscribe();
    for (const [url, body] of [
      ['/api/a', { x: 1 }],
      ['/api/b', { y: 2 }],
      ['/api/c', { z: 3 }],
    ] as const) {
      const req = http.expectOne(url);
      expect(req.request.body).toEqual(body);
      req.flush({});
    }
  });

  it('sends forms and deletes', () => {
    const form = new FormData();
    api.postForm('/f', form).subscribe();
    api.putForm('/g', form).subscribe();
    api.delete('/h').subscribe();
    const post = http.expectOne('/api/f');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toBe(form);
    const put = http.expectOne('/api/g');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toBe(form);
    const del = http.expectOne('/api/h');
    expect(del.request.method).toBe('DELETE');
    expect(del.request.withCredentials).toBe(true);
    post.flush({});
    put.flush({});
    del.flush({});
  });
});

import type { Route } from '@angular/router';
import { appConfig } from './app.config';
import { routes } from './app.routes';

describe('app routes', () => {
  beforeAll(() => {
    // gsap.matchMedia corre al importar algunas pantallas y jsdom no lo trae.
    window.matchMedia ??= ((query: string) =>
      ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) as unknown as MediaQueryList);
  });

  it('lazy-loads a component for every screen', async () => {
    const lazy = flatten(routes).filter((route) => route.loadComponent);

    expect(lazy.length).toBeGreaterThan(20);
    for (const route of lazy) {
      const component = await (route.loadComponent as () => Promise<unknown>)();
      expect(component, route.path).toBeTypeOf('function');
    }
  });

  it('falls back to the home page', () => {
    expect(routes.at(-1)).toEqual({ path: '**', redirectTo: '' });
  });

  it('declares the application providers', () => {
    expect(appConfig.providers.length).toBeGreaterThan(0);
  });
});

function flatten(list: Route[]): Route[] {
  return list.flatMap((route) => [route, ...flatten(route.children ?? [])]);
}

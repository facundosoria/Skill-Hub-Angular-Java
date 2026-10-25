import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from '../core/auth';
import type { User } from '../core/models';
import { Shell } from './shell';

@Component({ template: '' })
class Blank {}

describe('Shell', () => {
  const user = signal<User | null>(null);
  const auth = { user: user.asReadonly(), logout: vi.fn() };
  let reducedMotion = true;

  beforeEach(() => {
    reducedMotion = true;
    user.set(member('member'));
    auth.logout.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: reducedMotion, media: query }));
    TestBed.configureTestingModule({
      imports: [Shell],
      providers: [
        provideRouter([
          { path: 'skills', component: Blank },
          { path: 'plugins', component: Blank },
          { path: 'contracts', component: Blank },
          { path: 'login', component: Blank },
          { path: '**', component: Blank },
        ]),
        { provide: AuthService, useValue: auth },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function render() {
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('shows member links and hides admin links', () => {
    const { component, el } = render();
    expect(component.isAdmin()).toBe(false);
    expect(component.navLinks().map((l) => l.path)).toEqual(['/keys', '/docs', '/mapa', '/salas', '/infra']);
    expect(el.querySelector('a[href="/review"]')).toBeNull();
  });

  it('adds admin links for admins', () => {
    user.set(member('admin'));
    const { component, el } = render();
    expect(component.navLinks().map((l) => l.path)).toContain('/admin/users');
    expect(el.querySelector('a[href="/audit"]')).not.toBeNull();
  });

  it('tracks the active catalog section from navigation', async () => {
    const { fixture, component } = render();
    const router = TestBed.inject(Router);
    expect(component.activeSection()).toBeNull();
    for (const section of ['skills', 'plugins', 'contracts'] as const) {
      await router.navigateByUrl(`/${section}`);
      expect(component.activeSection()).toBe(section);
    }
    expect(component.isCatalogActive()).toBe(true);
    await router.navigateByUrl('/keys');
    expect(component.isCatalogActive()).toBe(false);
    fixture.destroy();
  });

  it('opens the catalog menu, closes it from an item or an outside click', async () => {
    const { fixture, component, el } = render();
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/plugins');
    const trigger = el.querySelector('[data-catalog-menu] button') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    expect(component.catalogOpen()).toBe(true);
    const items = el.querySelectorAll('[role="menuitem"]');
    expect(items.length).toBe(3);

    (items[0] as HTMLElement).click();
    expect(component.catalogOpen()).toBe(false);

    component.toggleCatalog();
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: false }));
    component.catalogOpen.set(true);
    document.body.click();
    expect(component.catalogOpen()).toBe(false);
  });

  it('logs out immediately with reduced motion', async () => {
    const { component } = render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
    await component.logout();
    expect(auth.logout).toHaveBeenCalled();
    expect(component.loggingOut()).toBe(true);
    expect(navigate).toHaveBeenCalledWith(['/login']);

    await component.logout();
    expect(auth.logout).toHaveBeenCalledTimes(1);
  });

  it('fades out before navigating when motion is allowed', async () => {
    reducedMotion = false;
    vi.useFakeTimers();
    const { el } = render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const button = [...el.querySelectorAll('button')].at(-1) as HTMLButtonElement;
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(navigate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(360);
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });
});

function member(role: 'admin' | 'member'): User {
  return { id: 'u', username: 'ana', name: 'Ana', team: null, role, mustChangePassword: false } as User;
}

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth';

/** Exige sesion. Sin usuario -> /login. Puerto del layout (app) que redirige a login. */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.loaded()) await auth.refresh();
  return auth.user() ? true : router.createUrlTree(['/login']);
};

/** Exige rol admin. Puerto de los `redirect("/skills")` de las paginas de admin. */
export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.loaded()) await auth.refresh();
  if (!auth.user()) return router.createUrlTree(['/login']);
  return auth.isAdmin ? true : router.createUrlTree(['/skills']);
};

/** Para /login: si ya hay sesion, mandar al inicio autenticado. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.loaded()) await auth.refresh();
  return auth.user() ? router.createUrlTree(['/']) : true;
};

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth';

/** Exige sesion. Sin usuario -> /login. Puerto del layout (app) que redirige a login. */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.loaded()) await auth.refresh();
  const user = auth.user();
  if (!user) return router.createUrlTree(['/login']);
  return user.mustChangePassword ? router.createUrlTree(['/change-password']) : true;
};

/** Exige rol admin. Puerto de los `redirect("/skills")` de las paginas de admin. */
export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.loaded()) await auth.refresh();
  if (!auth.user()) return router.createUrlTree(['/login']);
  if (auth.user()!.mustChangePassword) return router.createUrlTree(['/change-password']);
  return auth.isAdmin ? true : router.createUrlTree(['/skills']);
};

/** Para /login: si ya hay sesion, mandar al inicio autenticado. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.loaded()) await auth.refresh();
  const user = auth.user();
  if (!user) return true;
  return router.createUrlTree([user.mustChangePassword ? '/change-password' : '/']);
};

/** Solo permite la pantalla obligatoria a una sesion creada con contrasena temporal. */
export const passwordChangeGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.loaded()) await auth.refresh();
  const user = auth.user();
  if (!user) return router.createUrlTree(['/login']);
  return user.mustChangePassword ? true : router.createUrlTree(['/']);
};

import { Routes } from '@angular/router';
import { adminGuard, authGuard, guestGuard } from './core/guards';

/**
 * Puerto del ruteo de src/app. Todo lo de `(app)` cuelga del Shell (nav + outlet)
 * y pide sesion; las pantallas de admin agregan adminGuard.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'skills' },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login').then((m) => m.Login),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      {
        path: 'skills',
        loadComponent: () => import('./features/skills/skills-list').then((m) => m.SkillsList),
      },
      {
        path: 'skills/new',
        loadComponent: () => import('./features/skills/skill-form').then((m) => m.SkillForm),
        data: { mode: 'create' },
      },
      {
        path: 'skills/:slug',
        loadComponent: () => import('./features/skills/skill-detail').then((m) => m.SkillDetailPage),
      },
      {
        path: 'skills/:slug/edit',
        loadComponent: () => import('./features/skills/skill-form').then((m) => m.SkillForm),
        data: { mode: 'edit' },
      },
      {
        path: 'skills/:slug/diff',
        loadComponent: () => import('./features/skills/skill-diff').then((m) => m.SkillDiff),
      },
      {
        path: 'keys',
        loadComponent: () => import('./features/keys/keys').then((m) => m.Keys),
      },
      {
        path: 'profile',
        loadComponent: () => import('./features/profile/profile').then((m) => m.Profile),
      },
      {
        path: 'docs',
        loadComponent: () => import('./features/stub').then((m) => m.Stub),
        data: { title: 'Cómo funciona' },
      },
      {
        path: 'review',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/review/review').then((m) => m.Review),
      },
      {
        path: 'insights',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/insights/insights').then((m) => m.Insights),
      },
      {
        path: 'audit',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/audit/audit').then((m) => m.Audit),
      },
      {
        path: 'admin/users',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/admin-users').then((m) => m.AdminUsers),
      },
    ],
  },
  { path: '**', redirectTo: 'skills' },
];

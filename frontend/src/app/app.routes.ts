import { Routes } from '@angular/router';
import { adminGuard, authGuard, guestGuard } from './core/guards';

/**
 * Puerto del ruteo de src/app. Todo lo de `(app)` cuelga del Shell (nav + outlet)
 * y pide sesion; las pantallas de admin agregan adminGuard.
 */
export const routes: Routes = [
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
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./features/home/landing/landing').then((m) => m.Landing),
      },
      {
        path: 'skills',
        loadComponent: () => import('./features/skills/skills-list').then((m) => m.SkillsList),
        data: { section: 'skills' },
      },
      {
        path: 'skills/new',
        loadComponent: () => import('./features/skills/skill-form').then((m) => m.SkillForm),
        data: { mode: 'create', section: 'skills' },
      },
      {
        path: 'skills/:slug',
        loadComponent: () => import('./features/skills/skill-detail').then((m) => m.SkillDetailPage),
        data: { section: 'skills' },
      },
      {
        path: 'skills/:slug/edit',
        loadComponent: () => import('./features/skills/skill-form').then((m) => m.SkillForm),
        data: { mode: 'edit', section: 'skills' },
      },
      {
        path: 'skills/:slug/diff',
        loadComponent: () => import('./features/skills/skill-diff').then((m) => m.SkillDiff),
        data: { section: 'skills' },
      },
      {
        path: 'plugins',
        loadComponent: () => import('./features/skills/skills-list').then((m) => m.SkillsList),
        data: { section: 'plugins' },
      },
      {
        path: 'plugins/new',
        loadComponent: () => import('./features/skills/skill-form').then((m) => m.SkillForm),
        data: { mode: 'create', section: 'plugins' },
      },
      {
        path: 'plugins/:slug',
        loadComponent: () => import('./features/skills/skill-detail').then((m) => m.SkillDetailPage),
        data: { section: 'plugins' },
      },
      {
        path: 'plugins/:slug/edit',
        loadComponent: () => import('./features/skills/skill-form').then((m) => m.SkillForm),
        data: { mode: 'edit', section: 'plugins' },
      },
      {
        path: 'plugins/:slug/diff',
        loadComponent: () => import('./features/skills/skill-diff').then((m) => m.SkillDiff),
        data: { section: 'plugins' },
      },
      {
        path: 'contracts',
        loadComponent: () => import('./features/skills/skills-list').then((m) => m.SkillsList),
        data: { section: 'contracts' },
      },
      {
        path: 'contracts/new',
        loadComponent: () => import('./features/skills/skill-form').then((m) => m.SkillForm),
        data: { mode: 'create', section: 'contracts' },
      },
      {
        path: 'contracts/:slug',
        loadComponent: () => import('./features/skills/skill-detail').then((m) => m.SkillDetailPage),
        data: { section: 'contracts' },
      },
      {
        path: 'contracts/:slug/edit',
        loadComponent: () => import('./features/skills/skill-form').then((m) => m.SkillForm),
        data: { mode: 'edit', section: 'contracts' },
      },
      {
        path: 'contracts/:slug/diff',
        loadComponent: () => import('./features/skills/skill-diff').then((m) => m.SkillDiff),
        data: { section: 'contracts' },
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
        loadComponent: () => import('./features/docs/docs').then((m) => m.Docs),
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
  { path: '**', redirectTo: '' },
];

import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { routes } from './app.routes';
import { AuthService } from './core/auth';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch()),
    // withViewTransitions: cross-fade entre rutas (el navegador respeta
    // prefers-reduced-motion, reforzado en styles.css).
    provideRouter(routes, withComponentInputBinding(), withViewTransitions()),
    // Resuelve la sesion actual antes del primer render (equivale a getCurrentUser
    // en el layout del proyecto Next).
    provideAppInitializer(() => inject(AuthService).refresh()),
  ],
};

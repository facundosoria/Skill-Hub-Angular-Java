# 0008. Frontend Angular zoneless, standalone, signals y OnPush

- **Estado:** Aceptado
- **Fecha:** 2026-09-08

## Contexto

El frontend se portó desde React/Next.js a Angular 22 en un solo esfuerzo
(commits del 2026-09-08). Angular 22 permite prescindir de `zone.js` y de
`NgModule`, y ofrece signals como modelo de estado reactivo.

## Decisión

- **Zoneless:** no hay `zone.js` en `package.json` ni en los polyfills de
  `angular.json`; Angular asume detección de cambios sin zonas.
- **Standalone components**, `inject()` en lugar de inyección por constructor,
  control flow moderno (`@if` / `@for`) y rutas con `loadComponent` (lazy).
- **Estado en `signal()` / `computed()`**; la sesión se resuelve antes del
  primer render con `provideAppInitializer`.
- **`ChangeDetectionStrategy.OnPush`** como convención para componentes nuevos
  (exigida en [AGENTS.md](../../AGENTS.md) y en el plan del mapa).
- Animaciones con `animate.enter` / `animate.leave` nativos y keyframes CSS, sin
  `@angular/animations`; `withViewTransitions()` para el cross-fade entre rutas.

## Alternativas consideradas

- **Angular con `zone.js` y NgModules:** *Razón no registrada — confirmar* por
  qué se eligió zoneless desde el inicio.
- **Mantener React:** ver [0001](0001-stack-spring-boot-angular-postgres-docker-compose.md).

## Consecuencias

- Menos magia y bundle más chico, pero la detección de cambios sólo corre por
  escrituras de signals, `markForCheck()`, eventos de template o `setInput`. Un
  `await`/HTTP que muta un objeto plano **no** refresca la vista.
- Ya causó un bug real: el formulario de edición quedaba vacío porque
  `skill-form.ts` reasignaba un POJO tras un `queueMicrotask` (commit
  `b7ee5e1`, arreglado con `effect()` + `markForCheck()`).
- Regla práctica: todo estado cargado async va en signals; si se usa un form
  template-driven con `[(ngModel)]` sobre un objeto, llamar `markForCheck()`
  después de asignarlo.
- `OnPush` no está aplicado en todos los componentes: al momento de escribir,
  14 de 30 archivos con `@Component` (sin contar specs) lo declaran. La
  convención aplica a código nuevo o tocado; no se hizo una migración masiva.

## Referencias

- [README.md](../../README.md) — sección "Frontend".
- [AGENTS.md](../../AGENTS.md) — sección "Frontend".
- Commits `9e947e1` (scaffold), `250fb7e` (animaciones), `b7ee5e1` (bug zoneless).
- `frontend/package.json`, `frontend/angular.json`, `frontend/src/app/app.config.ts`.

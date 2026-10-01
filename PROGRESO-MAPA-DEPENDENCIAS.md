# Registro de avance — PLAN-MAPA-DEPENDENCIAS.md

Orquestación: Orca run `run_1f14ca3ba672` · workers Codex · inicio 2026-10-01.

Leyenda: ⬜ pendiente · 🔄 en curso · ✅ hecho y verificado · ⚠️ hecho con observaciones · ⛔ bloqueado / requiere decisión

## Ola 1 (en paralelo)

| # | Bloque | Worker | Estado | Evidencia |
|---|---|---|---|---|
| B1 | Migración `V23__dependency_map.sql` + seed desde `state.json` vivo | Codex backend | ⚠️ | No había contenedor `mapa-dependencias` corriendo → se usó `mapa-dependencias/data/state.json` (versión 5, 13 nodos, 5 tipos, 57 edges, 4 tildes, 4 actividades). V23 era el siguiente número libre |
| B2 | `resources/depmap/seed.json` | Codex backend | ✅ | — |
| B3 | `DepMapRepository`, `DepMapService`, `DepMapEvents`, `DepMapController` | Codex backend + fix | ✅ | Bug del E2E corregido: `replaceEdges` hacía `setval` con `update()` → 500 en reset/import. Ahora usa `queryForObject`. Tests nuevos de reset/import como admin: fallaban 2/6 antes, pasan 6/6 después; `mvn test` 115/0/0 |
| B4 | `DepMapIntegrationTest` + `mvn test` | Codex backend | ✅ | `DepMapIntegrationTest` 4/4; `mvn test` BUILD SUCCESS, 113 tests, 0 fallos, 0 errores |
| F1 | `dep-map-geometry.ts` + `dep-map-geometry.spec.ts` | Codex frontend | ✅ | spec compara cur>acc, ida y vuelta y usr>not contra el HTML original |
| F2 | `dep-map-store.ts` (signals, SSE, caché offline) | Codex frontend | ✅ | informado por el worker |
| F3 | `dep-map.ts`, `dep-map-graph.ts`, `dep-map-matrix.ts`, `dep-map-list.ts`, `dep-map-panel.ts`, diálogos | Codex frontend | ✅ | diálogos dentro de los componentes (sin archivos aparte) |
| F4 | Ruta `mapa` en `app.routes.ts`, link en `shell.ts`, i18n `es.ts`/`en.ts` | Codex frontend | ✅ | — |
| F5 | `npm run build` + `npx ng test` | Codex frontend | ✅ (re-verificado en V2) | Build OK (sólo warnings de presupuesto CSS), Vitest 5 archivos/17 tests OK, **pero con un shim de Node**: Angular CLI exige Node ≥ 22.22.3 y el entorno tiene 22.12.0. Se re-verifica en V2 |

## Ola 2 (después de la ola 1)

| # | Bloque | Worker | Estado | Evidencia |
|---|---|---|---|---|
| V1 | Revisión cruzada del contrato API backend ↔ frontend | Codex verificador (`ctx_df5814d7dc55`) | ✅ | 2 correcciones: presencia real en `GET /api/depmap/state` (`DepMapController.java:36`, `DepMapEvents.java:46`); `POST edges` sin `kind` → 400 `DomainException` (`DepMapService.java:60`). Datos de V23 = fuente (13/5/57/4) |
| V2 | Verificación completa (`mvn test`, `npm run build`, `ng test`) + revisión del shim de Node | Codex verificador (`ctx_df5814d7dc55`) | ✅ | `mvn test` 113/0/0 (tras las correcciones). Frontend oficial con `node:22-alpine` v22.23.3 en una copia temporal: `npm ci`, `npm run build` y `ng test` OK (5 archivos/17 tests). Con el Node local 22.12.0 los comandos no arrancan. No quedó ningún shim persistente |
| V3 | Prueba de humo (stack aislado `-p depmap-e2e`, sin tocar producción) + curl/SSE | Codex e2e (`ctx_38b50a300fd9`) | ✅ | 15/15 chequeos PASS: 401 sin sesión; estado 13/57/4 v5; POST 201, PUT done, DELETE; import/reset 403 para no admin; SSE hello y update; reset/import admin OK tras el fix. Build docker del frontend y el backend OK. Informe: `/tmp/depmap-e2e/report.md` |
| D1 | Sección del mapa en `README.md` (incluye la limitación de una sola instancia para SSE/presencia) | Codex docs (`ctx_3de301729c2f`) | ✅ | Sección agregada sin tocar los cambios de Hydra; rutas/endpoints contrastados con el código; `git diff --check` OK |

## Corte

| # | Bloque | Estado |
|---|---|---|
| C1 | Re-sincronizar cambios del viejo: detectar fuentes más nuevas que v5 (sólo lectura) | ✅ No hay cambios posteriores a v5: el `state.json` coincide exactamente con V23 (13 nodos, 5 tipos, 57 edges, tildes e26/e39/e40/e42, 4 actividades). No hace falta Aplicar JSON |
| C2 | Dar de baja el contenedor `mapa-dependencias`: inventario (sólo lectura) | ✅ No existe nada que dar de baja: sin contenedor, imagen, volumen, listener 8790, servicio ni referencias `/mapa/`/8790 en Caddyfile/compose de Skill Hub. Sólo queda la definición del servicio en el compose del repo externo (no se borra el repo, según el plan) |
| C3 | E2E con dos contextos de navegador + screenshots comparativos contra una copia de la app vieja | ✅ Dos sesiones Chromium: "En vivo · 2 en línea"; un alta en una sesión aparece en la otra; modo sin conexión con banner y botones deshabilitados. Los 13 nodos tienen el **mismo transform en el viewBox** que en la app vieja. Las diferencias en px vienen de que el SVG renderiza más angosto (721 vs 778 px) dentro del shell. Capturas en `/tmp/depmap-e2e/*.png`. Los contenedores de producción conservan los mismos IDs |

## Bitácora

- 2026-10-01 — Run creado; ola 1 lanzada.
  - Backend: task `task_2b1a868be7ce` / dispatch `ctx_e1d10675d969` (terminal `term_d28ccb76…`).
  - Frontend: task `task_cedca0b1a889` / dispatch `ctx_73e4d23d39f7` (terminal `term_ab99b0e8…`).
- 2026-10-01 09:16 — Frontend: worker_done con éxito (⚠️ shim de Node). Worker liberado.
- 2026-10-01 09:22 — Backend: worker_done con éxito, 113 tests OK. Worker liberado.
- 2026-10-01 — Ola 2 lanzada: verificador `task_1bc64ca04a24`/`ctx_df5814d7dc55`, docs `task_c0931dd049b6`/`ctx_3de301729c2f`.
- 2026-10-01 09:24 — Docs: worker_done con éxito (README.md). Worker liberado.
- 2026-10-01 09:31 — Verificador: worker_done con éxito; 2 correcciones de backend; todas las verificaciones OK. Worker liberado. Run sin workers pendientes.

## Estado final de la implementación

**Plan completo.** Hecho y verificado: B1–B4, F1–F5, V1, V2, V3, D1, C1, C2, C3.

**Observaciones (no bloquean):**
- ~~El Node del host era 22.12.0~~ → resuelto: ahora v22.23.2 (ver bitácora).
- Warning de presupuesto CSS en `dep-map.ts` (+261 bytes).
- Presencia/SSE en memoria: una sola instancia de backend (documentado en el README).
- El SVG del mapa se ve unos 57 px más angosto que en la app vieja a 1280 px, por el ancho del shell. Las coordenadas del viewBox son idénticas.
- Nada se commiteó; los cambios conviven con los de Hydra sin commitear.
- Restos temporales fuera del repo: `/tmp/depmap-e2e/`, `/tmp/depmap-frontend.9WuRbB`, `/tmp/depmap-docker-before.tsv`.

## Bitácora

- 2026-10-01 — Run creado; ola 1 lanzada.
  - Backend: task `task_2b1a868be7ce` / dispatch `ctx_e1d10675d969` (terminal `term_d28ccb76…`).
  - Frontend: task `task_cedca0b1a889` / dispatch `ctx_73e4d23d39f7` (terminal `term_ab99b0e8…`).
- 2026-10-01 09:16 — Frontend: worker_done con éxito (⚠️ shim de Node). Worker liberado.
- 2026-10-01 09:22 — Backend: worker_done con éxito, 113 tests OK. Worker liberado.
- 2026-10-01 — Ola 2 lanzada: verificador `task_1bc64ca04a24`/`ctx_df5814d7dc55`, docs `task_c0931dd049b6`/`ctx_3de301729c2f`.
- 2026-10-01 09:24 — Docs: worker_done con éxito (README.md). Worker liberado.
- 2026-10-01 09:31 — Verificador: worker_done con éxito; 2 correcciones de backend; todas las verificaciones OK. Worker liberado. Run sin workers pendientes.

## Estado final de la implementación

**Hecho:** B1–B4, F1–F5, V1, V2, D1.

**Pendiente (requiere al usuario):**
- V3 / C3: prueba de humo con `docker compose up -d --build` y E2E con dos navegadores + screenshots contra la app vieja. Reconstruye el stack en ejecución, que hoy incluye los cambios de Hydra sin commitear.
- C1: si la app vieja cambió después de la versión 5, hacer Datos → Copiar en la vieja y Aplicar JSON como admin en la nueva.
- C2: dar de baja el contenedor `mapa-dependencias` (no se encontró corriendo durante la ejecución).

**Observaciones:**
- El Node local (22.12.0) es más viejo que el que exige Angular CLI (≥ 22.22.3): `npm run build`/`ng test` no corren en el host sin actualizar Node.
- Warning de presupuesto CSS en `dep-map.ts` (+261 bytes sobre el límite por componente). No bloquea el build.
- Presencia/SSE en memoria: una sola instancia de backend (documentado en el README).
- Quedan restos temporales fuera del repo: `/tmp/depmap-frontend.9WuRbB` (copia usada para la verificación). El archivo vacío `./printf` es anterior a esta tarea.
- 2026-10-01 — Ola 3 lanzada para cerrar los pendientes: corte (sólo lectura) `task_02d1e95effd3`/`ctx_406c7c88aa10`, E2E aislado `task_c8e4d3c2a191`/`ctx_38b50a300fd9`.
- 2026-10-01 09:36 — Corte: worker_done con éxito (C1 y C2 sin acciones necesarias). Worker liberado.
- 2026-10-01 09:37 — E2E escaló un bug: reset (y probablemente import) da 500. Se lanzó el worker de corrección `task_2e19fb318c8b`/`ctx_5556918f56c3`; el E2E sigue con el resto de los chequeos.
- 2026-10-01 09:44 — Fix: worker_done con éxito (reset/import corregidos, 115 tests OK). Worker liberado; se pidió al E2E re-probar reset/import.
- 2026-10-01 09:51 — E2E: worker_done con éxito (V3 y C3). Worker liberado. Run sin workers pendientes.
- 2026-10-01 — Pedido del usuario: actualizar Node del host a ≥ 22.22.3. Run `run_a5cb95356c0f`, worker `task_f9a1e4744407`/`ctx_34fecb4787ac` en curso.
- 2026-10-01 17:16 — Node actualizado con nvm a v22.23.2 (default; `~/.bashrc` y `~/.profile` activan nvm en shells nuevos). Paquetes globales conservados; codex 0.159.3 y Orca 1.4.217 funcionan. `npm run build` OK y `ng test` OK (17 tests) directamente en el host. Worker liberado. Ya no aplica la observación sobre el Node del host.

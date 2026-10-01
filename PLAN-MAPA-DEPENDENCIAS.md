# Plan: migrar `mapa-dependencias` a Skill Hub (Angular + Spring Boot + Postgres)

## Context

`/home/rcoleman/Repos/mapa-dependencias` es una app aparte (Node/Express + un `public/index.html` sin framework, estado en `data/state.json`, sync en vivo por SSE) que hoy se pensaba montar bajo `/mapa/` con un proxy. Queremos que pase a ser una pantalla nativa de Skill Hub, con su stack (Angular 22 standalone/signals/OnPush/Tailwind 4 + Spring Boot 3.4/JdbcTemplate/Flyway/Postgres 16) y su estructura, para poder sumarla a la página. Hay que preservar **toda la información** (13 nodos con su `x/y`, 5 tipos, `info` por grupo, 57 dependencias, tildes, actividad) y **la posición de los objetos en pantalla** (grafo en viewBox `1000×745`, nodos `168×52`, misma geometría de flechas, mismo layout de cabecera/barra/vista+panel 420px, mismas tres vistas).

Decisiones tomadas con el usuario:
- **Persistencia**: tablas Postgres nuevas vía migración Flyway (autorizada explícitamente), seed con los datos actuales.
- **Identidad**: sesión de Skill Hub. Se eliminan el campo "Tu nombre" y `EDIT_KEY`; la autoría sale del usuario logueado. Todos los usuarios logueados agregan/eliminan/tildan; **Aplicar JSON** y **Restaurar originales** solo admin. Cada cambio también va a `audit_events`.
- **Estilo**: tokens y primitivas de Skill Hub (`uiButton`, `uiCard`, `uiBadge`, `uiInput`/`uiSelect`/`uiTextarea`, `ui-empty-state`, `<dialog>` nativo), manteniendo layout y posiciones. Azul/naranja quedan solo como semántica de dirección, como variables locales del componente (no se tocan `styles.css` ni componentes compartidos).

## Backend (`backend/src/main/java/com/skillhub/depmap/`)

**Migración** `backend/src/main/resources/db/migration/V23__dependency_map.sql`:
- `dep_map_nodes(id text pk, name text, short_name text, x int, y int, transversal bool, objective text, note text, own_tasks jsonb, sort_order int)` — `sort_order` conserva el orden de claves de `seed.json` (define orden de Matriz, selects y pintado de nodos).
- `dep_map_kinds(id text pk, label text, sort_order int)`.
- `dep_map_edges(id text pk, from_node text fk, to_node text fk, kind text fk, state text check in ('pendiente','definir'), text text, done bool default false, done_by text, sort_order bigserial)` — check `from_node <> to_node`.
- `dep_map_activity(id bigserial, ts timestamptz, actor_id uuid null fk users ON DELETE SET NULL, actor_name text, summary text)`.
- `dep_map_meta(id int pk check id=1, version bigint, updated_at timestamptz, updated_by text)`.
- `INSERT`s generados a partir de `mapa-dependencias/data/state.json` (estado vivo actual: versión 5, 57 edges, 4 tildes, 4 actividades), preservando ids (`e1…`, `u…`) y el orden.
- Copiar `server/seed.json` a `backend/src/main/resources/depmap/seed.json` para **Restaurar originales**.

**Clases** (siguiendo `InsightsController` / `AuditService` / `ApiExceptionHandler`):
- `DepMapRepository` — JdbcTemplate/NamedParameterJdbcTemplate; arma el documento de estado.
- `DepMapService` — `@Transactional`; cada mutación hace `SELECT … FROM dep_map_meta FOR UPDATE`, aplica el cambio, incrementa `version`, inserta actividad (máx. 60, se recorta), llama `AuditService.logAudit(...)` y, después del commit, emite el evento SSE. Reproduce exactamente las validaciones y mensajes de `server/index.js` (`clean()`, `MAX_TEXT=500`, `short()` a 60 chars, "Elegí dos grupos distintos.", "Contá qué necesita.", `validateEdges`, etc.) lanzando `DomainException` / `ResponseStatusException(404)`.
- `DepMapEvents` — registro en memoria de `SseEmitter` (timeout largo, heartbeat `: ping` cada 25 s con `@Scheduled` o executor), presencia = nombres distintos de usuarios conectados; eventos `hello` / `presence` / `update` con el mismo JSON que hoy.
- `DepMapController` `@RequestMapping("/api/depmap")`, todos con `@AuthPrincipal CurrentUser`:

| Hoy | Skill Hub | Permiso |
|---|---|---|
| `GET /api/state` | `GET /api/depmap/state` (misma forma: `nodes,kinds,info,edges,done,activity(20),presence,version,updatedAt,updatedBy,serverTime`) | logueado |
| `GET /api/events` | `GET /api/depmap/events` (`text/event-stream`, cookie de sesión) | logueado |
| `POST /api/edges` | `POST /api/depmap/edges` → 201 `{edge,version}` | logueado |
| `DELETE /api/edges/:id` | `DELETE /api/depmap/edges/{id}` | logueado |
| `PUT /api/done/:id` | `PUT /api/depmap/done/{id}` `{done}` | logueado |
| `POST /api/import` | `POST /api/depmap/import` `{edges,done}` | admin |
| `POST /api/reset` | `POST /api/depmap/reset` | admin |

`nodes` se devuelve como objeto `{id:{n,s,x,y,transv?}}` en el orden de `sort_order` (LinkedHashMap) y `done` como `{id:true}`, para que el JSON de **Datos → Copiar/Aplicar** sea idéntico al actual (export del viejo importable en el nuevo). `x-client-name` / `x-edit-key` desaparecen. `OriginCheckInterceptor` y `PasswordChangeInterceptor` ya cubren `/api/**`; Caddy ya proxea `/api/*` y hace flush automático de `text/event-stream` (no hace falta tocar `Caddyfile` ni `docker-compose.yml`).

Limitación a documentar: presencia/SSE en memoria asume una sola instancia de backend (igual que hoy).

## Frontend (`frontend/src/app/features/depmap/`)

- `dep-map-geometry.ts` — puerto **literal** de `W=168,H=52`, `clip()`, `geom()`, `pairs()`, `rel()` y del cálculo de clases (`base/out/in/sel/dim`, `touched`, ancho `1.2+min(n,6)*.45`) como funciones puras. Garantiza mismas coordenadas/paths.
- `dep-map-store.ts` — servicio `@Injectable` con signals: estado del servidor, filtros (`view,q,estado,kindsOn,mine,node,pair`), `visible` como `computed`, carga vía `Api` (`core/api.ts`), `EventSource('/api/depmap/events')` con `refreshSoon` 140 ms, reintento 8 s, modo sin conexión con caché en `localStorage` (mismas claves `depmap-mine`, `depmap-view`, `depmap-cache-v2`, envueltas en try/catch), `flash(id)`.
- `dep-map.ts` (página, ruta) — cabecera (título, píldora En vivo, **Mi grupo**, Datos, Agregar dependencia), banner sin conexión, barra (tabs Mapa/Matriz/Lista con `role=tab`/`aria-selected`, búsqueda, estado, chips de tipo con `aria-pressed`), grilla `minmax(0,1fr) 420px` con panel sticky; breakpoints 1020/760/560 replicados con utilidades Tailwind.
- `dep-map-graph.ts` — SVG `viewBox="0 0 1000 745"`, markers, capas pasivas/activas/nodos, etiqueta "tu grupo", nodos focusables (Enter/Espacio), `min-width:720px` + scroll horizontal bajo 760px, leyenda contextual.
- `dep-map-matrix.ts`, `dep-map-list.ts`, `dep-map-panel.ts` — mismo contenido/orden (resumen 2 cifras, "Necesita de", "Lo necesitan", tareas propias, actividad reciente con tiempos relativos refrescados cada 60 s, ítems con tilde y ×).
- Diálogos con `<dialog>` nativo como en `features/admin/admin-users.ts`: Agregar dependencia, Datos (Copiar / Restaurar originales / Aplicar JSON — los dos últimos solo si `isAdmin`), confirmación de eliminar/restaurar. Toast local del componente.
- Estilos: utilidades Tailwind con tokens de Skill Hub (`bg-surface`, `border-border`, `text-text-muted`, `--radius`, sombras). En el `styles` del componente: `--dep-out` / `--dep-in` (azul/naranja con variante oscura bajo `prefers-color-scheme` + `[data-theme]`), animación `flash` y `prefers-reduced-motion`. Nada global.
- Convenciones: standalone, `ChangeDetectionStrategy.OnPush`, `inject()`, `@if/@for`, `signal/computed`.
- i18n: nueva sección `mapa` en `core/i18n/es.ts` (textos actuales, rioplatense) y `core/i18n/en.ts` (tipo `Dict` lo exige). Los textos de datos (nombres, dependencias) no se traducen.
- Ruta: `{ path: 'mapa', loadComponent: () => import('./features/depmap/dep-map').then(m => m.DepMap) }` dentro de los children del Shell en `app.routes.ts` (hereda `authGuard`). Link en `layout/shell.ts` → `navLinks` base (`n.mapa`).

## Corte y datos

1. Antes de generar `V23`, tomar el `state.json` vivo del contenedor actual para los `INSERT`.
2. Tras desplegar, si hubo cambios en el viejo entre medio: **Datos → Copiar** en el viejo y **Aplicar JSON** como admin en el nuevo (contrato compatible).
3. Dar de baja el contenedor `mapa-dependencias` (no se borra el repo). Actualizar `README.md` de Skill Hub con la sección del mapa.

## Archivos

Nuevos: `backend/.../depmap/{DepMapController,DepMapService,DepMapRepository,DepMapEvents}.java`, `db/migration/V23__dependency_map.sql`, `resources/depmap/seed.json`, `backend/src/test/java/com/skillhub/DepMapIntegrationTest.java`, `frontend/src/app/features/depmap/*` (+ `dep-map-geometry.spec.ts`).
Modificados (mínimo): `frontend/src/app/app.routes.ts`, `frontend/src/app/layout/shell.ts` (un link), `frontend/src/app/core/i18n/es.ts`, `en.ts`, `README.md`.

## Verificación

- `cd backend && mvn test` — `DepMapIntegrationTest` (Testcontainers, patrón de `RestApiIntegrationTest`): estado inicial = 13 nodos con mismas `x/y`, 57 edges, 4 tildes; alta/baja/tilde incrementan `version` y registran actividad + audit; mensajes de validación idénticos; import/reset 403 para no-admin; 401 sin sesión; SSE recibe `hello` y `update`.
- `cd frontend && npm run build` y `npx ng test` — `dep-map-geometry.spec.ts` compara paths/posiciones contra valores calculados con el `index.html` original para pares conocidos (p. ej. `cur>acc`, ida y vuelta).
- E2E manual: `docker compose up -d --build`, abrir `/mapa` en dos navegadores con usuarios distintos: píldora "En vivo · 2 en línea", alta en uno aparece en el otro con flash; screenshots lado a lado con la app vieja (`127.0.0.1:8790`) al mismo ancho para comparar posición de nodos, flechas, badges y panel en Mapa/Matriz/Lista; cortar backend → banner sin conexión y modo lectura.

## Sugerencias aparte (no incluidas)

- Preseleccionar "Mi grupo" a partir del `team` del usuario (los nombres del enum `Team` no coinciden 1:1 con los nodos; requiere un mapeo).

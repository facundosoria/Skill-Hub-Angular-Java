# Marketplace-Migration

Migración del **Skill Hub** (hoy Next.js 16 en `D:\Marketplace`) a **Angular + Spring Boot**.
Plan completo: `D:\ClaudeData\claude-home\plans\me-gustaria-migrar-todo-lively-blossom.md`.

## Estado: spike + 7 tools MCP + auth de sesión + API REST ✅

| | |
|---|---|
| `backend/` | Spring Boot 3.4 (Java 21, Maven). MCP + API REST completos, 38 tests en verde. |
| `frontend/` | Angular 22 (standalone, signals, zoneless) + Tailwind 4. **Todas las pantallas portadas y verificadas e2e.** |

## Frontend (`frontend/`)

```bash
cd frontend
npm install
npm start          # ng serve :4200, proxy /api -> :8080 (necesita el backend levantado)
npm run build
```

- **core/**: `Api` (HttpClient `withCredentials`), `AuthService` + guards (`authGuard`/`adminGuard`/`guestGuard`),
  `ThemeService`, `I18n` (los dicts `es.ts`/`en.ts` del proyecto Next portados verbatim, ahora como signal),
  `SkillService`
- **Ruteo**: las 14 rutas con lazy loading; `Shell` (nav + `<router-outlet>`, links de admin condicionales);
  `provideAppInitializer` resuelve la sesión antes del primer render (equivale a `getCurrentUser` en el layout)
- **shared/ui.ts**: primitivas portadas de `primitives.tsx` (Button, Badge, Card, Field, Input, Textarea, Select, EmptyState, StatusBadge)
- **Tokens de diseño**: `globals.css` → `styles.css`, con el script anti-parpadeo de tema en `index.html`
- **Páginas reales**: login (+ registro), catálogo, detalle de skill (markdown GFM + preview
  sandboxeado + banner de votación + acciones de admin), `skill-form` (crear/editar
  **con live-checks de duplicados a 350 ms e idioma a 600 ms**), keys, profile, review,
  insights, audit, admin/users
- **markdown**: `marked` + `DOMPurify` (puerto de `skill-markdown.tsx`) + **Shiki** para los bloques
  de código (doble tema, mejora sobre el original); preview en `<iframe sandbox="allow-scripts">` sin `allow-same-origin`
- **diff de versiones**: `jsdiff` (`diffLines`) — `/skills/:slug/diff?a=&b=`, puerto de `diff-view.tsx`
- **docs** (`/docs`): el contenido son dos `.md` (`public/content/docs.{es,en}.md`) renderizados con el
  mismo pipeline (marked + Shiki); índice lateral con scroll-spy generado de los `##`

- **animaciones** (puerto de `motion/react`): `animate.enter`/`animate.leave` nativos de Angular 22
  (sin `@angular/animations`) + keyframes CSS + `withViewTransitions()` para el cross-fade entre rutas.
  Colapso de paneles condicionales, stagger de listas, fade del "guardado". Los keyframes arrancan
  en opacity 0.35 (no 0) para que nada quede invisible si la animación no corre; `prefers-reduced-motion` las apaga.

**El frontend Angular está portado.** Todas las pantallas funcionan contra el backend.

El spike valida las dos incógnitas de mayor riesgo del plan:

1. **Las migraciones SQL de Drizzle corren tal cual en Flyway.** Los 10 archivos de
   `D:\Marketplace\drizzle\*.sql` + los 2 de `drizzle/extra/` se copiaron verbatim a
   `backend/src/main/resources/db/migration/V1..V12`. Flyway los aplica sobre un Postgres 16
   limpio sin tocarlos (los `WARN ... already exists, skipping` de V6/V7 son los `IF NOT EXISTS`
   que Drizzle ya traía por migraciones solapadas). De `V13` en adelante ya no vienen de Drizzle:
   `V13` purga los skills de ejemplo y las cuentas no-admin antes del uso real; `V14` re-siembra
   el skill de referencia `writing-skills`; `V15` agrega `skill_versions.proposed_by_agent`;
   `V16` renombra 4 entradas del catálogo a la convención `generate-*`.
2. **La búsqueda full-text de Postgres se porta como SQL crudo, sin cambios de comportamiento.**
   `SearchRepository` es el puerto línea por línea de `src/server/skills/search.ts`: las 3 pasadas
   (`websearch_to_tsquery` estricta → OR laxa con piso de `ts_rank` → trigramas), el ranking
   `ts_rank × boost`, el período de gracia. Los 17 tests de integración pasan.

```
McpIntegrationTest   23 tests   (MCP end-to-end)
RestApiIntegrationTest 15 tests  (auth + API REST)
-> 38 en verde
```

## Cómo correr

Requisitos: JDK 21, Maven, Docker (para los tests con Testcontainers).

```bash
cd backend
mvn test          # Postgres 16 en Testcontainers, Flyway V1..V16, MCP + API REST por HTTP
mvn spring-boot:run   # contra un Postgres local (ver application.yml / SPRING_DATASOURCE_*)
```

Env del server: `SPRING_DATASOURCE_URL` / `_USERNAME` / `_PASSWORD`, `SESSION_SECRET` (>= 32 chars),
`APP_TZ`, `COOKIE_SECURE=true` en prod, `USAGE_RETENTION_DAYS`.

El toolchain de esta máquina: Temurin JDK 21 (`winget`), Maven 3.9.9 en `C:\Tools`
(no está en winget, se bajó a mano). `JAVA_HOME` y el `PATH` quedaron seteados a nivel usuario.

## Qué cubre el spike (y qué no)

**Implementado**
- `GET /api/health`
- `POST /api/mcp` — JSON-RPC 2.0 stateless: `initialize`, `tools/list`, `tools/call`, `ping`
- Auth por API key: `Authorization: Bearer sk_hub_...`, hash SHA-256, revocación inmediata
- **Las 7 tools MCP completas:**
  - lectura: `search_skills`, `get_skill`, `sync_skills`, `list_skills`, `get_port_registry`
  - escritura: `propose_skill` — con las 3 guardas del original (idioma inglés vía heurística
    `LanguageDetector`, duplicado por trigramas + tags vía `DuplicatesRepository.esDuplicadoFuerte`,
    slug único), inserción transaccional y `audit_events`
  - escritura: `propose_revision` — cambio a una convención publicada como revisión pendiente
    (`proposed_by_agent`, sin tocar la versión viva); acepta `title` y `new_slug` (renombre con
    redirección `deprecated` / `superseded_by` sobre el slug viejo)
- `get_skill`/`sync_skills` devuelven el `.md` guardable con frontmatter determinista y sin `preview`
- Telemetría de uso: cola acotada + flush `@Scheduled` cada 5 s, rollup `usage_daily`
  (contrato "nunca tira" — cada insert va aislado, un skill borrado no tumba el lote)
- `AuditService` (puerto de `audit.ts`) — snapshot de identidad + metadata JSON en columna text

**Auth de sesión** (puerto de `auth/session.ts` + `auth/index.ts` + `auth/password.ts`)
- `PasswordHasher` — scrypt vía Bouncy Castle, formato `scrypt$N$r$p$salt$key` **compatible byte a byte**
  con los hashes que ya generó el proyecto Next (verifica un hash escrito por Node y viceversa)
- `SessionService` — JWT HS256 (jjwt) en cookie httpOnly `skillhub_session`, 7 días,
  payload `{userId, username, role}`. El estado de la cuenta se re-chequea en cada request.
- `@AuthPrincipal CurrentUser` — resolver de argumento que inyecta el usuario de la cookie
  (401 si falta); los controllers chequean `user.isAdmin()` para lo de admin

**API REST** (puerto de las server actions + las lecturas de las páginas)
- auth: `POST /api/auth/{login,register,logout}`, `GET /api/auth/me`
- skills: `GET /api/skills`, `GET /api/skills/{slug}` (+ history, related, voteStatus),
  `GET /api/skills/{slug}/diff`, `POST /api/skills` (create, con guardas de idioma y duplicados),
  `PUT /api/skills/{slug}` (update — versión pendiente + votos si un member edita algo publicado),
  `POST /api/skills/{slug}/{publish,deprecate,vote,apply-edit,discard-edit}`,
  `GET /api/skills/duplicates`, `POST /api/skills/check-language`
- `VoteService` — `VOTES_REQUIRED=3`, la 3ª aprobación aplica la edición sola
- review (admin): `GET /api/review`, `POST /api/review/{slug}/{approve,reject}`
- keys: `GET/POST /api/keys`, `DELETE /api/keys/{id}`
- profile: `GET/PUT /api/profile`
- admin users: `GET /api/admin/users`, `POST /api/admin/users/{id}/{approve,reject,reset-password}`
- audit (admin): `GET /api/audit`  ·  insights (admin): `GET /api/insights`
- Todo error de la API sale como `{"error": "..."}` (`ApiExceptionHandler`)

**Pendiente para el proyecto real**
- `skill_related` no se edita desde ningún endpoint todavía (el original tampoco lo expone en la web)

El frontend Angular entero y el espejo de tema/idioma anti-parpadeo (script en `index.html` +
`ThemeService`) ya están portados — ver la sección *Frontend*.

## Decisiones del spike que ajustan el plan

### MCP: JSON-RPC a mano, no el SDK de Java
El plan decía "usar el MCP Java SDK". El spike encontró que el SDK ya está en **2.x siguiendo la
spec stateless del 2026-07-28** (sin handshake `initialize`, sin `Mcp-Session-Id`), mientras que
los clientes Claude y el server Next actual todavía negocian **2025-06-18** y devuelven
`instructions` en el `initialize`. Para un server de sólo lectura sin sesión, el JSON-RPC son
~4 métodos: se implementó a mano en `McpController` (~120 líneas), sin dependencia que se mueva.
**Recomendación:** bajar ese punto del plan de "usar el SDK" a "evaluar el SDK vs. el controlador
propio" — el propio ya anda y matchea el contrato que esperan los tests del original.

### Migraciones: verbatim, no consolidadas
Se confirmó que no hace falta un baseline consolidado. En la base de prod (que ya tiene el schema
de Drizzle) se arranca con `spring.flyway.baseline-on-migrate=true` y `baseline-version=12` para que
no reaplique nada; en una base limpia se aplican las 12.

### Parity de YAML pendiente
`js-yaml` (original) y SnakeYAML (Java) formatean distinto. El roundtrip
(`serialize → parse → mismos campos`) funciona y los tests portados pasan, pero el test del
original que hace *snapshot del string exacto* de `buildSkillFrontmatter` va a necesitar un
emisor a medida o ajustar el snapshot.

### Testcontainers 1.20.4 + Docker 29
Docker 29 subió la API mínima a 1.44 y el `docker-java` de Testcontainers 1.x cae a 1.32. Se fijó
`api.version=1.44` en `src/test/resources/docker-java.properties`. En el proyecto real conviene
Testcontainers 2.x, que negocia la versión solo.

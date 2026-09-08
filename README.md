# Marketplace-Migration

Migración del **Skill Hub** (hoy Next.js 16 en `D:\Marketplace`) a **Angular + Spring Boot**.
Plan completo: `D:\ClaudeData\claude-home\plans\me-gustaria-migrar-todo-lively-blossom.md`.

## Estado: Paso 1 (spike) + las 6 tools MCP ✅

| | |
|---|---|
| `backend/` | Proyecto Spring Boot 3.4 (Java 21, Maven). Spike funcionando. |
| `frontend/` | Angular — todavía no. |

El spike valida las dos incógnitas de mayor riesgo del plan:

1. **Las migraciones SQL de Drizzle corren tal cual en Flyway.** Los 10 archivos de
   `D:\Marketplace\drizzle\*.sql` + los 2 de `drizzle/extra/` se copiaron verbatim a
   `backend/src/main/resources/db/migration/V1..V12`. Flyway los aplica sobre un Postgres 16
   limpio sin tocarlos (los `WARN ... already exists, skipping` de V6/V7 son los `IF NOT EXISTS`
   que Drizzle ya traía por migraciones solapadas).
2. **La búsqueda full-text de Postgres se porta como SQL crudo, sin cambios de comportamiento.**
   `SearchRepository` es el puerto línea por línea de `src/server/skills/search.ts`: las 3 pasadas
   (`websearch_to_tsquery` estricta → OR laxa con piso de `ts_rank` → trigramas), el ranking
   `ts_rank × boost`, el período de gracia. Los 17 tests de integración pasan.

```
Tests run: 23, Failures: 0, Errors: 0, Skipped: 0
```

## Cómo correr

Requisitos: JDK 21, Maven, Docker (para los tests con Testcontainers).

```bash
cd backend
mvn test          # Postgres 16 en Testcontainers, Flyway V1..V12, /api/mcp por HTTP
mvn spring-boot:run   # contra un Postgres local (ver application.yml / SPRING_DATASOURCE_*)
```

El toolchain de esta máquina: Temurin JDK 21 (`winget`), Maven 3.9.9 en `C:\Tools`
(no está en winget, se bajó a mano). `JAVA_HOME` y el `PATH` quedaron seteados a nivel usuario.

## Qué cubre el spike (y qué no)

**Implementado**
- `GET /api/health`
- `POST /api/mcp` — JSON-RPC 2.0 stateless: `initialize`, `tools/list`, `tools/call`, `ping`
- Auth por API key: `Authorization: Bearer sk_hub_...`, hash SHA-256, revocación inmediata
- **Las 6 tools MCP completas:**
  - lectura: `search_skills`, `get_skill`, `sync_skills`, `list_skills`, `get_port_registry`
  - escritura: `propose_skill` — con las 3 guardas del original (idioma inglés vía heurística
    `LanguageDetector`, duplicado por trigramas + tags vía `DuplicatesRepository.esDuplicadoFuerte`,
    slug único), inserción transaccional y `audit_events`
- `get_skill`/`sync_skills` devuelven el `.md` guardable con frontmatter determinista y sin `preview`
- Telemetría de uso: cola acotada + flush `@Scheduled` cada 5 s, rollup `usage_daily`
  (contrato "nunca tira" — cada insert va aislado, un skill borrado no tumba el lote)
- `AuditService` (puerto de `audit.ts`) — snapshot de identidad + metadata JSON en columna text

**Pendiente para el proyecto real**
- Camino de escritura desde la web: create/update/publish/deprecate, votos
- Auth de sesión (JWT `skillhub_session`) + `PasswordEncoder` compatible con el formato
  `scrypt$N$r$p$salt$key` del original
- Toda la API REST que consume el frontend
- El frontend Angular entero

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

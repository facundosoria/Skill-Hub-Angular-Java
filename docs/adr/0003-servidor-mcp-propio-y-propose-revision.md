# 0003. Servidor MCP propio (JSON-RPC a mano) y flujo `propose_revision`

- **Estado:** Aceptado
- **Fecha:** 2026-09-08

## Contexto

Skill Hub expone su catálogo a agentes de IA vía MCP en `POST /api/mcp`. El
plan de migración decía "usar el MCP Java SDK". Durante el spike se encontró
que el SDK ya estaba en 2.x siguiendo la spec **stateless del 2026-07-28** (sin
handshake `initialize`, sin `Mcp-Session-Id`), mientras que los clientes
Claude y el servidor Next de entonces negociaban **2025-06-18** y devolvían
`instructions` en el `initialize`.

Además, los agentes necesitaban un canal para proponer cambios a convenciones
ya publicadas sin pisar la versión viva, simétrico a `propose_skill` para
entradas nuevas.

## Decisión

1. **JSON-RPC 2.0 implementado a mano** en `backend/src/main/java/com/skillhub/mcp/`
   (`McpController`, `McpTools`, `McpInstructions`, `SkillCatalog`):
   `initialize`, `tools/list`, `tools/call`, `ping`, stateless y sólo por POST
   (`GET /api/mcp` responde 401 sin token y 405 con token).
2. **Siete tools:** lectura (`search_skills`, `get_skill`, `sync_skills`,
   `list_skills`, `get_port_registry`) y escritura (`propose_skill`,
   `propose_revision`).
3. **`propose_revision`** (commit `5e1d58e`, ampliado en `c8cf3fa` y `d3da27b`):
   - Crea una **revisión pendiente** (`pending_version_id` + `meta_snapshot`),
     nunca toca la versión publicada; la aprueba o rechaza un admin en `/review`.
   - `base_version` detecta ediciones intermedias (rechazo *stale*).
   - V15 agrega `skill_versions.proposed_by_agent` para distinguirla de una
     edición web por votos.
   - Acepta `title` y `new_slug`: al aprobarse renombra la fila in place
     (conserva `id`, historial y métricas) y deja el slug viejo como
     `deprecated` → `superseded_by`, reutilizando el redirect que ya exponen
     `get_skill` / `sync_skills`.
   - El autor puede reemplazar su propia revisión pendiente (misma
     `base_version`); una pendiente de otro autor o una edición web por votos
     sigue bloqueando.
   - `owning_team` explícito opcional (por defecto, el equipo de la credencial)
     para no dejar una convención `shared` con dueño del equipo proponente.
4. Artifacts de hasta 5 MB se entregan en `get_skill` como `content_base64`
   dentro de la respuesta MCP ya autenticada (commit `699c0f3`), porque un
   cliente MCP no tiene el Bearer en texto plano para seguir un `download_url`.

## Alternativas consideradas

- **MCP Java SDK 2.x:** descartado en el spike por la diferencia de versión de
  protocolo con los clientes reales; el README recomienda "evaluar el SDK vs.
  el controlador propio" en lugar de adoptarlo por defecto.
- **Que el agente edite directamente la versión publicada:** descartado; el
  cambio pasa por revisión humana (`/review`).
- **Renombrar borrando y re-creando el skill:** descartado para no perder
  historial ni `usage_daily` (FK por id).

## Consecuencias

- Sin dependencia que cambie de spec bajo los pies (~120 líneas de controlador),
  pero el protocolo se mantiene a mano: actualizar a nuevas versiones de MCP es
  trabajo propio.
- Las reglas de dedup, piso de relevancia y conteo de uso viven en el servidor
  (ver [0005](0005-busqueda-full-text-postgres-y-deteccion-de-idioma.md)).
- Autenticación del endpoint: ver [0002](0002-autenticacion-sesiones-api-keys-y-oauth-hydra.md).
- Renombres masivos del catálogo se hicieron por migración (V16, ver
  [0004](0004-flyway-unica-via-de-cambio-de-esquema.md)).

## Referencias

- [README.md](../../README.md) — "MCP: JSON-RPC a mano, no el SDK de Java" y
  "Las 7 tools MCP completas".
- Commits `a3bbd6e`, `9a74fbe`, `5e1d58e`, `c8cf3fa`, `d3da27b`, `08e539c`, `699c0f3`.
- `backend/src/main/resources/db/migration/V15__skill_version_proposed_by_agent.sql`.
- Tests: `McpIntegrationTest`.

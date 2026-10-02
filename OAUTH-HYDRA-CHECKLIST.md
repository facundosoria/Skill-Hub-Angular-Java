# Checklist de cierre Hydra/OAuth

Guía operativa para el endpoint MCP. Los estados permitidos son `pendiente`,
`en progreso`, `aprobado` y `bloqueado`; `aprobado` exige evidencia reproducible
en código, test o un paso de la suite E2E.

## Estado actual

- **Última revisión:** 2026-10-01
- **Estado:** aprobado con riesgos operativos documentados
- **Fuente relacionada:** `HYDRA-OAUTH.md`, `docker-compose.yml`, `backend/src/main/java/com/skillhub/oauth/`, `frontend/src/app/features/auth/`, `scripts/test-hydra-oauth.sh` y `e2e/oauth/README.md`

## Resultado de verificación

La suite `scripts/test-hydra-oauth.sh` terminó con `RESULT PASS checks=15
failures=0` y código 0. El frontend se verificó en una copia temporal con
`node:22-alpine` (Node 22.23.3): `npm ci` código 0, 4 archivos/12 tests
aprobados y `npm run build` código 0. El backend terminó con 109 tests, 0
fallos, 0 errores y 0 omitidos.

Los warnings CSS de presupuesto del build son preexistentes y no alteran el
resultado. El Node local 22.12.0 queda registrado como limitación de entorno;
no se modificaron `package.json`, tests ni el Node del sistema.

## Criterios documentales (Fase 7)

| Criterio | Estado | Evidencia |
|---|---|---|
| 7.1 Actualizar `HYDRA-OAUTH.md` | aprobado | `HYDRA-OAUTH.md`: estado, controles, E2E, diagnóstico, rollback, riesgos y producción. |
| 7.2 Actualizar esta checklist | aprobado | Esta tabla y los criterios finales conservan estado y evidencia. |
| 7.3 Corregir README obsoleto | aprobado | `README.md`: conteo backend actualizado y sección OAuth/Hydra enlazada. |
| 7.4 DCR sin cuenta previa | aprobado | `HYDRA-OAUTH.md` y E2E 5.2; registro público sin login. |
| 7.5 Separar registro de acceso | aprobado | `HYDRA-OAUTH.md` y E2E 5.2/5.7/5.8; DCR no crea sesión ni acceso MCP. |
| 7.6 Controles de seguridad | aprobado | `HYDRA-OAUTH.md`; `HydraJwtValidatorTest`, `McpOAuthIntegrationTest`, `HydraAdminClientConsentTest`; E2E 5.3, 5.6 y 5.12. |
| 7.7 Riesgo de spam pospuesto | aprobado | `HYDRA-OAUTH.md`, sección “Riesgos residuales y criterio de producción”. |
| 7.8 Ejecución E2E | aprobado | `e2e/oauth/README.md`, `scripts/test-hydra-oauth.sh`, salida final 15/15. |
| 7.9 Diagnóstico y rollback | aprobado | `HYDRA-OAUTH.md`, sección “Diagnóstico y rollback”. |
| 7.10 Criterio de producción | aprobado | `HYDRA-OAUTH.md`, sección “Riesgos residuales y criterio de producción”. |

## Criterios finales (7.17–7.32)

| Criterio | Estado | Evidencia |
|---|---|---|
| 7.17 Un cliente puede registrarse sin cuenta | aprobado | E2E 5.2: DCR público devuelve cliente sin login previo. |
| 7.18 El registro no permite acceder a datos | aprobado | E2E 5.2: cliente sin login recibe 401 en MCP; E2E 5.8–5.10 sólo pasan con token válido. |
| 7.19 Sólo usuario activo, autenticado y con consentimiento obtiene token | aprobado | E2E 5.5–5.7 y 5.13: login, consentimiento, code exchange y usuario inactivo rechazado. |
| 7.20 PKCE, issuer, audiencia, recurso, subject y scope validados | aprobado | `HydraJwtValidatorTest`, `McpOAuthIntegrationTest`; E2E 5.3, 5.4 y 5.12; `scope`/`scp` y recurso MCP configurados. |
| 7.21 Logout funciona | aprobado | `OAuthLogoutTest`, `HydraAdminClientLogoutTest`; E2E 5.11: callback, cookie eliminada y `/api/auth/me` 401. |
| 7.22 Cambio obligatorio no se puede saltar | aprobado | `OAuthPasswordChangeFlowTest`; E2E 5.15: no token antes y token sólo después del cambio. |
| 7.23 API keys y login web siguen funcionando | aprobado | `McpIntegrationTest`, `RestApiIntegrationTest`; E2E 5.14; backend 109 tests. |
| 7.24 Suite E2E completa desde entorno limpio | aprobado | `scripts/test-hydra-oauth.sh`: proyecto Compose aislado, `RESULT PASS checks=15 failures=0`, código 0; logs sin secretos. |
| 7.25 Checklist con evidencia de cada criterio aprobado | aprobado | Tablas de criterios documentales y finales de este archivo. |
| 7.26 DCR habilitado en producción | aprobado | `docker-compose.yml`: DCR habilitado; E2E 5.2. |
| 7.27 No se exige cuenta Skill Hub antes de DCR | aprobado | `HYDRA-OAUTH.md` y E2E 5.2. |
| 7.28 PKCE obligatorio | aprobado | `docker-compose.yml` (`OAUTH2_PKCE_ENFORCED_FOR_PUBLIC_CLIENTS=true`); E2E 5.3 valida rechazo al finalizar authorize/token exchange. |
| 7.29 Scope único obligatorio `mcp` | aprobado | `HydraJwtValidator` exige `mcp` en `scope` o `scp`; consentimiento filtra scopes; E2E 5.8–5.12. |
| 7.30 Rate limiting/spam pospuestos y documentados | aprobado | `HYDRA-OAUTH.md`: riesgo residual, monitoreo y criterio de producción explícitos. |
| 7.31 Registrar cliente no concede acceso MCP | aprobado | E2E 5.2/5.8; validación JWT exige usuario activo, recurso y scope. |
| 7.32 Consentimiento obligatorio | aprobado | `OAuthControllerTest`, `HydraAdminClientConsentTest`; E2E 5.6 rechazo explícito y 5.7 code exchange sólo tras aceptar. |

## Regresión de conexión Claude Desktop

- Hydra publica `registration_endpoint` sólo cuando se configura
  `WEBFINGER_OIDC_DISCOVERY_CLIENT_REGISTRATION_URL`; el endpoint anunciado es
  `${PUBLIC_BASE_URL}/oauth2/register` y conserva DCR público, PKCE obligatorio
  y cliente público `token_endpoint_auth_method=none`.
- `/api/mcp` responde `401` con `WWW-Authenticate` antes de método no soportado
  y `405 Allow: POST` después de autenticar; `HttpRequestMethodNotSupportedException`
  también se mapea globalmente a 405.
- Las rutas `.well-known` path-inserted se sirven como JSON desde backend y no
  reciben el fallback HTML de Caddy; el E2E las verifica junto con DCR.

## Riesgos residuales

- Rate limiting específico de DCR y mitigación avanzada de spam quedan
  pospuestos; registrar y monitorear el riesgo antes de tráfico no confiable.
- Hydra 2.2 no limita globalmente `grant_types` ni `scope` en DCR; el control
  compensatorio es el filtrado en consentimiento y la validación de audiencia,
  recurso y `mcp` en `/api/mcp`.
- Las transacciones de cambio obligatorio viven en memoria y no son
  distribuidas entre réplicas; un reinicio invalida una continuación pendiente.
- El Node local 22.12.0 es menor al requerido por Angular CLI 22; Paso A se
  aprobó con Node 22.23.3 en `node:22-alpine` sobre una copia temporal.

## Operación

La provisión de PostgreSQL para Hydra es declarativa: `docker-compose.yml`
ejecuta `db-init`, que comparte `scripts/db/init-hydra-db.sh` con el override
E2E. El script espera a PostgreSQL y reconcilia rol, password, ownership y
privilegios sin imprimir secretos; `hydra-migrate` sólo comienza si termina
correctamente.

La provisión de claves también es declarativa: `hydra-keys` materializa de
forma idempotente `hydra.openid.id-token` y `hydra.jwt.access-token` mediante el
Admin API antes de permitir el arranque de `backend`. `docker-compose.e2e.yml`
hereda el mismo servicio, por lo que readiness implica que Hydra ya tiene las
claves necesarias y no sólo que `/health/ready` responde 200.

Para el flujo completo usar:

```bash
scripts/test-hydra-oauth.sh
```

Para diagnosticar sin exponer secretos: `docker compose -p skillhub-e2e ps` y
`docker compose -p skillhub-e2e logs --no-color`; no usar `down` sobre otro
proyecto. El rollback conserva las bases existentes y vuelve a la imagen o
artefacto anterior; no eliminar `pgdata` compartido.

## Historial de cierre

| Fecha | Tarea | Verificación | Estado |
|---|---|---|---|
| 2026-10-01 | Cierre documental P7 | Paso A en Node 22.23.3 Docker; E2E 15/15; backend 109 tests; `git diff --check` | Aprobado |

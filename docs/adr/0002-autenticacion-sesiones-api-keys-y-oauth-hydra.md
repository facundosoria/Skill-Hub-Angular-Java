# 0002. Autenticación: sesiones propias, API keys y OAuth con Ory Hydra para MCP

- **Estado:** Aceptado
- **Fecha:** 2026-09-08 (sesiones y API keys) · 2026-10-01 (Hydra/OAuth)

## Contexto

La aplicación tiene tres tipos de cliente: el navegador (SPA Angular), agentes
que llaman al servidor MCP con una credencial fija, y clientes MCP estándar
(por ejemplo los conectores de Claude) que esperan descubrir un Authorization
Server OAuth y registrarse solos (DCR).

Los usuarios y sus hashes de contraseña ya existían en la base del proyecto
Next.js, generados con scrypt por Node.

## Decisión

1. **Sesión web propia** (`backend/.../session/`): JWT HS256 (jjwt) en cookie
   httpOnly `skillhub_session`, 7 días, payload `{userId, username, role}`. El
   estado de la cuenta se re-chequea en cada request. `PasswordHasher` usa
   scrypt vía Bouncy Castle con formato `scrypt$N$r$p$salt$key`, **compatible
   byte a byte** con los hashes generados por el proyecto Next, para no forzar
   un reseteo de contraseñas al migrar.
2. **API keys para MCP** (`auth/ApiKeyService.java`): `Authorization: Bearer
   sk_hub_...`, guardadas como hash SHA-256, con revocación inmediata.
3. **OAuth 2.1 con Ory Hydra para `/api/mcp`** (`backend/.../oauth/`, commits
   `cd846f0`, `d671c2c`, `ddc4679`): Hydra es el Authorization Server pero
   **no administra usuarios**; el login y el consentimiento los resuelve Skill
   Hub y el `user.id` es el `sub` del token. Authorization Code + PKCE, DCR
   habilitado sin exigir cuenta previa (registrar un cliente sólo crea una
   identidad técnica). `HydraJwtValidator` exige RS256, issuer, `sub` UUID,
   `exp`, audiencia `${PUBLIC_BASE_URL}/api/mcp` y scope `mcp`;
   `OAuthIdentityService` exige `users.status = 'active'`.
4. Las API keys **siguen funcionando** y no pasan por la validación JWT; ambas
   rutas terminan en la misma `ApiKeyIdentity` (con `apiKeyId = null` para OAuth).
5. El cambio obligatorio de contraseña (V20) se integra con OAuth mediante una
   transacción pendiente de un solo uso (`OAuthPasswordChangeService`).

## Alternativas consideradas

- **Exigir cuenta Skill Hub antes del DCR:** descartado explícitamente para no
  obligar a registrar a mano cada cliente MCP ([PLAN-HYDRA-OAUTH.md](../../PLAN-HYDRA-OAUTH.md), Fase 2).
- **Sólo API keys:** insuficiente para clientes MCP que requieren discovery
  OAuth (RFC 8414 / RFC 9728) y DCR (commit `ddc4679`).
- **Otro Authorization Server (Keycloak, Spring Authorization Server) o
  implementarlo en el backend:** *Razón no registrada — confirmar* por qué se
  eligió Hydra.
- **Rate limiting avanzado del DCR:** pospuesto deliberadamente; queda como
  riesgo operativo aceptado ([HYDRA-OAUTH.md](../../HYDRA-OAUTH.md), "Riesgos residuales").

## Consecuencias

- Un servicio más en Compose (Hydra + `hydra-migrate` + `hydra-keys`) y una base
  `hydra` adicional en el mismo Postgres; `rebuild-app.sh` debe verificar su
  esquema, salud y claves antes de recrear el backend.
- El puerto admin 4445 de Hydra debe quedar sólo dentro de Docker.
- Hydra 2.2 no permite una allow-list global de `grant_types` ni de scopes en
  DCR; el control compensatorio es filtrar en el consentimiento y validar
  recurso + `mcp` en `/api/mcp`.
- Las transacciones de cambio de contraseña viven en memoria: un reinicio o una
  segunda réplica invalida la continuación OAuth pendiente.
- Hubo intermitencia bajo carga por generación perezosa de JWKs en Hydra,
  resuelta provisionando claves antes de declararlo listo
  ([docs/OAUTH-INTERMITENCIA-HYDRA.md](../OAUTH-INTERMITENCIA-HYDRA.md), commits
  `9652fbd`, `22871ea`).

## Referencias

- [HYDRA-OAUTH.md](../../HYDRA-OAUTH.md), [PLAN-HYDRA-OAUTH.md](../../PLAN-HYDRA-OAUTH.md),
  [OAUTH-HYDRA-CHECKLIST.md](../../OAUTH-HYDRA-CHECKLIST.md),
  [docs/OAUTH-INTERMITENCIA-HYDRA.md](../OAUTH-INTERMITENCIA-HYDRA.md).
- [README.md](../../README.md) — secciones "Auth de sesión" y "OAuth/Hydra para MCP".
- `scripts/test-hydra-oauth.sh`, `e2e/oauth/README.md`.
- Commits `e41bd62`, `c5dfaa7`, `cd846f0`, `d671c2c`, `ddc4679`, `9652fbd`.
- Relacionado: [0007](0007-rate-limiting-con-filtro-propio.md).

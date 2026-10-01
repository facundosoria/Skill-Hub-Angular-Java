# Hydra y OAuth para MCP

## Propósito

Skill Hub usa Ory Hydra como Authorization Server OAuth 2.1 para proteger el
servidor MCP HTTP (`/api/mcp`). Hydra no administra usuarios: el login se
resuelve contra los usuarios existentes de Skill Hub y el `user.id` de Skill Hub
se usa como subject del token.

La integración mantiene compatibilidad con las API keys existentes. Un cliente
MCP puede autenticarse con una API key `sk_hub_...` o con un access token JWT
emitido por Hydra.

## Arquitectura

```text
Cliente MCP
    |
    |  POST /api/mcp
    v
Caddy / frontend :8087
    |-- /api/* ----------------------> backend :8080
    |-- /oauth2/* -------------------> Hydra public :4444
    |-- /.well-known/* --------------> backend o Hydra
    |
    +-- Hydra admin :4445 <----------- backend solamente
                 |
                 +--------------------> PostgreSQL / base hydra

backend :8080 -----------------------> PostgreSQL / base skillhub
```

El puerto administrativo `4445` no se publica. El puerto público de Hydra se
expone localmente en `127.0.0.1:4444` para debugging, pero en el flujo normal
los clientes acceden a través de Caddy y `PUBLIC_BASE_URL`.

## Componentes implementados

### Infraestructura

- `oryd/hydra:v2.2.0` en `docker-compose.yml`.
- Servicio `hydra-migrate`, que aplica el schema de Hydra sobre la base `hydra`.
- PostgreSQL con un único volumen Docker (`pgdata`) que contiene las bases
  `skillhub` y `hydra`.
- Healthcheck de Hydra sobre `/health/ready`.
- `scripts/rebuild-app.sh` espera que Hydra esté saludable antes de recrear el
  backend.

### Configuración

Las variables principales son:

| Variable | Uso |
|---|---|
| `PUBLIC_BASE_URL` | Issuer y base pública que ven los clientes OAuth. |
| `HYDRA_DB_PASSWORD` | Password del usuario de PostgreSQL para Hydra. |
| `HYDRA_SYSTEM_SECRET` | Secreto interno de Hydra. |
| `HYDRA_ISSUER` | Issuer esperado por el validador JWT del backend. |
| `HYDRA_JWKS_URI` | JWKS usado para validar access tokens. |
| `HYDRA_ADMIN_URL` | API administrativa interna de Hydra (`http://hydra:4445`). |
| `HYDRA_PUBLIC_URL` | URL interna usada por el backend para consultar discovery. |
| `HYDRA_MCP_RESOURCE_URL` | Recurso protegido: `/api/mcp`. |
| `HYDRA_PROTECTED_RESOURCE_METADATA_URL` | URL pública de metadata RFC 9728. |

Los valores reales deben vivir en `.env` y no se commitean.

### Login y consentimiento

Hydra está configurado con:

- `URLS_LOGIN=/oauth/login`;
- `URLS_CONSENT=/oauth/consent`;
- `URLS_LOGOUT=/oauth/logout`.

El login implementado es:

1. Hydra redirige al frontend con `login_challenge`.
2. `/oauth/login` solicita usuario y contraseña.
3. El backend valida las credenciales mediante `UserService`.
4. El backend acepta el login en Hydra usando el UUID del usuario como subject.
5. Hydra redirige a `/oauth/consent` cuando el cliente no tiene
   `skip_consent`.
6. El frontend consulta los datos del challenge a través de
   `GET /api/oauth/consent-request`.
7. El usuario ve el cliente y los scopes solicitados.
8. `Autorizar` llama a `POST /api/oauth/accept-consent`.
9. `Rechazar` llama a `POST /api/oauth/reject-consent`.
10. Hydra redirige al callback del cliente con un authorization code o con
    `access_denied`.

El backend obtiene los scopes directamente desde Hydra. El navegador no puede
modificar la lista de scopes que se otorga.

### Endpoints del backend

| Endpoint | Función |
|---|---|
| `POST /api/oauth/accept-login` | Valida credenciales y acepta `login_challenge`. |
| `GET /api/oauth/consent-request` | Devuelve nombre del cliente y scopes seguros para la UI. |
| `POST /api/oauth/accept-consent` | Acepta el consentimiento consultando los scopes en Hydra. |
| `POST /api/oauth/reject-consent` | Rechaza con `access_denied`. |
| `GET /.well-known/oauth-protected-resource` | Metadata RFC 9728 del recurso MCP. |
| `GET /.well-known/oauth-authorization-server` | Reenvía el discovery de Hydra bajo RFC 8414. |

### Validación de access tokens

`HydraJwtValidator` valida tokens JWT mediante Nimbus y el JWKS de Hydra:

- firma `RS256`;
- issuer;
- `sub`;
- expiración (`exp`).

`OAuthIdentityService` usa el `sub` como UUID de usuario, busca la cuenta en
`users` y exige `status = 'active'`. El resultado se adapta al mismo
`ApiKeyIdentity` usado por MCP, con `apiKeyId = null`.

El endpoint MCP devuelve `401` con `WWW-Authenticate` y el enlace a metadata
cuando falta o es inválida la autenticación.

## Discovery y superficie pública

Caddy publica:

- `/oauth2/*` hacia Hydra público;
- `/.well-known/openid-configuration` hacia Hydra;
- `/.well-known/jwks.json` hacia Hydra;
- `/.well-known/oauth-authorization-server` hacia el backend;
- `/.well-known/oauth-protected-resource` hacia el backend;
- `/userinfo` hacia Hydra.

El issuer debe coincidir exactamente con `URLS_SELF_ISSUER` de Hydra y con la
metadata que recibe el cliente.

## Levantar localmente

1. Crear `.env` desde `.env.example` y completar secretos generados.
2. Para HTTP local, usar `PUBLIC_BASE_URL=http://localhost:8087` y
   `COOKIE_SECURE=false`.
3. Levantar PostgreSQL:

   ```bash
   docker compose --env-file .env up -d db
   ```

4. En una base nueva, crear el usuario y la base de Hydra en dos comandos
   separados:

   ```bash
   docker compose --env-file .env exec db \
     psql -U skillhub -d postgres \
     -c "CREATE ROLE hydra LOGIN PASSWORD '<HYDRA_DB_PASSWORD>';"

   docker compose --env-file .env exec db \
     psql -U skillhub -d postgres \
     -c "CREATE DATABASE hydra OWNER hydra;"
   ```

5. Ejecutar el rebuild completo:

   ```bash
   PUBLIC_BASE_URL=http://localhost:8087 \
   COOKIE_SECURE=false \
   ./scripts/rebuild-app.sh
   ```

6. Verificar servicios:

   ```bash
   docker compose --env-file .env ps
   curl -fsS http://localhost:4444/health/ready
   curl -fsS http://localhost:8087/.well-known/oauth-protected-resource
   curl -fsS http://localhost:8087/.well-known/oauth-authorization-server
   ```

La primera cuenta registrada en una base limpia es administradora. El volumen
`skill-hub-angular-java_pgdata` es local a cada host y no se sube al repositorio.
Eliminarlo borra los datos locales, pero no afecta producción.

## Cliente OAuth local de prueba

Hydra tiene habilitado el Dynamic Client Registration para desarrollo local.
Un cliente de prueba puede registrarse en:

```text
POST http://localhost:8087/oauth2/register
```

Debe usar Authorization Code + PKCE, `token_endpoint_auth_method: none`, un
redirect URI local y `skip_consent: false` para probar la pantalla de
consentimiento.

El cliente MCP debe configurarse con:

```text
http://localhost:8087/api/mcp
```

con OAuth habilitado y sin un header `Authorization` de API key. El flujo
esperado es:

```text
GET /api/mcp
  -> 401 + resource_metadata
  -> discovery OAuth
  -> authorization code + PKCE
  -> /oauth/login
  -> /oauth/consent
  -> token endpoint
  -> POST /api/mcp con Bearer JWT
```

## Verificaciones realizadas

- `docker compose config --quiet`.
- `mvn -DskipTests compile`.
- `mvn -Dtest=OAuthControllerTest test`.
- `npx tsc --noEmit -p tsconfig.app.json`.
- `git diff --check`.
- Build Docker de backend y frontend mediante `scripts/rebuild-app.sh`.
- Hydra respondió saludable en `/health/ready`.
- Metadata protegida y metadata del authorization server respondieron
  correctamente.
- Se registró un cliente local con `skip_consent=false`.
- Se recreó una base local vacía y se reaplicaron las migraciones de Hydra y
  Skill Hub.

El flujo completo con credenciales reales, intercambio de authorization code y
llamada MCP autenticada todavía debe ejecutarse manualmente con un cliente
OAuth/MCP.

## Pendientes conocidos

El seguimiento detallado está en
[`OAUTH-HYDRA-CHECKLIST.md`](OAUTH-HYDRA-CHECKLIST.md). Los principales
pendientes son:

- implementar logout OAuth;
- completar pruebas end-to-end automatizadas;
- validar audiencia, recurso y scopes del JWT;
- impedir que OAuth saltee el cambio obligatorio de contraseña;
- endurecer DCR, CORS y el modo `--dev` antes de producción;
- ejecutar la prueba real de autorización, rechazo y llamada MCP.

Hydra/OAuth no debe considerarse listo para producción hasta cerrar esos
pendientes.

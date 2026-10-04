# Hydra y OAuth para MCP

## Propósito

Skill Hub usa Ory Hydra como Authorization Server OAuth 2.1 para proteger el
servidor MCP HTTP (`/api/mcp`). Hydra no administra usuarios: el login se
resuelve contra los usuarios existentes de Skill Hub y el `user.id` de Skill Hub
se usa como subject del token.

La integración mantiene compatibilidad con las API keys existentes. Un cliente
MCP puede autenticarse con una API key `sk_hub_...` o con un access token JWT
emitido por Hydra.

## Estado verificado

Al 2026-10-01, la integración tiene una verificación E2E reproducible: la suite
`scripts/test-hydra-oauth.sh` terminó con `RESULT PASS checks=15 failures=0` y
validó DCR, PKCE, discovery, login, consentimiento, intercambio de código,
las tres operaciones MCP, tokens inválidos, usuario inactivo, logout y cambio
obligatorio de contraseña. El backend terminó con 109 tests sin fallos; la
verificación directa del frontend se ejecutó en `node:22-alpine` sobre una
copia temporal del directorio y terminó con 12 tests y build exitosos.

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
- DCR público se anuncia explícitamente mediante `WEBFINGER_OIDC_DISCOVERY_CLIENT_REGISTRATION_URL`; sin esta clave Hydra habilita `/oauth2/register` pero omite `registration_endpoint` del discovery.
- Servicio `hydra-migrate`, que aplica el schema de Hydra sobre la base `hydra`.
- PostgreSQL con un único volumen Docker (`pgdata`) que contiene las bases
  `skillhub` y `hydra`.
- Healthcheck de Hydra sobre `/health/ready`.
- `hydra-keys` hace un GET read-only al JWKS público para que Hydra v2.2.0
  materialice `hydra.openid.id-token`; para
  `hydra.jwt.access-token` consulta el Admin API y sólo ante un 404 explícito
  ejecuta el POST de creación. Errores de red, timeout, 5xx y otros estados
  terminan el one-shot sin crear ni rotar claves. Con estrategia `opaque` no
  materializa el set de access token. El timeout de cada request es
  120 s (`HYDRA_KEYS_HTTP_TIMEOUT_SECONDS`), holgado frente a la medición de
  materialización bajo carga (~5,2 s), y sólo después de terminar correctamente
  se inicia el backend; el mismo servicio se hereda en `docker-compose.e2e.yml`.
- `scripts/rebuild-app.sh` espera que los consumidores estén disponibles luego
  de la provisión de claves.

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

La configuración efectiva también impone PKCE para clientes públicos, usa el
recurso `${PUBLIC_BASE_URL}/api/mcp`, anuncia el scope `mcp`, emite scopes JWT
en formatos `scope` y `scp`, limita CORS público al origen de
`PUBLIC_BASE_URL`, y mantiene el Admin API `4445` sólo en la red interna de
Docker. `serve all --dev` queda reservado para HTTP local; con un issuer HTTPS
se ejecuta `serve all` sin `--dev`.

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
8. Si la cuenta exige cambio de contraseña, el login queda retenido en una
   transacción efímera de un solo uso y el usuario continúa por
   `/oauth/password-change`; la transacción se consume antes de aceptar el
   login en Hydra.
9. `Autorizar` llama a `POST /api/oauth/accept-consent`.
10. `Rechazar` llama a `POST /api/oauth/reject-consent`.
11. Hydra redirige al callback del cliente con un authorization code o con
    `access_denied`.

El consentimiento consulta el challenge real en Hydra y sólo concede la
intersección con `{openid, offline_access, mcp}`. También otorga como
audiencia el recurso `${PUBLIC_BASE_URL}/api/mcp`; el navegador no puede
ampliar scopes ni audiencia.

El backend obtiene los scopes directamente desde Hydra. El navegador no puede
modificar la lista de scopes que se otorga.

### Endpoints del backend

| Endpoint | Función |
|---|---|
| `POST /api/oauth/accept-login` | Valida credenciales y acepta `login_challenge`. |
| `GET /api/oauth/consent-request` | Devuelve nombre del cliente y scopes seguros para la UI. |
| `POST /api/oauth/accept-consent` | Acepta el consentimiento consultando los scopes en Hydra. |
| `POST /api/oauth/reject-consent` | Rechaza con `access_denied`. |
| `POST /api/oauth/password-change` | Completa el cambio obligatorio y continúa el login retenido. |
| `POST /api/oauth/password-change/reject` | Invalida una continuación pendiente. |
| `GET /api/oauth/logout-request` | Devuelve sólo datos seguros del `logout_challenge`. |
| `POST /api/oauth/accept-logout` | Limpia la sesión local, invalida continuaciones y acepta el logout en Hydra. |
| `POST /api/oauth/reject-logout` | Rechaza el logout y continúa al callback de Hydra. |
| `GET /.well-known/oauth-protected-resource` | Metadata RFC 9728 del recurso MCP. |
| `GET /.well-known/oauth-authorization-server` | Reenvía el discovery de Hydra bajo RFC 8414. |

Las variantes path-inserted `/.well-known/oauth-protected-resource/api/mcp` y
`/.well-known/oauth-authorization-server/api/mcp` también se enrutan al backend
para impedir que Caddy las convierta en HTML del SPA. Las rutas `.well-known`
no soportadas no deben caer al fallback.

`GET /api/mcp` autentica primero: sin token devuelve `401` con
`WWW-Authenticate` y `resource_metadata`; con token devuelve `405 Allow: POST`,
porque este servidor sólo ofrece el transporte MCP por POST.

### Validación de access tokens

`HydraJwtValidator` valida tokens JWT mediante Nimbus y el JWKS de Hydra:

- firma `RS256`;
- issuer;
- `sub` UUID;
- expiración (`exp`);
- audiencia igual a `HYDRA_MCP_RESOURCE_URL` (`${PUBLIC_BASE_URL}/api/mcp`);
- scope `mcp`, en un claim `scope` string o `scp` como lista de strings.

`OAuthIdentityService` usa el `sub` como UUID de usuario, busca la cuenta en
`users` y exige `status = 'active'`. El resultado se adapta al mismo
`ApiKeyIdentity` usado por MCP, con `apiKeyId = null`.

El endpoint MCP devuelve `401` con `WWW-Authenticate` y el enlace a metadata
cuando falta o es inválida la autenticación.

Las API keys siguen el flujo anterior y no pasan por la validación JWT. La
identidad OAuth sólo se acepta cuando coinciden firma, issuer, expiración,
subject, audiencia/recurso y scope; registrar un cliente no crea una sesión,
no autentica un usuario y no concede acceso a `/api/mcp`.

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
3. Ejecutar el rebuild completo (el script levanta PostgreSQL y prepara Hydra):

   ```bash
   ./scripts/rebuild-app.sh
   ```

4. Verificar servicios:

   ```bash
   docker compose --env-file .env ps
   curl -fsS http://localhost:4444/health/ready
   curl -fsS http://localhost:8087/.well-known/oauth-protected-resource
   curl -fsS http://localhost:8087/.well-known/oauth-authorization-server
   ```

La primera cuenta registrada en una base limpia es administradora. El volumen
`skill-hub-angular-java_pgdata` es local a cada host y no se sube al repositorio.
Eliminarlo borra los datos locales, pero no afecta producción.

### Claves JWK y arranque

Hydra 2.2 puede generar perezosamente las claves de firma: el primer discovery
o autorización puede materializar `hydra.openid.id-token`, y la emisión de un
access token JWT materializa `hydra.jwt.access-token`. `hydra-keys` fuerza esa
materialización mediante el GET read-only de `/.well-known/jwks.json`. En
Hydra v2.2.0 ese GET devuelve 200 y materializa `hydra.openid.id-token`; para
el set de access token, el GET Admin devuelve 404 hasta que el POST de creación
lo materializa. El POST queda reservado exclusivamente a ese 404 explícito.
Por eso los `kid` se conservan en un `up` repetido y no se rotan en cada
despliegue; el script no imprime la respuesta del API ni claves privadas. La
estrategia configurada es `STRATEGIES_ACCESS_TOKEN=jwt`, por lo que ambos sets
se preparan en este despliegue.

El cliente E2E tiene un timeout de transporte de 30 segundos en
`e2e/oauth/client.js:68-72`. Ese límite no forma parte de la corrección: la
operación legítima debe comenzar con los key sets ya materializados. El backend
usa `RestClient` sin timeouts explícitos para el Admin/Public API
(`backend/src/main/java/com/skillhub/oauth/HydraAdminClient.java:28-30` y
`OAuthController.java:42-46`), y `HydraJwtValidator.java:47-55` usa Nimbus
`RemoteJWKSet`, que mantiene caché local de JWKS; el arranque ordenado elimina
la generación perezosa antes de esas rutas.

## Registro dinámico y acceso

Hydra tiene habilitado el Dynamic Client Registration (DCR) también para el
despliegue previsto. El registro no requiere una cuenta previa de Skill Hub y
sólo crea una identidad técnica. Un cliente de prueba puede registrarse en:

```text
POST http://localhost:8087/oauth2/register
```

Debe usar Authorization Code + PKCE, `token_endpoint_auth_method: none`, un
redirect URI local y `skip_consent: false` para probar la pantalla de
consentimiento.

Registrar el cliente y obtener acceso son operaciones distintas: después del
DCR todavía se requiere login de un usuario activo, consentimiento explícito,
PKCE y un intercambio válido del authorization code. El backend acepta en MCP
únicamente el token destinado al recurso MCP y con scope `mcp`; por eso un
cliente recién registrado no puede leer ni modificar datos.

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

## Ejecutar la suite E2E

Desde la raíz del repositorio:

```bash
scripts/test-hydra-oauth.sh
```

La suite crea el proyecto Docker aislado `skillhub-e2e`, con PostgreSQL,
Hydra, backend, frontend/Caddy y un cliente Node sin dependencias externas.
Usa puertos propios, genera secretos efímeros en `/tmp`, limpia sólo ese
proyecto y escanea los logs sin imprimir passwords, tokens, client secrets,
challenges ni valores del `.env`. La ejecución verificada terminó con 15/15
checks aprobados y código 0; el detalle de pasos está en
[`e2e/oauth/README.md`](e2e/oauth/README.md).

El caso cerrado de intermitencia bajo carga y su reproducción portable están
documentados en [`docs/OAUTH-INTERMITENCIA-HYDRA.md`](docs/OAUTH-INTERMITENCIA-HYDRA.md).

## Diagnóstico y rollback

Para un fallo de la suite, consultar primero el estado del proyecto aislado:

```bash
docker compose -p skillhub-e2e ps
docker compose -p skillhub-e2e logs --no-color
```

No usar `docker compose down` sin el proyecto `-p skillhub-e2e`. El script
limpia automáticamente sólo sus contenedores y volúmenes. Para repetir un
flujo local, verificar `/health/ready`, discovery, `HYDRA_MCP_RESOURCE_URL`,
issuer, CORS y la salud del backend; no copiar secretos de los logs.

El rollback de aplicación consiste en volver al artefacto o imagen anterior y
reiniciar el stack conservando las bases existentes. No borrar `pgdata` en un
entorno compartido: eliminar ese volumen sólo descarta datos locales y exige
recrear ambas bases. Los clientes DCR ya registrados y sus redirect URIs se
administran en Hydra; un rollback no debe eliminar clientes sin una decisión
operativa explícita.

## Riesgos residuales y criterio de producción

- DCR no tiene todavía rate limiting específico: el spam y los registros
  masivos quedan pospuestos como riesgo operativo. Deben monitorizarse y
  mitigarse antes de exponer el endpoint a tráfico no confiable.
- Hydra 2.2 no ofrece una allow-list global para `grant_types` ni para limitar
  globalmente el `scope` declarado por DCR. El control compensatorio vigente es
  filtrar scopes/audiencia en el consentimiento y validar recurso y `mcp` en
  `/api/mcp`.
- Las transacciones de cambio obligatorio de contraseña viven en memoria y no
  son distribuidas: un reinicio o una réplica distinta invalida una
  continuación pendiente; el usuario debe reiniciar OAuth.
- El Node local 22.12.0 es menor que el mínimo requerido por Angular CLI 22.
  La suite frontend se verificó con Node 22.23.3 en `node:22-alpine`, sin
  modificar `package.json`, el Node del sistema ni `node_modules` del repo.

Se puede considerar producción sólo cuando la configuración use issuer HTTPS,
CORS explícito, `serve all` sin `--dev`, Admin API 4445 interno, secretos
externos y la suite E2E termine con código 0. La checklist debe conservar
evidencia de cada criterio y una decisión operativa sobre el riesgo de DCR;
no se requiere bloquear el cierre documental por implementar rate limiting
avanzado, pero sí debe quedar aceptado y monitoreado por el responsable de
producción.

# Architecture Decision Records (ADR)

Registro de las decisiones de arquitectura de Skill Hub y del porqué de cada
una. Cada ADR describe una decisión concreta, su contexto, las alternativas y
sus consecuencias. Los ADR no reemplazan a los documentos operativos de la raíz
([HYDRA-OAUTH.md](../../HYDRA-OAUTH.md), [backup-produccion.md](../../backup-produccion.md),
los `PLAN-*` y `PROGRESO-*`): los enlazan.

## Índice

| # | Decisión | Estado | Fecha |
|---|---|---|---|
| [0001](0001-stack-spring-boot-angular-postgres-docker-compose.md) | Stack: Spring Boot + Angular + PostgreSQL + Docker Compose | Aceptado | 2026-09-08 |
| [0002](0002-autenticacion-sesiones-api-keys-y-oauth-hydra.md) | Autenticación: sesiones propias, API keys y OAuth con Ory Hydra para MCP | Aceptado | 2026-09-08 / 2026-10-01 |
| [0003](0003-servidor-mcp-propio-y-propose-revision.md) | Servidor MCP propio (JSON-RPC a mano) y flujo `propose_revision` | Aceptado | 2026-09-08 |
| [0004](0004-flyway-unica-via-de-cambio-de-esquema.md) | Flyway como única vía de cambio de esquema; purgas y seeds como migraciones | Aceptado | 2026-09-08 |
| [0005](0005-busqueda-full-text-postgres-y-deteccion-de-idioma.md) | Búsqueda full-text de PostgreSQL y detección de idioma propia | Aceptado | 2026-09-08 / 2026-09-11 |
| [0006](0006-sanitizacion-de-markdown-y-sandbox-del-preview.md) | Sanitización de Markdown y sandbox del preview | Aceptado | 2026-09-08 |
| [0007](0007-rate-limiting-con-filtro-propio.md) | Rate limiting de login con un filtro propio (`RateLimitFilter`) | Aceptado | 2026-09-19 |
| [0008](0008-frontend-zoneless-standalone-signals-onpush.md) | Frontend Angular zoneless, standalone, signals y OnPush | Aceptado | 2026-09-08 |
| [0009](0009-mapa-de-dependencias-nativo.md) | Mapa de dependencias nativo: tablas propias (V23) y geometría/matriz en el cliente | Aceptado | 2026-10-01 |
| [0010](0010-deploy-con-rebuild-app-y-backups.md) | Despliegue con `scripts/rebuild-app.sh`, sin CI, con backup previo | Aceptado | 2026-09-13 / 2026-10-04 |
| [0011](0011-politica-de-testing-coverage-90.md) | Política de testing: coverage mínimo de 90 % (JaCoCo `check` + vitest) | Propuesto | 2026-10-25 |

## Cómo agregar un ADR

1. Copiar [0000-template.md](0000-template.md) a `NNNN-titulo-en-kebab-case.md`,
   con el siguiente número libre de cuatro dígitos. Escribir en español.
2. Completar todas las secciones: **Estado, Fecha, Contexto, Decisión,
   Alternativas consideradas, Consecuencias, Referencias**.
3. Sacar el porqué de fuentes verificables (código, migraciones, `git log`,
   documentos) y citarlas en *Referencias*. Si el motivo no está registrado en
   ningún lado, escribir **"Razón no registrada — confirmar"** en lugar de
   suponerlo, y sumarlo a la lista de huecos de abajo.
4. Empezar en estado `Propuesto` si la decisión todavía no se implementó o no se
   mergeó; pasar a `Aceptado` cuando esté en `master`.
5. Agregar la fila al índice de este README.
6. **No editar el fondo de un ADR aceptado.** Si la decisión cambia, crear un ADR
   nuevo y marcar el viejo como `Reemplazado por [NNNN](...)`. Se pueden
   corregir errores de forma, enlaces o completar un hueco "confirmar".

Estados posibles: `Propuesto`, `Aceptado`, `Reemplazado por NNNN`, `Obsoleto`.

## Huecos a confirmar

Puntos donde el motivo no quedó registrado en el código, las migraciones, el
historial de git ni los documentos del repo. El plan original de la migración
(`D:\ClaudeData\claude-home\plans\me-gustaria-migrar-todo-lively-blossom.md`,
citado en el README raíz) no está disponible y probablemente contenga varias de
estas respuestas (el código cita sus "decisiones 4, 5, 11 y 15").

- **0001:** por qué migrar de Next.js a Spring Boot + Angular; por qué JDBC/SQL
  crudo en lugar de JPA; por qué Angular y no seguir con React.
- **0002:** por qué Ory Hydra y no Keycloak, Spring Authorization Server u otro.
- **0004:** por qué purgas y renombres por migración en lugar de SQL manual
  (lo escrito es inferido del código, no declarado).
- **0005:** por qué no un motor de búsqueda externo; por qué una heurística
  propia de idioma en lugar de una librería.
- **0006:** por qué se permite HTML ejecutable en el bloque `preview` (heredado
  de la "decisión 5" del plan original).
- **0007:** por qué un filtro propio y no Bucket4j/Resilience4j o límites en
  Caddy/nginx; confirmar que todos los proxies normalizan `CF-Connecting-IP` /
  `X-Forwarded-For`.
- **0008:** por qué zoneless desde el inicio; si `OnPush` debe aplicarse a todos
  los componentes (hoy 14 de 30 lo declaran).
- **0009:** por qué la geometría y la matriz se calculan en el cliente y no en
  el servidor.
- **0010:** confirmar que el servidor final ya es un checkout git (el README
  indica `git pull --ff-only`) y que la sincronización manual de archivos quedó
  en desuso; por qué no hay CI/CD; si existe copia de los backups fuera del
  servidor.
- **0011:** por qué 90 %; métrica, exclusiones y fase de Maven; si
  `rebuild-app.sh` o un hook va a ejecutar la verificación.

## Decisiones aún sin ADR

Candidatas detectadas en el historial que no entran en esta primera tanda:
monitoreo de infraestructura y logs del gateway (`V24__infra_monitoring.sql`,
[docs/infra-monitor.md](../infra-monitor.md),
[docs/infra-gateway-logs-backend.md](../infra-gateway-logs-backend.md)), opt-in
de Tailscale ([docs/infra-monitor-tailnet.md](../infra-monitor-tailnet.md)),
votación de ediciones (`VOTES_REQUIRED=3`, V8) y artifacts de catálogo (V18).

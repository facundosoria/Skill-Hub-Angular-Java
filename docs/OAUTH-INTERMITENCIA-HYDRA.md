# Intermitencia de OAuth bajo carga

## Resumen

El caso quedó cerrado como una intermitencia del flujo OAuth E2E cuando se
somete al host a carga artificial. Se observó únicamente en la Raspberry Pi
de 4 núcleos, con load average aproximadamente entre 12 y 17: el callback
ocasionalmente llega sin `authorization code` y los checks siguientes fallan
en cascada. No se reprodujo sin carga: hubo 10/10 corridas exitosas en varias
tandas.

Esto no describe un fallo confirmado del flujo normal de producción. En
producción las claves viven en PostgreSQL, por lo que el costo de generación
se paga una vez por base y no en cada login ni en cada reinicio. El E2E crea
una base vacía en cada corrida y por eso paga siempre ese costo inicial.

## Línea de tiempo y evidencia

La corrida que permitió aislar el caso mostró lo siguiente:

- Hydra estaba listo y respondió readiness `200`.
- El primer discovery disparó la generación perezosa de
  `hydra.openid.id-token` y tardó `5.18078279 s`.
- El `GET /oauth2/auth` que completa login y consentimiento terminó en `303`
  con `code` presente, después de `10.575984317 s`.
- Desde el check 5.5, el cliente recibió un callback sin authorization code.
  Los checks 5.7 a 5.15 fallaron como cascada porque faltaban el código, los
  tokens o los datos derivados de ellos.
- En otra corrida se observó un `502` de Caddy. No apareció un `502` en la
  tanda de 10 corridas documentada abajo.

La reproducción bajo carga fue 4/10 (los fallos fueron las corridas 4, 5, 7
y 9). El reporte original fue `/tmp/oauth-stress.GgnO25/report.md` y dejó
esta tabla:

### Sin carga

| corrida | resultado | duración s | readiness s | load average |
|---:|---|---:|---:|---|
| 1 | PASS | 57 | 4 | 7.27, 7.77, 6.46 |
| 2 | PASS | 53 | 4 | 7.69, 7.71, 6.51 |
| 3 | PASS | 60 | 4 | 5.64, 7.11, 6.37 |
| 4 | PASS | 69 | 4 | 5.64, 6.94, 6.37 |
| 5 | PASS | 69 | 4 | 6.34, 6.82, 6.36 |
| 6 | PASS | 61 | 4 | 7.77, 7.20, 6.53 |
| 7 | PASS | 70 | 4 | 6.90, 7.04, 6.52 |
| 8 | PASS | 66 | 4 | 6.93, 7.03, 6.55 |
| 9 | PASS | 46 | 4 | 5.45, 6.60, 6.44 |
| 10 | PASS | 65 | 4 | 4.87, 6.22, 6.31 |

### Presión de CPU y stack `oauth-load` aislado

| corrida | resultado | duración s | readiness s | load average |
|---:|---|---:|---:|---|
| 1 | PASS | 83 | 4 | 3.50, 5.68, 6.13 |
| 2 | PASS | 69 | 4 | 12.71, 8.25, 7.00 |
| 3 | PASS | 71 | 5 | 14.05, 9.49, 7.52 |
| 4 | FAIL (8) | 78 | 4 | 15.17, 10.83, 8.14 |
| 5 | FAIL (8) | 73 | 5 | 14.33, 11.63, 8.64 |
| 6 | PASS | 65 | 5 | 16.84, 12.93, 9.32 |
| 7 | FAIL (8) | 89 | 4 | 15.78, 13.37, 9.72 |
| 8 | PASS | 72 | 4 | 14.96, 13.62, 10.14 |
| 9 | FAIL (8) | 69 | 5 | 12.89, 13.43, 10.34 |
| 10 | PASS | 67 | 4 | 12.87, 13.28, 10.51 |

En la corrida fallida, Hydra registró el `200` de discovery y luego las
duraciones anteriores; el cliente fue quien vio el callback incompleto. El
script también dejó evidencia de que las iteraciones del stack de carga
terminaron y se limpiaron.

`hydra-keys` aporta una evidencia complementaria. Hydra registra `200` para
`/.well-known/jwks.json` a los `12.001 s`, mientras que el `wget` del cliente
ve `network error`; el detalle está en
`/tmp/skillhub-e2e.z8z3iw/startup-failure.log` cuando ese archivo existe.
Con `STRATEGIES_ACCESS_TOKEN=jwt` se preparan tanto
`hydra.openid.id-token` como `hydra.jwt.access-token`. La generación es
perezosa en Hydra v2.2.0; `hydra-keys` fuerza esa materialización antes de
levantar los consumidores.

## Hipótesis descartadas

- **WriteTimeout de `net/http` en Hydra.** Hydra v2.2.0 sólo configura
  `ReadHeaderTimeout=5s` en `cmd/server/handler.go`; el schema no expone
  timeouts de escritura. No hay evidencia de un WriteTimeout configurable que
  explique esta respuesta perdida.
- **Timeout del cliente.** `e2e/oauth/client.js` usa 30 segundos por request y
  `scripts/provision-hydra-keys.sh` usa `wget --timeout 120`. La medición de
  `10.58 s` no alcanza el timeout del cliente.
- **Diffs locales.** La bisección mostró que `HEAD` y cada diff por separado
  pasan sin carga; no apareció un cambio único que reproduzca la intermitencia.
- **Conflicto de Compose entre corridas.** La causa operativa sí encontrada y
  corregida era que el cleanup ocultaba errores de `down`; quedaba el
  contenedor `Conflict /skillhub-e2e-db-1` y la siguiente corrida no empezaba
  limpia. El teardown ahora comprueba su propio proyecto y propaga el error.

## Qué se corrigió en el camino

Estas correcciones son de preparación y diagnóstico, no una modificación del
comportamiento OAuth durante un login:

- `scripts/db/init-hydra-db.sh`: inicialización idempotente y compartida del
  rol y la base de Hydra.
- Entrypoint de Hydra en el stack de producción: separa `serve all --dev` para
  HTTP local de `serve all` para issuer HTTPS.
- `scripts/provision-hydra-keys.sh` y el servicio `hydra-keys`: pre-generan o
  materializan las claves antes de iniciar backend.
- `scripts/test-hydra-oauth.sh`: readiness vía Caddy y lifecycle síncrono,
  incluyendo cleanup verificable del proyecto E2E.

## Preguntas abiertas

El mecanismo exacto de la respuesta perdida sigue abierto: el servidor registra
`200`, pero el cliente ve la conexión cortada aproximadamente a los 10–12
segundos. Se evaluaron claves ES256 (generan en milisegundos), pero no se
aplicaron porque cambiarían el algoritmo de firma y exigirían revisar
`HydraJwtValidator` y la compatibilidad de clientes MCP; RS256 es el algoritmo
OIDC obligatorio en este despliegue. También se evaluó capturar `tcpdump`,
pero no se incorporó a la corrección.

## Reproducir en otra computadora

### Requisitos y puertos

Se necesita Docker con Compose v2, Node `22.22.3` o superior, y una máquina
con recursos suficientes para construir las imágenes. El E2E usa únicamente
estos puertos locales: `15432` (PostgreSQL), `18444` (Hydra público) y
`18087` (Caddy/frontend). El script de carga usa una red y volumen internos,
sin publicar puertos.

Desde la raíz del repo:

```bash
node --version
docker version
docker compose version
```

### A. Diez corridas sin carga

```bash
./scripts/stress-hydra-oauth.sh --runs 10
```

### B. Diez corridas con carga

```bash
./scripts/stress-hydra-oauth.sh --runs 10 --with-load --load-level 1
```

`--load-level 1` crea un proceso `yes` por núcleo detectado y levanta un clon
completo del stack en el proyecto Compose aislado
`skillhub-oauth-load-*`, con puertos `15433`, `18445` y `18088`. Para una
presión mayor, subir el nivel; la corrida original usó una presión equivalente
en una Raspberry Pi de 4 núcleos. El script registra `RESULT`, duración y load
average en `records.tsv`, conserva un log por corrida y, al terminar, mata sólo
sus procesos `yes` y baja sólo su proyecto Compose.
Cada ejecución de la suite principal sigue usando exclusivamente
`skillhub-e2e`.

Variables útiles que leen los scripts:

| variable | valor por defecto | función |
|---|---:|---|
| `E2E_READINESS_TIMEOUT_SECONDS` | 120 | límite de readiness vía Caddy |
| `E2E_READINESS_INTERVAL_SECONDS` | 2 | intervalo entre probes |
| `E2E_READINESS_REQUIRED_SUCCESSES` | 3 | `200` consecutivos requeridos |
| `HYDRA_KEYS_HTTP_TIMEOUT_SECONDS` | 120 | timeout de cada request de `hydra-keys` |
| `STRATEGIES_ACCESS_TOKEN` | `jwt` en Compose | decide si se materializa el set JWT |
| `TMPDIR` | `/tmp` | ubicación de temporales |
| `POSTGRES_*`, `HYDRA_*`, `PUBLIC_BASE_URL`, `COOKIE_SECURE`, `HYDRA_DEV_MODE` | generadas o del entorno | valores que la suite escribe en su `.env` temporal |

Por ejemplo, para dar más margen de arranque sin cambiar el caso de carga:

```bash
E2E_READINESS_TIMEOUT_SECONDS=240 \
HYDRA_KEYS_HTTP_TIMEOUT_SECONDS=180 \
./scripts/stress-hydra-oauth.sh --runs 10 --with-load
```

### Logs y diagnóstico de Hydra

Los resultados del stress quedan en el directorio informado al final (o en un
temporario `/tmp/oauth-stress.*`). Los logs de una suite que falla se
conservan en `/tmp/skillhub-e2e.*` e incluyen `startup-failure.log`,
`readiness-failure.log`, `container.log` y la salida del cliente. Buscar:

- generación o materialización de `hydra.openid.id-token` y
  `hydra.jwt.access-token`;
- duración y status de `/.well-known/jwks.json`, discovery y `/oauth2/auth`;
- `error=` en los redirects y callbacks sin `code`;
- `502` de Caddy y diferencias entre el timestamp de `200` del servidor y el
  `network error` del cliente.

Para una inspección manual con override de debug, crear un archivo fuera del
repo:

```bash
cat >/tmp/hydra-debug.yml <<'EOF'
services:
  hydra:
    environment:
      LOG_LEVEL: debug
EOF
```

Con una corrida E2E activa, aplicar el override al mismo proyecto y a los
mismos archivos Compose, desde otra terminal:

```bash
docker compose -p skillhub-e2e \
  --env-file /tmp/skillhub-e2e.XXXXXX/.env \
  -f docker-compose.yml -f docker-compose.e2e.yml -f /tmp/hydra-debug.yml \
  up -d --force-recreate hydra
docker compose -p skillhub-e2e \
  -f docker-compose.yml -f docker-compose.e2e.yml -f /tmp/hydra-debug.yml \
  logs -f --no-color hydra
```

Reemplazar `XXXXXX` por el directorio real que el script haya conservado.
El override es sólo diagnóstico y no se debe copiar a producción. En una
corrida fallida, usar el `docker compose ... logs` antes de que el cleanup
termine o conservar los logs que el script imprime.

### Criterios de éxito y limpieza

Una corrida individual es exitosa si termina con `RESULT PASS checks=15
failures=0` y código 0. Para evaluar la intermitencia, conservar las 10
filas de cada `records.tsv`: sin carga se espera 10/10, mientras que la carga
artificial puede reproducir fallos 5.5 y su cascada sin implicar un fallo
determinista del producto.

Al terminar, comprobar que no quedaron objetos del harness:

```bash
docker ps -a --filter label=com.docker.compose.project=skillhub-e2e
docker volume ls --filter label=com.docker.compose.project=skillhub-e2e
docker network ls --filter label=com.docker.compose.project=skillhub-e2e
docker ps -a --filter label=com.docker.compose.project=skillhub-oauth-load
```

Las primeras tres salidas deben estar vacías; para el proyecto de carga usar
el nombre exacto `skillhub-oauth-load-<pid>` que imprimió el script. Si una
interrupción dejó objetos, bajar únicamente ese proyecto con los mismos
archivos temporales:

```bash
docker compose -p skillhub-oauth-load-<pid> \
  --env-file /tmp/oauth-stress.XXXXXX/load.env \
  -f docker-compose.yml -f docker-compose.e2e.yml \
  -f /tmp/oauth-stress.XXXXXX/load-compose.yml \
  down -v --remove-orphans
```

No usar `docker compose down` sin `-p`: el harness nunca debe tocar el
proyecto Compose por defecto ni el stack de producción.

# 0010. Despliegue con `scripts/rebuild-app.sh`, sin CI, con backup previo

- **Estado:** Aceptado
- **Fecha:** 2026-09-13 (script inicial) · 2026-10-04 (unificación local/raspi/prod)

## Contexto

No hay CI/CD. La aplicación corre con Docker Compose en tres máquinas: la de
desarrollo (`localhost:8087`), una Raspberry (`skillhub.rcoleman.me`) y el
servidor final (`marketplace-utn.tech`). Cada host tiene su `.env` con
credenciales, no versionado. Las migraciones Flyway corren al arrancar el
backend y algunas borran datos (ver [0004](0004-flyway-unica-via-de-cambio-de-esquema.md)).

En los primeros despliegues (2026-09-08) el servidor **no era un checkout de
git**: se sincronizaban archivos a mano (`git archive | ssh … tar xf -`) y se
recreaban los contenedores con `docker compose build` + `up -d --no-deps`,
tomando antes un `pg_dump` manual.

## Decisión

Un único script, `./scripts/rebuild-app.sh local|raspi|prod [tailscale]`, con
el mismo `docker-compose.yml` en los tres hosts (commits `2a1a351`, `c67a830`,
`d7e783a`, `9ee32cf`):

- El destino fija URL pública, puerto web, `COOKIE_SECURE`, proyecto Compose y
  volumen de datos; no se edita Compose ni `.env` entre hosts.
- **Guardas antes de tocar contenedores:** el hostname debe corresponder al
  destino; en `raspi`/`prod` el volumen de Postgres debe existir (no crea una
  base vacía), el checkout debe estar limpio y en `master` (no se despliega
  código distinto al commit).
- En `prod` verifica que la base tenga `public.users` y guarda un
  **`pg_dumpall`** en `~/skill-hub-backups/prod/` antes de las migraciones.
- Orden: `hydra-migrate` → Hydra sano → `hydra-keys` → build de `backend` y
  `web` → recrea sólo el backend y espera salud → recrea `web` → verifica el HTML
  servido y, en `raspi`/`prod`, que el dominio público sirva el bundle nuevo.
- **Nunca usa `down -v`.**
- `npm run build` no actualiza el contenedor web: para ver un cambio en
  `localhost:8087` hay que correr `rebuild-app.sh local`
  ([AGENTS.md](../../AGENTS.md)).
- Backup manual adicional documentado en
  [backup-produccion.md](../../backup-produccion.md) (`pg_dumpall` comprimido
  que queda en el servidor, sin transferir datos por la red).

## Alternativas consideradas

- **Sincronización de archivos sin git en el servidor** (práctica inicial):
  reemplazada. El README actual indica `git pull --ff-only` en los hosts
  remotos antes del script, y el script exige un checkout git limpio en
  `master`. *Confirmar* que el servidor final ya es un checkout git y que la
  sincronización manual quedó en desuso.
- **CI/CD (GitHub Actions u otro):** *Razón no registrada — confirmar.*
- **Un Compose por entorno:** descartado al unificar en `c67a830`; el destino
  se parametriza en el script.

## Consecuencias

- Un despliegue es reproducible y atado a un commit de `master`.
- No se puede desplegar a `prod` sobre una base vacía ni sin backup.
- Los backups quedan en el mismo servidor que la base: no protegen ante la
  pérdida del host. *Confirmar* si existe copia fuera del servidor.
- Los hostnames permitidos (`pi-server`, `servidin`, `mk-luisao-02`) están
  versionados en el script: cambiar de servidor exige editarlo.
- La Raspberry tuvo un corte inicial con el stack anterior `skillhub-test`
  ocupando `:18080` (ver README).

## Referencias

- `scripts/rebuild-app.sh`, `docker-compose.yml`, `.env.example`.
- [README.md](../../README.md) — "Reconstruir la aplicación".
- [backup-produccion.md](../../backup-produccion.md).
- Commits `cd23b56`, `2a1a351`, `c67a830`, `d7e783a`, `9ee32cf`, `72a8e37`
  (opt-in `tailscale`).

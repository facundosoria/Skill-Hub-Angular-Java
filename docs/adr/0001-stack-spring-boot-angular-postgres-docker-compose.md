# 0001. Stack: Spring Boot + Angular + PostgreSQL + Docker Compose

- **Estado:** Aceptado
- **Fecha:** 2026-09-08

## Contexto

Skill Hub existía como aplicación Next.js 16 (repo `D:\Marketplace`) con
Drizzle sobre PostgreSQL. Se decidió migrarla completa a un backend Java y un
frontend Angular. El plan original de la migración vive fuera del repo
(`D:\ClaudeData\claude-home\plans\me-gustaria-migrar-todo-lively-blossom.md`,
citado por el [README](../../README.md)) y no está disponible para consulta.

El spike del 2026-09-08 (`a3bbd6e`) tenía que despejar las dos incógnitas de
mayor riesgo: que las migraciones SQL de Drizzle corrieran tal cual en Flyway
(ver [0004](0004-flyway-unica-via-de-cambio-de-esquema.md)) y que la búsqueda
full-text se pudiera portar como SQL crudo sin cambios de comportamiento (ver
[0005](0005-busqueda-full-text-postgres-y-deteccion-de-idioma.md)).

## Decisión

- **Backend:** Spring Boot 3.4, Java 21, Maven (`backend/`). Acceso a datos con
  `JdbcTemplate` / SQL crudo, no JPA: los repositorios son puertos línea por
  línea del código TypeScript (p. ej. `SearchRepository` ← `search.ts`).
- **Frontend:** Angular 22 standalone + Tailwind 4 (`frontend/`), servido como
  SPA estática por Caddy, que además hace de reverse proxy de `/api/*` al
  backend (`frontend/Caddyfile`). Ver [0008](0008-frontend-zoneless-standalone-signals-onpush.md).
- **Base de datos:** se mantiene PostgreSQL 16 (la base de producción ya
  existía con el esquema de Drizzle).
- **Despliegue:** Docker Compose con los servicios `db`, `backend`, `web` y,
  desde 2026-10-01, Hydra (`docker-compose.yml`, commit `cd23b56`). Ver
  [0010](0010-deploy-con-rebuild-app-y-backups.md).
- **Tests de backend:** Testcontainers con Postgres 16 real, no H2.

## Alternativas consideradas

- **Quedarse en Next.js:** *Razón no registrada — confirmar* por qué se migró
  (el commit `a3bbd6e` y el README sólo registran el hecho de la migración).
- **Spring Boot + JPA/Hibernate:** no hay registro explícito; el código
  muestra que se priorizó portar SQL verbatim para no cambiar comportamiento.
  *Razón no registrada — confirmar.*
- **Otro framework de frontend (seguir en React):** *Razón no registrada — confirmar.*

## Consecuencias

- La paridad con el sistema original es verificable: SQL y validaciones se
  portaron literalmente y los tests portados del original pasan.
- Se pierde la generación de esquema de un ORM; todo cambio de esquema es SQL a
  mano en Flyway.
- Algunas diferencias de librería quedan como deuda: `js-yaml` vs SnakeYAML
  formatean distinto el frontmatter (sección "Parity de YAML pendiente" del
  README).
- Testcontainers 1.20.4 necesitó fijar `api.version=1.44` para Docker 29
  (`backend/src/test/resources/docker-java.properties`); el README recomienda
  Testcontainers 2.x.
- Caddy queda como único punto de entrada HTTP por contenedor (headers de
  seguridad, CSP, proxy de `/api`, `/oauth2` y `.well-known`).

## Referencias

- [README.md](../../README.md) — secciones "Estado", "Decisiones del spike".
- Commits `a3bbd6e` (spike backend), `9e947e1` (scaffold Angular 22),
  `cd23b56` (infra Docker para prod).
- `backend/pom.xml`, `frontend/package.json`, `docker-compose.yml`,
  `frontend/Caddyfile`.

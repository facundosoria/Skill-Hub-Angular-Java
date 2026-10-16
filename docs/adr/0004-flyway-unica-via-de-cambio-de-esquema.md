# 0004. Flyway como única vía de cambio de esquema; purgas y seeds como migraciones

- **Estado:** Aceptado
- **Fecha:** 2026-09-08

## Contexto

La base de producción ya tenía el esquema creado por Drizzle (10 migraciones +
2 "extra" con índices y extensiones que Drizzle no modela). El backend Java
necesitaba gestionar el esquema sin reaplicar nada sobre esa base y, a la vez,
poder crear una base limpia idéntica para tests y nuevos entornos.

Después aparecieron cambios de **datos** que debían ser reproducibles y
auditables: borrar datos de ejemplo antes del uso real, sembrar un skill que
las instrucciones del MCP dan por existente y renombrar entradas del catálogo.

## Decisión

1. **Migraciones de Drizzle copiadas verbatim** como `V1..V12`
   (`backend/src/main/resources/db/migration/`), sin consolidar. En una base
   limpia se aplican las 12; en la base de prod se arrancó con
   `baseline-on-migrate=true` y `baseline-version=12`, configurable por
   `FLYWAY_BASELINE_ON_MIGRATE` / `FLYWAY_BASELINE_VERSION`
   (`application.yml`, commit `cd23b56`).
2. **Todo cambio de esquema posterior es una migración Flyway nueva** (V13..V24
   al momento de escribir). Flyway corre al arrancar el backend.
3. **Purgas y seeds también son migraciones**, no scripts ad hoc:
   - **V13** borra todos los skills (eran de ejemplo/prueba) y las cuentas no
     admin antes del uso real; las cascadas de V1–V3 limpian versiones, tags,
     votos y uso, y `audit_events.actor_snapshot` preserva el nombre del actor.
   - **V14** re-siembra `writing-skills`, porque las instrucciones del servidor
     MCP y `propose_skill` mandan a leerlo y V13 lo había dejado inexistente.
   - **V16** renombra 4 entradas a la convención `generate-*` (pedido del equipo
     LLM): borra 2 provisionales sin uso, renombra in place las publicadas
     (conserva id e historial) y deja un stub `deprecated` → `superseded_by`
     para la que tenía uso. Todas sus sentencias son no-op si el slug no
     existe, para poder correrla sin conocer el estado exacto de prod.
4. La regla está escrita para colaboradores en [AGENTS.md](../../AGENTS.md):
   no crear ni editar migraciones sin pedido explícito.

## Alternativas consideradas

- **Baseline consolidado (un único V1 nuevo):** descartado en el spike; se
  confirmó que no hacía falta y que copiar verbatim evitaba divergencias con la
  base existente (README, "Migraciones: verbatim, no consolidadas").
- **Purgas/renombres por SQL manual en el servidor:** *Razón no registrada —
  confirmar*; lo inferible del código es que una migración deja registro en
  `flyway_schema_history`, se prueba en Testcontainers y se aplica igual en
  todos los entornos.

## Consecuencias

- Reproducibilidad: una base limpia queda igual a prod (salvo datos).
- Las migraciones de datos son **irreversibles** (V13 borra filas): exigen
  backup previo. `rebuild-app.sh prod` toma un `pg_dumpall` antes de arrancar el
  backend (ver [0010](0010-deploy-con-rebuild-app-y-backups.md)).
- V13 corre también en cualquier base nueva: en un entorno limpio no hay nada
  que borrar, pero en una base con datos los elimina. Hay que tenerlo presente
  al restaurar dumps anteriores a V13.
- Los nombres de versión no deben chocar entre ramas paralelas (ya existe
  `V17` y `V17_1`).
- Drizzle ya no participa: los comentarios de V11 que mencionan
  `scripts/migrate.ts` son históricos.

## Referencias

- `backend/src/main/resources/db/migration/V11__search_indexes.sql` …
  `V24__infra_monitoring.sql`, en particular `V13__…`, `V14__…`, `V16__…`.
- [README.md](../../README.md) — "Migraciones: verbatim, no consolidadas".
- Commits `a3bbd6e`, `cd23b56`, `11187d6` (V13), `5e1d58e` (V14/V15), `c8cf3fa` (V16).
- `backend/src/main/resources/application.yml` (sección `flyway`).

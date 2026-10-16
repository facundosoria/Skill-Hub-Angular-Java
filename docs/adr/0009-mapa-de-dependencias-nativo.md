# 0009. Mapa de dependencias nativo: tablas propias (V23) y geometría/matriz en el cliente

- **Estado:** Aceptado
- **Fecha:** 2026-10-01

## Contexto

`mapa-dependencias` era una app aparte (Node/Express + un `index.html` sin
framework, estado en `data/state.json`, sync en vivo por SSE) que se pensaba
montar bajo `/mapa/` con un proxy. Se decidió convertirla en una pantalla nativa
de Skill Hub preservando toda la información (13 nodos con su `x/y`, 5 tipos,
57 dependencias, tildes, actividad) y la posición de los objetos en pantalla.

## Decisión

Decisiones tomadas con el usuario y registradas en
[PLAN-MAPA-DEPENDENCIAS.md](../../PLAN-MAPA-DEPENDENCIAS.md):

1. **Persistencia en Postgres** con tablas nuevas vía Flyway
   (`V23__dependency_map.sql`, autorizada explícitamente): `dep_map_nodes`,
   `dep_map_kinds`, `dep_map_edges`, `dep_map_activity`, `dep_map_meta`. Seed
   con el `state.json` vivo (versión 5), preservando ids y orden (`sort_order`).
   `backend/src/main/resources/depmap/seed.json` sirve para **Restaurar originales**.
2. **Identidad = sesión de Skill Hub.** Desaparecen "Tu nombre" y `EDIT_KEY`.
   Todo usuario logueado agrega, elimina y tilda; **Aplicar JSON** y
   **Restaurar originales** sólo admin. Cada cambio va a `audit_events`.
3. **Contrato JSON compatible** con la app vieja (`nodes` como objeto ordenado,
   `done` como `{id:true}`) para poder migrar con Datos → Copiar / Aplicar JSON.
4. **Concurrencia:** cada mutación toma `dep_map_meta FOR UPDATE`, incrementa
   `version`, registra actividad y emite el evento SSE después del commit
   (`DepMapService`). Presencia y SSE en memoria (`DepMapEvents`).
5. **Geometría y matriz se calculan en el cliente**
   (`frontend/src/app/features/depmap/dep-map-geometry.ts`,
   `dep-map-matrix.ts`): el servidor sólo guarda posiciones `x/y` y relaciones.
   La geometría empezó como puerto literal del `index.html` original
   (`dep-map-geometry.spec.ts` comparaba paths contra él) y luego se ajustó en
   la auditoría UX (nodos y viewBox más grandes, matriz que entra completa en
   escritorio, zoom/pan; ver `docs/PLAN-MAPA-UX.md`).
6. **Estilo:** tokens y primitivas de Skill Hub; azul/naranja sólo como
   semántica de dirección, en variables locales del componente.

## Alternativas consideradas

- **Montar la app vieja bajo `/mapa/` con un proxy:** era el plan previo;
  descartado en favor de una pantalla nativa para sumarla a la página con el
  mismo stack y la misma identidad.
- **Seguir con `state.json` en disco:** descartado al elegir tablas Postgres.
- **Calcular el layout o la matriz en el servidor:** *Razón no registrada —
  confirmar*; lo registrado es el objetivo de reproducir exactamente la
  geometría del cliente original.

## Consecuencias

- El mapa hereda auth, auditoría, backups y despliegue del resto de la app.
- **Presencia y SSE en memoria asumen una sola instancia de backend** (igual que
  la app original; documentado en el README).
- Hay modo sin conexión con caché en `localStorage` (`dep-map-cache.ts`).
- La geometría ya no es idéntica al original: las comparaciones del spec
  original dejaron de ser la referencia tras la auditoría UX.
- La vista celular quedó fuera de alcance por decisión del usuario
  (`docs/HANDOFF-MAPA-UX.md`).

## Referencias

- [PLAN-MAPA-DEPENDENCIAS.md](../../PLAN-MAPA-DEPENDENCIAS.md),
  [PROGRESO-MAPA-DEPENDENCIAS.md](../../PROGRESO-MAPA-DEPENDENCIAS.md),
  [docs/PLAN-MAPA-UX.md](../PLAN-MAPA-UX.md),
  [docs/AUDITORIA-UX-MAPA.md](../AUDITORIA-UX-MAPA.md),
  [docs/HANDOFF-MAPA-UX.md](../HANDOFF-MAPA-UX.md).
- [README.md](../../README.md) — sección "Mapa de dependencias".
- `backend/src/main/java/com/skillhub/depmap/`, `frontend/src/app/features/depmap/`.
- Commits `f6be65d`, `10190e9`, `c5269b1`, `eb1b4f4`, `a9d5428`.

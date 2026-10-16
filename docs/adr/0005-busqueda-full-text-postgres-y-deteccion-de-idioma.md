# 0005. Búsqueda full-text de PostgreSQL y detección de idioma propia

- **Estado:** Aceptado
- **Fecha:** 2026-09-08 (puerto de la búsqueda) · 2026-09-11 (catálogo bilingüe)

## Contexto

El catálogo necesita búsqueda tolerante a variantes ("Boton" / "Botones" /
"Buttons"), detección de duplicados al proponer un skill y ranking por uso. El
sistema original ya resolvía esto en SQL sobre PostgreSQL. El catálogo pasó a
escribirse en inglés (V12) y luego a admitir inglés y español a la vez (V17).

## Decisión

1. **Full-text de PostgreSQL + `pg_trgm`, sin motor externo.**
   - V11: extensión `pg_trgm`, índice GIN `to_tsvector(...)` sobre
     `skills.search_text` (texto desnormalizado), índice de trigramas sobre
     `title` e índice de `usage_daily` para el ranking.
   - V12: el índice pasa a `english`, porque stemming español sobre texto inglés
     no colapsa "buttons"/"button".
   - V17: se agrega un **segundo** índice `spanish` en paralelo (no en
     reemplazo) y la columna `skills.language`; las pasadas de búsqueda evalúan
     ambos idiomas con OR (commit `3c71570`).
2. **`SearchRepository` es un puerto línea por línea** de `search.ts`: tres
   pasadas (`websearch_to_tsquery` estricta → OR laxa con piso de `ts_rank` →
   trigramas), ranking `ts_rank × boost` y período de gracia. Pisos de
   relevancia: estricta 0.03, laxa 0.06; por debajo devuelve `results: []` y
   registra la búsqueda fallida (commit `5e1d58e`).
3. **Dedup al proponer** (`DuplicatesRepository`): similitud de trigramas sobre
   `title + when_to_use + inicio del cuerpo`, nunca sobre tags (un tag
   compartido bloqueaba convenciones legítimas); umbrales score 0.52 / título
   0.75, y por debajo entra como provisional para revisión humana.
4. **`LanguageDetector` heurístico propio** (puerto de `language.ts`): cuenta
   palabras funcionales y caracteres propios del español por campo; cualquier
   empate (incluido 0 a 0) queda ambiguo y no vota. Desde `3c71570` **no
   bloquea el español**: bloquea que los campos de un mismo skill mezclen
   idiomas (`idioma_inconsistente`). El fix `8ac33d4` eliminó el sesgo que
   clasificaba como inglés por falta de evidencia.

## Alternativas consideradas

- **Un solo índice FTS para los dos idiomas:** descartado; V11→V12 mostró que
  un único stemmer pierde recall en el otro idioma (comentario de V17).
- **Motor de búsqueda externo (Elasticsearch, Meilisearch, etc.):** *Razón no
  registrada — confirmar*; el spike sólo registra que se portó el SQL sin
  cambios de comportamiento.
- **Librería de detección de idioma (p. ej. modelos n-gram):** *Razón no
  registrada — confirmar*; el código documenta que la heurística es
  deliberadamente conservadora con jerga técnica y títulos cortos.

## Consecuencias

- Sin infraestructura adicional; búsqueda y dedup son transaccionales con el
  resto de los datos.
- Los umbrales (0.03 / 0.06 / 0.52 / 0.75) son calibraciones empíricas con un
  cliente real: cambiar el contenido del catálogo puede pedir recalibrar.
- Sumar un tercer idioma implica otra migración de índice, cambios en las
  consultas y en `LanguageDetector`.
- Cada `CREATE INDEX IF NOT EXISTS` con nombre existente no se recrea aunque
  cambie la expresión: por eso V12 hace `DROP INDEX` explícito.

## Referencias

- `backend/src/main/resources/db/migration/V11__search_indexes.sql`,
  `V12__english_fts_index.sql`, `V17__skill_language.sql`.
- `backend/src/main/java/com/skillhub/skill/SearchRepository.java`,
  `DuplicatesRepository.java`, `LanguageDetector.java`.
- Commits `a3bbd6e`, `5e1d58e`, `3c71570`, `8ac33d4`.
- Tests: `LanguageDetectorTest`, `McpIntegrationTest`.

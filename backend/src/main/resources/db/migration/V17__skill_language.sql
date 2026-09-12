-- Soporte de skills en español, coexistiendo con los que están en inglés.
-- No hay skills en español en producción hoy (V13 purgó los seeds, V14/V16
-- dejaron todo en inglés), así que no hace falta backfill más allá del default.

ALTER TABLE skills ADD COLUMN language text NOT NULL DEFAULT 'en'
  CHECK (language IN ('en', 'es'));

-- Segundo índice FTS en paralelo al de V12 (no en reemplazo): permite que el
-- catálogo tenga skills en inglés y en español a la vez sin perder recall en
-- ninguno de los dos (V11 -> V12 ya mostró que un solo stemmer no alcanza).
CREATE INDEX IF NOT EXISTS skills_search_fts_es_idx
  ON skills USING GIN (to_tsvector('spanish', search_text));

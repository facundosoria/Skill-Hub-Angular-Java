-- Índices de búsqueda y detección de duplicados (decisiones 4, 11 y 15).
-- Se aplica desde scripts/migrate.ts después de las migraciones de Drizzle:
-- Drizzle no modela ni índices por expresión ni extensiones, y como compara
-- contra su propio snapshot, no intenta borrar lo que se crea acá.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Full-text en español sobre el texto desnormalizado del skill.
CREATE INDEX IF NOT EXISTS skills_search_fts_idx
  ON skills USING GIN (to_tsvector('spanish', search_text));

-- Similitud por trigramas: agarra "Boton" / "Botones" / "Buttons" (decisión 11).
CREATE INDEX IF NOT EXISTS skills_title_trgm_idx
  ON skills USING GIN (title gin_trgm_ops);

-- Ventana de 90 días de usage_daily, que es lo que consulta el ranking.
CREATE INDEX IF NOT EXISTS usage_daily_skill_day_idx
  ON usage_daily (skill_id, day DESC);

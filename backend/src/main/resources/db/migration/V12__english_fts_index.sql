-- El catálogo pasa a estar escrito en inglés, así que el índice full-text
-- también. Con stemming español sobre texto inglés, "buttons" y "button" no
-- colapsan al mismo lexema y la búsqueda pierde justo lo que la hace útil.
--
-- El índice viejo se dropea explícitamente: los CREATE INDEX IF NOT EXISTS de
-- 001 no recrean nada si el nombre ya existe, aunque cambie la expresión.

DROP INDEX IF EXISTS skills_search_fts_idx;

CREATE INDEX IF NOT EXISTS skills_search_fts_en_idx
  ON skills USING GIN (to_tsvector('english', search_text));

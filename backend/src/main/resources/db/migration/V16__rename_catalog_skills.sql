-- Renombres del catalogo a la convencion generate-* (pedido del equipo LLM).
--
-- Dos entradas provisionales sin uso se borran para que el agente las re-proponga
-- con el slug correcto; dos publicadas se renombran in place (la fila conserva su
-- id, y con el id todo el historial y las metricas de uso, que son FK por id).
-- Solo user-stories-... (7 usos/90d) deja un stub `deprecated` -> superseded_by
-- para que get_skill / sync_skills redirijan a los agentes con copia local vieja.
--
-- Todas las sentencias son no-op si el slug no existe: es seguro correrla sin
-- conocer el estado exacto de prod.

-- 1. Provisionales sin uso: borrar. Los cascades de skill_versions / skill_tags /
--    usage_* se disparan igual que en V13.
DELETE FROM skills WHERE slug IN
  ('http-contract-behind-api-gateway',
   'kafka-event-contract-topic-envelope-delivery');

-- 2. epic-fiche-format -> generate-epic (publicado, sin uso registrado).
UPDATE skills SET slug = 'generate-epic', title = 'Generate epic', updated_at = now()
WHERE slug = 'epic-fiche-format';

-- 3. user-stories-in-plain-language-taiga-format -> generate-user-story
--    (publicado, 7 usos/90d): rename in place + stub deprecated en el slug viejo.
UPDATE skills SET slug = 'generate-user-story', title = 'Generate user story', updated_at = now()
WHERE slug = 'user-stories-in-plain-language-taiga-format';

INSERT INTO skills (slug, title, description, when_to_use, stack, type, status,
                    owner_team, origin, superseded_by, search_text)
SELECT 'user-stories-in-plain-language-taiga-format',
       'User stories in plain language (Taiga format)',
       description, when_to_use, stack, type, 'deprecated',
       owner_team, origin, id, ''
FROM skills WHERE slug = 'generate-user-story';

-- 4. Rebuild search_text de las dos filas vivas renombradas (cambio el title) -
--    mismo orden que Frontmatter.buildSearchText (ver V14).
UPDATE skills s
SET search_text = concat_ws(
  E'\n',
  s.title,
  s.description,
  s.when_to_use,
  (SELECT string_agg(tag, ' ' ORDER BY tag) FROM skill_tags WHERE skill_id = s.id),
  v.content
)
FROM skill_versions v
WHERE v.id = s.current_version_id
  AND s.slug IN ('generate-epic', 'generate-user-story');

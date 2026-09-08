-- Seed del skill de referencia `writing-skills`.
--
-- Las instrucciones del server y la descripcion de propose_skill mandan al
-- agente a leer get_skill('writing-skills') antes de proponer. V13 purgo todos
-- los skills de ejemplo, asi que ese slug no existia y la instruccion quedaba
-- rota. Este skill lo documenta: que significa cada campo de propose_skill y las
-- reglas de redaccion del catalogo.
--
-- Entra como `published` / origin `human`: es doc oficial, no una propuesta.
-- El search_text se arma al final con el mismo orden que
-- Frontmatter.buildSearchText (title, description, when_to_use, tags, content
-- unidos por saltos de linea).

INSERT INTO skills (
  slug, title, description, when_to_use,
  stack, type, status, origin, owner_team, search_text
)
VALUES (
  'writing-skills',
  'Writing skills for the catalogue',
  'Field-by-field guide to propose_skill and the wording rules every catalogue entry follows.',
  'Use when writing or proposing a catalogue skill: what each propose_skill field means and the house rules for wording title, description, when_to_use, content and rationale.',
  'shared',
  'reference',
  'published',
  'human',
  'platform',
  ''
);

INSERT INTO skill_tags (skill_id, tag)
SELECT s.id, tag
FROM skills s, unnest(ARRAY['writing', 'conventions', 'meta', 'propose']) AS tag
WHERE s.slug = 'writing-skills';

INSERT INTO skill_versions (skill_id, version, content, changelog)
SELECT s.id, 1, $body$## Rule

A catalogue entry is only useful if another agent can find it and follow it without guessing. Write every field for that reader.

## The fields of propose_skill

- **title** (required) - a short noun phrase naming the topic, 3-120 chars. Not a sentence.
- **description** (required) - one sentence, 10-200 chars. What the entry covers, in plain terms. Do not just repeat the title.
- **when_to_use** (required) - 10-200 chars, written FOR A MACHINE, not a person. Name the situations and the words someone would use to describe the task, e.g. "Use when doing X; also when Y or Z." This string is what decides whether search returns your entry, so spend the most effort here.
- **stack** (required) - one of `angular`, `java`, `shared`, `infra`. Use `shared` for anything not tied to one runtime.
- **type** - one of `skill` (how something is done), `convention` (a rule to respect), `reference` (data). Defaults to `convention`.
- **content** (required) - Markdown, min 40 chars, starting with `## Rule`. State the rule first, then the reasoning and any examples. Keep it short: an agent reads this every time.
- **from_query** (required) - the exact search that returned nothing and led you here. Used to track catalogue gaps.
- **rationale** (required, min 10 chars) - what you based the rule on: the surrounding codebase, a related entry, or general practice because there was nothing to infer from. Be honest; an admin reads this to decide how much to trust the entry.
- **tags** - up to 12 short strings for extra matching.
- **slug** - derived from the title if omitted. Only set it to override.

## Wording rules

- Write in English. The search index stems English and agents query in English; an entry in another language is effectively invisible.
- One rule per entry. If it needs two rules that apply in different situations, it is probably two entries.
- Prefer the imperative: "Always ...", "Never ...", "Name it ...".
- Only propose when search_skills returned nothing. If something similar exists, the call is refused and returns the existing entry - follow that one.
$body$, 'Seed inicial (V14).'
FROM skills s
WHERE s.slug = 'writing-skills';

UPDATE skills s
SET current_version_id = v.id
FROM skill_versions v
WHERE v.skill_id = s.id AND s.slug = 'writing-skills';

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
WHERE v.skill_id = s.id AND s.slug = 'writing-skills';

-- Marca en skill_versions para distinguir una revision propuesta por un agente
-- (via la tool MCP propose_revision) de una edicion pendiente hecha desde la web.
--
-- Ambas usan skills.pending_version_id + skill_versions.meta_snapshot, pero:
--   - la edicion web de un no-admin se resuelve por votos de pares (V8) y se ve
--     en la pagina del skill;
--   - la revision de un agente la revisa un admin desde /review, igual que las
--     provisionales nuevas.
-- El flag deja que /review liste solo las segundas sin tocar el flujo de la web.

ALTER TABLE "skill_versions"
  ADD COLUMN IF NOT EXISTS "proposed_by_agent" boolean NOT NULL DEFAULT false;

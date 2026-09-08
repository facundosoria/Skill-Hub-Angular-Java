-- Limpieza de datos de ejemplo previa al uso real del catálogo.
--
-- Se borran TODOS los skills (eran de ejemplo/prueba de la migración) y todas
-- las cuentas que no sean admin. Los admin se conservan: son las cuentas reales
-- del equipo y la primera cuenta del sistema siempre es admin.
--
-- Cascadas que hacen el trabajo pesado (ver V1/V2/V3):
--   skills        -> skill_versions, skill_tags, skill_related, skill_edit_votes,
--                    usage_daily, usage_daily_users, usage_events  (ON DELETE cascade)
--                    superseded_by                                 (ON DELETE set null)
--   users(no adm) -> api_keys, usage_daily_users, skill_edit_votes (ON DELETE cascade)
--                    audit_events.actor_id, usage_events.user_id    (ON DELETE set null;
--                    audit_events.actor_snapshot preserva el nombre del actor)

DELETE FROM skills;

DELETE FROM users WHERE role <> 'admin';

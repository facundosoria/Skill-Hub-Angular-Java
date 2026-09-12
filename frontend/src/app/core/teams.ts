/** Equipos oficiales de microservicios. Los valores coinciden con la API. */
export const TEAM_OPTIONS = [
  'Identidad y Usuarios',
  'Cursos y Matrícula',
  'Motor de Desafíos',
  'Teóricos y Encuestas',
  'Desafíos Prácticos',
  'Sandbox / Runtime',
  'Evaluación LLM',
  'Banco',
  'Mercado',
  'Roadmap y Progreso',
  'Social y Notificaciones',
  'Backoffice',
] as const;

export type Team = (typeof TEAM_OPTIONS)[number];

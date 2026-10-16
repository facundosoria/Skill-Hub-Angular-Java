import { LogEntry } from './infra-logs.models';

export interface LogExplanation { meaning: { es: string; en: string }; action: { es: string; en: string } }
const NEUTRAL: LogExplanation = {
  meaning: { es: 'Este evento resume información registrada por el gateway.', en: 'This event summarizes information recorded by the gateway.' },
  action: { es: 'Revisá la hora, la ruta y el trace ID si necesitás seguir la solicitud.', en: 'Check the time, route, and trace ID if you need to follow the request.' },
};
const explanations: Record<string, LogExplanation> = {
  'status:401': { meaning: { es: 'Suele indicar que tu sesión no es válida o venció.', en: 'This usually indicates that your session is invalid or expired.' }, action: { es: 'Iniciá sesión de nuevo.', en: 'Sign in again.' } },
  'status:403': { meaning: { es: 'Suele indicar que tu usuario no tiene permiso para este recurso.', en: 'This usually indicates that your account cannot access this resource.' }, action: { es: 'Comprobá que estés usando la cuenta correcta; si persiste, consultá al equipo.', en: 'Check that you are using the right account; contact the team if it continues.' } },
  'status:404': { meaning: { es: 'Suele indicar que la ruta no existe o el recurso no se encontró.', en: 'This usually indicates that the route or resource was not found.' }, action: { es: 'Revisá la dirección y volvé a intentarlo.', en: 'Check the address and try again.' } },
  'status:429': { meaning: { es: 'Suele indicar que hubo demasiadas solicitudes en poco tiempo.', en: 'This usually indicates that too many requests arrived in a short time.' }, action: { es: 'Esperá unos segundos y volvé a intentarlo.', en: 'Wait a few seconds and try again.' } },
  'status:4xx': { meaning: { es: 'El servidor rechazó la solicitud.', en: 'The server rejected the request.' }, action: { es: 'Revisá la solicitud y volvé a intentarlo.', en: 'Review the request and try again.' } },
  'status:5xx': { meaning: { es: 'Suele indicar que falló el servidor o un microservicio no respondió.', en: 'This usually indicates a server failure or an unresponsive service.' }, action: { es: 'Reportalo con la hora y el trace ID.', en: 'Report it with the time and trace ID.' } },
  'event:JWT_REJECTED:session-closed': { meaning: { es: 'Suele indicar que la sesión fue cerrada.', en: 'This usually indicates that the session was closed.' }, action: { es: 'Volvé a entrar.', en: 'Sign in again.' } },
  'event:UNEXPECTED_ERROR': { meaning: { es: 'Suele indicar un error no controlado del gateway.', en: 'This usually indicates an unhandled gateway error.' }, action: { es: 'Reportalo con la hora y el trace ID.', en: 'Report it with the time and trace ID.' } },
};
const statusNames: Record<number, { es: string; en: string }> = {
  200: { es: 'OK', en: 'OK' }, 201: { es: 'Creado', en: 'Created' }, 204: { es: 'Sin contenido', en: 'No content' },
  301: { es: 'Redirección', en: 'Redirect' }, 302: { es: 'Redirección', en: 'Redirect' }, 304: { es: 'No modificado', en: 'Not modified' },
  400: { es: 'Solicitud inválida', en: 'Bad request' }, 401: { es: 'No autenticado', en: 'Unauthenticated' },
  403: { es: 'Sin permiso', en: 'Forbidden' }, 404: { es: 'No encontrado', en: 'Not found' },
  409: { es: 'Conflicto', en: 'Conflict' }, 429: { es: 'Demasiadas solicitudes', en: 'Too many requests' },
  500: { es: 'Error interno', en: 'Internal error' }, 502: { es: 'Gateway no disponible', en: 'Gateway unavailable' },
  503: { es: 'Servicio no disponible', en: 'Service unavailable' }, 504: { es: 'Gateway no disponible', en: 'Gateway unavailable' },
};

export function statusName(status: number, locale: 'es' | 'en'): string { return statusNames[status]?.[locale] ?? ''; }

export function explainLog(entry: Pick<LogEntry, 'status' | 'event' | 'reason'>): LogExplanation {
  if (entry.event === 'JWT_REJECTED' && entry.reason === 'session-closed') return explanations['event:JWT_REJECTED:session-closed'];
  if (entry.event === 'UNEXPECTED_ERROR') return explanations['event:UNEXPECTED_ERROR'];
  if (entry.status !== null && explanations[`status:${entry.status}`]) return explanations[`status:${entry.status}`];
  if (entry.status !== null && entry.status >= 400 && entry.status <= 499) return explanations['status:4xx'];
  if (entry.status !== null && entry.status >= 500 && entry.status <= 599) return explanations['status:5xx'];
  return NEUTRAL;
}

export function hasSpecificExplanation(entry: Pick<LogEntry, 'status' | 'event' | 'reason'>): boolean {
  return (entry.event === 'JWT_REJECTED' && entry.reason === 'session-closed') || entry.event === 'UNEXPECTED_ERROR' ||
    (entry.status !== null && entry.status >= 400 && entry.status <= 599);
}

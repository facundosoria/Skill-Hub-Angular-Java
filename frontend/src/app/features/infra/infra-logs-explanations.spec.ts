import { describe, expect, it } from 'vitest';
import { explainLog, statusName } from './infra-logs-explanations';
import { logEntry } from './infra-logs.fixtures';

describe('gateway log explanations', () => {
  it('explains common HTTP failures without asserting an unverified cause', () => {
    const explanation = explainLog(logEntry(1, { status: 401 }));
    expect(explanation.meaning.es).toContain('Suele indicar');
    expect(explanation.meaning.es).toContain('sesión');
    expect(explanation.action.es).toContain('Iniciá sesión');
  });
  it('explains known gateway events and uses neutral copy for unknown events', () => {
    expect(explainLog(logEntry(1, { status: 500, event: 'UNEXPECTED_ERROR' })).meaning.es).toContain('no controlado');
    expect(explainLog(logEntry(1, { status: null, event: 'UNLISTED_EVENT' })).meaning.es).toContain('No hay una explicación');
  });
  it('labels requested common HTTP statuses in both locales', () => {
    expect(statusName(201, 'es')).toBe('Creado');
    expect(statusName(503, 'es')).toBe('Servicio no disponible');
    expect(statusName(404, 'en')).toBe('Not found');
  });
});

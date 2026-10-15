import { describe, expect, it } from 'vitest';
import { groupEntries, issueMarkdown, routeSegment, toCsv } from './infra-logs-diagnostics';
import { logEntry } from './infra-logs.fixtures';

describe('gateway log diagnostics helpers', () => {
  it('groups repeated warnings and errors by level, event, route, and status', () => {
    const entries = [logEntry(1, { level: 'ERROR', status: 500 }), logEntry(2, { level: 'ERROR', status: 500 }),
      logEntry(3, { level: 'INFO', status: 200 }), logEntry(4, { level: 'WARN', status: 500 })];
    const groups = groupEntries(entries, true);
    expect(groups.map(group => group.entries.length)).toEqual([2, 1, 1]);
    expect(groupEntries(entries, false).map(group => group.entries.length)).toEqual([1, 1, 1, 1]);
  });
  it('builds an issue summary and CSV from sanitized fields only', () => {
    const entry = logEntry(10, { status: 503, traceId: null });
    const markdown = issueMarkdown([entry]);
    expect(markdown).toContain('Ventana de logs de 6 h del api-gateway');
    expect(markdown).toContain('Servicio no disponible'); expect(markdown).toContain('UTC');
    expect(markdown).not.toContain('email'); expect(markdown).not.toContain('userId');
    expect(toCsv([logEntry(1, { route: '/api/a,"b' })])).toContain('"/api/a,""b"');
  });
  it('extracts a route segment without mapping it to a service', () => {
    expect(routeSegment('/api/users/{id}')).toBe('users');
    expect(routeSegment(null)).toBe('');
  });
});

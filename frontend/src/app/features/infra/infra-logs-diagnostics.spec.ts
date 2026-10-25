import { describe, expect, it } from 'vitest';
import { downloadFilename, groupEntries, issueMarkdown, routeInsights, routeSegment, toCsv, toText } from './infra-logs-diagnostics';
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
  it('extracts the first segment of routes outside /api and handles bare /api', () => {
    expect(routeSegment('/health')).toBe('health');
    expect(routeSegment('/api')).toBe('');
    expect(routeSegment('')).toBe('');
  });
  it('counts requests and errors per route and skips entries without a route', () => {
    const insights = routeInsights([
      logEntry(1, { route: '/api/a', status: 200 }), logEntry(2, { route: '/api/a', status: 404 }),
      logEntry(3, { route: '/api/b', status: null }), logEntry(4, { route: null }),
    ]);
    expect(insights).toEqual([
      { route: '/api/a', segment: 'a', count: 2, errorCount: 1 },
      { route: '/api/b', segment: 'b', count: 1, errorCount: 0 },
    ]);
  });
  it('fills missing request fields with dashes in the issue summary', () => {
    const markdown = issueMarkdown([logEntry(1, { method: null, route: null, status: null, durationMs: null, traceId: null })]);
    expect(markdown).toContain('- **Método:** —');
    expect(markdown).toContain('- **Ruta:** —');
    expect(markdown).toContain('- **Estado:** Sin estado');
    expect(markdown).toContain('- **Duración:** —');
    expect(markdown).toContain('- **Trace ID:** —');
  });
  it('shows bare status codes without a known name', () => {
    expect(issueMarkdown([logEntry(1, { status: 299 })])).toContain('- **Estado:** 299\n');
  });
  it('caps the issue summary at fifty events', () => {
    const entries = Array.from({ length: 60 }, (_, i) => logEntry(i + 1));
    expect(issueMarkdown(entries).match(/Hora UTC/g)).toHaveLength(50);
  });
  it('escapes spreadsheet formulas, joins lines and leaves nulls empty in CSV', () => {
    const csv = toCsv([logEntry(1, { route: '=HYPERLINK()', reason: null, lines: ['uno', 'dos'] })]);
    const [header, row] = csv.split('\r\n');
    expect(header.startsWith('"id","timestamp"')).toBe(true);
    expect(row).toContain(`"'=HYPERLINK()"`);
    expect(row).toContain('"uno\ndos"');
    expect(row).toContain(',"",');
    for (const prefix of ['+', '@', '-']) expect(toCsv([logEntry(1, { reason: `${prefix}x` })])).toContain(`"'${prefix}x"`);
  });
  it('renders a readable text export', () => {
    const text = toText([
      logEntry(1, { timestamp: '2026-10-25T10:00:00.000Z', lines: ['primera', 'segunda'] }),
      logEntry(2, { timestamp: '2026-10-25T10:00:01.000Z', method: null, route: null, status: null, durationMs: null, lines: ['solo'] }),
    ]);
    expect(text).toContain('2026-10-25T10:00:00.000Z INFO GET /api/example/{id} 200 OK 18 ms REQUEST_COMPLETED\nprimera\nsegunda');
    expect(text).toContain('2026-10-25T10:00:01.000Z INFO   Sin estado  ms REQUEST_COMPLETED\nsolo');
    expect(text.split('\n\n')).toHaveLength(2);
  });
  it('builds safe download file names', () => {
    const now = new Date('2026-10-25T10:11:12.345Z');
    expect(downloadFilename('g7', 'json', now)).toBe('api-gateway-g7-2026-10-25T10-11-12-345Z.json');
    expect(downloadFilename(null, 'csv', now)).toBe('api-gateway-starting-2026-10-25T10-11-12-345Z.csv');
    expect(downloadFilename('../g:1', 'txt', now)).toBe('api-gateway-___g_1-2026-10-25T10-11-12-345Z.txt');
    expect(downloadFilename('g7', 'txt')).toMatch(/^api-gateway-g7-\d{4}-.*\.txt$/);
  });
});

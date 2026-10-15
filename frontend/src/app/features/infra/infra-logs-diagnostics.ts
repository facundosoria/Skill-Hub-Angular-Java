import { LogEntry } from './infra-logs.models';
import { statusName } from './infra-logs-explanations';

export interface LogGroup { key: string; entries: LogEntry[]; representative: LogEntry }
export interface RouteInsight { route: string; segment: string; count: number; errorCount: number }

export function groupEntries(entries: LogEntry[], enabled: boolean): LogGroup[] {
  const groups = new Map<string, LogGroup>();
  for (const entry of entries) {
    const key = enabled && entry.level !== 'INFO'
      ? JSON.stringify([entry.level, entry.event, entry.route, entry.status]) : entry.id;
    const group = groups.get(key);
    if (group) group.entries.push(entry);
    else groups.set(key, { key, entries: [entry], representative: entry });
  }
  return [...groups.values()];
}

export function routeSegment(route: string | null): string {
  const segments = route?.split('/').filter(Boolean) ?? [];
  return segments[0] === 'api' ? segments[1] ?? '' : segments[0] ?? '';
}

export function routeInsights(entries: LogEntry[]): RouteInsight[] {
  const grouped = new Map<string, RouteInsight>();
  for (const entry of entries) {
    if (!entry.route) continue;
    const insight = grouped.get(entry.route) ?? { route: entry.route, segment: routeSegment(entry.route), count: 0, errorCount: 0 };
    insight.count++;
    if (entry.status !== null && entry.status >= 400) insight.errorCount++;
    grouped.set(entry.route, insight);
  }
  return [...grouped.values()];
}

function localTime(timestamp: string): string { return new Date(timestamp).toLocaleString('es-AR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hour12: false }); }
function statusText(entry: LogEntry): string {
  return entry.status === null ? 'Sin estado' : `${entry.status}${statusName(entry.status, 'es') ? ` ${statusName(entry.status, 'es')}` : ''}`;
}

export function issueMarkdown(entries: LogEntry[]): string {
  const blocks = entries.slice(0, 50).map(entry => [
    `- **Hora local:** ${localTime(entry.timestamp)}`,
    `- **Hora UTC:** ${entry.timestamp}`,
    `- **Método:** ${entry.method ?? '—'}`,
    `- **Ruta:** ${entry.route ?? '—'}`,
    `- **Estado:** ${statusText(entry)}`,
    `- **Duración:** ${entry.durationMs === null ? '—' : `${entry.durationMs} ms`}`,
    `- **Nivel:** ${entry.level}`,
    `- **Logger / evento:** ${entry.logger} / ${entry.event}`,
    `- **Trace ID:** ${entry.traceId ?? '—'}`,
  ].join('\n'));
  return `Ventana de logs de 6 h del api-gateway\n\n${blocks.join('\n\n')}`;
}

function cell(value: unknown): string {
  let text = value == null ? '' : Array.isArray(value) ? value.join('\n') : String(value);
  if (/^[=+@\-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(entries: LogEntry[]): string {
  const fields: (keyof LogEntry)[] = ['id', 'timestamp', 'level', 'logger', 'event', 'traceId', 'spanId',
    'method', 'route', 'status', 'durationMs', 'reason', 'lines', 'redacted'];
  return [fields.map(cell).join(','), ...entries.map(entry => fields.map(field => cell(entry[field])).join(','))].join('\r\n');
}

export function toText(entries: LogEntry[]): string {
  return entries.map(entry => `${entry.timestamp} ${entry.level} ${entry.method ?? ''} ${entry.route ?? ''} ${statusText(entry)} ${entry.durationMs ?? ''} ms ${entry.event}\n${entry.lines.join('\n')}`).join('\n\n');
}

export function downloadFilename(generation: string | null, extension: 'json' | 'csv' | 'txt', now = new Date()): string {
  const timestamp = now.toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const safeGeneration = (generation ?? 'starting').replace(/[^A-Za-z0-9_-]/g, '_');
  return `api-gateway-${safeGeneration}-${timestamp}.${extension}`;
}

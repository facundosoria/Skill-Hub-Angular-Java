export type LogLevel = 'INFO' | 'WARN' | 'ERROR';
export type SourceStatus = 'healthy' | 'disconnected' | 'starting';
export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  logger: string;
  event: string;
  traceId: string | null;
  spanId: string | null;
  method: string | null;
  route: string | null;
  status: number | null;
  durationMs: number | null;
  reason: string | null;
  lines: string[];
  redacted: true;
}
export type LogMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type LogStatusFilter = '2xx' | '3xx' | '4xx' | '5xx';
export interface LogFilters { levels: LogLevel[]; q: string; traceId: string; route: string; methods: LogMethod[]; statuses: LogStatusFilter[]; minDurationMs: number | null }
export interface LogStatus {
  sourceStatus: SourceStatus;
  generation: string | null;
  coverageStart: string | null;
  headCursor: string | null;
  oldestCursor: string | null;
  omittedCount: number;
  retentionTruncated: boolean;
  activeStreams: number;
  accountBlockedUntil: string | null;
}
export interface LogPage {
  service: 'api-gateway';
  generation: string | null;
  generatedAt: string;
  retentionSeconds: number;
  coverageStart: string | null;
  sourceStatus: SourceStatus;
  lastSourceContactAt: string | null;
  lastEventAt: string | null;
  policyVersion: string | null;
  capacityLimited: boolean;
  omittedCount: number;
  headCursor: string | null;
  oldestCursor: string | null;
  nextBefore: string | null;
  nextAfter: string | null;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  entries: LogEntry[];
}
export type LogConnection = 'loading' | 'starting' | 'connecting' | 'live' | 'reconnecting' | 'polling' | 'paused' | 'hidden' | 'blocked' | 'error' | 'revoked';
export const EMPTY_FILTERS: LogFilters = { levels: [], q: '', traceId: '', route: '', methods: [], statuses: [], minDurationMs: null };
export function validFilters(filters: LogFilters): boolean {
  return filters.q.length <= 120 && filters.route.length <= 120 && !/[\u0000-\u001f\u007f]/.test(filters.route) && (!filters.traceId || /^[\da-f]{32}$/i.test(filters.traceId)) &&
    (filters.minDurationMs === null || filters.minDurationMs >= 0 && filters.minDurationMs <= 600_000) &&
    filters.levels.every(level => ['INFO', 'WARN', 'ERROR'].includes(level)) &&
    filters.methods.every(method => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) &&
    filters.statuses.every(status => ['2xx', '3xx', '4xx', '5xx'].includes(status));
}
export function isCursor(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && /^[^:\s]+:\d+$/.test(value);
}
export function compareCursors(a: string, b: string): number {
  const [ag, as] = a.split(':');
  const [bg, bs] = b.split(':');
  if (ag !== bg) throw new Error('Cursor generation mismatch');
  return BigInt(as) < BigInt(bs) ? -1 : BigInt(as) > BigInt(bs) ? 1 : 0;
}
export function decodeEntries(value: unknown): LogEntry[] {
  if (!Array.isArray(value) || value.some(entry => !entry || !isCursor(entry.id) ||
    typeof entry.timestamp !== 'string' || !Number.isFinite(Date.parse(entry.timestamp)) ||
    !['INFO', 'WARN', 'ERROR'].includes(entry.level) || typeof entry.logger !== 'string' ||
    typeof entry.event !== 'string' || entry.redacted !== true || !Array.isArray(entry.lines) ||
    entry.lines.length > 64 || entry.lines.some((line: unknown) => typeof line !== 'string') ||
    (entry.traceId != null && (typeof entry.traceId !== 'string' || !/^[\da-f]{32}$/i.test(entry.traceId))))) {
    throw new Error('Invalid sanitized log batch');
  }
  return value;
}

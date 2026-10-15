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
export interface LogFilters { levels: LogLevel[]; q: string; traceId: string }
export interface LogStatus {
  sourceStatus: SourceStatus;
  generation: string;
  coverageStart: string;
  headCursor: string;
  oldestCursor: string;
  omittedCount: number;
  retentionTruncated: boolean;
  activeStreams: number;
  accountBlockedUntil: string | null;
}
export interface LogPage {
  service: 'api-gateway';
  generation: string;
  generatedAt: string;
  retentionSeconds: number;
  coverageStart: string;
  sourceStatus: SourceStatus;
  lastSourceContactAt: string | null;
  lastEventAt: string | null;
  policyVersion: string;
  capacityLimited: boolean;
  omittedCount: number;
  headCursor: string;
  oldestCursor: string;
  nextBefore: string | null;
  nextAfter: string;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  entries: LogEntry[];
}
export type LogConnection = 'loading' | 'connecting' | 'live' | 'reconnecting' | 'polling' | 'paused' | 'hidden' | 'blocked' | 'error' | 'revoked';
export const EMPTY_FILTERS: LogFilters = { levels: [], q: '', traceId: '' };
export function validFilters(filters: LogFilters): boolean {
  return filters.q.length <= 120 && (!filters.traceId || /^[\da-f]{32}$/i.test(filters.traceId)) &&
    filters.levels.every(level => ['INFO', 'WARN', 'ERROR'].includes(level));
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

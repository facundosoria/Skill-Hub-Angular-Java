import { LogBuffer } from './infra-logs.buffer';
import { compareCursors, EMPTY_FILTERS, validFilters } from './infra-logs.models';
import { logEntry } from './infra-logs.fixtures';

describe('Gateway log browser buffer', () => {
  it('deduplicates by ID and preserves sequence order independently of timestamps', () => {
    const buffer = new LogBuffer();
    buffer.merge([logEntry(3), logEntry(1), logEntry(2, { timestamp: new Date(Date.now() - 1000).toISOString() })]);
    expect(buffer.merge([logEntry(2), logEntry(4)])).toBe(1);
    expect(buffer.values().map(entry => entry.id)).toEqual(['g7:1', 'g7:2', 'g7:3', 'g7:4']);
  });
  it('keeps at most 5000 events and discards the oldest with a warning', () => {
    const buffer = new LogBuffer();
    buffer.merge(Array.from({ length: 5002 }, (_, index) => logEntry(index + 1)));
    expect(buffer.values()).toHaveLength(5000); expect(buffer.values()[0].id).toBe('g7:3'); expect(buffer.truncated).toBe(true);
  });
  it('enforces the 8 MiB UTF-8 payload limit including multiline entries', () => {
    const buffer = new LogBuffer();
    buffer.merge(Array.from({ length: 1500 }, (_, index) => logEntry(index + 1, { lines: ['é'.repeat(3800)] })));
    expect(buffer.payloadBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(buffer.values().length).toBeLessThan(1500); expect(buffer.truncated).toBe(true);
  });
  it('prunes expired events during a heartbeat even without incoming lines', () => {
    const buffer = new LogBuffer();
    buffer.merge([logEntry(1, { timestamp: new Date(Date.now() - 3600_000).toISOString() }), logEntry(2)]);
    buffer.merge([], new Date(Date.now() - 1000).toISOString());
    expect(buffer.values().map(entry => entry.id)).toEqual(['g7:2']);
  });
  it('compares large sequence numbers without losing precision', () => {
    expect(compareCursors('g7:9007199254740993', 'g7:9007199254740992')).toBe(1);
  });
});
describe('Gateway log filters', () => {
  it('accepts only exposed levels, literal text up to 120 chars and exactly 32 hex trace chars', () => {
    expect(validFilters({ ...EMPTY_FILTERS, levels: ['INFO', 'WARN'], q: 'a'.repeat(120), traceId: 'ABCDEF12'.repeat(4) })).toBe(true);
    expect(validFilters({ ...EMPTY_FILTERS, q: 'a'.repeat(121) })).toBe(false);
    expect(validFilters({ ...EMPTY_FILTERS, traceId: 'g'.repeat(32) })).toBe(false);
    expect(validFilters({ ...EMPTY_FILTERS, traceId: '1'.repeat(31) })).toBe(false);
    expect(validFilters({ ...EMPTY_FILTERS, levels: ['DEBUG' as 'INFO'] })).toBe(false);
  });
});

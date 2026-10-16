import { compareCursors, LogEntry } from './infra-logs.models';

/** Payload accounting includes every retained event, including off-screen rows. */
export class LogBuffer {
  private items = new Map<string, { entry: LogEntry; bytes: number }>();
  private bytes = 0;
  truncated = false;
  constructor(private maxEvents = 5000, private maxBytes = 8 * 1024 * 1024) {}
  clear(): void { this.items.clear(); this.bytes = 0; this.truncated = false; }
  merge(entries: LogEntry[], coverageStart?: string): number {
    let added = 0;
    for (const entry of entries) {
      if (this.items.has(entry.id)) continue;
      const bytes = new TextEncoder().encode(JSON.stringify(entry)).byteLength;
      this.items.set(entry.id, { entry, bytes });
      this.bytes += bytes;
      added++;
    }
    const sorted = [...this.items.values()].sort((a, b) => compareCursors(a.entry.id, b.entry.id));
    for (const item of sorted) {
      if (coverageStart && Date.parse(item.entry.timestamp) < Date.parse(coverageStart)) {
        this.remove(item.entry.id);
      } else if (this.items.size > this.maxEvents || this.bytes > this.maxBytes) {
        this.remove(item.entry.id);
        this.truncated = true;
      }
    }
    return added;
  }
  private remove(id: string): void {
    this.bytes -= this.items.get(id)!.bytes;
    this.items.delete(id);
  }
  values(): LogEntry[] { return [...this.items.values()].map(item => item.entry).sort((a, b) => compareCursors(a.id, b.id)); }
  get payloadBytes(): number { return this.bytes; }
}

import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../core/api';
import type { RoomDetailData, RoomMessage, RoomStatus } from './room-models';

/**
 * Estado de una sala abierta en la web. Mismo esquema que DepMapStore: carga
 * inicial por REST y despues SSE (/api/rooms/{id}/events). EventSource se
 * reconecta solo; el "hello" de cada conexion trae el ultimo seq y, si nos
 * perdimos mensajes, se piden por cursor.
 */
@Injectable()
export class RoomStore {
  private api = inject(Api);

  readonly room = signal<RoomDetailData | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly live = signal(false);

  private id = '';
  private eventSource: EventSource | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.disconnect());
  }

  async open(id: string, loadError: string): Promise<void> {
    this.disconnect();
    this.id = id;
    this.loading.set(true);
    this.error.set(null);
    try {
      this.room.set(await firstValueFrom(this.api.get<RoomDetailData>(`/rooms/${encodeURIComponent(id)}`)));
      this.connect();
    } catch {
      this.error.set(loadError);
    } finally {
      this.loading.set(false);
    }
  }

  /** Recarga sala y contrato; se usa tras propuestas, aceptaciones y cambios de estado. */
  async refresh(): Promise<void> {
    if (!this.id) return;
    try {
      this.room.set(await firstValueFrom(this.api.get<RoomDetailData>(`/rooms/${encodeURIComponent(this.id)}`)));
    } catch {
      // Se reintenta con el siguiente evento.
    }
  }

  append(message: RoomMessage, status?: RoomStatus): void {
    this.room.update((room) => {
      if (!room || room.messages.some((m) => m.seq === message.seq)) return room;
      const messages = [...room.messages, message].sort((a, b) => a.seq - b.seq);
      return {
        ...room,
        messages,
        status: status ?? room.status,
        lastSeq: Math.max(room.lastSeq, message.seq),
      };
    });
  }

  private async catchUp(): Promise<void> {
    const room = this.room();
    if (!room) return;
    const since = room.messages.length ? room.messages[room.messages.length - 1].seq : 0;
    try {
      const page = await firstValueFrom(
        this.api.get<{ messages: RoomMessage[] }>(`/rooms/${encodeURIComponent(this.id)}/messages`, {
          since,
          limit: 200,
        }),
      );
      page.messages.forEach((m) => this.append(m));
      this.refreshSoon();
    } catch {
      // Sin red: el proximo hello vuelve a intentarlo.
    }
  }

  private connect(): void {
    if (typeof EventSource === 'undefined') return;
    this.eventSource = new EventSource(`/api/rooms/${encodeURIComponent(this.id)}/events`);
    this.eventSource.onopen = () => this.live.set(true);
    this.eventSource.onerror = () => this.live.set(false);
    this.eventSource.onmessage = (event) => {
      let data: { type?: string; lastSeq?: number; message?: RoomMessage; status?: RoomStatus };
      try {
        data = JSON.parse(event.data) as typeof data;
      } catch {
        return;
      }
      if (data.type === 'hello') {
        this.live.set(true);
        if ((data.lastSeq ?? 0) > (this.room()?.lastSeq ?? 0)) void this.catchUp();
      } else if (data.type === 'message' && data.message) {
        this.append(data.message, data.status);
        if (data.message.kind !== 'message') this.refreshSoon();
      }
    };
  }

  private refreshSoon(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 250);
  }

  private disconnect(): void {
    this.eventSource?.close();
    this.eventSource = null;
    this.live.set(false);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }
}

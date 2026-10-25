import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER, of, throwError } from 'rxjs';
import { Api } from '../../core/api';
import { AuthService } from '../../core/auth';
import type { User } from '../../core/models';
import { Highlighter } from '../../shared/highlighter';
import type { RoomDetailData, RoomMessage } from './room-models';
import { RoomDetail } from './room-detail';

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  emit(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
}

describe('RoomDetail', () => {
  const user = signal<User | null>(null);
  const api = { get: vi.fn(), post: vi.fn() };
  const flush = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    FakeEventSource.last = null;
    vi.stubGlobal('EventSource', FakeEventSource);
    user.set(member('Banco'));
    api.get.mockReset().mockReturnValue(of(detail()));
    api.post.mockReset().mockReturnValue(of({}));
    TestBed.configureTestingModule({
      imports: [RoomDetail],
      providers: [
        provideRouter([]),
        { provide: Api, useValue: api },
        { provide: AuthService, useValue: { user: user.asReadonly() } },
        { provide: Highlighter, useValue: { codeToHtml: vi.fn().mockResolvedValue(null) } },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function render(id = 'r1') {
    const fixture = TestBed.createComponent(RoomDetail);
    fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('shows the loading message and then the load error', async () => {
    api.get.mockReturnValue(NEVER);
    const loading = TestBed.createComponent(RoomDetail);
    loading.componentRef.setInput('id', 'r1');
    loading.detectChanges();
    loading.detectChanges();
    expect(loading.nativeElement.textContent).toContain(loading.componentInstance.t().salas.cargando);

    api.get.mockReturnValue(throwError(() => ({})));
    const { el, component } = await render();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(component.t().salas.errorCarga);
  });

  it('renders messages, the markdown contract and accepts it', async () => {
    const { fixture, component, el } = await render();
    const t = component.t().salas;
    expect(api.get).toHaveBeenCalledWith('/rooms/r1');
    expect(FakeEventSource.last?.url).toBe('/api/rooms/r1/events');
    expect(el.textContent).toContain('Sala de pagos');
    expect(el.textContent).toContain('Sistema: sala creada');
    expect(el.textContent).toContain(t.propuesta);
    expect(el.textContent).toContain(t.aceptacion);
    expect(el.textContent).toContain(t.pendientes);
    expect(el.textContent).toContain(component.howTo());
    expect(component.canAccept()).toBe(true);
    expect(component.canClose()).toBe(true);
    expect(component.tone('agreed')).toBe('success');
    expect(component.tone('closed')).toBe('neutral');

    FakeEventSource.last!.onopen?.();
    fixture.detectChanges();
    expect(el.textContent).toContain(t.enVivo);
    FakeEventSource.last!.onerror?.();
    fixture.detectChanges();
    expect(el.textContent).toContain(t.sinConexion);

    api.get.mockReturnValue(of(detail({ contract: { ...detail().contract!, acceptedBy: ['Mercado', 'Banco'], pendingTeams: [] } })));
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(t.aceptar))!.click();
    await flush();
    fixture.detectChanges();
    expect(api.post).toHaveBeenCalledWith('/rooms/r1/contracts/2/accept');
    expect(el.textContent).toContain(t.yaAceptaste);
  });

  it('shows an OpenAPI contract as preformatted text and a missing contract', async () => {
    api.get.mockReturnValue(of(detail({ contract: { ...detail().contract!, format: 'openapi', content: 'openapi: 3.1.0' } })));
    const openapi = await render();
    expect(openapi.el.querySelector('pre')?.textContent).toContain('openapi: 3.1.0');

    api.get.mockReturnValue(of(detail({ contract: null, topic: '' })));
    const none = await render();
    expect(none.el.textContent).toContain(none.component.t().salas.sinContrato);
    expect(none.component.canAccept()).toBe(false);
  });

  it('sends a message and ignores empty drafts', async () => {
    const { fixture, component, el } = await render();
    await component.send();
    expect(api.post).not.toHaveBeenCalled();

    api.post.mockReturnValue(of(message({ seq: 9, body: 'Hola equipo', kind: 'message' })));
    component.draft.set('  Hola equipo ');
    fixture.detectChanges();
    (el.querySelector('form button[type="submit"]') as HTMLButtonElement).click();
    await flush();
    fixture.detectChanges();
    expect(api.post).toHaveBeenCalledWith('/rooms/r1/messages', { body: 'Hola equipo' });
    expect(component.draft()).toBe('');
    expect(el.textContent).toContain('Hola equipo');
  });

  it('closes the room after confirmation and reports errors', async () => {
    const { fixture, component, el } = await render();
    vi.stubGlobal('confirm', vi.fn(() => false));
    await component.close();
    expect(api.post).not.toHaveBeenCalled();

    vi.stubGlobal('confirm', vi.fn(() => true));
    api.post.mockReturnValueOnce(throwError(() => ({ error: { error: 'Sin permiso' } })));
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(component.t().salas.cerrar))!.click();
    await flush();
    fixture.detectChanges();
    expect(el.textContent).toContain('Sin permiso');

    api.get.mockReturnValue(of(detail({ status: 'closed' })));
    await component.close();
    fixture.detectChanges();
    expect(api.post).toHaveBeenLastCalledWith('/rooms/r1/close');
    expect(el.textContent).toContain(component.t().salas.cerrada);
    expect(component.canAccept()).toBe(false);
  });

  it('lets admins close rooms from other teams', async () => {
    user.set({ ...member('Mercado'), role: 'admin' } as User);
    api.get.mockReturnValue(of(detail({ createdByTeam: 'Banco', teams: ['Banco'] })));
    const { component } = await render();
    expect(component.canClose()).toBe(true);
    expect(component.canAccept()).toBe(false);

    user.set(member(null));
    expect(component.canClose()).toBe(false);
  });

  it('applies live events and catches up on missed messages', async () => {
    const { fixture, component, el } = await render();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const source = FakeEventSource.last!;
    const store = (component as unknown as { store: { room(): RoomDetailData | null; live(): boolean } }).store;

    source.emit('no es json');
    source.emit({ type: 'hello', lastSeq: 3 });
    expect(store.live()).toBe(true);

    source.emit({ type: 'message', message: message({ seq: 4, body: 'Nuevo', kind: 'message' }) });
    source.emit({ type: 'message', message: message({ seq: 4, body: 'Duplicado', kind: 'message' }) });
    expect(store.room()!.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4]);

    api.get.mockImplementation((url: string) =>
      url.endsWith('/messages') ? of({ messages: [message({ seq: 6, body: 'Seis' }), message({ seq: 5, body: 'Cinco' })] }) : of(detail({ status: 'agreed', lastSeq: 6 })),
    );
    source.emit({ type: 'hello', lastSeq: 6 });
    await vi.advanceTimersByTimeAsync(0);
    expect(api.get).toHaveBeenCalledWith('/rooms/r1/messages', { since: 4, limit: 200 });
    expect(store.room()!.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5, 6]);

    source.emit({ type: 'message', message: message({ seq: 7, kind: 'accept', body: 'Acepto' }), status: 'agreed' });
    expect(store.room()!.status).toBe('agreed');
    await vi.advanceTimersByTimeAsync(250);
    expect(store.room()!.lastSeq).toBe(6);
    fixture.detectChanges();
    expect(el.textContent).toContain(component.t().salas.estado.agreed);

    api.get.mockReturnValue(throwError(() => ({})));
    source.emit({ type: 'hello', lastSeq: 99 });
    source.emit({ type: 'message', message: message({ seq: 8, kind: 'proposal' }) });
    await vi.advanceTimersByTimeAsync(250);
    expect(store.room()).not.toBeNull();

    fixture.destroy();
    expect(source.close).toHaveBeenCalled();
  });

  it('reopens the store when the id changes', async () => {
    const { fixture } = await render('r1');
    const first = FakeEventSource.last!;
    fixture.componentRef.setInput('id', 'r 2');
    fixture.detectChanges();
    await flush();
    expect(first.close).toHaveBeenCalled();
    expect(api.get).toHaveBeenCalledWith('/rooms/r%202');
  });

  it('skips live updates without EventSource support', async () => {
    vi.stubGlobal('EventSource', undefined);
    const { component } = await render();
    expect((component as unknown as { store: { live(): boolean } }).store.live()).toBe(false);
  });
});

function member(team: string | null): User {
  return { id: 'u', username: 'ana', name: 'Ana', team, role: 'member', mustChangePassword: false } as User;
}

function message(overrides: Partial<RoomMessage> = {}): RoomMessage {
  return {
    id: `m${overrides.seq ?? 1}`,
    seq: 1,
    authorName: 'agente-banco',
    authorTeam: 'Banco',
    authorKind: 'agent',
    kind: 'message',
    body: 'Mensaje',
    createdAt: '2026-10-01T10:00:00Z',
    ...overrides,
  };
}

function detail(overrides: Partial<RoomDetailData> = {}): RoomDetailData {
  return {
    id: 'r1',
    title: 'Sala de pagos',
    topic: 'Definir contrato',
    createdByTeam: 'Banco',
    status: 'open',
    lastSeq: 3,
    teams: ['Banco', 'Mercado'],
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-01T10:00:00Z',
    contract: {
      version: 2,
      format: 'markdown',
      proposedByTeam: 'Mercado',
      createdAt: '2026-10-01T10:00:00Z',
      acceptedBy: ['Mercado'],
      pendingTeams: ['Banco'],
      content: '## Contrato\n\nPOST /pagos',
    },
    messages: [
      message({ seq: 1, kind: 'system', authorKind: 'system', body: 'Sistema: sala creada' }),
      message({ seq: 2, kind: 'proposal', authorTeam: 'Mercado', body: 'Propongo v2' }),
      message({ seq: 3, kind: 'accept', authorTeam: 'Mercado', authorKind: 'human', body: 'Acepto' }),
    ],
    ...overrides,
  };
}

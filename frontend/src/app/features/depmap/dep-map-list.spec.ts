import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { DepMapList } from './dep-map-list';
import { DepMapEdge, DepMapState, DepMapStore } from './dep-map-store';
import { I18n } from '../../core/i18n/i18n';

const edges: DepMapEdge[] = [
  { id: 'e-ops-usr', from: 'ops', to: 'usr', kind: 'api', state: 'pendiente', text: 'Endpoint de altas' },
  { id: 'e-usr-pag', from: 'usr', to: 'pag', kind: 'evento', state: 'definir', text: 'Evento de cobro' },
  { id: 'e-usr-ops', from: 'usr', to: 'ops', kind: 'bloqueante', state: 'pendiente', text: 'Bloqueo de cuentas' },
  { id: 'e-ops-pag', from: 'ops', to: 'pag', kind: 'misterio', state: 'pendiente', text: 'Tipo desconocido' },
];

function baseState(): DepMapState {
  return {
    nodes: {
      usr: { n: 'Usuarios', s: 'usr', x: 0, y: 0 },
      ops: { n: 'Operaciones', s: 'ops', x: 0, y: 0 },
      pag: { n: 'Pagos', s: 'pag', x: 0, y: 0 },
    },
    kinds: { bloqueante: 'Bloqueante' },
    info: {},
    edges,
    done: { 'e-usr-ops': true },
    activity: [],
    presence: [],
    version: 1,
    updatedAt: null,
    updatedBy: null,
  };
}

function createFakeStore() {
  const state = signal(baseState());
  const shown = signal<DepMapEdge[]>(edges);
  const store = {
    state,
    flashId: signal<string | null>(null),
    visible: computed(() => shown()),
    shown,
    selectedNode: null as string | null,
    setDoneCalls: [] as [string, boolean][],
    setDoneResult: Promise.resolve() as Promise<void>,
    selectNode(id: string) { store.selectedNode = id; },
    setDone(id: string, done: boolean): Promise<void> {
      store.setDoneCalls.push([id, done]);
      return store.setDoneResult;
    },
  };
  return store;
}

describe('DepMapList', () => {
  let fixture: ComponentFixture<DepMapList>;
  let store: ReturnType<typeof createFakeStore>;
  let i18n: I18n;

  beforeEach(async () => {
    store = createFakeStore();
    await TestBed.configureTestingModule({
      imports: [DepMapList],
      providers: [{ provide: DepMapStore, useValue: store }],
    }).compileComponents();
    i18n = TestBed.inject(I18n);
    i18n.setLocale('es');
    fixture = TestBed.createComponent(DepMapList);
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function rows(): HTMLTableRowElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('tbody tr'));
  }

  function cells(row: HTMLTableRowElement): string[] {
    return Array.from(row.querySelectorAll('td')).map((td) => (td.textContent ?? '').trim());
  }

  it('shows the empty message when no edge is visible', () => {
    store.shown.set([]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('table')).toBeNull();
    expect(fixture.nativeElement.querySelector('.empty').textContent.trim()).toBe(i18n.t().mapa.listaVacia);
  });

  it('renders one row per visible edge sorted by origin and then destination name', () => {
    const order = rows().map((row) => cells(row).slice(1, 3));

    expect(order).toEqual([
      ['Operaciones', 'Pagos'],
      ['Operaciones', 'Usuarios'],
      ['Usuarios', 'Operaciones'],
      ['Usuarios', 'Pagos'],
    ]);
  });

  it('labels built-in kinds, custom kinds and unknown kinds', () => {
    const m = i18n.t().mapa;
    const kindByText = new Map(rows().map((row) => [cells(row)[3], cells(row)[4]]));

    expect(kindByText.get('Endpoint de altas')).toBe(m.tipoApi);
    expect(kindByText.get('Evento de cobro')).toBe(m.tipoEvento);
    expect(kindByText.get('Bloqueo de cuentas')).toBe('Bloqueante');
    expect(kindByText.get('Tipo desconocido')).toBe('misterio');
  });

  it('maps every built-in kind id to its translated label', () => {
    const m = i18n.t().mapa;
    const list = fixture.componentInstance;

    expect(list.kindLabel('api')).toBe(m.tipoApi);
    expect(list.kindLabel('evento')).toBe(m.tipoEvento);
    expect(list.kindLabel('dato')).toBe(m.tipoDatos);
    expect(list.kindLabel('permiso')).toBe(m.tipoPermiso);
    expect(list.kindLabel('ui')).toBe(m.tipoComponente);
  });

  it('follows the locale when it changes', () => {
    i18n.setLocale('en');
    fixture.detectChanges();

    const header = fixture.nativeElement.querySelector('thead th');
    expect(header.getAttribute('aria-label')).toBe(i18n.t().mapa.listaHecho);
    expect(fixture.componentInstance.kindLabel('dato')).toBe(i18n.t().mapa.tipoDatos);
  });

  it('shows done, to-define and pending states', () => {
    const m = i18n.t().mapa;
    const stateByText = new Map(rows().map((row) => [cells(row)[3], cells(row)[5]]));

    expect(stateByText.get('Bloqueo de cuentas')).toBe(m.listaHecho);
    expect(stateByText.get('Evento de cobro')).toBe(m.listaADefinir);
    expect(stateByText.get('Endpoint de altas')).toBe(m.listaPendiente);
  });

  it('marks done rows, strikes their text and checks their box', () => {
    const doneRow = rows().find((row) => cells(row)[3] === 'Bloqueo de cuentas')!;
    const pendingRow = rows().find((row) => cells(row)[3] === 'Endpoint de altas')!;

    expect(doneRow.classList).toContain('done-row');
    expect(doneRow.querySelectorAll('td')[3].classList).toContain('line-through');
    expect((doneRow.querySelector('input') as HTMLInputElement).checked).toBe(true);
    expect(pendingRow.classList).not.toContain('done-row');
    expect((pendingRow.querySelector('input') as HTMLInputElement).checked).toBe(false);
  });

  it('gives each checkbox an accessible label', () => {
    const labels = rows().map((row) => row.querySelector('input')!.getAttribute('aria-label'));

    expect(labels.every((label) => label === i18n.t().mapa.marcarHecho)).toBe(true);
  });

  it('highlights the flashed edge', () => {
    store.flashId.set('e-usr-pag');
    fixture.detectChanges();

    const flashed = rows().filter((row) => row.classList.contains('flash'));
    expect(flashed.length).toBe(1);
    expect(cells(flashed[0])[3]).toBe('Evento de cobro');
  });

  it('selects the origin or destination node when its name is clicked', () => {
    const row = rows().find((r) => cells(r)[3] === 'Evento de cobro')!;
    const [fromButton, toButton] = Array.from(row.querySelectorAll('button.lnk')) as HTMLButtonElement[];

    fromButton.click();
    expect(store.selectedNode).toBe('usr');

    toButton.click();
    expect(store.selectedNode).toBe('pag');
  });

  it('asks the store to mark an edge as done when its box is checked', async () => {
    const row = rows().find((r) => cells(r)[3] === 'Endpoint de altas')!;
    const box = row.querySelector('input') as HTMLInputElement;

    box.click();
    await fixture.whenStable();

    expect(store.setDoneCalls).toEqual([['e-ops-usr', true]]);
    expect(box.checked).toBe(true);
  });

  it('restores the previous checkbox value when saving fails', async () => {
    store.setDoneResult = Promise.reject(new Error('offline'));
    const row = rows().find((r) => cells(r)[3] === 'Bloqueo de cuentas')!;
    const box = row.querySelector('input') as HTMLInputElement;

    box.click();
    expect(box.checked).toBe(false);
    await Promise.resolve();
    await Promise.resolve();

    expect(store.setDoneCalls).toEqual([['e-usr-ops', false]]);
    expect(box.checked).toBe(true);
  });
});

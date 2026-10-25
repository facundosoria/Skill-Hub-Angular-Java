import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { I18n } from '../../core/i18n/i18n';
import { calculateMatrixLayout, DepMapMatrix } from './dep-map-matrix';
import { DepMapEdge, DepMapState, DepMapStore } from './dep-map-store';

describe('calculateMatrixLayout', () => {
  it('fits 13 groups plus the totals row within wrapper padding', () => {
    const layout = calculateMatrixLayout(719, 594, 14, 13);

    expect(layout.cell).toBeCloseTo(34.33, 2);
    expect(layout.rowLabel).toBe(150);
    expect(layout.header).toBeCloseTo(85.82, 2);
    // 12px top + 12px bottom wrapper padding, one header and 14 body rows.
    expect(24 + layout.header + 14 * layout.cell).toBeLessThanOrEqual(594);
  });

  it('caps cells at the existing size when there is room', () => {
    expect(calculateMatrixLayout(1200, 800, 14, 13).cell).toBe(44);
  });

  it('keeps the readable floor and allows overflow when height is insufficient', () => {
    expect(calculateMatrixLayout(645, 462, 14, 13).cell).toBe(28);
  });
});

describe('DepMapMatrix component', () => {
  const edges: DepMapEdge[] = [
    { id: 'm1', from: 'usr', to: 'ops', kind: 'api', state: 'pendiente', text: 'a' },
    { id: 'm2', from: 'usr', to: 'ops', kind: 'api', state: 'pendiente', text: 'b' },
    { id: 'm3', from: 'ops', to: 'pag', kind: 'api', state: 'pendiente', text: 'c' },
  ];
  const state: DepMapState = {
    nodes: {
      usr: { n: 'Usuarios', s: 'USR', x: 0, y: 0 },
      ops: { n: 'Operaciones', s: 'OPS', x: 0, y: 0 },
      pag: { n: 'Pagos', s: 'PAG', x: 0, y: 0 },
      sec: { n: 'Seguridad', s: 'SEC', x: 0, y: 0, transv: true },
    },
    kinds: { api: 'API' }, info: {}, edges, done: {}, activity: [], presence: [], version: 1, updatedAt: null, updatedBy: null,
  };
  let fixture: ComponentFixture<DepMapMatrix>;
  let shown: ReturnType<typeof signal<DepMapEdge[]>>;
  let selectPair: ReturnType<typeof vi.fn>;
  let frames: FrameRequestCallback[];
  let desktop: boolean;

  function flushFrames(): void {
    for (let i = 0; i < 4 && frames.length; i++) {
      const pending = frames.splice(0);
      pending.forEach((callback) => callback(0));
    }
  }

  async function render(host?: HTMLElement): Promise<HTMLElement> {
    shown = signal(edges);
    selectPair = vi.fn();
    await TestBed.configureTestingModule({
      imports: [DepMapMatrix],
      providers: [{
        provide: DepMapStore,
        useValue: { state: signal(state), mine: signal('usr'), visible: computed(() => shown()), selectPair },
      }],
    }).compileComponents();
    TestBed.inject(I18n).setLocale('es');
    fixture = TestBed.createComponent(DepMapMatrix);
    if (host) host.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  function sizeWrapper(wrapper: HTMLElement, size: { clientWidth: number; clientHeight: number; scrollWidth: number; scrollHeight: number }): void {
    for (const [key, value] of Object.entries(size)) Object.defineProperty(wrapper, key, { configurable: true, get: () => value });
  }

  beforeEach(() => {
    frames = [];
    desktop = true;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width') ? desktop : false, media: query,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('shows the empty message when nothing is visible', async () => {
    const el = await render();
    shown.set([]);
    fixture.detectChanges();
    expect(el.querySelector('.empty')!.textContent).toContain(fixture.componentInstance.t().mapa.matrizVacia);
  });

  it('lists only regular groups as rows and columns', async () => {
    const el = await render();
    expect([...el.querySelectorAll('thead th span')].map((span) => span.textContent)).toContain('USR');
    expect(el.textContent).not.toContain('SEC');
    expect(el.querySelectorAll('tbody tr')).toHaveLength(4);
  });

  it('counts dependencies per cell, row and column', async () => {
    await render();
    const matrix = fixture.componentInstance;
    expect(matrix.cellCount('usr', 'ops')).toBe(2);
    expect(matrix.cellCount('ops', 'usr')).toBe(0);
    expect(matrix.rowTotal('usr')).toBe(2);
    expect(matrix.colTotal('pag')).toBe(1);
  });

  it('labels and selects a cell with dependencies', async () => {
    const el = await render();
    const cell = el.querySelector('button.cell.on') as HTMLButtonElement;
    expect(cell.getAttribute('aria-label')).toBe('Usuarios necesita de Operaciones: 2 pedidos');
    expect(cell.getAttribute('title')).toBe('Usuarios necesita de Operaciones');
    cell.click();
    expect(selectPair).toHaveBeenCalledWith(['usr', 'ops']);
  });

  it('marks my group row and column', async () => {
    const el = await render();
    expect(el.querySelector('tr.minerow th')!.textContent).toBe('Usuarios');
    expect(el.querySelectorAll('.minecol').length).toBeGreaterThan(0);
  });

  it('mentions sliding on narrow screens', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const el = await render();
    expect(el.querySelector('.hint')!.textContent).toContain(fixture.componentInstance.t().mapa.matrizHintDesliza);
  });

  it('sizes the cells on desktop', async () => {
    const el = await render();
    const wrapper = el.querySelector('.tablewrap') as HTMLElement;
    sizeWrapper(wrapper, { clientWidth: 900, clientHeight: 600, scrollWidth: 900, scrollHeight: 600 });
    window.dispatchEvent(new Event('resize'));
    flushFrames();
    expect(wrapper.style.getPropertyValue('--cell')).toMatch(/px$/);
    expect(wrapper.style.getPropertyValue('--matrix-width')).toMatch(/px$/);
    expect(wrapper.classList.contains('overflow-x')).toBe(false);
  });

  it('shrinks the cells when the fit-height table overflows', async () => {
    const host = document.createElement('div');
    host.className = 'fit-height';
    document.body.appendChild(host);
    const el = await render(host);
    const wrapper = el.querySelector('.tablewrap') as HTMLElement;
    sizeWrapper(wrapper, { clientWidth: 900, clientHeight: 300, scrollWidth: 1200, scrollHeight: 600 });
    fixture.componentInstance['scheduleLayout'](wrapper, true);
    flushFrames();
    expect(parseFloat(wrapper.style.getPropertyValue('--cell'))).toBe(28);
    expect(wrapper.classList.contains('overflow-x')).toBe(true);
    expect(wrapper.classList.contains('overflow-y')).toBe(true);
    host.remove();
  });

  it('clears the desktop sizing on small screens', async () => {
    const el = await render();
    const wrapper = el.querySelector('.tablewrap') as HTMLElement;
    wrapper.style.setProperty('--cell', '40px');
    wrapper.classList.add('overflow-x');
    fixture.componentInstance['scheduleLayout'](wrapper, false);
    flushFrames();
    expect(wrapper.style.getPropertyValue('--cell')).toBe('');
    expect(wrapper.classList.contains('overflow-x')).toBe(false);
  });

  it('cleans up when destroyed', async () => {
    await render();
    expect(() => fixture.destroy()).not.toThrow();
  });
});

import { TestBed } from '@angular/core/testing';
import { ToastHost, ToastService } from './toast';

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    service = TestBed.inject(ToastService);
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('starts empty', () => {
    expect(service.toasts()).toEqual([]);
  });

  it('adds a neutral toast by default', () => {
    service.show('Copiado');

    expect(service.toasts()).toEqual([{ id: 1, text: 'Copiado', tone: 'neutral' }]);
  });

  it('keeps the requested tone', () => {
    service.show('Guardado', 'success');
    service.show('Fallo', 'danger');

    expect(service.toasts().map((toast) => toast.tone)).toEqual(['success', 'danger']);
  });

  it('gives each toast a new id', () => {
    service.show('Uno');
    service.show('Dos');
    service.show('Tres');

    expect(service.toasts().map((toast) => toast.id)).toEqual([1, 2, 3]);
  });

  it('keeps at most three toasts and drops the oldest', () => {
    ['a', 'b', 'c', 'd', 'e'].forEach((text) => service.show(text));

    expect(service.toasts().map((toast) => toast.text)).toEqual(['c', 'd', 'e']);
  });

  it('removes a toast after the default 2200 ms', () => {
    service.show('Copiado');

    vi.advanceTimersByTime(2199);
    expect(service.toasts().length).toBe(1);

    vi.advanceTimersByTime(1);
    expect(service.toasts()).toEqual([]);
  });

  it('honours a custom duration per toast', () => {
    service.show('Corto', 'neutral', 500);
    service.show('Largo', 'neutral', 3000);

    vi.advanceTimersByTime(500);
    expect(service.toasts().map((toast) => toast.text)).toEqual(['Largo']);

    vi.advanceTimersByTime(2500);
    expect(service.toasts()).toEqual([]);
  });

  it('dismisses only the toast with the given id', () => {
    service.show('Uno');
    service.show('Dos');

    service.dismiss(1);

    expect(service.toasts().map((toast) => toast.text)).toEqual(['Dos']);
  });

  it('ignores dismissing an unknown id', () => {
    service.show('Uno');

    service.dismiss(99);

    expect(service.toasts().length).toBe(1);
  });

  it('does not fail when the timer fires for a toast already dismissed', () => {
    service.show('Uno');
    service.dismiss(1);

    expect(() => vi.advanceTimersByTime(2200)).not.toThrow();
    expect(service.toasts()).toEqual([]);
  });
});

describe('ToastHost', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({ imports: [ToastHost] }).compileComponents();
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('announces toasts politely in a status region', () => {
    const fixture = TestBed.createComponent(ToastHost);
    fixture.detectChanges();

    const region = fixture.nativeElement.querySelector('[role="status"]') as HTMLElement;
    expect(region).not.toBeNull();
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('renders every toast text with a dot matching its tone', () => {
    const fixture = TestBed.createComponent(ToastHost);
    const service = TestBed.inject(ToastService);
    service.show('Guardado', 'success');
    service.show('Fallo', 'danger');
    service.show('Info');
    fixture.detectChanges();

    const dots = Array.from(fixture.nativeElement.querySelectorAll('[aria-hidden="true"]')) as HTMLElement[];
    expect(fixture.nativeElement.textContent).toContain('Guardado');
    expect(fixture.nativeElement.textContent).toContain('Fallo');
    expect(fixture.nativeElement.textContent).toContain('Info');
    expect(dots[0].classList).toContain('bg-success');
    expect(dots[1].classList).toContain('bg-danger');
    expect(dots[2].classList).toContain('bg-accent');
    expect(dots[0].classList).not.toContain('bg-danger');
  });
});

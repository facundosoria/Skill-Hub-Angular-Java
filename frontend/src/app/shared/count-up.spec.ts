import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CountUp } from './count-up';

@Component({
  imports: [CountUp],
  template: `<span [countUp]="value()" [countUpMs]="ms()"></span>`,
})
class Host {
  value = signal(0);
  ms = signal(700);
}

describe('CountUp', () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let now: number;
  let originalMatchMedia: typeof window.matchMedia;

  function setReducedMotion(reduced: boolean): void {
    window.matchMedia = ((query: string) => ({
      matches: reduced && query.includes('reduce'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }

  /** Corre el proximo frame pendiente con el reloj en `at` ms. */
  function runFrame(at: number): void {
    now = at;
    const pending = Array.from(frames.entries());
    frames.clear();
    pending.forEach(([, callback]) => callback(at));
  }

  function render(value: number, ms = 700) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.value.set(value);
    fixture.componentInstance.ms.set(ms);
    fixture.detectChanges();
    const span = fixture.nativeElement.querySelector('span') as HTMLElement;
    return { fixture, span };
  }

  beforeEach(async () => {
    frames = new Map();
    nextFrame = 1;
    now = 0;
    originalMatchMedia = window.matchMedia;
    setReducedMotion(false);
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames.delete(id);
    });
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('counts from zero to the target with an ease-out curve', () => {
    const { span } = render(100);

    runFrame(0);
    expect(span.textContent).toBe('0');

    runFrame(350);
    // p = 0.5 -> 1 - 0.5^3 = 0.875
    expect(span.textContent).toBe('88');

    runFrame(700);
    expect(span.textContent).toBe('100');
    expect(frames.size).toBe(0);
  });

  it('keeps requesting frames until the duration ends', () => {
    render(10);

    runFrame(100);
    expect(frames.size).toBe(1);

    runFrame(699);
    expect(frames.size).toBe(1);

    runFrame(700);
    expect(frames.size).toBe(0);
  });

  it('never overshoots the target when a frame arrives late', () => {
    const { span } = render(42);

    runFrame(5000);

    expect(span.textContent).toBe('42');
  });

  it('counts from the previous value when the input changes', () => {
    const { fixture, span } = render(100);
    runFrame(0);
    runFrame(700);
    expect(span.textContent).toBe('100');

    now = 1000;
    fixture.componentInstance.value.set(200);
    fixture.detectChanges();
    runFrame(1000);
    expect(span.textContent).toBe('100');

    runFrame(1350);
    expect(span.textContent).toBe('188');

    runFrame(1700);
    expect(span.textContent).toBe('200');
  });

  it('counts down as well as up', () => {
    const { fixture, span } = render(50);
    runFrame(700);

    now = 1000;
    fixture.componentInstance.value.set(10);
    fixture.detectChanges();
    runFrame(1700);

    expect(span.textContent).toBe('10');
  });

  it('cancels the running animation when a new target arrives', () => {
    const { fixture, span } = render(100);
    runFrame(350);
    expect(span.textContent).toBe('88');

    fixture.componentInstance.value.set(0);
    fixture.detectChanges();

    expect(frames.size).toBe(1);
    runFrame(350 + 700);
    expect(span.textContent).toBe('0');
  });

  it('writes the final value at once with reduced motion', () => {
    setReducedMotion(true);

    const { span } = render(73);

    expect(span.textContent).toBe('73');
    expect(frames.size).toBe(0);
  });

  it('writes the final value at once when the duration is zero', () => {
    const { span } = render(15, 0);

    expect(span.textContent).toBe('15');
    expect(frames.size).toBe(0);
  });

  it('writes the final value at once when requestAnimationFrame is missing', () => {
    vi.stubGlobal('requestAnimationFrame', undefined);

    const { span } = render(9);

    expect(span.textContent).toBe('9');
  });

  it('cancels the pending frame when destroyed', () => {
    const { fixture } = render(100);
    expect(frames.size).toBe(1);

    fixture.destroy();

    expect(frames.size).toBe(0);
  });
});

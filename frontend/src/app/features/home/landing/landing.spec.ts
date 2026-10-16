import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18n } from '../../../core/i18n/i18n';
import { Landing } from './landing';

const renderer = vi.hoisted(() => {
  // ScrollTrigger usa matchMedia al registrarse, antes de cualquier beforeEach.
  window.matchMedia ??= ((query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) as unknown as MediaQueryList);
  return { instances: [] as Array<Record<string, ReturnType<typeof vi.fn>>> };
});

// jsdom no tiene WebGL: se reemplaza three por dobles mínimos de lo que usa la landing.
vi.mock('three', () => {
  const vector = () => ({ set: vi.fn() });
  class Disposable {
    dispose = vi.fn();
  }
  class Object3D {
    position = vector();
    rotation = { x: 0, y: 0, z: 0, set: vi.fn() };
    children: Object3D[] = [];
    add(...nodes: Object3D[]) {
      this.children.push(...nodes);
    }
    traverse(fn: (node: Object3D) => void) {
      fn(this);
      this.children.forEach((child) => child.traverse(fn));
    }
  }
  class Mesh extends Object3D {
    constructor(
      public geometry: Disposable,
      public material: Disposable | Disposable[],
    ) {
      super();
    }
  }
  class LineSegments extends Mesh {}
  class PerspectiveCamera extends Object3D {
    aspect = 1;
    updateProjectionMatrix = vi.fn();
  }
  class WebGLRenderer {
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
    constructor() {
      renderer.instances.push(this as unknown as Record<string, ReturnType<typeof vi.fn>>);
    }
  }
  return {
    WebGLRenderer,
    Scene: Object3D,
    Group: Object3D,
    PerspectiveCamera,
    Mesh,
    LineSegments,
    BoxGeometry: Disposable,
    EdgesGeometry: Disposable,
    MeshStandardMaterial: Disposable,
    LineBasicMaterial: Disposable,
    AmbientLight: Object3D,
    DirectionalLight: Object3D,
  };
});

describe('Landing', () => {
  let matches = true;
  let resizeCallback: (() => void) | undefined;
  const disconnect = vi.fn();

  beforeEach(() => {
    matches = true;
    renderer.instances.length = 0;
    disconnect.mockReset();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resizeCallback = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    vi.stubGlobal('scrollTo', vi.fn());
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
    TestBed.configureTestingModule({ imports: [Landing], providers: [provideRouter([])] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (HTMLCanvasElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLCanvasElement.prototype as { clientHeight?: number }).clientHeight;
  });

  async function render() {
    const fixture = TestBed.createComponent(Landing);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('renders the hero and calls to action', async () => {
    const { el } = await render();
    const t = TestBed.inject(I18n).t().landing;
    expect(el.textContent).toContain(t.explorar);
    expect(el.querySelector('a[href="/skills"]')).not.toBeNull();
    expect(el.querySelector('a[href="/docs"]')).not.toBeNull();
  });

  it('builds the 3D scene and scroll timeline on desktop with motion', async () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, get: () => 400 });
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
    const { fixture } = await render();

    expect(renderer.instances.length).toBe(1);
    const instance = renderer.instances[0];
    expect(instance['setSize']).toHaveBeenCalledWith(400, 200, false);
    resizeCallback?.();
    window.dispatchEvent(new Event('resize'));
    TestBed.inject(I18n).setLocale('en');
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 50));

    fixture.destroy();
    expect(instance['dispose']).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
    TestBed.inject(I18n).setLocale('es');
  });

  it('skips canvas sizing without layout', async () => {
    await render();
    expect(renderer.instances[0]['setSize']).not.toHaveBeenCalled();
  });

  it('skips the scene on mobile or with reduced motion', async () => {
    matches = false;
    const { fixture } = await render();
    expect(renderer.instances.length).toBe(0);
    fixture.destroy();
  });
});

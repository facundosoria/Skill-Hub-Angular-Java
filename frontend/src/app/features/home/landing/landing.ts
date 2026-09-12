import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import * as THREE from 'three';

gsap.registerPlugin(Flip, ScrollTrigger);

@Component({
  imports: [RouterLink],
  selector: 'app-landing',
  styleUrl: './landing.css',
  templateUrl: './landing.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Landing {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private media?: gsap.MatchMedia;
  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private object?: THREE.Group;
  private resizeObserver?: ResizeObserver;

  constructor() {
    afterNextRender(() => this.initializeMotion());
    this.destroyRef.onDestroy(() => this.disposeMotion());
  }

  private initializeMotion(): void {
    const root = this.host.nativeElement;
    const canvas = root.querySelector('[data-landing-canvas]') as HTMLCanvasElement | null;
    if (!canvas) return;

    this.media = gsap.matchMedia();
    this.media.add(
      {
        desktop: '(min-width: 768px)',
        motion: '(prefers-reduced-motion: no-preference)',
      },
      (context) => {
        const conditions = context.conditions as { desktop: boolean; motion: boolean };
        if (!conditions.desktop || !conditions.motion) return;

        this.createScene(canvas);
        this.createScrollTimeline(root, canvas);

        return () => this.disposeScene();
      },
    );
  }

  private createScene(canvas: HTMLCanvasElement): void {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, canvas });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    this.camera.position.set(0, 0, 5);

    const object = new THREE.Group();
    const geometry = new THREE.IcosahedronGeometry(1.15, 1);
    const surface = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: 0xe67e22, metalness: 0.25, roughness: 0.45 }),
    );
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0x43210a, transparent: true, opacity: 0.55 }),
    );
    object.add(surface, edges);
    this.scene.add(object);
    this.scene.add(new THREE.AmbientLight(0xffffff, 2.2));
    const keyLight = new THREE.DirectionalLight(0xffe1be, 3.5);
    keyLight.position.set(2, 3, 4);
    this.scene.add(keyLight);
    this.object = object;

    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas(canvas));
    this.resizeObserver.observe(canvas);
    this.resizeCanvas(canvas);
    gsap.ticker.add(this.render);
  }

  private resizeCanvas(canvas: HTMLCanvasElement): void {
    if (!this.renderer || !this.camera) return;
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private createScrollTimeline(root: HTMLElement, canvas: HTMLCanvasElement): void {
    const waypoints = Array.from(root.querySelectorAll<HTMLElement>('[data-waypoint]'));
    if (waypoints.length !== 4 || !this.object) return;
    const states = waypoints.map((waypoint) => Flip.getState(waypoint));
    Flip.fit(canvas, states[0], { absolute: true, scale: true });
    const timeline = gsap.timeline({
      scrollTrigger: {
        trigger: root,
        start: 'top top',
        end: 'bottom bottom',
        scrub: true,
        invalidateOnRefresh: true,
      },
    });

    // Mantiene la duración total en 1: los offsets que siguen son progreso real de scroll.
    timeline.to({}, { duration: 1 }, 0);

    const arrivals = waypoints.slice(1).map((waypoint) => this.waypointProgress(root, waypoint));
    let departure = 0;
    const rotations = [
      { x: 1.2, y: 2.4 },
      { x: 2.7, y: 4.8 },
      { x: 4.1, y: 7.2 },
    ];

    arrivals.forEach((arrival, index) => {
      const duration = Math.max(arrival - departure, 0.001);
      this.addWaypointTransition(timeline, canvas, states[index + 1], departure, duration);
      timeline.to(this.object!.rotation, { ...rotations[index], duration, ease: 'none' }, departure);
      departure = arrival;
    });

    ScrollTrigger.refresh();

    gsap.utils.toArray<HTMLElement>('[data-reveal]', root).forEach((element) => {
      gsap.fromTo(
        element,
        { autoAlpha: 0, y: 24 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.55,
          ease: 'power2.out',
          scrollTrigger: { trigger: element, start: 'top 82%', once: true },
        },
      );
    });
  }

  private addWaypointTransition(
    timeline: gsap.core.Timeline,
    canvas: HTMLCanvasElement,
    state: Flip.FlipState,
    position: number,
    duration: number,
  ): void {
    const transition = Flip.fit(canvas, state, { duration, ease: 'none', scale: true });
    if (transition) timeline.add(transition as gsap.core.Tween, position);
  }

  private waypointProgress(root: HTMLElement, waypoint: HTMLElement): number {
    const rootTop = root.getBoundingClientRect().top + window.scrollY;
    const scrollRange = Math.max(root.offsetHeight - window.innerHeight, 1);
    const waypointRect = waypoint.getBoundingClientRect();
    const arrivalScroll = window.scrollY + waypointRect.top + waypointRect.height / 2 - window.innerHeight / 2;
    return gsap.utils.clamp(0.001, 0.999, (arrivalScroll - rootTop) / scrollRange);
  }

  private readonly render = (): void => {
    if (this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera);
  };

  private disposeMotion(): void {
    this.media?.revert();
    this.media = undefined;
    this.disposeScene();
  }

  private disposeScene(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    gsap.ticker.remove(this.render);
    this.object?.traverse((node) => {
      if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments) {
        node.geometry.dispose();
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => material.dispose());
      }
    });
    this.renderer?.dispose();
    this.renderer = undefined;
    this.scene = undefined;
    this.camera = undefined;
    this.object = undefined;
  }
}

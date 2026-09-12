import { Component, DestroyRef, ElementRef, inject, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import gsap from 'gsap';
import { AuthService } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { TEAM_OPTIONS, type Team } from '../../core/teams';
import { UI } from '../../shared/ui';

function scrambleText(
  currentText: string,
  targetText: string,
  onUpdate: (val: string) => void,
  duration = 0.32,
): () => void {
  if (typeof window === 'undefined') {
    onUpdate(targetText);
    return () => {};
  }
  const chars = '!<>-_/[]{}—=+*^?#________';
  const length = Math.max(currentText.length, targetText.length);
  const startTime = performance.now();
  let frameId = 0;

  function update(now: number): void {
    const elapsed = (now - startTime) / 1000;
    const progress = Math.min(elapsed / duration, 1);
    let output = '';

    for (let i = 0; i < length; i++) {
      if (progress * length > i) {
        output += targetText[i] || '';
      } else {
        output += chars[Math.floor(Math.random() * chars.length)];
      }
    }
    onUpdate(output);

    if (progress < 1) {
      frameId = requestAnimationFrame(update);
    } else {
      onUpdate(targetText);
    }
  }
  frameId = requestAnimationFrame(update);
  return () => cancelAnimationFrame(frameId);
}

/** Componente de autenticación con Fluid Morphing (Opción 2) */
@Component({
  selector: 'app-login',
  imports: [FormsModule, ...UI],
  styles: `
    @keyframes authFlicker {
      0%, 18.999%, 21%, 23.999%, 52.999%, 56%, 100% {
        opacity: 1;
        filter: drop-shadow(0 0 14px color-mix(in srgb, var(--accent) 75%, transparent))
                drop-shadow(0 0 28px color-mix(in srgb, var(--accent) 35%, transparent));
      }
      19%, 20.999%, 53%, 55.999% {
        opacity: 0.3;
        filter: none;
      }
      24% {
        opacity: 0.75;
      }
    }

    @keyframes cursorBlink {
      0%, 49% {
        opacity: 1;
      }
      50%, 100% {
        opacity: 0;
      }
    }

    .auth-glow {
      animation: authFlicker 3.6s infinite;
    }

    .auth-cursor {
      animation: cursorBlink 0.85s infinite;
    }

    .auth-success-overlay {
      position: fixed;
      z-index: 50;
      inset: 0;
      display: grid;
      place-items: center;
      overflow: hidden;
      visibility: hidden;
      background: #000;
    }

    .auth-success-message {
      position: relative;
      z-index: 1;
      margin: 0;
      color: var(--accent);
      font-family: var(--font-app-mono);
      font-size: clamp(0.95rem, 3.15vw, 2.84rem);
      font-weight: 700;
      letter-spacing: 0.16em;
      max-width: calc(100vw - 2rem);
      padding-inline: 1rem;
      text-align: center;
      overflow-wrap: anywhere;
      text-shadow: 0 0 24px color-mix(in srgb, var(--accent) 65%, transparent);
    }

    @media (prefers-reduced-motion: reduce) {
      .auth-glow,
      .auth-cursor {
        animation: none !important;
        opacity: 1 !important;
      }
    }
  `,
  template: `
    <main class="relative mx-auto flex min-h-dvh max-w-5xl flex-col justify-center px-4 py-10 sm:px-6 lg:px-8">
      <!-- Halo de acento sutil en el fondo -->
      <div
        class="pointer-events-none absolute -top-32 left-1/3 -z-10 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl"
        aria-hidden="true"
      ></div>

      <div #authContent class="flex flex-col items-center justify-center gap-10 lg:flex-row lg:items-center lg:justify-between lg:gap-16">
        <!-- Costado Izquierdo: Branding Imponente con Efecto Parpadeante -->
        <aside class="w-full max-w-md lg:max-w-lg space-y-5 text-center lg:text-left">
          <div class="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2/90 px-3.5 py-1 text-xs font-mono font-medium text-text-muted shadow-sm backdrop-blur">
            <span class="relative flex h-2 w-2">
              <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75"></span>
              <span class="relative inline-flex h-2 w-2 rounded-full bg-accent"></span>
            </span>
            <span>SYSTEM CONTEXT · v2.0</span>
          </div>

          <div class="space-y-1.5">
            <h2 class="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-text leading-none">
              SKILL HUB
            </h2>
            <div class="flex items-center justify-center lg:justify-start gap-2.5 font-mono text-2xl sm:text-3xl lg:text-4xl font-bold">
              <span class="text-text-faint">&gt;</span>
              <span class="auth-glow text-accent tracking-wider">auth</span>
              <span class="auth-cursor inline-block w-2.5 sm:w-3 h-6 sm:h-8 lg:h-9 bg-accent rounded-xs"></span>
            </div>
          </div>
        </aside>

        <!-- Costado Derecho: Tarjeta Central con Fluid Morph -->
        <div class="w-full max-w-md">
          <div
            #cardRef
            class="morph-card relative overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface p-6 sm:p-8 shadow-[var(--shadow-lg)] transition-[border-color,box-shadow] duration-300"
          >
            <!-- Segmented Control (Píldora deslizante) -->
            <div class="relative mb-6 flex rounded-full border border-border bg-surface-2 p-1">
              <div
                #pillSlider
                class="pointer-events-none absolute bottom-1 left-1 top-1 rounded-full border border-border-strong bg-surface shadow-[var(--shadow-sm)]"
                style="width: calc(50% - 4px);"
              ></div>
              <button
                type="button"
                (click)="setMode('login')"
                class="relative z-10 flex-1 cursor-pointer rounded-full py-1.5 text-center text-xs font-medium transition-colors sm:text-sm"
                [class.text-text]="mode() === 'login'"
                [class.text-text-muted]="mode() !== 'login'"
              >
                {{ t().login.entrar }}
              </button>
              <button
                type="button"
                (click)="setMode('register')"
                class="relative z-10 flex-1 cursor-pointer rounded-full py-1.5 text-center text-xs font-medium transition-colors sm:text-sm"
                [class.text-text]="mode() === 'register'"
                [class.text-text-muted]="mode() !== 'register'"
              >
                {{ t().login.crearCuenta }}
              </button>
            </div>

            <!-- Header de la tarjeta (sin el badge central) -->
            <div class="mb-6">
              <h1 class="min-h-[2rem] text-2xl font-semibold tracking-tight text-text">
                {{ displayTitle() }}
              </h1>
              <p class="mt-1 text-sm text-text-muted">
                {{ t().login.subtitulo }}
              </p>
            </div>

            <!-- Formulario -->
            <form (ngSubmit)="submit()" class="space-y-4">
              <!-- Campos adicionales con animación auto-height -->
              <div
                #extraFields
                class="overflow-hidden"
                style="display: none; height: 0px; opacity: 0;"
              >
                <div class="space-y-4 pb-4">
                  <ui-field [label]="t().login.equipo">
                    <select
                      uiSelect
                      name="team"
                      [(ngModel)]="team"
                      [required]="mode() === 'register'"
                      class="w-full"
                    >
                      <option value="" disabled>{{ t().login.equipo }}</option>
                      @for (option of teams; track option) {
                        <option [value]="option">{{ option }}</option>
                      }
                    </select>
                  </ui-field>
                  <ui-field [label]="t().login.legajo" [hint]="t().login.legajoHint">
                    <input uiInput name="legajo" [(ngModel)]="legajo" placeholder="321333" />
                  </ui-field>
                </div>
              </div>

              <!-- Campos comunes -->
              <ui-field [label]="t().login.usuario">
                <input
                  uiInput
                  name="username"
                  [(ngModel)]="username"
                  autocomplete="username"
                  placeholder="421496-Facundo Soria"
                  required
                />
              </ui-field>

              <ui-field
                [label]="t().login.password"
                [hint]="mode() === 'register' ? t().login.minimo : undefined"
              >
                <input
                  uiInput
                  name="password"
                  type="password"
                  [(ngModel)]="password"
                  [autocomplete]="mode() === 'login' ? 'current-password' : 'new-password'"
                  required
                />
              </ui-field>

              @if (error()) {
                <p class="text-sm text-danger" role="alert" animate.enter="anim-panel-in">{{ error() }}</p>
              } @else if (info()) {
                <p class="text-sm text-success" role="status" animate.enter="anim-panel-in">{{ info() }}</p>
              }

              <!-- Botón de submit con barra de progreso reactiva y espaciado adecuado -->
              <div class="pt-2">
                <button
                  uiButton
                  type="submit"
                  [disabled]="pending()"
                  class="relative w-full overflow-hidden"
                >
                  <div
                    #btnProgress
                    class="pointer-events-none absolute inset-y-0 left-0 bg-white/20 transition-none"
                    style="width: 0%;"
                  ></div>
                  <span class="relative z-10 flex items-center justify-center gap-2">
                    @if (pending()) {
                      <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                      </svg>
                      {{ t().login.esperando }}
                    } @else {
                      {{ displaySubmit() }}
                    }
                  </span>
                </button>
              </div>
            </form>

            <!-- Footer toggle -->
            <p class="mt-6 text-center text-sm text-text-muted">
              {{ mode() === 'login' ? t().login.sinCuenta : t().login.yaTengo }}
              <button
                type="button"
                (click)="setMode(mode() === 'login' ? 'register' : 'login')"
                class="cursor-pointer font-medium text-accent underline underline-offset-2"
              >
                {{ mode() === 'login' ? t().login.registrate : t().login.entra }}
              </button>
            </p>
          </div>
        </div>
      </div>

      <div #successOverlay class="auth-success-overlay">
        <p #accessGrantedRef class="auth-success-message" aria-hidden="true">{{ accessGrantedText() }}</p>
        <p class="sr-only" role="status" aria-live="polite">{{ successAnnouncement() }}</p>
      </div>
    </main>
  `,
})
export class Login {
  private auth = inject(AuthService);
  private router = inject(Router);
  private i18n = inject(I18n);
  private destroyRef = inject(DestroyRef);
  t = this.i18n.t;

  @ViewChild('cardRef') cardRef?: ElementRef<HTMLElement>;
  @ViewChild('pillSlider') pillSlider?: ElementRef<HTMLElement>;
  @ViewChild('extraFields') extraFieldsRef?: ElementRef<HTMLElement>;
  @ViewChild('btnProgress') btnProgress?: ElementRef<HTMLElement>;
  @ViewChild('authContent') authContentRef?: ElementRef<HTMLElement>;
  @ViewChild('successOverlay') successOverlayRef?: ElementRef<HTMLElement>;
  @ViewChild('accessGrantedRef') accessGrantedRef?: ElementRef<HTMLElement>;

  mode = signal<'login' | 'register'>('login');
  displayTitle = signal(this.t().login.entrar);
  displaySubmit = signal(this.t().login.entrar);

  username = '';
  password = '';
  team: Team | '' = '';
  teams = TEAM_OPTIONS;
  legajo = '';
  pending = signal(false);
  error = signal<string | null>(null);
  info = signal<string | null>(null);
  successAnnouncement = signal('');
  accessGrantedText = signal('');

  private titleScrambleCleanup?: () => void;
  private btnScrambleCleanup?: () => void;
  private successScrambleCleanup?: () => void;
  private successTimeline?: gsap.core.Timeline;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.titleScrambleCleanup) this.titleScrambleCleanup();
      if (this.btnScrambleCleanup) this.btnScrambleCleanup();
      if (this.successScrambleCleanup) this.successScrambleCleanup();
      if (this.cardRef?.nativeElement) gsap.killTweensOf(this.cardRef.nativeElement);
      if (this.pillSlider?.nativeElement) gsap.killTweensOf(this.pillSlider.nativeElement);
      if (this.extraFieldsRef?.nativeElement) gsap.killTweensOf(this.extraFieldsRef.nativeElement);
      if (this.btnProgress?.nativeElement) gsap.killTweensOf(this.btnProgress.nativeElement);
      this.successTimeline?.kill();
    });
  }

  setMode(targetMode: 'login' | 'register'): void {
    if (this.mode() === targetMode) return;

    const card = this.cardRef?.nativeElement;
    const extra = this.extraFieldsRef?.nativeElement;
    const isRegister = targetMode === 'register';

    this.mode.set(targetMode);
    this.error.set(null);
    this.info.set(null);

    // 1. Slider de píldora
    if (this.pillSlider?.nativeElement) {
      gsap.to(this.pillSlider.nativeElement, {
        xPercent: isRegister ? 100 : 0,
        duration: 0.35,
        ease: 'power3.out',
      });
    }

    // 2. Scramble text de título y botón submit
    const targetTitle = isRegister ? this.t().login.crearCuenta : this.t().login.entrar;
    if (this.titleScrambleCleanup) this.titleScrambleCleanup();
    if (this.btnScrambleCleanup) this.btnScrambleCleanup();

    this.titleScrambleCleanup = scrambleText(
      this.displayTitle(),
      targetTitle,
      val => this.displayTitle.set(val),
    );
    this.btnScrambleCleanup = scrambleText(
      this.displaySubmit(),
      targetTitle,
      val => this.displaySubmit.set(val),
    );

    // 3. Fluid Morphing Animation en la tarjeta y campos
    if (card && extra) {
      const startCardHeight = card.offsetHeight;
      card.style.height = `${startCardHeight}px`;

      if (isRegister) {
        extra.style.display = 'block';
        extra.style.pointerEvents = 'auto';
        extra.style.height = 'auto';
        extra.style.opacity = '1';

        // Medir altura natural con los campos visibles
        const targetCardHeight = card.scrollHeight;
        const targetExtraHeight = extra.scrollHeight;

        // Resetear al estado inicial para la animación
        extra.style.height = '0px';
        extra.style.opacity = '0';

        // Animar tanto la tarjeta como el contenedor de campos
        gsap.to(card, {
          height: targetCardHeight,
          duration: 0.42,
          ease: 'power3.inOut',
          onComplete: () => {
            card.style.height = 'auto';
          },
        });

        gsap.to(extra, {
          height: targetExtraHeight,
          opacity: 1,
          duration: 0.4,
          ease: 'power3.inOut',
          onComplete: () => {
            extra.style.height = 'auto';
          },
        });

        const fields = extra.querySelectorAll('ui-field');
        if (fields.length) {
          gsap.fromTo(
            fields,
            { y: -14, opacity: 0 },
            { y: 0, opacity: 1, stagger: 0.08, duration: 0.32, ease: 'power2.out', delay: 0.08 },
          );
        }
      } else {
        extra.style.pointerEvents = 'none';
        const startExtraHeight = extra.offsetHeight;
        extra.style.height = `${startExtraHeight}px`;

        // Medir altura natural sin los campos
        extra.style.display = 'none';
        const targetCardHeight = card.scrollHeight;
        extra.style.display = 'block';

        gsap.to(card, {
          height: targetCardHeight,
          duration: 0.38,
          ease: 'power3.inOut',
          onComplete: () => {
            card.style.height = 'auto';
          },
        });

        gsap.to(extra, {
          height: 0,
          opacity: 0,
          duration: 0.35,
          ease: 'power3.inOut',
          onComplete: () => {
            extra.style.display = 'none';
          },
        });
      }
    }
  }

  toggle(): void {
    this.setMode(this.mode() === 'login' ? 'register' : 'login');
  }

  async submit(): Promise<void> {
    this.pending.set(true);
    this.error.set(null);
    this.info.set(null);

    // Barra de progreso animada mientras procesa
    if (this.btnProgress?.nativeElement) {
      gsap.to(this.btnProgress.nativeElement, { width: '85%', duration: 1.2, ease: 'power1.out' });
    }

    try {
      if (this.mode() === 'login') {
        const user = await this.auth.login(this.username, this.password);
        await this.handleSuccessTransition(user.name || user.username);
        this.router.navigate(['/']);
      } else {
        const res = await this.auth.register({
          username: this.username,
          password: this.password,
          team: this.team as Team,
          legajo: this.legajo || undefined,
        });
        if (res.user) {
          await this.handleSuccessTransition(res.user.name || res.user.username);
          this.router.navigate(['/']);
        } else {
          this.resetProgress();
          this.info.set(res.info ?? null);
        }
      }
    } catch (e: unknown) {
      this.resetProgress();
      this.error.set(apiError(e));
      this.triggerShake();
    } finally {
      this.pending.set(false);
    }
  }

  private async handleSuccessTransition(displayName: string): Promise<void> {
    if (this.btnProgress?.nativeElement) {
      gsap.to(this.btnProgress.nativeElement, { width: '100%', duration: 0.2, ease: 'power2.inOut' });
    }

    const content = this.authContentRef?.nativeElement;
    const card = this.cardRef?.nativeElement;
    const overlay = this.successOverlayRef?.nativeElement;
    const message = this.accessGrantedRef?.nativeElement;

    if (!content || !card || !overlay || !message) return;

    this.successAnnouncement.set('Access granted');
    gsap.set(overlay, { autoAlpha: 0 });
    this.successScrambleCleanup?.();
    this.accessGrantedText.set('');
    gsap.set(message, { autoAlpha: 0 });

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.set(content, { autoAlpha: 0 });
      gsap.set(overlay, { autoAlpha: 1 });
      this.accessGrantedText.set(`WELCOME ${displayName}`);
      gsap.set(message, { autoAlpha: 1 });
      await new Promise(resolve => setTimeout(resolve, 900));
      return;
    }

    this.successTimeline?.kill();
    this.successTimeline = gsap.timeline({ paused: true });
    this.successTimeline
      .to(overlay, { autoAlpha: 1, duration: 0.56, ease: 'power2.out' })
      .to(content, { autoAlpha: 0, scale: 0.96, duration: 0.56, ease: 'power2.inOut' }, '<')
      .to(card, { borderRadius: '50%', scale: 0.72, duration: 0.56, ease: 'power3.inOut' }, '<')
      .to({}, { duration: 0.16 })
      .addLabel('access')
      .to(message, { autoAlpha: 1, duration: 0.12 }, 'access')
      .call(() => {
        this.successScrambleCleanup = scrambleText(
          '',
          'ACCESS GRANTED',
          value => this.accessGrantedText.set(value),
          0.72,
        );
      }, [], 'access')
      .to({}, { duration: 0.72 }, 'access')
      .to({}, { duration: 0.35 })
      .call(() => {
        this.successScrambleCleanup = scrambleText(
          'ACCESS GRANTED',
          '',
          value => this.accessGrantedText.set(value),
          0.28,
        );
      })
      .to({}, { duration: 0.28 })
      .call(() => {
        this.successScrambleCleanup = scrambleText(
          '',
          `WELCOME ${displayName}`,
          value => this.accessGrantedText.set(value),
          0.72,
        );
      })
      .to({}, { duration: 0.72 })
      .to({}, { duration: 0.9 })
      .to(message, { autoAlpha: 0, duration: 0.42, ease: 'power2.out' });

    await new Promise<void>(resolve => {
      this.successTimeline?.eventCallback('onComplete', resolve).play();
    });
  }

  private triggerShake(): void {
    if (this.cardRef?.nativeElement) {
      gsap.fromTo(
        this.cardRef.nativeElement,
        { x: -8 },
        {
          x: 0,
          duration: 0.45,
          ease: 'elastic.out(1, 0.3)',
        },
      );
    }
  }

  private resetProgress(): void {
    if (this.btnProgress?.nativeElement) {
      gsap.killTweensOf(this.btnProgress.nativeElement);
      gsap.set(this.btnProgress.nativeElement, { width: '0%' });
    }
  }
}

/** El backend manda { error } con 4xx; HttpClient lo envuelve en HttpErrorResponse. */
export function apiError(e: unknown): string {
  const err = e as { error?: { error?: string }; message?: string };
  return err?.error?.error ?? err?.message ?? 'Algo salio mal';
}

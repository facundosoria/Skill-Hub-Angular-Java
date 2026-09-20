import { Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { UI } from '../../shared/ui';
import { apiError } from '../auth/login';

type ProviderId = 'claude' | 'codex' | 'antigravity' | 'opencode' | 'generic';
type SurfaceId = 'cli' | 'prompt';
type TerminalOs = 'unix' | 'windows';

interface GuideStep {
  title: string;
  instruction: string;
  details?: string[];
  detailsByOs?: Partial<Record<TerminalOs, string[]>>;
  detailsAreAlternatives?: boolean;
  code?: string;
  codeIsFile?: boolean;
  codeLabel?: string;
  codeFilePath?: string;
  prompt?: string;
  warning?: string;
  keyAction?: boolean;
  noCopy?: boolean;
}

interface Surface {
  id: SurfaceId;
  label: string;
  description: string;
  officialDocs: string;
  steps: GuideStep[];
}

interface Provider {
  id: ProviderId;
  name: string;
  surfaces: Surface[];
}

@Component({
  selector: 'app-mcp-tutorial',
  imports: [FormsModule, ...UI],
  template: `
    <section class="space-y-6" aria-labelledby="mcp-tutorial-title">
      <!-- Barra Superior: Título + Selector de SO -->
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2">
            <span class="rounded bg-accent-soft px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-accent">MCP Tutorial</span>
          </div>
          <h2 id="mcp-tutorial-title" class="mt-1 text-xl font-bold tracking-tight text-text">
            {{ selectedSurface() === 'cli' ? text().titleCli : text().titlePrompt }}
          </h2>
          <p class="mt-0.5 text-sm text-text-muted">
            {{ selectedSurface() === 'cli' ? text().subtitleCli : text().subtitlePrompt }}
          </p>
        </div>
      </div>


      <!-- Espacio de trabajo estable: configuración + paso activo -->
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr] items-stretch lg:h-[680px]">
        <!-- Columna izquierda: configuración, sin una lista de pasos que compita con el contenido -->
        <div uiCard class="p-5 flex flex-col justify-between h-full space-y-5">
          <div class="space-y-5">
            <!-- 1. Modalidad: CLI vs Prompt -->
            <div>
              <h3 class="text-xs font-semibold uppercase tracking-wider text-text-muted">{{ text().chooseMode }}</h3>
              <div class="mt-2 flex rounded-[var(--radius)] border border-border bg-surface-2 p-1 gap-1" role="radiogroup" [attr.aria-label]="text().chooseMode">
                @if (selectedProvider() !== 'generic') {
                  <button
                    type="button"
                    class="flex-1 rounded-[calc(var(--radius)-2px)] py-1.5 px-2 text-xs font-medium transition-colors cursor-pointer text-center flex items-center justify-center gap-1.5 focus-visible:shadow-[var(--ring)] focus-visible:outline-none"
                    [class.bg-surface]="selectedSurface() === 'cli'"
                    [class.text-text]="selectedSurface() === 'cli'"
                    [class.shadow-[var(--shadow-sm)]]="selectedSurface() === 'cli'"
                    [class.text-text-muted]="selectedSurface() !== 'cli'"
                    role="radio"
                    [attr.aria-checked]="selectedSurface() === 'cli'"
                    (click)="selectSurface('cli')"
                  >
                    <span>💻</span>
                    <span>{{ text().modeCli }}</span>
                  </button>
                }
                <button
                  type="button"
                  class="flex-1 rounded-[calc(var(--radius)-2px)] py-1.5 px-2 text-xs font-medium transition-colors cursor-pointer text-center flex items-center justify-center gap-1.5 focus-visible:shadow-[var(--ring)] focus-visible:outline-none"
                  [class.w-full]="selectedProvider() === 'generic'"
                  [class.bg-surface]="selectedSurface() === 'prompt'"
                  [class.text-text]="selectedSurface() === 'prompt'"
                  [class.shadow-[var(--shadow-sm)]]="selectedSurface() === 'prompt'"
                  [class.text-text-muted]="selectedSurface() !== 'prompt'"
                  role="radio"
                  [attr.aria-checked]="selectedSurface() === 'prompt'"
                  (click)="selectSurface('prompt')"
                >
                  <span>💬</span>
                  <span>{{ text().modePrompt }}</span>
                </button>
              </div>
            </div>

            <!-- 2. Elegí tu programa -->
            <div>
              <h3 class="text-xs font-semibold uppercase tracking-wider text-text-muted">{{ text().chooseClient }}</h3>
              <div class="mt-2.5 grid grid-cols-2 gap-2" role="radiogroup" [attr.aria-label]="text().chooseClient">
                @for (p of providers(); track p.id; let last = $last) {
                  <button
                    type="button"
                    class="rounded-[var(--radius)] border px-3 py-2 text-xs font-medium transition-colors cursor-pointer text-left flex items-center gap-2 focus-visible:shadow-[var(--ring)] focus-visible:outline-none"
                    [class.col-span-2]="last"
                    [class.border-accent]="selectedProvider() === p.id"
                    [class.bg-accent-soft]="selectedProvider() === p.id"
                    [class.text-accent]="selectedProvider() === p.id"
                    [class.border-border]="selectedProvider() !== p.id"
                    [class.bg-surface-2]="selectedProvider() !== p.id"
                    [class.text-text]="selectedProvider() !== p.id"
                    role="radio"
                    [attr.aria-checked]="selectedProvider() === p.id"
                    (click)="selectProvider(p.id)"
                  >
                    @if (getProviderIconPath(p.id); as iconPath) {
                      <img class="h-5 w-5 shrink-0 object-contain" [src]="iconPath" alt="" />
                    } @else {
                      <svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                        <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56V20h-3v-.08A1.7 1.7 0 0 0 10.66 18.36a1.7 1.7 0 0 0-1.88.34l-.06.06L6.6 16.64l.06-.06A1.7 1.7 0 0 0 7 14.7a1.7 1.7 0 0 0-1.56-1.04H5v-3h.44A1.7 1.7 0 0 0 7 9.62a1.7 1.7 0 0 0-.34-1.88L6.6 7.68l2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.04-1.56V4h3v.4a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06A1.7 1.7 0 0 0 19.4 9.62 1.7 1.7 0 0 0 20.96 10.66h.04v3h-.04A1.7 1.7 0 0 0 19.4 15Z" />
                      </svg>
                    }
                    <span class="truncate">{{ p.name }}</span>
                  </button>
                }
              </div>
            </div>

            <div>
              <h3 class="text-xs font-semibold uppercase tracking-wider text-text-muted">{{ text().chooseOs }}</h3>
              <div class="mt-2 inline-flex w-full rounded-[var(--radius)] border border-border bg-surface-2 p-1" role="radiogroup" [attr.aria-label]="text().chooseOs">
                <button
                  type="button"
                  class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius)-2px)] px-2 py-2 text-xs font-medium transition-colors cursor-pointer focus-visible:shadow-[var(--ring)] focus-visible:outline-none"
                  [class.bg-surface]="terminalOs() === 'unix'"
                  [class.text-text]="terminalOs() === 'unix'"
                  [class.text-text-muted]="terminalOs() !== 'unix'"
                  [class.shadow-[var(--shadow-sm)]]="terminalOs() === 'unix'"
                  role="radio"
                  [attr.aria-checked]="terminalOs() === 'unix'"
                  (click)="terminalOs.set('unix')"
                >
                  <img class="h-4 w-4 shrink-0 object-contain" src="/icons/unix.svg" alt="" />
                  {{ text().macLinux }}
                </button>
                <button
                  type="button"
                  class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius)-2px)] px-2 py-2 text-xs font-medium transition-colors cursor-pointer focus-visible:shadow-[var(--ring)] focus-visible:outline-none"
                  [class.bg-surface]="terminalOs() === 'windows'"
                  [class.text-text]="terminalOs() === 'windows'"
                  [class.text-text-muted]="terminalOs() !== 'windows'"
                  [class.shadow-[var(--shadow-sm)]]="terminalOs() === 'windows'"
                  role="radio"
                  [attr.aria-checked]="terminalOs() === 'windows'"
                  (click)="terminalOs.set('windows')"
                >
                  <img class="h-4 w-4 shrink-0 object-contain" src="/icons/windows11.svg" alt="" />
                  {{ text().windows }}
                </button>
              </div>
            </div>

          </div>

          <!-- Footer Sidebar -->
          <div class="pt-4 border-t border-border flex flex-col gap-2 text-xs text-text-muted">
            <div class="flex items-center gap-2 text-text-faint">
              <span>🔒</span>
              <span>{{ text().securityNote }}</span>
            </div>
            <a
              class="text-xs font-medium text-accent hover:underline inline-flex items-center gap-1 focus-visible:shadow-[var(--ring)] focus-visible:outline-none"
              [href]="surface().officialDocs"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ text().officialDocs }} ↗
            </a>
          </div>
        </div>

        <!-- Columna derecha: encabezado, contenido desplazable y acciones siempre reservadas -->
        <div uiCard class="grid h-[min(680px,calc(100dvh-1.5rem))] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-4 sm:p-6 lg:h-[680px]">
          <div class="border-b border-border pb-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-xs font-bold uppercase tracking-wider text-accent">{{ text().step }} {{ currentStep() + 1 }} {{ text().of }} {{ surface().steps.length }}</span>
                  <span class="rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-text-muted">
                    {{ provider().name }} · {{ selectedSurface() === 'cli' ? text().modeCli : text().modePrompt }}
                  </span>
                </div>
                <div class="mt-3 flex items-center gap-3">
                  <div class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" [attr.aria-label]="text().progressLabel" [attr.aria-valuemin]="1" [attr.aria-valuemax]="surface().steps.length" [attr.aria-valuenow]="currentStep() + 1">
                    <div class="h-full rounded-full bg-accent transition-[width] duration-200" [style.width.%]="progressPercent()"></div>
                  </div>
                  <button uiButton variant="secondary" size="sm" type="button" (click)="openStepsNavigator()">
                    {{ text().viewSteps }}
                  </button>
                </div>
              </div>

            </div>
          </div>

          <!-- Sólo este cuerpo se desplaza cuando un paso es extenso. -->
          <div class="min-h-0 overflow-y-auto overscroll-contain py-5 pr-1">
            <div class="space-y-4">
            <div>
              <h3 class="text-lg font-bold tracking-tight text-text">{{ step().title }}</h3>
              <p class="mt-1 text-sm leading-relaxed text-text-muted">{{ step().instruction }}</p>
            </div>

            <!-- Action Box para Crear Key sin salir de la pantalla (Disponible en CLI y Prompt) -->
            @if (step().keyAction) {
              <div class="rounded-[var(--radius)] border border-accent/30 bg-accent-soft p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 class="text-xs font-semibold text-text flex items-center gap-1.5">
                    @if (activeKey()) {
                      <span class="text-success font-bold">✓</span> {{ text().keyActiveLabel }} <code class="font-mono text-xs">{{ activeKey()!.substring(0, 12) }}…</code>
                    } @else {
                      <span>🔑</span> {{ text().createKeyActionTitle }}
                    }
                  </h4>
                  <p class="text-xs text-text-muted mt-0.5">
                    @if (activeKey()) {
                      {{ text().keyActiveDesc }}
                    } @else {
                      {{ text().createKeyActionDesc }}
                    }
                  </p>
                </div>
                <button uiButton type="button" size="sm" (click)="openKeyModal()">
                  {{ activeKey() ? text().createAnotherKeyBtn : text().createKeyBtn }}
                </button>
              </div>
            }

            <!-- Terminal Box (Modo CLI) -->
            @if (step().code) {
              <div class="rounded-[var(--radius)] border border-[#2d2d32] bg-[#141416] overflow-hidden shadow-lg">
                <div class="flex items-center justify-between bg-[#1e1e22] px-3.5 py-2 border-b border-[#2d2d32]">
                  <div class="flex items-center gap-1.5">
                    <span class="h-2.5 w-2.5 rounded-full bg-[#ff5f56]"></span>
                    <span class="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]"></span>
                    <span class="h-2.5 w-2.5 rounded-full bg-[#27c93f]"></span>
                  </div>
                <span class="font-mono text-[11px] text-[#888894]">{{ step().codeLabel ?? (step().codeIsFile ? 'Archivo de configuración' : (terminalOs() === 'windows' ? 'PowerShell' : 'bash / zsh')) }}</span>
              </div>
              <div class="p-4 flex items-start justify-between gap-3">
                <code class="font-mono text-[13px] leading-relaxed text-[#e2e2ea] whitespace-pre-wrap word-break flex-1">
                  @if (!step().codeIsFile) {
                    <span class="text-[#6c6a7a] select-none mr-2">{{ terminalOs() === 'windows' ? 'PS >' : '$' }}</span>
                  }
                  {{ displayCode() }}
                </code>

                  <!-- Botón de copia O badge de comando manual -->
                  @if (step().noCopy) {
                    <span class="inline-flex items-center gap-1 rounded bg-[#25252b] border border-[#3d3d46] px-2.5 py-1 text-[11px] font-medium text-[#a0a0b2] shrink-0" [title]="text().manualCommandHint">
                      ⌨️ {{ text().manualCommandBadge }}
                    </span>
                  } @else {
                    <button
                      type="button"
                      class="rounded-[var(--radius)] border border-[#3e3e46] bg-[#2a2a30] hover:bg-[#36363e] px-2.5 py-1.5 text-xs text-[#f0f0f5] transition-colors cursor-pointer shrink-0 focus-visible:shadow-[var(--ring)] focus-visible:outline-none"
                      [class.!bg-success]="copied()"
                      [class.!text-white]="copied()"
                      [class.!border-success]="copied()"
                      (click)="copy()"
                    >
                      {{ copied() ? text().copied : text().copy }}
                    </button>
                  }
                </div>
              </div>
            }

            <!-- Prompt Box (Modo Prompt) -->
            @if (selectedSurface() === 'prompt' && step().prompt) {
              <div class="rounded-[var(--radius)] border border-border bg-surface-2 overflow-hidden shadow-sm">
                <div class="flex items-center justify-between bg-surface px-4 py-2.5 border-b border-border">
                  <span class="text-xs font-semibold text-text flex items-center gap-1.5">
                    <span>💬</span> {{ text().promptBoxHeader }}
                  </span>
                  <span class="text-[11px] text-text-faint">{{ text().promptBoxSub }}</span>
                </div>
                <div class="p-4 flex items-start justify-between gap-3">
                  <pre class="font-mono text-[12px] sm:text-[13px] leading-relaxed text-text whitespace-pre-wrap word-break flex-1 select-all">{{ displayPrompt() }}</pre>
                  <button
                    type="button"
                    class="rounded-[var(--radius)] border border-border bg-surface hover:bg-surface-2 px-3 py-1.5 text-xs font-medium text-text transition-colors cursor-pointer shrink-0 focus-visible:shadow-[var(--ring)] focus-visible:outline-none"
                    [class.!bg-success]="copied()"
                    [class.!text-white]="copied()"
                    [class.!border-success]="copied()"
                    (click)="copyPrompt()"
                  >
                    {{ copied() ? text().copied : text().copyPrompt }}
                  </button>
                </div>
              </div>
            }

            <!-- Details list if any -->
            @if (stepDetails().length) {
              <ul class="space-y-2 text-sm leading-relaxed text-text-muted" [class.list-disc]="step().detailsAreAlternatives" [class.pl-5]="step().detailsAreAlternatives">
                @for (detail of stepDetails(); track detail; let index = $index) {
                  <li class="flex gap-3">
                    @if (!step().detailsAreAlternatives) {
                      <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-xs text-text-faint">{{ index + 1 }}</span>
                    }
                    <span>{{ detail }}</span>
                  </li>
                }
              </ul>
            }

            <!-- Warning Callout -->
            @if (step().warning) {
              <div class="rounded-[var(--radius)] border border-warning/35 bg-warning-soft/30 p-3 text-xs sm:text-sm leading-relaxed text-text-muted flex items-start gap-2.5">
                <span class="text-warning font-bold text-sm">💡</span>
                <div>
                  <span class="font-semibold text-text">{{ text().attention }}</span> {{ step().warning }}
                </div>
              </div>
            }

            <!-- Final Step Guided Test -->
            @if (currentStep() === surface().steps.length - 1) {
              <div class="rounded-[var(--radius)] border border-accent/30 bg-accent-soft/45 p-4 space-y-3">
                <p class="text-sm font-semibold text-text">{{ text().finalTitle }}</p>
                <ol class="space-y-1.5 text-xs sm:text-sm leading-relaxed text-text-muted">
                  <li class="flex gap-2"><span class="font-bold text-text">1.</span><span>{{ text().finalKeepTerminal }}</span></li>
                  <li class="flex gap-2"><span class="font-bold text-text">2.</span><span>{{ text().finalOpen }} {{ provider().name }}.</span></li>
                  <li class="flex gap-2"><span class="font-bold text-text">3.</span><span>{{ text().finalPaste }}</span></li>
                </ol>
                <div class="relative">
                  <code class="block w-full rounded-[var(--radius)] border border-border bg-surface p-3 pr-20 font-mono text-xs text-text">{{ text().testPrompt }}</code>
                  <button
                    type="button"
                    class="absolute top-2 right-2 rounded-[var(--radius)] border border-border bg-surface-2 hover:bg-surface px-2.5 py-1 text-xs text-text transition-colors cursor-pointer focus-visible:shadow-[var(--ring)] focus-visible:outline-none"
                    (click)="copyValue(text().testPrompt)"
                  >
                    {{ copied() ? text().copied : text().copy }}
                  </button>
                </div>
                <p class="text-xs text-text-muted"><span class="font-semibold text-text">{{ text().finalExpectedLabel }}</span> {{ text().finalExpected }}</p>
              </div>
            }
            </div>
          </div>

          <div class="flex items-center justify-between gap-3 border-t border-border bg-surface pt-4">
            <span class="hidden text-xs text-text-faint sm:inline">{{ text().navigationHint }}</span>
            <div class="ml-auto flex items-center gap-2">
              <button uiButton variant="secondary" size="sm" type="button" [disabled]="currentStep() === 0" (click)="previous()">
                ← {{ text().previous }}
              </button>
              <button uiButton size="sm" type="button" [disabled]="currentStep() === surface().steps.length - 1" (click)="next()">
                {{ text().next }} →
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Navegador bajo demanda: mantiene el progreso visible sin ocupar la columna lateral. -->
      @if (stepsNavigatorOpen()) {
        <div
          class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          [attr.aria-labelledby]="stepsNavigatorTitleId"
          (click)="closeStepsNavigator()"
          (keydown.escape)="closeStepsNavigator()"
        >
          <div class="flex max-h-[min(600px,calc(100dvh-1rem))] w-full max-w-lg flex-col rounded-t-[var(--radius-lg)] border border-border bg-surface shadow-2xl sm:rounded-[var(--radius-lg)]" (click)="$event.stopPropagation()">
            <div class="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 [id]="stepsNavigatorTitleId" class="text-base font-semibold tracking-tight text-text">{{ text().stepsNavigatorTitle }}</h3>
                <p class="mt-0.5 text-xs text-text-muted">{{ text().stepsNavigatorDescription }}</p>
              </div>
              <button
                type="button"
                autofocus
                class="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius)] text-text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:shadow-[var(--ring)] focus-visible:outline-none"
                [attr.aria-label]="text().close"
                (click)="closeStepsNavigator()"
              >
                <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div class="min-h-0 overflow-y-auto p-3 sm:p-4" role="list">
              @for (st of surface().steps; track st.title; let idx = $index) {
                <button
                  type="button"
                  class="flex w-full items-start gap-3 rounded-[var(--radius)] p-3 text-left transition-colors focus-visible:shadow-[var(--ring)] focus-visible:outline-none"
                  [class.bg-accent-soft]="idx === currentStep()"
                  [class.hover:bg-surface-2]="idx !== currentStep()"
                  [attr.aria-current]="idx === currentStep() ? 'step' : null"
                  (click)="selectStepFromNavigator(idx)"
                >
                  <span
                    class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                    [class.bg-accent]="idx === currentStep()"
                    [class.text-accent-fg]="idx === currentStep()"
                    [class.bg-success]="idx < currentStep()"
                    [class.text-white]="idx < currentStep()"
                    [class.bg-surface-2]="idx > currentStep()"
                    [class.border]="idx > currentStep()"
                    [class.border-border-strong]="idx > currentStep()"
                    [class.text-text-muted]="idx > currentStep()"
                  >
                    @if (idx < currentStep()) { ✓ } @else { {{ idx + 1 }} }
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block text-sm font-medium text-text" [class.font-semibold]="idx === currentStep()">{{ st.title }}</span>
                    <span class="mt-0.5 block text-xs text-text-faint">{{ text().step }} {{ idx + 1 }}</span>
                  </span>
                </button>
              }
            </div>
          </div>
        </div>
      }

      <!-- MODAL PARA CREAR KEY SIN SALIR DE LA PANTALLA -->
      @if (keyModalOpen()) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm"
          (click)="closeKeyModal()"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="text().createKeyTitle"
        >
          <div
            class="relative w-full max-w-md rounded-[var(--radius-lg)] border border-border bg-surface p-5 sm:p-6 shadow-2xl flex flex-col gap-4 anim-pop-in"
            (click)="$event.stopPropagation()"
          >
            <!-- Header del Modal -->
            <div class="flex items-center justify-between border-b border-border pb-3">
              <h3 class="text-base font-semibold tracking-tight text-text">{{ text().createKeyTitle }}</h3>
              <button
                type="button"
                (click)="closeKeyModal()"
                class="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius)] text-text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
                [attr.aria-label]="text().close"
              >
                <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            @if (!generatedKey()) {
              <p class="text-xs text-text-muted leading-relaxed">{{ text().createKeyDesc }}</p>

              <ui-field [label]="text().keyNameLabel">
                <input
                  uiInput
                  [(ngModel)]="keyName"
                  placeholder="mi-notebook"
                  (keydown.enter)="generateKey()"
                  [disabled]="isGeneratingKey()"
                />
              </ui-field>

              @if (keyError()) {
                <p class="text-xs text-danger">{{ keyError() }}</p>
              }

              <div class="flex justify-end gap-2 pt-2 border-t border-border">
                <button uiButton variant="secondary" type="button" (click)="closeKeyModal()" [disabled]="isGeneratingKey()">
                  {{ text().cancel }}
                </button>
                <button uiButton type="button" (click)="generateKey()" [disabled]="isGeneratingKey()">
                  {{ isGeneratingKey() ? text().generating : text().generateAndApply }}
                </button>
              </div>
            } @else {
              <div class="rounded-[var(--radius)] border border-accent/30 bg-accent-soft p-3.5 space-y-2">
                <p class="text-xs font-semibold text-accent">{{ text().keyGeneratedSuccess }}</p>
                <div class="flex items-center gap-2 bg-surface border border-border rounded-[var(--radius)] p-2">
                  <code class="font-mono text-xs text-text truncate flex-1">{{ generatedKey() }}</code>
                  <button
                    type="button"
                    class="rounded-[var(--radius)] border border-border px-2 py-1 text-xs text-text bg-surface-2 hover:bg-surface transition-colors cursor-pointer"
                    (click)="copyValue(generatedKey()!)"
                  >
                    {{ copied() ? text().copied : text().copy }}
                  </button>
                </div>
              </div>
              <p class="text-xs text-text-muted leading-relaxed">{{ text().keyAppliedHint }}</p>

              <div class="flex justify-end pt-2 border-t border-border">
                <button uiButton type="button" (click)="closeKeyModal()">
                  {{ text().continueTutorial }}
                </button>
              </div>
            }
          </div>
        </div>
      }
    </section>
  `,
})
export class McpTutorial {
  readonly showKeys = output<void>();
  private readonly api = inject(Api);
  readonly i18n = inject(I18n);

  readonly selectedProvider = signal<ProviderId>('claude');
  readonly selectedSurface = signal<SurfaceId>('cli');
  readonly terminalOs = signal<TerminalOs>('unix');
  readonly currentStep = signal(0);
  readonly copied = signal(false);
  readonly stepsNavigatorOpen = signal(false);
  readonly stepsNavigatorTitleId = 'mcp-steps-navigator-title';

  // In-place Key Generation Modal
  readonly keyModalOpen = signal(false);
  readonly keyName = signal('mi-notebook');
  readonly generatedKey = signal<string | null>(null);
  readonly isGeneratingKey = signal(false);
  readonly keyError = signal<string | null>(null);
  readonly activeKey = signal<string | null>(null);

  private readonly mcpUrl = 'https://marketplace-utn.tech/api/mcp';
  private readonly apiKeyPlaceholder = 'PEGAR_API_KEY_AQUI';
  private readonly es = computed(() => this.i18n.locale() === 'es');
  readonly configSourcePath = computed(() => this.terminalOs() === 'windows'
    ? '$HOME\\.config\\skillhub\\mcp-config.json'
    : '$HOME/.config/skillhub/mcp-config.json');

  readonly claudeMcpCommand = computed(() => this.terminalOs() === 'windows'
    ? `claude mcp add --scope user --transport http skillhub ${this.mcpUrl} --header "Authorization: Bearer ${this.apiKeyPlaceholder}"`
    : `claude mcp add --scope user --transport http skillhub ${this.mcpUrl} --header 'Authorization: Bearer ${this.apiKeyPlaceholder}'`);
  readonly securePrompt = computed(() => this.es()
    ? `Configurá Skill Hub como servidor MCP en el cliente de IA que estoy usando.\n\nUsá como fuente el archivo local ${this.configSourcePath()}. Ese archivo contiene la URL y el header Authorization con la API key.\n\nReglas obligatorias:\n1. Leé el archivo local para usar sus valores, pero nunca muestres su contenido ni la API key en chat, respuestas o logs.\n2. No me pidas pegar la API key en el chat.\n3. Detectá el cliente y su archivo oficial de configuración; no inventes rutas ni menús.\n4. Antes de modificar algo, hacé un respaldo, informá el archivo y esperá confirmación.\n5. Configurá un servidor remoto Streamable HTTP llamado skillhub con OAuth desactivado.\n6. Copiá los valores del archivo fuente al formato oficial del cliente.\n7. Verificá la conexión sin revelar la key.\n8. Informá sólo cliente, archivo, estado y cómo probarlo.`
    : `Configure Skill Hub as an MCP server in the AI client I am using.\n\nUse the local file ${this.configSourcePath()} as the source. It contains the URL and the Authorization header with the API key.\n\nMandatory rules:\n1. Read the local file to use its values, but never show its contents or the API key in chat, responses, or logs.\n2. Do not ask me to paste the API key into chat.\n3. Detect the client and official configuration file; do not invent paths or menus.\n4. Before editing, make a backup, report the file, and wait for confirmation.\n5. Configure a remote Streamable HTTP server named skillhub with OAuth disabled.\n6. Copy the source file values into the client’s official format.\n7. Verify without revealing the key.\n8. Report only the client, file, status, and how to test.`);

  readonly text = computed(() => this.es() ? {
    titleCli: 'Conectá el marketplace desde tu terminal (CLI)',
    subtitleCli: 'Tutorial paso a paso por línea de comandos para registrar el servidor MCP.',
    titlePrompt: 'Conectá el marketplace mediante un Prompt a tu IA',
    subtitlePrompt: 'Guardá la configuración en un archivo local y usá el prompt para que tu IA la aplique.',
    chooseMode: '1. ¿Cómo querés conectar?',
    modeCli: 'Terminal (CLI)',
    modePrompt: 'Vía Prompt',
    chooseClient: '2. Elegí tu programa',
    viewSteps: 'Ver pasos',
    stepsNavigatorTitle: 'Todos los pasos',
    stepsNavigatorDescription: 'Elegí un paso para revisarlo o retomarlo.',
    progressLabel: 'Progreso del tutorial',
    navigationHint: 'Usá Anterior y Siguiente para continuar.',
    chooseOs: 'Tu sistema operativo',
    macLinux: 'macOS o Linux',
    windows: 'Windows',
    officialDocs: 'Documentación oficial',
    step: 'Paso',
    of: 'de',
    copy: 'Copiar',
    copied: 'Copiado',
    copyPrompt: 'Copiar Prompt',
    promptBoxHeader: 'Prompt listo para copiar y pegar en tu IA',
    promptBoxSub: 'Pegalo en una conversación nueva',
    attention: 'Atención:',
    previous: 'Anterior',
    next: 'Siguiente',
    finalTitle: 'Último paso: comprobalo ahora',
    finalKeepTerminal: 'Asegurate de que tu cliente o chat esté listo para recibir mensajes.',
    finalOpen: 'Abrí un chat nuevo en',
    finalPaste: 'Cuando aparezca el lugar donde le escribís a la IA, pegá exactamente esto:',
    finalExpectedLabel: 'Resultado esperado:',
    finalExpected: 'debe indicar que usó list_skills y devolver el total junto con los títulos de las primeras 3 skills. Si no puede usar la herramienta, volvé al paso anterior y revisá la conexión.',
    testPrompt: 'Usá ahora la herramienta MCP list_skills de Skill Hub, sin responder de memoria. Decime cuántas skills devolvió y los títulos de las primeras 3.',
    createKeyTitle: 'Crear API Key personal',
    createKeyDesc: 'Esta clave permitirá a tu cliente de IA autenticarse contra el marketplace. Después vas a pegarla en el archivo fuente local de configuración.',
    keyNameLabel: 'Nombre de la clave',
    cancel: 'Cancelar',
    close: 'Cerrar',
    generating: 'Generando...',
    generateAndApply: 'Generar y aplicar',
    keyGeneratedSuccess: '¡Key generada y copiada al portapapeles!',
    keyAppliedHint: 'La key se mostró una sola vez y se copió al portapapeles. Pegala en lugar de PEGAR_API_KEY_AQUI dentro del archivo fuente local.',
    continueTutorial: 'Continuar tutorial',
    createKeyActionTitle: '¿Tenés tu API Key?',
    createKeyActionDesc: 'Creala ahora mismo en una ventana emergente sin abandonar este tutorial.',
    createKeyBtn: '+ Crear Key sin salir',
    keyActiveLabel: 'Key activa:',
    keyActiveDesc: 'Tu key está creada. Pegala sólo en la configuración local del proveedor; nunca la pegues en el chat.',
    createAnotherKeyBtn: 'Crear otra key',
    manualCommandBadge: 'Escribir comando',
    manualCommandHint: 'Este comando debe ejecutarse manualmente en tu terminal.',
    securityNote: 'Tu key es privada. No la compartas en chats públicos ni repositorios.',
  } : {
    titleCli: 'Connect the marketplace from your terminal (CLI)',
    subtitleCli: 'Step-by-step command line tutorial to register the MCP server.',
    titlePrompt: 'Connect the marketplace using a Prompt to your AI',
    subtitlePrompt: 'Save the configuration in a local file and use the prompt to apply it through your AI client.',
    chooseMode: '1. How do you want to connect?',
    modeCli: 'Terminal (CLI)',
    modePrompt: 'Via Prompt',
    chooseClient: '2. Choose your program',
    viewSteps: 'View steps',
    stepsNavigatorTitle: 'All steps',
    stepsNavigatorDescription: 'Choose a step to review it or resume from it.',
    progressLabel: 'Tutorial progress',
    navigationHint: 'Use Previous and Next to continue.',
    chooseOs: 'Your operating system',
    macLinux: 'macOS or Linux',
    windows: 'Windows',
    officialDocs: 'Official documentation',
    step: 'Step',
    of: 'of',
    copy: 'Copy',
    copied: 'Copied',
    copyPrompt: 'Copy Prompt',
    promptBoxHeader: 'Prompt ready to copy and paste into your AI',
    promptBoxSub: 'Paste it in a new conversation',
    attention: 'Attention:',
    previous: 'Previous',
    next: 'Next',
    finalTitle: 'Last step: test it now',
    finalKeepTerminal: 'Make sure your client or chat is ready to receive messages.',
    finalOpen: 'Open a new chat in',
    finalPaste: 'When you see where to write to the AI, paste this exact text:',
    finalExpectedLabel: 'Expected result:',
    finalExpected: 'it must state that it used list_skills and return the total along with the titles of the first 3 skills. If it cannot use the tool, go back one step and check the connection.',
    testPrompt: 'Use the Skill Hub MCP tool list_skills now; do not answer from memory. Tell me how many skills it returned and the titles of the first 3.',
    createKeyTitle: 'Create personal API Key',
    createKeyDesc: 'This key allows your AI client to authenticate against the marketplace. You will paste it into the local configuration source file.',
    keyNameLabel: 'Key name',
    cancel: 'Cancel',
    close: 'Close',
    generating: 'Generating...',
    generateAndApply: 'Generate and apply',
    keyGeneratedSuccess: 'Key generated and copied to clipboard!',
    keyAppliedHint: 'The key was shown once and copied to the clipboard. Paste it in place of PEGAR_API_KEY_AQUI inside the local source file.',
    continueTutorial: 'Continue tutorial',
    createKeyActionTitle: 'Do you have your API Key?',
    createKeyActionDesc: 'Create it right now in a popup without leaving this tutorial.',
    createKeyBtn: '+ Create Key without leaving',
    keyActiveLabel: 'Active key:',
    keyActiveDesc: 'Your key is created. Paste it only into the provider’s local configuration; never paste it into chat.',
    createAnotherKeyBtn: 'Create another key',
    manualCommandBadge: 'Type command',
    manualCommandHint: 'This command must be run manually in your terminal.',
    securityNote: 'Your key is private. Never share it in public chats or repositories.',
  });

  readonly providers = computed<Provider[]>(() => {
    const es = this.es();
    const tx = (spanish: string, english: string) => es ? spanish : english;
    const common: GuideStep = {
      title: tx('Generá y copiá tu key', 'Generate and copy your key'),
      instruction: tx('Creá una key con un nombre como “mi-notebook”. Podés generarla directamente acá sin salir.', 'Create a key named something like “my-notebook”. You can generate it right here without leaving.'),
      keyAction: true,
    };
    const authorizationHeader = `Bearer ${this.apiKeyPlaceholder}`;
    const codexConfig = `[mcp_servers.skillhub]\nurl = "${this.mcpUrl}"\nhttp_headers = { Authorization = "${authorizationHeader}" }`;
    const opencodeConfig = JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: { servers: { skillhub: { type: 'remote', url: this.mcpUrl, oauth: false, headers: { Authorization: authorizationHeader } } } } }, null, 2);
    const promptConfigFile: GuideStep = {
      title: tx('Creá el archivo fuente de configuración', 'Create the configuration source file'),
      instruction: tx(`Seguí las instrucciones de tu sistema operativo para crear ${this.configSourcePath()} fuera del proyecto. Después pegá este JSON, reemplazá ${this.apiKeyPlaceholder} por la key copiada y guardá el archivo. El agente lo usará para configurar tu cliente.`, `Follow the instructions for your operating system to create ${this.configSourcePath()} outside the project. Then paste this JSON, replace ${this.apiKeyPlaceholder} with the copied key, and save the file. The agent will use it to configure your client.`),
      detailsByOs: {
        unix: [
          tx('Abrí Terminal y ejecutá: mkdir -p ~/.config/skillhub', 'Open Terminal and run: mkdir -p ~/.config/skillhub'),
          tx('Ejecutá: nano ~/.config/skillhub/mcp-config.json', 'Run: nano ~/.config/skillhub/mcp-config.json'),
          tx('Pegá el JSON y reemplazá PEGAR_API_KEY_AQUI por tu key. Guardá con Ctrl + O, presioná Enter y salí con Ctrl + X.', 'Paste the JSON and replace PEGAR_API_KEY_AQUI with your key. Save with Ctrl + O, press Enter, and exit with Ctrl + X.'),
        ],
        windows: [
          tx('Abrí PowerShell y ejecutá: New-Item -ItemType Directory -Force "$HOME\\.config\\skillhub"', 'Open PowerShell and run: New-Item -ItemType Directory -Force "$HOME\\.config\\skillhub"'),
          tx('Ejecutá: notepad "$HOME\\.config\\skillhub\\mcp-config.json"', 'Run: notepad "$HOME\\.config\\skillhub\\mcp-config.json"'),
          tx('En Bloc de notas, pegá el JSON y reemplazá PEGAR_API_KEY_AQUI por tu key. Al guardar, elegí Tipo: Todos los archivos (*.*), confirmá el nombre mcp-config.json y usá UTF-8. No lo guardes como mcp-config.json.txt.', 'In Notepad, paste the JSON and replace PEGAR_API_KEY_AQUI with your key. When saving, choose Save as type: All files (*.*), confirm the name mcp-config.json, and use UTF-8. Do not save it as mcp-config.json.txt.'),
        ],
      },
      code: JSON.stringify({ url: this.mcpUrl, headers: { Authorization: authorizationHeader } }, null, 2),
      codeIsFile: true,
      codeLabel: tx('Archivo fuente local', 'Local source file'),
      warning: tx('Este archivo contiene tu API key. No lo subas al repositorio ni lo compartas. El agente leerá el archivo, pero no debe mostrar su contenido.', 'This file contains your API key. Do not commit or share it. The agent will read the file, but must not display its contents.'),
    };

    const providers: Provider[] = [
      {
        id: 'claude', name: 'Claude Code',
        surfaces: [
          {
            id: 'cli', label: tx('Terminal (CLI)', 'Terminal (CLI)'),
            description: tx('Claude Code se configura desde la terminal.', 'Claude Code is configured from the terminal.'),
            officialDocs: 'https://docs.anthropic.com/en/docs/claude-code/mcp',
            steps: [
              {
                title: tx('Comprobá que Claude Code está instalado', 'Check that Claude Code is installed'),
                instruction: tx('Abrí una terminal y ejecutá esto. Si ves una versión, seguí. Si dice “command not found”, instalá o actualizá Claude Code primero.', 'Open a terminal and run this. If you see a version, continue. If it says “command not found”, install or update Claude Code first.'),
                code: 'claude --version',
                noCopy: true,
              },
              common,
              {
                title: tx('Agregá Skill Hub a tu usuario', 'Add Skill Hub for your user'),
                instruction: tx('Abrí Terminal, pegá este comando y presioná Enter. El scope user evita crear un archivo local dentro del proyecto.', 'Open Terminal, paste this command, and press Enter. User scope avoids creating a local project file.'),
                code: this.claudeMcpCommand(),
                warning: tx(`Reemplazá ${this.apiKeyPlaceholder} por la key copiada antes de ejecutar el comando. La key quedará guardada en la configuración de usuario de Claude.`, `Replace ${this.apiKeyPlaceholder} with the copied key before running the command. The key will be stored in Claude's user configuration.`),
              },
              {
                title: tx('Verificá la conexión', 'Verify the connection'),
                instruction: tx('Ejecutá el comando. Tiene que aparecer un servidor llamado skillhub. Después abrí Claude Code y escribí /mcp para verlo conectado.', 'Run the command. A server named skillhub must appear. Then open Claude Code and type /mcp to see it connected.'),
                code: 'claude mcp list',
              },
              {
                title: tx('Probá el catálogo', 'Test the catalogue'),
                instruction: tx('En una conversación nueva de Claude Code, seguí la prueba guiada que aparece abajo. Si no usa Skill Hub, abrí /mcp y copiá el estado o error.', 'In a new Claude Code conversation, follow the guided test shown below. If it does not use Skill Hub, open /mcp and copy its status or error.'),
              },
            ],
          },
          {
            id: 'prompt', label: tx('Vía Prompt', 'Via Prompt'),
            description: tx('Pedile a Claude que se auto-configure pegándole un prompt en el chat.', 'Ask Claude to self-configure by pasting a prompt into the chat.'),
            officialDocs: 'https://docs.anthropic.com/en/docs/claude-code/mcp',
            steps: [
              common,
              promptConfigFile,
              {
                title: tx('Copiá el prompt para Claude', 'Copy the prompt for Claude'),
                instruction: tx('Copiá estas instrucciones completas. Indican a Claude cómo registrar el servidor MCP de Skill Hub en su configuración de usuario.', 'Copy these complete instructions. They tell Claude how to register the Skill Hub MCP server in user configuration.'),
                prompt: this.securePrompt(),
                warning: tx('Claude ejecutará la configuración sin que tengas que editar archivos manualmente.', 'Claude will execute configuration without requiring manual file edits.'),
              },
              {
                title: tx('Pegalo en el chat de Claude', 'Paste it into Claude chat'),
                instruction: tx('Abrí una nueva conversación en Claude Code o Claude Desktop y pegá el prompt copiado.', 'Open a new conversation in Claude Code or Claude Desktop and paste the copied prompt.'),
              },
              {
                title: tx('Probá el catálogo', 'Test the catalogue'),
                instruction: tx('Preguntale a Claude por las convenciones para confirmar que ya tiene acceso a las herramientas.', 'Ask Claude about conventions to confirm it has access to the tools.'),
              },
            ],
          },
        ],
      },
      {
        id: 'antigravity', name: 'Antigravity',
        surfaces: [
          {
            id: 'cli', label: tx('Terminal (CLI)', 'Terminal (CLI)'),
            description: tx('Antigravity CLI usa su propio administrador MCP.', 'Antigravity CLI uses its own MCP manager.'),
            officialDocs: 'https://antigravity.google/docs/ide-mcp',
            steps: [
              {
                title: tx('Comprobá que Antigravity CLI está instalado', 'Check that Antigravity CLI is installed'),
                instruction: tx('Abrí una terminal y ejecutá esto. Si ves una versión, seguí. Si dice “command not found”, instalá o actualizá Antigravity CLI primero.', 'Open a terminal and run this. If you see a version, continue. If it says “command not found”, install or update Antigravity CLI first.'),
                code: 'agy --version',
                noCopy: true,
              },
              common,
              {
                title: tx('Abrí la configuración global', 'Open global configuration'),
                instruction: tx('No ejecutes el bloque de abajo en la terminal: es contenido JSON para pegar dentro del archivo ~/.gemini/config/mcp_config.json. Si no existe, crealo. Conservá cualquier otro servidor y agregá skillhub dentro de mcpServers.', 'Do not run the block below in the terminal: it is JSON content to paste inside ~/.gemini/config/mcp_config.json. If it does not exist, create it. Keep other servers and add skillhub inside mcpServers.'),
                detailsByOs: {
                  unix: [
                    tx('Ejecutá `mkdir -p ~/.gemini/config` y luego abrí `nano ~/.gemini/config/mcp_config.json`.', 'Run `mkdir -p ~/.gemini/config`, then open `nano ~/.gemini/config/mcp_config.json`.'),
                    tx('Pegá el JSON dentro del archivo, guardá, cerrá el editor y recién después volvé a Antigravity.', 'Paste the JSON inside the file, save, close the editor, and only then return to Antigravity.'),
                  ],
                  windows: [
                    tx('Ejecutá `New-Item -ItemType Directory -Force "$HOME\\.gemini\\config"` y luego abrí `notepad "$HOME\\.gemini\\config\\mcp_config.json"`.', 'Run `New-Item -ItemType Directory -Force "$HOME\\.gemini\\config"`, then open `notepad "$HOME\\.gemini\\config\\mcp_config.json"`.'),
                    tx('Pegá el JSON dentro del archivo, guardá, cerrá el editor y recién después volvé a Antigravity.', 'Paste the JSON inside the file, save, close the editor, and only then return to Antigravity.'),
                  ],
                },
                code: JSON.stringify({ mcpServers: { skillhub: { serverUrl: this.mcpUrl, headers: { Authorization: `Bearer ${this.apiKeyPlaceholder}` }, oauth: false } } }, null, 2),
                codeIsFile: true,
                warning: tx(`Reemplazá ${this.apiKeyPlaceholder} por la key copiada antes de guardar el archivo.`, `Replace ${this.apiKeyPlaceholder} with the copied key before saving the file.`),
              },
              {
                title: tx('Recargá desde /mcp', 'Reload from /mcp'),
                instruction: tx('Guardá el archivo, volvé a /mcp y usá la acción de recargar. Skill Hub debe pasar a conectado.', 'Save the file, return to /mcp, and use the reload action. Skill Hub must become connected.'),
              },
              {
                title: tx('Probá el catálogo', 'Test the catalogue'),
                instruction: tx('Volvé al prompt normal y pegá la prueba final. Si falla, copiá el log o estado que muestra /mcp.', 'Return to the normal prompt and paste the final test. If it fails, copy the log or status shown by /mcp.'),
              },
            ],
          },
          {
            id: 'prompt', label: tx('Vía Prompt', 'Via Prompt'),
            description: tx('Pedile al agente de Antigravity que configure su propio servidor MCP.', 'Ask the Antigravity agent to configure its own MCP server.'),
            officialDocs: 'https://antigravity.google/docs/ide-mcp',
            steps: [
              common,
              promptConfigFile,
              {
                title: tx('Copiá el prompt para el Agente Antigravity', 'Copy the prompt for Antigravity Agent'),
                instruction: tx('Copiá esta directiva para el agente de Antigravity.', 'Copy this directive for the Antigravity agent.'),
                prompt: this.securePrompt(),
                warning: tx('El agente editará el archivo mcp_config.json de forma segura.', 'The agent will safely edit the mcp_config.json file.'),
              },
              {
                title: tx('Pegalo en el chat del agente', 'Paste it into agent chat'),
                instruction: tx('Abrí el panel del agente en Antigravity y enviá el prompt.', 'Open the agent panel in Antigravity and send the prompt.'),
              },
              {
                title: tx('Probá el catálogo', 'Test the catalogue'),
                instruction: tx('Pedile al agente que consulte las convenciones de Skill Hub.', 'Ask the agent to consult Skill Hub conventions.'),
              },
            ],
          },
        ],
      },
      {
        id: 'codex', name: 'Codex',
        surfaces: [
          {
            id: 'cli', label: tx('Terminal (CLI)', 'Terminal (CLI)'),
            description: tx('Configuración personal de Codex desde terminal.', 'Personal Codex configuration from the terminal.'),
            officialDocs: 'https://developers.openai.com/es-419/docs/extend/mcp?surface=cli',
            steps: [
              {
                title: tx('Comprobá que Codex está disponible', 'Check that Codex is available'),
                instruction: tx('Verificá en tu terminal que Codex esté instalado.', 'Verify in your terminal that Codex is installed.'),
                code: 'codex --version',
                noCopy: true,
              },
              common,
              {
                title: tx('Abrí el archivo de configuración', 'Open the configuration file'),
                instruction: tx(`Abrí ~/.codex/config.toml. Si ya tiene contenido, agregá el bloque al final sin borrar lo anterior. Reemplazá ${this.apiKeyPlaceholder} por la key copiada.`, `Open ~/.codex/config.toml. If it already has content, append this block without deleting existing content. Replace ${this.apiKeyPlaceholder} with the copied key.`),
                code: codexConfig,
                codeIsFile: true,
              },
              {
                title: tx('Verificá desde Codex CLI', 'Verify from Codex CLI'),
                instruction: tx('En la misma terminal, ejecutá este comando. Debe listar skillhub. Luego iniciá Codex y usá /mcp si querés ver el estado.', 'In the same terminal, run this command. It must list skillhub. Then start Codex and use /mcp to see its status.'),
                code: 'codex mcp list',
              },
              {
                title: tx('Probá el catálogo', 'Test the catalogue'),
                instruction: tx('Abrí una conversación nueva y pegá la prueba final. Si falla, copiá el resultado de codex mcp list.', 'Open a new conversation and paste the final test. If it fails, copy the output of codex mcp list.'),
              },
            ],
          },
          {
            id: 'prompt', label: tx('Vía Prompt', 'Via Prompt'),
            description: tx('Instrucción para que Codex o Cursor configure el archivo toml.', 'Instruction for Codex or Cursor to configure the toml file.'),
            officialDocs: 'https://developers.openai.com/es-419/docs/extend/mcp?surface=cli',
            steps: [
              common,
              promptConfigFile,
              {
                title: tx('Copiá el prompt para Codex / Cursor', 'Copy prompt for Codex / Cursor'),
                instruction: tx('Copiá estas instrucciones para que el modelo agregue el servidor.', 'Copy these instructions for the model to add the server.'),
                prompt: this.securePrompt(),
                warning: tx('El modelo actualizará el archivo de configuración toml.', 'The model will update the toml configuration file.'),
              },
              {
                title: tx('Pegalo en el chat de Codex / Cursor', 'Paste it into Codex / Cursor chat'),
                instruction: tx('Pegá el texto en una conversación nueva y esperá la confirmación.', 'Paste the text into a new conversation and wait for confirmation.'),
              },
              {
                title: tx('Probá el catálogo', 'Test the catalogue'),
                instruction: tx('Confirmá que el asistente pueda invocar las herramientas.', 'Confirm that the assistant can invoke tools.'),
              },
            ],
          },
        ],
      },
      {
        id: 'opencode', name: 'OpenCode',
        surfaces: [
          {
            id: 'cli', label: tx('Terminal (CLI)', 'Terminal (CLI)'),
            description: tx('OpenCode conecta MCP remoto desde su configuración o CLI.', 'OpenCode connects remote MCP from its configuration or CLI.'),
            officialDocs: 'https://opencode.ai/v2/docs/mcp-servers',
            steps: [
              {
                title: tx('Comprobá que OpenCode está instalado', 'Check that OpenCode is installed'),
                instruction: tx('Verificá en tu terminal que OpenCode esté disponible.', 'Verify in your terminal that OpenCode is available.'),
                code: 'opencode --version',
                noCopy: true,
              },
              common,
              {
                title: tx('Abrí la configuración global', 'Open global configuration'),
                instruction: tx(`Abrí ~/.config/opencode/opencode.jsonc. Si el archivo ya existe, agregá sólo el servidor skillhub dentro de mcp.servers y reemplazá ${this.apiKeyPlaceholder} por la key copiada.`, `Open ~/.config/opencode/opencode.jsonc. If the file already exists, add only the skillhub server inside mcp.servers and replace ${this.apiKeyPlaceholder} with the copied key.`),
                code: opencodeConfig,
                codeIsFile: true,
              },
              {
                title: tx('Comprobá la conexión', 'Check the connection'),
                instruction: tx('En la misma terminal ejecutá esto. Skill Hub debe aparecer conectado. También podés abrir /mcps dentro de OpenCode.', 'In the same terminal run this. Skill Hub must show as connected. You can also open /mcps inside OpenCode.'),
                code: 'opencode mcp list',
              },
              {
                title: tx('Probá el catálogo', 'Test the catalogue'),
                instruction: tx('Iniciá OpenCode y pegá la prueba final. Si el estado dice needs authentication, revisá que hayas reemplazado el marcador y que oauth esté desactivado.', 'Start OpenCode and paste the final test. If status says needs authentication, check that you replaced the placeholder and that oauth is disabled.'),
              },
            ],
          },
          {
            id: 'prompt', label: tx('Vía Prompt', 'Via Prompt'),
            description: tx('Instrucción para configurar OpenCode vía chat.', 'Instruction to configure OpenCode via chat.'),
            officialDocs: 'https://opencode.ai/v2/docs/mcp-servers',
            steps: [
              common,
              promptConfigFile,
              {
                title: tx('Copiá el prompt para OpenCode', 'Copy prompt for OpenCode'),
                instruction: tx('Copiá este bloque para que OpenCode configure su JSON.', 'Copy this block for OpenCode to configure its JSON.'),
                prompt: this.securePrompt(),
              },
              {
                title: tx('Pegalo en OpenCode', 'Paste it into OpenCode'),
                instruction: tx('Pegá la directiva en el chat de OpenCode.', 'Paste the directive into OpenCode chat.'),
              },
              {
                title: tx('Probá el catálogo', 'Test the catalogue'),
                instruction: tx('Verificá que responda con la lista de skills.', 'Verify that it responds with the list of skills.'),
              },
            ],
          },
        ],
      },
      {
        id: 'generic', name: tx('Otro cliente MCP', 'Another MCP client'),
        surfaces: [
          {
            id: 'cli', label: tx('Configuración manual', 'Manual configuration'),
            description: tx('Para clientes que aceptan Streamable HTTP y headers personalizados.', 'For clients that accept Streamable HTTP and custom headers.'),
            officialDocs: 'https://modelcontextprotocol.io/docs/getting-started/intro',
            steps: [
              {
                title: tx('Buscá la guía MCP de tu proveedor', 'Find your provider’s MCP guide'),
                instruction: tx('En la documentación oficial de tu cliente buscá “MCP servers”, “Tools” o “Integrations”. Elegí agregar un servidor MCP remoto; no ejecutes un comando de terminal para este paso.', 'In your client’s official documentation, look for “MCP servers”, “Tools”, or “Integrations”. Choose to add a remote MCP server; do not run a terminal command for this step.'),
                details: [
                  tx('Elegí un servidor remoto o HTTP.', 'Choose a remote or HTTP server.'),
                  tx('Confirmá que ofrece transporte Streamable HTTP.', 'Confirm that it offers Streamable HTTP transport.'),
                  tx('Confirmá que permite headers HTTP personalizados. Si sólo admite stdio o SSE antiguo, ese cliente no es compatible.', 'Confirm that it allows custom HTTP headers. If it only supports stdio or legacy SSE, that client is not compatible.'),
                ],
              },
              common,
              {
                title: tx('Cargá los datos de Skill Hub', 'Enter Skill Hub details'),
                instruction: tx('Completá estos valores en el formulario o archivo que indique la documentación de tu cliente. Conservá cualquier otro servidor que ya tengas.', 'Enter these values in the form or file specified by your client’s documentation. Keep any other servers you already have.'),
                code: tx('Nombre del servidor: skillhub\nTransporte: Streamable HTTP\nURL: ', 'Server name: skillhub\nTransport: Streamable HTTP\nURL: ') + this.mcpUrl + tx(`\nNombre del header: Authorization\nValor del header: Bearer ${this.apiKeyPlaceholder}`, `\nHeader name: Authorization\nHeader value: Bearer ${this.apiKeyPlaceholder}`),
                codeIsFile: true,
                codeLabel: tx('Valores para cargar', 'Values to enter'),
                warning: tx(`Reemplazá ${this.apiKeyPlaceholder} por la key copiada antes de guardar la configuración.`, `Replace ${this.apiKeyPlaceholder} with the copied key before saving the configuration.`),
              },
              {
                title: tx('Probá el catálogo', 'Test the catalogue'),
                instruction: tx('Abrí un chat nuevo y pegá la prueba final.', 'Open a new chat and paste the final test.'),
              },
            ],
          },
          {
            id: 'prompt', label: tx('Vía Prompt', 'Via Prompt'),
            description: tx('Prompt universal para cualquier asistente de IA con soporte MCP.', 'Universal prompt for any AI assistant with MCP support.'),
            officialDocs: 'https://modelcontextprotocol.io/docs/getting-started/intro',
            steps: [
              common,
              promptConfigFile,
              {
                title: tx('Copiá el prompt universal', 'Copy the universal prompt'),
                instruction: tx('Copiá este prompt para que tu asistente se auto-configure.', 'Copy this prompt for your assistant to self-configure.'),
                prompt: this.securePrompt(),
                warning: tx('El asistente buscará y configurará la conexión de forma autónoma.', 'The assistant will locate and configure the connection autonomously.'),
              },
              {
                title: tx('Pegalo en el chat de tu IA', 'Paste it into your AI chat'),
                instruction: tx('Pegá este prompt en cualquier conversación con tu agente.', 'Paste this prompt into any conversation with your agent.'),
              },
              {
                title: tx('Probá el catálogo', 'Test the catalogue'),
                instruction: tx('Pedile que liste las skills para confirmar la conexión.', 'Ask it to list skills to confirm connection.'),
              },
            ],
          },
        ],
      },
    ];

    return providers.map((provider): Provider => ({
      ...provider,
      surfaces: provider.surfaces.map((surface): Surface => ({
        ...surface,
        steps: surface.steps.map((step) => step.prompt ? { ...step, prompt: this.securePrompt() } : step),
      })),
    }));
  });

  readonly provider = computed(() => this.providers().find((item) => item.id === this.selectedProvider())!);
  readonly surface = computed(() => this.provider().surfaces.find((item) => item.id === this.selectedSurface()) ?? this.provider().surfaces[0]);
  readonly step = computed(() => this.surface().steps[this.currentStep()]);
  readonly stepDetails = computed(() => this.step().detailsByOs?.[this.terminalOs()] ?? this.step().details ?? []);
  readonly progressPercent = computed(() => ((this.currentStep() + 1) / this.surface().steps.length) * 100);

  readonly displayCode = computed(() => {
    return this.step()?.code ?? '';
  });

  readonly displayPrompt = computed(() => {
    return this.step()?.prompt ? this.securePrompt() : '';
  });

  getProviderIconPath(id: ProviderId): string | null {
    switch (id) {
      case 'claude': return '/icons/claude.ico';
      case 'antigravity': return '/icons/antigravity.png';
      case 'codex': return '/icons/codex.png';
      case 'opencode': return '/icons/opencode.ico';
      case 'generic': return null;
    }
  }

  selectProvider(id: ProviderId): void {
    this.selectedProvider.set(id);
    if (id === 'generic') this.selectedSurface.set('prompt');
    this.currentStep.set(0);
  }

  selectSurface(id: SurfaceId): void {
    this.selectedSurface.set(id);
    this.currentStep.set(0);
  }

  goToStep(index: number): void {
    this.currentStep.set(index);
  }

  openStepsNavigator(): void {
    this.stepsNavigatorOpen.set(true);
  }

  closeStepsNavigator(): void {
    this.stepsNavigatorOpen.set(false);
  }

  selectStepFromNavigator(index: number): void {
    this.goToStep(index);
    this.closeStepsNavigator();
  }

  previous(): void {
    this.currentStep.update((step) => Math.max(0, step - 1));
  }

  next(): void {
    this.currentStep.update((step) => Math.min(this.surface().steps.length - 1, step + 1));
  }

  async copy(): Promise<void> {
    const code = this.displayCode();
    if (!code) return;
    await this.copyValue(code);
  }

  async copyPrompt(): Promise<void> {
    const prompt = this.displayPrompt();
    if (!prompt) return;
    await this.copyValue(prompt);
  }

  async copyValue(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1600);
    } catch {
      // Fallback
    }
  }

  openKeyModal(): void {
    this.keyModalOpen.set(true);
    this.keyError.set(null);
  }

  closeKeyModal(): void {
    this.keyModalOpen.set(false);
  }

  async generateKey(): Promise<void> {
    this.isGeneratingKey.set(true);
    this.keyError.set(null);
    try {
      const res = await firstValueFrom(
        this.api.post<{ created: string }>('/keys', { name: this.keyName().trim() || 'mi-notebook' })
      );
      this.generatedKey.set(res.created);
      this.activeKey.set(res.created);
      await this.copyValue(res.created);
    } catch (e) {
      this.keyError.set(apiError(e));
    } finally {
      this.isGeneratingKey.set(false);
    }
  }
}

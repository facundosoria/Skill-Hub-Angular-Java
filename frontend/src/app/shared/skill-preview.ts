import { Component, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/**
 * Puerto de src/components/skill-preview.tsx (decision 5).
 *
 * SEGURIDAD: sandbox SIN allow-same-origin. Es lo que impide que un preview
 * publicado por cualquiera de las 100 personas lea cookies, storage o el DOM de
 * la app. No agregar allow-same-origin bajo ningun concepto: junto con
 * allow-scripts desactiva el sandbox por completo.
 *
 * El srcdoc va con bypassSecurityTrustHtml porque el sandbox es la garantia, no
 * el saneo: React tampoco saneaba el srcDoc del original.
 */
@Component({
  selector: 'skill-preview',
  template: `
    <div class="relative min-h-[160px] overflow-hidden rounded-[var(--radius)] border border-border bg-white">
      <iframe
        title="Preview del skill"
        [srcdoc]="doc()"
        sandbox="allow-scripts"
        referrerpolicy="no-referrer"
        loading="lazy"
        (load)="loaded.set(true)"
        class="h-[220px] w-full border-0"
        [style.opacity]="loaded() ? 1 : 0"
        style="transition: opacity var(--dur) var(--ease)"
      ></iframe>
      @if (!loaded()) {
        <div class="absolute inset-0 animate-pulse bg-surface-2" aria-hidden="true"></div>
      }
    </div>
  `,
})
export class SkillPreview {
  private sanitizer = inject(DomSanitizer);
  html = input.required<string>();
  loaded = signal(false);

  doc = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{color-scheme:light}
  body{margin:0;padding:20px;font-family:ui-sans-serif,system-ui,sans-serif;background:#fff;color:#1a1a19}
  *{box-sizing:border-box}
</style></head><body>${this.html()}</body></html>`),
  );
}

# 0006. Sanitización de Markdown y sandbox del preview

- **Estado:** Aceptado
- **Fecha:** 2026-09-08

## Contexto

El cuerpo de cada skill es Markdown escrito por cualquiera de los ~100 usuarios
de la plataforma y se renderiza dentro de la SPA, que tiene la cookie de
sesión. Además, un skill puede incluir un bloque ` ```preview ` con HTML/JS que
debe ejecutarse para mostrar el componente descrito. Ambas cosas son vectores
de XSS si se confía en el contenido.

## Decisión

1. **El Markdown no se confía** (`frontend/src/app/shared/skill-markdown.ts`):
   `marked` (GFM) genera HTML que pasa siempre por `DOMPurify.sanitize` con
   `USE_PROFILES: { html: true }` (equivalente al `rehype-sanitize` del
   original) antes de `bypassSecurityTrustHtml`. El resaltado con Shiki se
   aplica después, reemplazando bloques ya saneados.
2. **El único HTML que se ejecuta es el bloque `preview`**, extraído del
   Markdown y renderizado en `<iframe sandbox="allow-scripts">` **sin
   `allow-same-origin`**, con `referrerpolicy="no-referrer"`
   (`frontend/src/app/shared/skill-preview.ts`). El sandbox es la garantía, no
   el saneo: el `srcdoc` no se sanea, igual que en el original.
3. **Regla dura:** nunca agregar `allow-same-origin`; junto con
   `allow-scripts` anula el sandbox y el preview podría leer cookies, storage y
   el DOM de la app.
4. Defensa en profundidad en Caddy (`frontend/Caddyfile`): CSP
   `default-src 'self'`, `script-src 'self'` más un único hash para el handler
   inline de Angular, `frame-ancestors 'none'`, `X-Frame-Options DENY`,
   `nosniff`.
5. [AGENTS.md](../../AGENTS.md) prohíbe cambiar la sanitización de Markdown o
   el sandbox del preview sin autorización explícita.

## Alternativas consideradas

- **Sanear también el `srcdoc` del preview:** no se hace; rompería el propósito
  del preview y el aislamiento real lo da el sandbox (comentario en
  `skill-preview.ts`).
- **Prohibir HTML ejecutable en skills:** *Razón no registrada — confirmar*;
  el preview es una funcionalidad heredada del original ("decisión 5" del plan
  original, no disponible en el repo).

## Consecuencias

- El preview funciona con scripts pero corre en un origen opaco: no puede usar
  storage, cookies ni llamar a la API con la sesión.
- La CSP con hash fijo debe actualizarse si Angular cambia el handler inline;
  si no, el stylesheet optimizado no se activa.
- Cualquier nuevo punto de render de Markdown (p. ej. `/docs`) debe reutilizar
  el mismo pipeline (`features/docs/docs.ts` lo hace).

## Referencias

- `frontend/src/app/shared/skill-markdown.ts`, `skill-preview.ts`,
  `frontend/src/app/features/docs/docs.ts`, `frontend/Caddyfile`.
- [README.md](../../README.md) — sección "markdown".
- Commits `213b1f4` (render de markdown), `ab58cf2` (Shiki).

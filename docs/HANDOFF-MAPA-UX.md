# Handoff — UX del tab Mapa (estado real al 2026-10-02)

Documento para continuar con otro agente desde cero. Todo lo que dice acá se verificó durante el trabajo: commits, despliegue y capturas.

## 1. Estado en una línea

Las 6 fases del plan (`docs/PLAN-MAPA-UX.md`) están **implementadas, verificadas en navegador y desplegadas** en https://skillhub.rcoleman.me, en la rama **`feat/mapa-ux`**, ya **publicada en `origin`** durante el cierre R1. El **PR hacia `master` sigue pendiente** porque el entorno no tiene GitHub CLI ni token (ver §5).

## 2. Repositorio

- Rama de trabajo: `feat/mapa-ux`, que sale de `master` en `95e1a28`. **Publicada en `origin/feat/mapa-ux`** en el cierre R1 (documentación incluida).
- Commits de la rama, del más viejo al más nuevo:

| Commit | Contenido |
|---|---|
| `c5269b1` | Ajuste a la altura en escritorio (offset medido, escala mínima 0,6 con histéresis), panel con un solo scroll, leyenda azul/naranja, contraste de nodos atenuados, aristas operables con teclado |
| `37b2790` | Docs: auditoría, plan y guía de Orca |
| `eb1b4f4` | La Matriz entra completa en escritorio (celda calculada por ancho y alto, 28–44 px) |
| `f4d5905` | Texto del mapa legible: nodos de 200×64, nombres de 16 y conteos de 13 unidades del viewBox, conteo `↑n ↓n` |
| `05dad19` | Fix: la Matriz se recalcula tras el layout final; la estimación de escala sigue el alto real de la leyenda |
| `d03cc19` | Botón "Importar/Exportar"; Esc; pestañas WAI-ARIA; i18n es/en; errores con `role=alert`; estado vacío de la Matriz |
| `a8e3187` | Fix: leyenda sin duplicados; posiciones de nodos acotadas al viewBox **solo al renderizar**; cadena de alto del SVG a través de los tabpanels |
| `e4b6c9b` | Zoom +/−/Ajustar, Ctrl+rueda, arrastrar para mover, "Ver mapa completo", aristas entrantes con línea discontinua |
| `4ff0c0d` | Fix: la barra de zoom ya no tapa nodos; foco de arista con halo; etiqueta "tu grupo" legible |
| `3bc649b` | Panel lateral plegable ("Detalle"), diálogos con `100dvh` y retorno de foco, botones × de 32 px; fix del selector "Mi grupo" desincronizado y de "your group" truncado |
| `4dc5c00` | Docs: plan actualizado |
| (este commit) | Docs: handoff de cierre y auditoría general; estado de push/PR |

- **Nota para el PR:** `origin/master` está en `b4ae949`, pero la rama sale del `master` **local** (`95e1a28`), que está **3 commits adelante** (`ddc4679`, `22871ea`, `95e1a28`; Hydra/OAuth/progress log). Un PR `feat/mapa-ux → master` incluiría esos 3 commits además de los 11 del Mapa. Decidir cómo sincronizar `master` antes de mergear; en R1 no se tocó `master`.

- Archivos de código tocados: `frontend/src/app/features/depmap/*` (incluye specs nuevos) y la sección `mapa` de `frontend/src/app/core/i18n/{es,en}.ts`. **No se tocó** backend, la base de datos, migraciones, el shell (`layout/shell.ts`) ni los estilos globales.
- Tests de depmap: 45 OK (`cd frontend && npm test -- --watch=false --include='src/app/features/depmap/**/*.spec.ts'`). `npm run build` OK; solo quedan los warnings de budget preexistentes de `skill-detail.ts` y `landing.css`.
- Working tree tras el cierre R1 (commit documental):
  - `docs/GUIA-ORQUESTACION-ORCA.md` sigue **modificado por el usuario y sin tocar**: no se incluyó en el commit documental.
  - `docs/AUDITORIA-UX.md` y este archivo (`docs/HANDOFF-MAPA-UX.md`) quedaron **commiteados** en el cierre R1.

## 3. Despliegue

- **skillhub.rcoleman.me** → túnel de Cloudflare → stack Docker **`skillhub-test`** en `127.0.0.1:18080`. **No** apunta al stack principal.
- Rebuild usado en cada fase: solo el servicio web, sin dependencias. El Dockerfile compila desde este checkout, incluso cambios no commiteados.
  ```bash
  docker compose -p skillhub-test --env-file /home/rcoleman/skillhub-test/.env \
    -f /home/rcoleman/Repos/Skill-Hub-Angular-Java/docker-compose.yml \
    -f /home/rcoleman/skillhub-test/docker-compose.override.yml build --no-cache web
  # mismo prefijo + `up -d --no-deps web`
  ```
- Último despliegue: el que incluye `3bc649b`, así que el sitio público tiene todo lo implementado. El backend, la base y Hydra no se reiniciaron en ningún momento.
- **Stack principal `skill-hub-angular-java` (`127.0.0.1:8087`): NO se rebuildeó** durante este trabajo; probablemente sirve una versión intermedia. Es un rebuild pendiente si se usa.
- ⚠️ Si se rebuildea `skillhub-test` desde `master`, se pierden los cambios. Primero hay que mergear `feat/mapa-ux`.

## 4. Comportamiento final del tab Mapa (escritorio, ≥1021 px de ancho)

- **Ajuste a la altura** (`.fit-height`): mapa y panel ocupan exactamente el alto de la ventana. Se activa solo si la escala real del SVG es ≥0,6 (umbral a 1440 de ancho: unos 830 px de alto). Por debajo, el mapa vuelve al flujo normal con scroll de página, a propósito, para que el texto siga legible.
- **Verificado sin scroll de página:** 1920×1080 y 1440×900, en español e inglés, con el panel desplegado o plegado.
- **Panel lateral:** un solo scroll interno. Se puede plegar con el botón "Detalle" de la toolbar; el estado se guarda en localStorage.
- **Matriz y Lista:** entran o scrollean dentro de su propio contenedor, sin cortes.
- **Grafo:**
  - Zoom con botones o Ctrl+rueda; la rueda sola sigue scrolleando la página.
  - "Ver mapa completo" quita la selección y no vuelve a elegir "Mi grupo" sola.
  - Direcciones distinguibles sin color: continua = "necesita de", discontinua = "lo necesitan".
  - Posiciones de nodos acotadas y separadas solo al renderizar; las posiciones guardadas en la base no cambian.
- **Accesibilidad e i18n:**
  - Aristas y nodos operables con teclado; foco con halo.
  - Pestañas WAI-ARIA con flechas y roving tabindex.
  - Esc limpia el par seleccionado o vuelve a "Mi grupo".
  - Textos en es/en; errores en `role=alert`.
- **Debajo de 1021 px de ancho** (tablet y celular): comportamiento original, sin cambios.

## 5. Pendiente

### Por implementar o corregir

| Prioridad | Ítem | Nota |
|---|---|---|
| Alta (de cierre) | PR de `feat/mapa-ux` → `master` | Push **hecho** en R1. PR **bloqueado**: no hay `gh`/`glab` ni token de GitHub en el entorno. Se puede abrir desde la web: `https://github.com/facundosoria/Skill-Hub-Angular-Java/compare/master...feat/mapa-ux` |
| Media | Rebuild del stack principal `:8087` | Solo si se usa |
| Media | **Vista celular**: MAP-01 (mapa cortado con scroll horizontal oculto), MAP-10 (navegación de 202 px fija arriba, afecta al shell global), MAP-11 en móvil (Matriz y Lista con scroll horizontal) | Postergado por decisión del usuario. Propuesta: abrir por defecto la Lista y mostrar solo el vecindario del grupo; "Ver completo" con pan/zoom |
| Baja | MAP-18 | Los hijos de depmap usan estilos locales en lugar de las primitivas de `shared/ui.ts`. Es un refactor y requiere aprobación |
| Baja | MAP-19 y MAP-20 | Coordinación del header sticky con el panel; overflow horizontal "fantasma" de `w-screen -translate-x-1/2` en `shell.ts`. Tocan el shell global y requieren aprobación |
| Baja | Botón "Detalle" | Su texto es algo más grande que el de los chips de la toolbar (cosmético) |
| Baja | Pantallas de ≤768 px de alto | El mapa vuelve a tener scroll de página. Se podría compactar más la cabecera solo en pantallas bajas |

### Documentación

- `docs/AUDITORIA-UX.md` (auditoría general del resto de las pantallas): se hizo sin la guía UX/UI porque no se encontró la skill. Existe en `~/.agents/skills/ui-ux-design-guide`, así que queda pendiente una segunda pasada con ella. La nota del documento ya está corregida.
- `docs/AUDITORIA-UX-MAPA.md`, sección 6: quedó **desactualizada** (por ejemplo, da MAP-08 como pendiente). La fuente de verdad del estado es `docs/PLAN-MAPA-UX.md` junto con este handoff.

### Seguridad

- **Cambiar la contraseña del usuario de prueba `coleman`.** Se pasó a los workers de QA por mensajes de Orca y queda en ese historial. Se verificó que no está en archivos, reportes ni commits. **No figura en este documento.**

## 6. Cómo se trabajó (para repetir el método)

- Orquestación con Orca (`orca orchestration`). Runs: `run_3364ab87cd42` (auditoría) y `run_35ae3a1387f2` (implementación). Guía de comandos: `docs/GUIA-ORQUESTACION-ORCA.md`.
- Agentes permitidos por el usuario: **Codex** y **opencode**. **Antigravity no.**
- Ciclo por fase:
  1. Un worker implementa y corre build + tests de depmap.
  2. **Otro** worker hace la QA en el navegador.
  3. Si pasa: rebuild de `web` en `skillhub-test`, verificación del dominio y commit solo de las rutas de la fase.
  4. Si falla: corrección y nueva QA.
- QA en el navegador:
  - Frontend del working tree con `cd frontend && npx ng serve --port 4300 --proxy-config <proxy.json>`. El proxy usado (crearlo fuera del repo):
    ```json
    { "/api": { "target": "http://127.0.0.1:18080", "secure": false, "changeOrigin": true,
                "headers": { "Origin": "http://127.0.0.1:18080" } } }
    ```
  - `agent-browser` (skill en `~/.agents/skills/agent-browser`) con el Chromium de Playwright del host (`~/.cache/ms-playwright`, build ~1243). Codex falla con "Chrome not found" si no se le indica.
  - Login: usuario `coleman`. La contraseña la da el usuario, nunca se escribe en archivos.
  - Al terminar, restaurar las preferencias de prueba: idioma español, "Mi grupo" = Usuarios, panel desplegado.
- Lecciones de esta corrida:
  - Las QA aprobaron varias veces defectos visibles en las capturas: barra de zoom tapando nodos, etiqueta truncada, leyenda duplicada, recorte del SVG. **Exigir inspección visual de cada captura** y criterios explícitos (nodos dentro del rect visible de `.workspace-card`, no solo "scroll de página 0").
  - Un worker creó una migración Flyway sin permiso (revertida antes de aplicarse). Prohibir explícitamente backend/DB en cada spec.
  - opencode se queda esperando un permiso en su propia interfaz ("Access external directory") si escribe fuera del repo. Se destraba con `orca terminal send --terminal <handle> --enter`.
  - Los workers corren en terminales de **segundo plano** (`surface: background`), no como pestañas visibles. Su rastro queda en `~/.codex/sessions/` y en `~/.local/share/opencode/opencode.db`.

## 7. Referencias

- Auditoría original: `docs/AUDITORIA-UX-MAPA.md` (hallazgos MAP-01 a MAP-20) y capturas en `docs/auditoria-mapa/`.
- Plan y estados por fase: `docs/PLAN-MAPA-UX.md`.
- Reglas del repo: `AGENTS.md` (alcance estricto; sin migraciones, autenticación ni dependencias sin autorización; validar con `npm run build` y tests).
- Los reportes y capturas de cada worker quedaron en el scratchpad temporal de la sesión anterior y **pueden no persistir**. Lo relevante está resumido acá.

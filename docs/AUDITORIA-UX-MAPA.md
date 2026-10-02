# Auditoría UX/UI — Tab "Mapa" (`/mapa`, Skill Hub)

Fecha: 2026-10-01 · Commit auditado: `95e1a28` (`master`) · Alcance: **solo** el tab Mapa.

**Método.** Orquestación Orca (`run_3364ab87cd42`) con 4 workers y validación cruzada del orquestador:

| Worker | Agente | Tipo | Reporte |
|---|---|---|---|
| W1 | Codex | Auditoría estática del código (layout, CSS, overflow, a11y) | 14 hallazgos `M-S-*` |
| V1 | Codex | Verificación independiente de W1 contra el código | 11 confirmados, 3 parciales, 7 omitidos `M-V-*` |
| W2 | Antigravity | Auditoría runtime con Chromium headless (`agent-browser`), 5 viewports × claro/oscuro, 36 capturas | 7 hallazgos `M-R-01..07` |
| V2 | Antigravity | Verificación runtime de seguimiento: pliegue en estado inicial real, discrepancias, entorno | 5 hallazgos `M-R-08..12` + correcciones a W2 |

**Marco.** `ui-ux-design-guide` (heurísticas de Jakob, carga cognitiva, mobile-first, accesibilidad, tipografía), `web-design-reviewer` (overflow, responsive, touch targets, contraste), `frontend-design` y `web-design-system` (Norman). WCAG 2.x se usa como suplemento.

**Entorno runtime.** Stack `skillhub-test` (Docker Compose) en `http://127.0.0.1:18080/mapa`, sesión autenticada. Dataset: 13 grupos y 39 dependencias visibles en el estado inicial. La sesión fue de solo lectura: no se modificó código, configuración ni base de datos, y V2 confirmó que los 4 contenedores siguen `healthy`.

**Qué es el "tab Mapa".** Son dos niveles a la vez:
- La entrada de navegación del shell, que lleva a la ruta `/mapa` (`app.routes.ts:142-144`, `shell.ts:221-226`).
- La subpestaña **Mapa**, que convive con **Matriz** y **Lista** dentro de `DepMap` (`dep-map.ts:37-38,109-110`).

La auditoría se centra en la vista Mapa y en todo lo que comparte la ruta (cabecera, toolbar y panel lateral). Matriz y Lista solo se tratan en lo que afecta al scroll.

**Arquitectura relevante.**
- `DepMap` (`features/depmap/dep-map.ts`) es el componente padre.
- Los hijos son `DepMapGraph` (un **SVG propio** con `viewBox="0 0 1000 745"`, sin D3, Cytoscape ni canvas), `DepMapMatrix`, `DepMapList` y `DepMapPanel`.
- El estado se guarda en `DepMapStore`, con sincronización SSE y presencia.
- No hay zoom, pan, fit-to-view ni `ResizeObserver`.

---

## 1. Resumen ejecutivo

El mapa tiene **buenas bases conceptuales**:
- Vistas alternativas Mapa/Matriz/Lista.
- Foco y contexto al seleccionar.
- Filtros por estado y por tipo.
- Presencia en vivo y modo offline.
- Nodos operables por teclado.

Sin embargo, **no cumple el objetivo de "mapas y gráficos sin scroll"** en ningún viewport habitual, y tiene **defectos visuales y de accesibilidad verificados en ejecución**.

**Los 5 problemas más importantes:**

1. **El mapa no entra en la pantalla.** Antes del primer nodo hay ~400 px de cromo (header, título, subtítulo, fila de acciones y toolbar). En un portátil de 1366×768 queda oculto el **31 % del mapa**, y en móvil (390×844) solo se ve el **4,9 %** sin scrollear.
2. **Hay scroll anidado en varios contenedores.**
   - En móvil, el SVG tiene `min-width:720px` dentro de una tarjeta `overflow-auto`, lo que deja el **50,8 % del grafo recortado** con scroll horizontal interno y sin ninguna señal de que existe.
   - En escritorio, el panel lateral tiene **doble scroll vertical** (+306 px interno y +358 px de página al mismo tiempo).
3. **La leyenda está rota.** Los ejemplos de "necesita de" (azul) y "lo necesitan" (naranja) se ven **grises e iguales** por un bug de especificidad CSS, así que la clave de color del gráfico no se puede leer.
4. **El contraste es insuficiente.** El texto de los nodos atenuados queda en **2,20:1 (claro)** y **2,97:1 (oscuro)**, cuando el mínimo AA es 4,5:1. El texto de conteo es de 9,5 px en el `viewBox`, que en pantalla equivale a **~6,8 px reales**.
5. **Las aristas no se pueden usar con teclado.** Son el núcleo del detalle de cada dependencia: se pueden clicar pero no enfocar, y el SVG raíz es `role="img"` aunque contiene botones.

**Puntuación consolidada (1–10)**

| Dimensión | W1 (estático) | W2 (runtime) | **Consolidada** | Justificación |
|---|---:|---:|---:|---|
| Layout / distribución | 7 | 7 | **5** | La grilla de 2 columnas es clara, pero el cromo superior consume entre el 37 % y el 52 % del alto. El ancho queda desaprovechado en 1920. El header móvil mide 202 px y es sticky. |
| Scroll | 3 | 6 | **3** | Hay scroll de página en los 5 viewports, scroll horizontal oculto en móvil, doble scroll en el aside y wrappers `overflow:auto` en Matriz y Lista. |
| Usabilidad | 7 | 7 | **6** | Las vistas, los filtros y el foco/contexto son buenos. Le restan la falta de zoom/fit, el "spaghetti" inicial, la etiqueta "Datos" ambigua y los errores silenciosos. |
| Accesibilidad | 5 | 6 | **4** | Las aristas no son operables por teclado, hay conflicto con `role=img`, los nodos atenuados tienen contraste 2,2:1, el texto real mide 6,8 px, las tabs no responden a las flechas, Esc no hace nada y la i18n es parcial. |
| Visualización | 6 | 8 | **5** | La geometría y las flechas son correctas. La leyenda es ilegible (bug) y la densidad inicial es alta. |
| Consistencia | 6 | 9 | **6** | Usa tokens y primitivas compartidas, pero tiene textos en español hardcodeados, estilos locales en los hijos y la colisión "Datos" vs "Datos". |
| **Global** | | | **≈ 4,8 / 10** | |

> W2 subestimó Scroll, Visualización y Consistencia porque no detectó el bug de la leyenda, el doble scroll del aside ni el corte bajo el pliegue. V2 corrigió esas mediciones.

---

## 2. Scroll y distribución medidos en runtime (estado inicial real)

Mediciones de V2 con recarga limpia y sin ninguna arista seleccionada. Valores en px y con `scrollY = 0`.

| Viewport | Header shell | Toolbar termina en | SVG top → bottom (alto) | % del SVG visible | SVG bajo el pliegue | Scroll de página | Scroll interno | Aside |
|---|---|---:|---|---:|---:|---:|---|---|
| 1920×1080 | 62, sticky | 340 | 400 → 935 (536) | 99,8 % | 0 | +358 | aside +126 | 340→1396; +316 bajo el pliegue, con scroll interno |
| 1440×900 | 62, sticky | 340 | 400 → 935 (536) | 93,3 % | 35 | +80 | aside (según contenido) | 340→1216; +316 bajo el pliegue |
| 1366×768 | 62, sticky | 340 | 400 → 935 (536) | **68,7 %** | **167** | +212 | aside | 340→1084; +316 bajo el pliegue |
| 768×1024 | 137, sticky | 452 | 512 → 1033 (522) | 98,1 % | 9 | +247 | — | apilado; 100 % bajo el pliegue |
| 390×844 | **202, sticky** | 696 | 818 → 1354 (536) | **4,9 %** | **510** | +754 | **tarjeta: X +370 px (50,8 % del SVG recortado)** | apilado; 100 % bajo el pliegue |

**Con un grupo denso seleccionado (1440×900, "Notificaciones")**, el aside mide `clientHeight` 876 y `scrollHeight` 1182, lo que da **+306 px de scroll interno**. El documento mide 1258 px, es decir **+358 px de scroll de página**. Los dos scrolls verticales están anidados.

**Interacciones medidas:**
- La rueda sobre el SVG desplaza la página: no hay zoom ni se atrapa el scroll, lo cual está bien.
- No hay pan.
- Esc no deselecciona.
- Las flechas no navegan el `tablist`.
- La consola queda sin errores en todas las transiciones.

**Distribución vertical (1440×900).** El header ocupa 62 px, el título y el subtítulo 84, la fila de estado/grupo/acciones 62, la toolbar de vistas y filtros 61, y la leyenda 60. **El mapa empieza en y=400, el 44 % del alto del viewport.** La cabecera del módulo y la toolbar ocupan en dos filas lo que cabría en una.

Capturas de referencia en `docs/auditoria-mapa/`:
- `v2-1366x768-inicial.png`: corte bajo el pliegue.
- `v2-390x844-inicial.png` y `v2-390-scrolled-map.png`: header sticky de 202 px y mapa recortado.
- `v2-1920x1080-inicial.png`: ancho desaprovechado.
- `1920x1080-claro-selected-viewport.png`: leyenda gris y aside largo.

### Fuentes de scroll (causa raíz → fix propuesto)

| # | Contenedor | Causa (código) | Efecto | Fix propuesto (no aplicado) |
|---|---|---|---|---|
| S1 | Tarjeta del mapa + SVG | `dep-map.ts:48` `max-[760px]:overflow-auto`; `dep-map-graph.ts:87` `@media (max-width:760px){ svg.map{min-width:720px} }` | Scroll horizontal oculto en móvil, con el 50,8 % del grafo fuera de vista | Quitar `min-width` y `overflow-auto`, y tratar móvil con la estrategia de §4.3 |
| S2 | Aside | `dep-map.ts:52` `sticky top-3 max-h-[calc(100vh-24px)] overflow-auto` | El alto máximo ignora que el aside empieza en y=340, lo que provoca doble scroll | Fijar la altura a la misma cota que el mapa (§4.1), con un único scroller interno |
| S3 | Página (cromo) | `shell.ts:167` `main py-10` + cabecera del módulo en 3 filas (`dep-map.ts:20-44`) | ~400 px de cromo antes del mapa | Compactar la cabecera **solo en `/mapa`** (§4.1) |
| S4 | Matriz | `dep-map-matrix.ts:41-43` `.tablewrap{overflow:auto}`, `.mx{min-width:820px}` | Scroll horizontal en 768 y 390; doble anidado en 390 por S1 | Un único wrapper `overflow-x:auto; overflow-y:visible` con indicador, o una lista de pares en móvil |
| S5 | Lista | `dep-map-list.ts:26` `.tablewrap{overflow:auto}` sin breakpoint | Scroll interno dependiente de los datos | Solo `overflow-x` y `overflow-wrap:anywhere` en la columna "Qué"; tarjetas apiladas en móvil |
| S6 | Diálogos | `dep-map.ts:83-84` `max-height:90vh; overflow:auto`; JSON `min-height:260px` | Scroll modal aceptable, pero con todo el diálogo desplazable | `max-height:calc(100dvh - 2rem)`, con scroll solo en el cuerpo y acciones fijas |
| S7 | Shell | `shell.ts:38` `min-h-screen` (100vh) vs `styles.css:130` `100dvh` | Discrepancia con las barras del navegador móvil | Alinear en `dvh` (afecta al shell global y requiere aprobación) |
| S8 | Header shell | `shell.ts:43` banda decorativa `w-screen -translate-x-1/2` | Overflow "fantasma" en X de hasta 348 px en el contenedor interno, sin scroll visible de página | Bajo riesgo; conviene revisarlo solo si aparecen saltos al enfocar |

---

## 3. Hallazgos consolidados

Severidades ajustadas tras la verificación cruzada. Las referencias `file:line` son relativas a `frontend/src/app/`.

### Alta

| ID | Categoría | Hallazgo | Evidencia | Principio | Fuente |
|---|---|---|---|---|---|
| **MAP-01** | Scroll / Mobile | En ≤760 px el SVG mantiene un mínimo de 720 px dentro de una tarjeta con `overflow:auto`. El 50,8 % del grafo queda recortado, con scroll horizontal interno y sin ninguna pista visual. | `depmap/dep-map.ts:48`, `depmap/dep-map-graph.ts:87`. Runtime: `clientWidth` 358 vs `scrollWidth` 728 | Mobile-first: evitar trampas de scroll anidado. WDR: Element overflow | M-S-01, M-S-06, M-R-02 (confirmado ×3) |
| **MAP-02** | Layout / Pliegue | El mapa no cabe en el viewport: hay ~400 px de cromo antes del SVG. En 1366×768 queda oculto el 31 % y en 390×844 el 95 %. | Tabla §2. `layout/shell.ts:167` `py-10`; `depmap/dep-map.ts:20-44` (cabecera en 3 filas) | Carga cognitiva: jerarquía above the fold. Objetivo explícito "sin scroll" | M-R-12, observación del orquestador, V2 |
| **MAP-03** | Scroll | El aside tiene doble scroll vertical: `max-height:calc(100vh-24px)` empieza en y=340, así que desborda la página 316 px **y** además scrollea por dentro. | `depmap/dep-map.ts:52`. Runtime: +306 interno y +358 de página | WDR: nested scroll. Jakob #3 (control) | M-S-02, V2-e |
| **MAP-04** | Visualización | **Leyenda rota:** los swatches de "necesita de" y "lo necesitan" se ven grises (`rgb(107,105,96)`) en lugar de azul y naranja. `.legend i{border-top:3px solid}` (especificidad 0,1,1) le gana a `.legend-out{border-color:…}` (0,1,0). | `depmap/dep-map-graph.ts:70-72`. Runtime con estilos computados; visible en `1920x1080-claro-selected-viewport.png` | Jakob #1 y #4. Codificación de visualización | M-R-08 (V2), confirmado visualmente |
| **MAP-05** | A11y / Contraste | Los nodos atenuados (`.node.dim{opacity:.35}`) aplican la opacidad también al texto: queda en 2,20:1 (claro) y 2,97:1 (oscuro), cuando lo exigido es 4,5:1. Siguen siendo interactivos, así que la norma aplica. | `depmap/dep-map-graph.ts:77` | WCAG 1.4.3. UI/UX Guide: accesibilidad | M-R-10, M-V-07 |
| **MAP-06** | A11y / Teclado | Las aristas se pueden clicar (`<g class="edge" (click)>`) pero no tienen `tabindex`, rol ni `keydown`. El detalle de una dependencia es inalcanzable sin mouse. El SVG raíz es `role="img"` y contiene nodos `role="button"`, una semántica que se contradice. La información de cada arista existe solo como `<title>`. | `depmap/dep-map-graph.ts:22,41-44,58-63,81` | WCAG 2.1.1 y 4.1.2. Norman: affordances | M-S-07, M-S-08, M-V-04, M-V-05, M-R-04 |

### Media

| ID | Categoría | Hallazgo | Evidencia | Fuente |
|---|---|---|---|---|
| **MAP-07** | UX / Visualización | No hay zoom, pan ni fit, y el estado inicial muestra todas las curvas al 70 % de opacidad, un efecto de "telaraña" de alta carga cognitiva. Escala mal con más grupos. | `depmap/dep-map-graph.ts:22-65`, `depmap/dep-map-geometry.ts:27-68`. Runtime: `zoomControls: []` | M-S-11, M-R-03, M-R-07 |
| **MAP-08** | Legibilidad | El texto de conteo es de 9,5 px en el `viewBox` de 1000, que en pantalla (escala 0,719) equivale a **~6,8 px**. Las etiquetas de 14 px quedan en ~10 px. Si se hiciera fluido en móvil, bajarían a ~4,8 px. | `depmap/dep-map-graph.ts:78-79` | M-R-05, M-V-03 (subido de Baja a Media: es información funcional) |
| **MAP-09** | Layout | En 1920 el contenedor está limitado a `max-w-6xl` (1224 px, con raíz de 17 px). El SVG ocupa el 18,6 % del área y el 37 % del ancho. | `layout/shell.ts:38` | M-R-01 |
| **MAP-10** | Layout / Mobile | En 390 px la navegación del shell ocupa 4 líneas (202 px) y es sticky: consume el 23,9 % del viewport al recorrer el mapa. | `layout/shell.ts:38-44`; `v2-390-scrolled-map.png` | M-R-09 (**afecta al shell global**) |
| **MAP-11** | Scroll | Matriz con `min-width:820px` + `overflow:auto`, y Lista con `overflow:auto` sin breakpoint: wrappers de scroll propios dentro de la tarjeta. | `depmap/dep-map-matrix.ts:41-43`, `depmap/dep-map-list.ts:26-31` | M-S-03, M-S-04 |
| **MAP-12** | Feedback | `store.error()` nunca se renderiza. `setDone` traga el error con `catch(() => undefined)`, así que al tildar "hecho" un fallo no avisa nada y el estado puede quedar desincronizado. Matriz no tiene estado vacío. | `depmap/dep-map-store.ts:83-84`, `depmap/dep-map-panel.ts:97`, `depmap/dep-map.ts:32-34,49-50,74` | M-S-12, M-V-06 |
| **MAP-13** | UX / Copy | Ambigüedad de etiquetas: el botón **"Datos"** abre el diálogo de gestión JSON y el chip **"Datos"** filtra aristas de tipo datos. Los dos están a menos de 100 px. | `depmap/dep-map.ts:27`, `depmap/dep-map.ts:44` | M-R-11 |
| **MAP-14** | A11y / Teclado / i18n | El `tablist` no responde a ←/→ ni declara `aria-controls`. Esc no deselecciona. Las etiquetas de las tabs, la leyenda, el panel y la lista están hardcodeadas en español aunque existe el locale `en`. | `depmap/dep-map.ts:37-44,109-114`, `depmap/dep-map-graph.ts:15-20,48-50`, `depmap/dep-map-panel.ts:13-35` | M-S-09 (parcial), M-R-04 |
| **MAP-15** | A11y / Color | La dirección se codifica sobre todo con azul y naranja en el SVG. Hay texto y `dasharray` para las transversales, pero falta redundancia en las propias líneas, y MAP-04 la anula en la leyenda. | `depmap/dep-map-graph.ts:15-19,78-84` | M-S-10 (parcial) |

### Baja

| ID | Hallazgo | Evidencia | Fuente |
|---|---|---|---|
| **MAP-16** | Los diálogos usan `90vh` con scroll completo y no restauran el foco explícitamente (`showModal()` nativo). | `depmap/dep-map.ts:55-73,83-84` | M-S-05, M-V-02 |
| **MAP-17** | El botón eliminar es "×" de 18 px con `padding:2px`, oculto hasta hover (visible en touch). El cierre de los diálogos también es "×". | `depmap/dep-map-panel.ts:41,62-67,73` | M-S-13 (parcial) |
| **MAP-18** | Los hijos usan estilos locales en lugar de las primitivas de `shared/ui.ts`, con riesgo de divergencia en foco y espaciado. | `depmap/dep-map-graph.ts:68-88`, `depmap/dep-map-panel.ts:55-73` | M-S-14 |
| **MAP-19** | El header sticky `z-30` y el aside `sticky top-3` no tienen coordinación de offset y z-index: el aside se pega a 12 px, debajo de un header de 62 px. | `layout/shell.ts:40-43`, `depmap/dep-map.ts:52` | M-V-01 (requiere validación visual) |
| **MAP-20** | Overflow fantasma en X por `w-screen -translate-x-1/2` en el shell, y `100vh` vs `100dvh`. | `layout/shell.ts:38,43`, `styles.css:130` | M-R-06, W1 S6 |

### Lo bueno (a conservar)

- **Modelo conceptual explícito:** el texto junto al gráfico explica que la flecha apunta hacia quien provee y que se ven ambos sentidos (`dep-map-graph.ts:11-20`).
- **Tres representaciones** (Mapa, Matriz y Lista) para distintas tareas; Lista funciona como alternativa textual.
- **Foco y contexto:** al seleccionar se atenúa lo no relacionado. Es elegante, aunque hay que corregir el contraste (MAP-05).
- **Nodos accesibles:** `tabindex=0`, `role=button`, `aria-label`, Enter/Espacio y anillo de foco visible.
- **Estado del sistema visible:** píldora "En vivo · N en línea" por SSE, banner offline que bloquea mutaciones, toast de guardado.
- **Colores direccionales** con contraste AA en los dos temas (5,26–8,12:1) y soporte de `prefers-reduced-motion`.
- La rueda **no** se secuestra: la página scrollea con naturalidad. Lazy loading, `OnPush` y consola sin errores.

---

## 4. Recomendaciones (orden sugerido)

Respetan `AGENTS.md`: los cambios son locales a `features/depmap` salvo los marcados como **[shell global]**, que requieren aprobación explícita.

### 4.1 Objetivo de layout "sin scroll" en escritorio (≥1024×700). Resuelve MAP-02, MAP-03 y MAP-09

1. **Compactar la cabecera del módulo a una sola fila.** Título + grupo + estado a la izquierda, "Datos" y "Agregar dependencia" a la derecha. El subtítulo pasa a ser una línea corta o un tooltip "¿Cómo se lee?". Vistas, búsqueda, estado y chips van en una segunda fila. Objetivo: el mapa empieza en y≈200 en lugar de 400.
2. **Ajustar el área de trabajo a la altura disponible**, no al ancho: `grid` con `height: calc(100dvh - <offset medido>)` y `min-height: 0` en los hijos. El SVG llena la tarjeta con `width:100%; height:100%` y `preserveAspectRatio="xMidYMid meet"`, que ya es el valor por defecto con `viewBox`.
3. **Aside con la misma altura que el mapa** y **un único** scroller interno, aceptado y señalizado. Quitar `sticky` + `calc(100vh-24px)`.
4. **Ancho:** permitir más ancho en `/mapa` (por ejemplo, un contenedor más ancho solo en esta ruta) o un botón para plegar el aside. Una alternativa al cambio de `max-w-6xl` es **[shell global]**.

### 4.2 Quick wins (bajo riesgo, locales)

- **MAP-04:** `.legend i.legend-out{border-top-color:var(--dep-out)}` y `.legend i.legend-in{border-top-color:var(--dep-in)}`.
- **MAP-05:** atenuar solo el `rect`/borde y las aristas. El texto del nodo atenuado debe quedar en ≥4,5:1.
- **MAP-08:** conteo ≥13 px y nombre ≥16 px en unidades del `viewBox`, que equivalen a unos 9,5 y 11,5 px reales a 719 px. Otra opción es reemplazar el texto de conteo por badges numéricos.
- **MAP-13:** renombrar el botón a "Importar/Exportar" o "JSON" y dejar "Datos" solo para el filtro.
- **MAP-14:** Esc para limpiar la selección y ←/→ en el `tablist` siguiendo el patrón WAI-ARIA Tabs, más `aria-controls`.
- **MAP-12:** región `role="alert"` para `store.error()` y feedback y rollback en `setDone`.

### 4.3 Móvil (≤760 px). Resuelve MAP-01, MAP-10 y MAP-11

Abrir por defecto la vista **Lista**, que es naturalmente apilable. Si se elige Mapa:
- El SVG se ajusta al ancho (sin `min-width`), con etiquetas escaladas a ≥12 px reales.
- Se muestra **solo el vecindario del grupo seleccionado** (progressive disclosure).
- Hay un botón "Ver completo" que abre el grafo en pantalla completa con pan/zoom táctil explícito.

Nunca usar un scroll horizontal oculto. Header móvil colapsable o hamburguesa de ≤56 px **[shell global]**.

### 4.4 Interacción con el grafo. Resuelve MAP-06, MAP-07 y MAP-15

- Aristas focusables (`tabindex=0`, `role=button`, `aria-label` "A necesita de B: N pedidos"), con Enter/Espacio.
- SVG raíz con `role="group"` en lugar de `img`.
- Controles visibles **+ / − / Ajustar**. Zoom solo con Ctrl+rueda o con los botones, para no romper el scroll de página.
- Estado inicial centrado en "Mi grupo" y su vecindario, con el resto atenuado y un control "Ver mapa completo".
- Redundancia no cromática: patrón distinto por sentido o puntas de flecha diferenciadas.

### 4.5 Validaciones pendientes antes o después de implementar

- Lector de pantalla real (NVDA/VoiceOver) sobre nodos, tabs y `role=img`.
- Dispositivos físicos: pinch/touch, teclado virtual en los diálogos.
- Dataset máximo esperado (más de 13 grupos) para el solapamiento de etiquetas.
- Simulación de daltonismo para los strokes finos.
- Locale `en` en `/mapa`.
- Zoom de texto al 200 %.

---

## 5. Limitaciones y trazabilidad

- El runtime se probó en Chromium headless (ARM64) con emulación de viewport, sin dispositivos reales, sin lector de pantalla y sin usuarios. Las puntuaciones son juicio heurístico.
- Correcciones aplicadas durante la validación:
  - Las capturas "default" de W2 tenían una arista seleccionada que arrastraba el estado del script. V2 rehízo las mediciones con recarga limpia.
  - La diferencia de ancho entre W1 (668 px) y W2 (719 px) se explica porque la raíz es de 17 px y no de 16.
  - El aside sí tiene scroll interno con grupos densos.
  - La mención de W2 a una "caída de servidor" se refería a un registro histórico de `PROGRESO-MAPA-DEPENDENCIAS.md`. No se detuvo ningún servicio.
- Reportes completos de los workers (W1, V1, W2, V2) y las 42 capturas: scratchpad de la sesión (temporal). En `docs/auditoria-mapa/` se conserva una selección de 9 capturas.
- La auditoría no modificó código. Este documento y `docs/auditoria-mapa/` son los únicos archivos nuevos.

---

## 6. Estado de implementación (2026-10-02, cambios sin commitear)

Implementado por workers Codex (I1–I3) y verificado en runtime por Antigravity (V3, V4) sobre `ng serve` con proxy al stack de prueba. Run `run_35ae3a1387f2`. Archivos tocados: `dep-map.ts`, `dep-map-graph.ts`, `dep-map-matrix.ts` y `dep-map-list.ts` (+73/−12). Build OK y tests de depmap 11/11 OK.

| ID | Estado | Evidencia runtime (V4) |
|---|---|---|
| MAP-02 | ✅ Sin scroll de página en escritorio | 0 px en 1920×1080, 1440×900, 1366×768, 1280×720, 1100×800 y 1024×768; el offset se mide en runtime y se recalcula al redimensionar. Con alto menor a 700 px vuelve al flujo normal. |
| MAP-03 | ✅ El panel tiene un único scroll interno | Con "Notificaciones": +1782 px internos y 0 px de página |
| MAP-04 | ✅ Leyenda azul y naranja | Colores computados `#1f5fe0` / `#b8490a` (claro) y `#6fa0ff` / `#ff9a52` (oscuro) |
| MAP-05 | ✅ Texto de nodos atenuados ≥4,5:1 | 17,42:1 (claro) y 14,98:1 (oscuro) |
| MAP-06 | ✅ Aristas operables por teclado | 32 aristas con `tabindex`, `role=button`, `aria-label`, Enter/Espacio y foco visible; el SVG pasó a `role=group` |
| Regresión D-03 (Matriz/Lista recortadas) | ✅ Corregida en I3 | Un único scroll interno hasta la última fila |

**Costo pendiente (nuevo riesgo, relacionado con MAP-08).** Al ajustar el SVG a la altura, la escala baja en pantallas bajas: en 1366×768 queda en 0,53 (nombres a 7,4 px, conteos a 5,1 px), y en 1024×768 en 0,30 (4,1 px y 2,8 px), lo que la vuelve **ilegible**. Hace falta definir una escala mínima o agrandar el texto del `viewBox` antes de dar MAP-02 por cerrado.

### 6.1 Escala mínima del ajuste a la altura (I4 + I5, verificado en V6 con Codex)

Para evitar texto ilegible, el modo ajustado (`.fit-height`) solo se activa si la escala estimada del SVG es ≥ `MIN_MAP_SCALE = 0.6`, con histéresis de salida en 0,58. La estimación es predictiva: no depende del scroll ni de la vista activa, y descuenta el padding inferior del shell.

| Viewport | Modo | Escala real | Nombres / conteos | Scroll de página |
|---|---|---:|---:|---:|
| 1920×1080 | ajustado | 0,719 | 10,1 / 6,8 px | 0 |
| 1440×900 | ajustado | 0,719 | 10,1 / 6,8 px | 0 |
| 1440×816 (umbral) | ajustado | 0,610 | 8,5 / 5,8 px | 0 |
| 1366×768 | normal | 0,719 | 10,1 / 6,8 px | sí (flujo normal) |
| 1100×800 / 1024×768 | normal (el ancho es el límite) | 0,595 / 0,519 | 8,3 / 7,3 px | sí |

Además se verificó en runtime:
- Al redimensionar en caliente no hay oscilación.
- El caso con la página scrolleada da la misma decisión que una recarga limpia.
- Mapa, Matriz y Lista conservan la decisión al alternar.
- MAP-03 a MAP-06 siguen pasando y la consola queda sin errores.

Diff total sin commitear: 5 archivos de `features/depmap` (+178/−14), incluido `dep-map.spec.ts` (tests de las funciones puras). Tests de depmap 15/15 OK y build OK.

**Pendiente:** el texto del mapa sigue siendo chico incluso a escala natural (conteos de 6,8 px). Para mejorarlo hace falta MAP-08 (agrandar las fuentes dentro del `viewBox`).

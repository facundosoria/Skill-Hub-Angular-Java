# Plan de ejecución — UX del tab Mapa

Origen: `docs/AUDITORIA-UX-MAPA.md`. Fuera de alcance por decisión del usuario: vista celular (MAP-01, MAP-10, MAP-11 en móvil).

## Ciclo por fase

1. **Implementar.** Worker Codex que solo edita `frontend/src/app/features/depmap/*` (e i18n si la fase lo indica) y corre build + tests de depmap.
2. **QA + release.** Otro worker Codex, independiente del que implementó:
   - Verifica en el navegador (`ng serve` + proxy al stack de prueba) con criterios medibles.
   - Si **pasa**: rebuild de `web` en `skillhub-test` (`--no-deps`), comprobación de que skillhub.rcoleman.me sirve el código nuevo y commit de la fase.
   - Si **falla**: no hay deploy ni commit; se vuelve al paso 1 con los defectos encontrados.
3. El orquestador valida la evidencia (reportes y capturas) y actualiza este documento.

**Commits:** rama `feat/mapa-ux`, un commit por fase. Push solo si el usuario lo pide.

## Fases

| # | Fase | Hallazgos | Criterio de aceptación | Estado |
|---|---|---|---|---|
| 0 | Commit de lo ya hecho | MAP-02..06 + escala mínima | Rama `feat/mapa-ux` con los cambios actuales de depmap y la auditoría | ✅ `c5269b1`, `37b2790` |
| 1 | Matriz completa en escritorio | MAP-11 (escritorio) | En 1920×1080, 1440×900 y 1366×768 la Matriz muestra todas las filas y columnas sin scroll, con celdas ≥28 px. Si no entra, scroll con indicador visible de "hay más contenido" | ✅ `eb1b4f4` (QA 2.ª ronda; desplegado) |
| 2 | Texto del mapa legible | MAP-08 | Nombres ≥11 px y conteos ≥9 px reales a escala natural (0,72). Sin solapamientos ni recortes de nodos | ✅ `f4d5905` (QA 2.ª ronda; desplegado). F2c ✅ `05dad19`: Matriz recalculada tras el layout final; umbral real 0,604 a 1440×832 |
| 3 | Copy, teclado, i18n y errores | MAP-13, MAP-14, MAP-12 | El botón "Datos" se renombra a "Importar/Exportar". Esc deselecciona. ←/→ funcionan en las pestañas, con `aria-controls`. Los textos del mapa usan i18n es/en. Los errores del store y de "hecho" se muestran con `role=alert` | ✅ `d03cc19` + `a8e3187` (correcciones: leyenda duplicada, nodos acotados al dibujo solo en render, cadena de alto del SVG); desplegado |
| 4 | Exploración del grafo | MAP-07, MAP-15 | Botones +, − y Ajustar (zoom solo con botones o Ctrl+rueda; la rueda sola sigue scrolleando la página). Vista inicial centrada en "Mi grupo" con un control "Ver mapa completo". Dirección de las flechas distinguible sin color | ✅ `e4b6c9b` + `4ff0c0d` (correcciones: la barra ya no tapa nodos, foco de arista con halo, "tu grupo" legible); desplegado |
| 5 | Ancho y detalles locales | MAP-09 (botón para plegar el panel), MAP-16, MAP-17 | Panel plegable que ensancha el mapa. Diálogos con `100dvh`, cuerpo scrolleable y foco restaurado. Botones "×" con área ≥32 px | ✅ `3bc649b` (4 rondas de QA: botones × de 32 px, botón "Detalle" en la toolbar, ajuste a la altura al plegar el panel; corrige también el selector "Mi grupo" desincronizado y la etiqueta "your group" truncada); desplegado |

**No incluidos** porque tocan el shell global o implican un refactor no pedido: MAP-18, MAP-19, MAP-20 y la vista celular. Requieren decisión aparte.


## Cierre (2026-10-02)

Las 6 fases (0–5) están completas, verificadas en navegador y desplegadas en skillhub.rcoleman.me, en la rama `feat/mapa-ux` (sin push). Commits: `c5269b1`, `37b2790`, `eb1b4f4`, `f4d5905`, `05dad19`, `d03cc19`, `a8e3187`, `e4b6c9b`, `4ff0c0d`, `3bc649b`.

**Pendiente, fuera de este plan:**
- Vista celular: MAP-01, MAP-10 y MAP-11 en móvil.
- MAP-18, MAP-19 y MAP-20: tocan el shell global o implican un refactor.
- Cosmético: el texto del botón "Detalle" es algo más grande que el de los chips.
- Con 768 px de alto o menos, el mapa vuelve al flujo normal con scroll de página, por la escala mínima de 0,6.

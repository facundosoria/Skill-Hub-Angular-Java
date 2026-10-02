# Auditoría UX/UI — Skill Hub (frontend Angular)

Fecha: 2026-10-01 · Método: auditoría **estática** del código (no se ejecutó la app ni se probó con usuarios), realizada por 5 workers de Codex orquestados desde Orca (1 de mapeo + 4 de auditoría por área) y validada por el orquestador.
Marco: skill `web-design-system` (principios de Norman, *The Design of Everyday Things*). **Nota (corregida 2026-10-02):** esta auditoría general no aplicó la guía UX/UI porque se buscó solo en `~/.claude/skills`, `~/.codex/skills` y el repo. La skill **sí existe**, como `ui-ux-design-guide`, en `~/.agents/skills/ui-ux-design-guide`. La auditoría del tab Mapa (`docs/AUDITORIA-UX-MAPA.md`) sí la usó; para el resto de las pantallas queda pendiente una segunda pasada con esa guía.

## Resumen ejecutivo

**Lo bueno (transversal)**
- Base sólida: primitivas UI compartidas (`shared/ui.ts`), tokens claro/oscuro, `prefers-reduced-motion`, foco visible, i18n es/en.
- Login, formulario de skills y detalle tienen feedback de estado (pending, errores, `role="alert"/status`), prevención de doble envío y validación en vivo (duplicados, idioma, slug automático).
- Catálogo con skeleton + empty state; diff y detalle con loading/error; guards de ruta coherentes (`authGuard`, `guestGuard`, `adminGuard`).
- Contexto antes de decidir en `/review` y `/admin/users`.

**Lo malo (patrones que se repiten, por prioridad)**
1. **Cargas sin estado de loading ni manejo de error (Alta).** `/keys`, `/profile`, `/review`, `/insights`, `/audit`, `/admin/users`, `/skills` (listado) y precarga de edición: un fallo o una espera se ven igual que "sin datos". Viola visibilidad/feedback/golfo de evaluación.
2. **Acciones destructivas o irreversibles sin confirmación nombrada, undo ni feedback (Alta).** Revocar key, aprobar/rechazar usuarios, aprobar/rechazar/descartar propuestas, publicar/descartar/deprecar skills. `/review` rechaza con `window.prompt()` nativo.
3. **Mutaciones sin estado ocupado** (doble envío posible) y sin mensaje de éxito en `/review`, `/admin/users`, detalle de skill, logout.
4. **No hay sistema global de feedback** (sin toasts/banners/diálogos propios).
5. **Affordances ambiguas:** `<button>` anidado dentro de `<a>` (`/skills`, `/review`); enlace a perfil solo con el nombre; `select` de stack sin etiqueta visible.
6. **Errores de sesión mezclados:** fallo de red en `/auth/me` se trata como "sin sesión" y redirige a login.
7. **i18n incompleto:** `UiStatusBadge` y fallback de `/docs` fijos en español; `lang` inicial.
8. **Accesibilidad básica:** sin `aria-current` en nav, `UiField` sin `aria-describedby`/`aria-invalid`, mensajes de `/profile` sin `role`.

**Puntuación por página (1–10)**

| Página | Nota | Página | Nota |
|---|---:|---|---:|
| `/login` | 7 | `/review` | 4 |
| `/profile` | 6 | `/insights` | 5 |
| `/keys` | 4 | `/audit` | 5 |
| Shell/sesión | 6 | `/admin/users` | 3 |
| `/skills` | 6 | `/docs` | 7 |
| `/skills/new` | 6 | Shell/nav global | 7 |
| `/skills/:slug` | 7 | Primitivas UI | 6 |
| `/skills/:slug/edit` | 6 | Tema/estilos/i18n | 7 |
| `/skills/:slug/diff` | 7 | | |

**Quick wins recomendados:** (a) un patrón común `loading/error/empty` con reintento para todas las cargas; (b) un diálogo de confirmación propio que nombre el objeto, reemplazando `prompt()` y protegiendo las acciones destructivas; (c) un servicio de toasts/región `aria-live`; (d) `busy` en todas las mutaciones.

Limitaciones: hallazgos basados en lectura de código; severidad y puntuaciones son juicio del worker, sin medición de contraste ni pruebas en dispositivo/responsive.

---

# Detalle por área

## Auditoría Área 1 — acceso, sesión y cuenta

Auditoría estática de `/login`, `/profile`, `/keys`, el shell y la lógica de sesión. No se ejecutó la aplicación ni se observaron usuarios reales; por tanto, las conclusiones se limitan a lo verificable en el código. Se aplican los principios y reglas de `web-design-system` (Norman); las correcciones son inferencias web, no citas literales del libro.

### Lo bueno

- **Login: campos identificables y modo visible.** Cada campo está encapsulado en `ui-field` con etiqueta, y el botón cambia entre entrar/crear cuenta según el modo (`frontend/src/app/features/auth/login.ts:20-38`, `47-56`). Esto favorece visibilidad, affordances y modelo conceptual (P01/P02/P03; R01-R03, R10-R15).
- **Login: feedback de operación y prevención de doble envío.** El estado `pending` deshabilita el submit y cambia su texto; errores e información se muestran con `role="alert"`/`role="status"` (`frontend/src/app/features/auth/login.ts:41-49`, `83-105`). Aplica feedback y prevención de slips (P05/P10; R40-R45, R90-R97).
- **Login: se conserva el contexto de registro.** Cuando el registro no activa la cuenta, se muestra el texto informativo recibido en vez de navegar silenciosamente (`frontend/src/app/features/auth/login.ts:92-100`). Aplica feedback y golfo de evaluación (P05/P08; R40-R45, R70-R74).
- **Profile: los controles de tema, idioma y datos están agrupados y etiquetados.** Los selects están próximos a sus efectos y usan opciones explícitas (`frontend/src/app/features/profile/profile.ts:21-41`). Aplica mapping y modelo conceptual (P02/P04; R10-R15, R30-R36).
- **Profile: guardado con estado ocupado, éxito y error.** El botón cambia a “guardando”, se deshabilita y luego se presenta guardado o error (`frontend/src/app/features/profile/profile.ts:43-49`, `86-105`). Aplica feedback y prevención de repetición (P05; R40-R45).
- **Keys: la clave recién creada se presenta en un bloque destacado y con copia explícita.** El mensaje “copia ahora” y el botón de copiar hacen perceptible la ventana de uso de la credencial (`frontend/src/app/features/keys/keys.ts:90-96`, `46-67`). Aplica visibilidad, affordance y feedback (P01/P03/P05; R01-R08, R20-R25, R40-R45).
- **Keys: estados de revocación y uso son distinguibles.** Cada fila muestra revocada, en uso o sin usar y fechas (`frontend/src/app/features/keys/keys.ts:106-127`). Aplica visibilidad del estado real y modelo conceptual (P01/P02; R05-R08, R10-R15).
- **Shell y rutas: la navegación principal, perfil y salida son visibles; las rutas protegidas tienen guards.** El shell expone catálogo, keys, docs, perfil y salir (`frontend/src/app/layout/shell.ts:18-43`); `authGuard`, `guestGuard` y `adminGuard` se conectan a las rutas (`frontend/src/app/app.routes.ts:10-18`, `43-72`). Esto apoya visibilidad, constraints lógicas y orientación (P01/P06/P08; R01-R08, R50-R54, R70-R74).
- **Sesión: la cookie no se expone al cliente y la sesión se resuelve antes del primer render.** El código documenta cookie `httpOnly` y registra `provideAppInitializer` (`frontend/src/app/core/auth.ts:6-9`, `23-35`; `frontend/src/app/app.config.ts:19-21`). Es una base coherente para el modelo conceptual de sesión y evita mostrar una cuenta no resuelta (P02/P05; R10-R15, R40-R45).

### Lo malo

| Severidad | Pagina/seccion | Problema | Principio violado | Evidencia archivo:linea | Recomendacion |
|---|---|---|---|---|---|
| Alta | `/keys`, revocación | Revocar una clave es una acción destructiva sin confirmación nombrada, undo ni resultado de éxito/error visible; un clic accidental puede dejar la credencial inutilizable. | P10/P11/P12: slips, undo y forcing functions (R90-R97, R100-R107, R110-R113). Dice el libro: el undo fiable es preferible a una confirmación débil [CH05-016], [CH05-017]. | `frontend/src/app/features/keys/keys.ts:124-127`, `207-210` | Separar visualmente la acción, identificar la clave en una confirmación contextual o, preferiblemente, ofrecer revocación reversible durante un plazo; mostrar éxito y error en el lugar de la fila. |
| Alta | `/keys`, carga inicial | La carga de `/keys` no tiene estado loading ni catch; durante la espera la lista parece vacía y un fallo queda indistinguible de “sin claves”. | P01/P05/P08/P11: visibilidad, feedback, golfo de evaluación y estados de error (R05-R08, R40-R45, R70-R74, R100-R107). [CH06-034]. | `frontend/src/app/features/keys/keys.ts:102-104`, `179-185` | Añadir loading explícito, error recuperable con reintento y empty state que indique qué acción permite crear la primera clave. |
| Alta | `/keys`, copia | Si la copia al portapapeles falla, `copy()` retorna sin feedback; el usuario no puede saber si debe reintentar o copiar manualmente. | P05/P08/P11: feedback y explicación del error (R40-R45, R70-R74, R100-R107). [CH00-017], [CH06-034]. | `frontend/src/app/features/keys/keys.ts:63-67` | Presentar estado de fallo persistente y alternativa “seleccionar/copiar manualmente”, sin perder la clave recién creada. |
| Media | `/keys`, creación | El input de nombre no tiene `name` (`ngModel` sí está presente), y no se ve restricción/validación de vacío antes de enviar; el error llega después de la acción. | P06/P11: constraints semánticas y prevención/detección de mistakes (R50-R54, R100-R107). | `frontend/src/app/features/keys/keys.ts:81-87`, `164`, `192-204` | Añadir `name`, `required`, longitud/formato y feedback inline antes de llamar al API; conservar el valor ante error. |
| Media | `/profile`, carga inicial | El perfil se carga en el constructor sin loading ni manejo de error; mientras llega la respuesta aparecen valores iniciales vacíos y un fallo no se comunica. | P01/P05/P08/P11: visibilidad del estado real, feedback y error (R05-R08, R40-R45, R70-R74, R100-R107). | `frontend/src/app/features/profile/profile.ts:69-76` | Modelar `loading/error`, bloquear o diferenciar el formulario hasta cargar, y ofrecer reintento con mensaje comprensible. |
| Media | `/profile`, tema/idioma | Tema e idioma se aplican inmediatamente al cambiar el select, pero la persistencia solo ocurre al pulsar Guardar; si guardar falla, la interfaz local y el estado guardado divergen sin explicarlo. | P02/P04/P05: modelo conceptual, mapping y feedback veraz (R10-R15, R30-R36, R40-R45). [CH00-029]. | `frontend/src/app/features/profile/profile.ts:29-40`, `79-84`, `86-105` | Elegir y comunicar un modelo: aplicar al guardar, o indicar explícitamente “cambio local pendiente” y permitir deshacer/restaurar si falla la persistencia. |
| Media | `/profile`, feedback | `saved` no tiene `role="status"` y el mensaje de error tampoco `role="alert"`; el feedback puede no ser anunciado a tecnologías de asistencia. La auditoría solo constata el marcado ausente; no evalúa WCAG. | P01/P05: visibilidad y feedback en el lugar (R01-R08, R40-R45). | `frontend/src/app/features/profile/profile.ts:47-48` | Marcar éxito como `role="status"` y error como `role="alert"` (o equivalente), manteniendo el mensaje junto al botón. |
| Media | Shell, logout | Logout no tiene estado ocupado, confirmación de resultado ni manejo de fallo; si la llamada falla no se navega y no se informa qué ocurrió. | P05/P11/P18: feedback, errores y control sobre automatización (R40-R45, R100-R107, R170). | `frontend/src/app/layout/shell.ts:38-43`, `79-82`; `frontend/src/app/core/auth.ts:59-62` | Deshabilitar mientras procesa, mostrar “cerrando sesión” y error recuperable; decidir y documentar si se permite salida local aunque falle la invalidación remota. |
| Media | Shell, navegación | El nombre del usuario es el único contenido del enlace a `/profile`; no hay texto visible que indique “perfil” salvo que el usuario interprete el nombre como destino. | P01/P02/P03: visibilidad, modelo conceptual y affordance (R01-R03, R10-R15, R20-R25). | `frontend/src/app/layout/shell.ts:31-36` | Añadir una etiqueta explícita “Perfil” (manteniendo el nombre como contexto) o una señal equivalente claramente asociada al destino. |
| Media | `AuthService`/guards, sesión | `refresh()` absorbe cualquier fallo de `/auth/me` como “sin usuario”; los guards redirigen a login también ante indisponibilidad de red, mezclando sesión expirada con fallo del sistema. | P02/P05/P08/P11: modelo conceptual, feedback, golfo de evaluación y errores (R10-R15, R40-R45, R70-R74, R100-R107). | `frontend/src/app/core/auth.ts:24-34`; `frontend/src/app/core/guards.ts:6-10`, `14-20`, `23-27` | Distinguir no autenticado de error de transporte/servidor, mostrar estado de servicio y reintento; no hacer que el usuario repita login como única explicación. |
| Baja | `/login`, validación | No hay constraints declarativas visibles (`required`, formato o minlength); los campos pueden llegar vacíos al submit y el usuario descubre el problema solo tras la respuesta del servidor. | P06/P11: constraints y prevención de mistakes (R50-R54, R100-R107). | `frontend/src/app/features/auth/login.ts:22-38`, `83-105` | Añadir restricciones apropiadas y mensajes inline que indiquen qué, por qué y cómo corregir, conservando lo ingresado. |
| Baja | `/login`, error genérico | El fallback “Algo salio mal” no explica qué pasó ni cómo recuperarse, aunque los errores del backend sí se muestran cuando existen. | P11: diseño para el error (R100-R107). [CH06-034]. | `frontend/src/app/features/auth/login.ts:109-113` | Usar un mensaje accionable para red/servidor y mantener el detalle específico cuando sea seguro mostrarlo. |

### Puntuacion 1-10 por pagina

- **`/login` — 7/10.** Tiene etiquetas, cambio de modo, estados pending/error/info y guards; pierde puntos por validación ausente y fallback genérico no accionable (`frontend/src/app/features/auth/login.ts:19-49`, `83-113`).
- **`/profile` — 6/10.** Mapping y guardado están claros, pero la carga inicial no tiene estado/error y los cambios inmediatos de tema/idioma pueden contradecir el resultado persistido (`frontend/src/app/features/profile/profile.ts:29-49`, `69-105`).
- **`/keys` — 4/10.** La creación y copia tienen buenas señales, pero la carga parece vacía durante fallos, copiar sin éxito no informa y revocar carece de undo/confirmación (`frontend/src/app/features/keys/keys.ts:90-104`, `124-127`, `179-210`).
- **Shell/sesión — 6/10.** La navegación y protección de rutas son visibles y coherentes, pero logout y los fallos de `refresh()` carecen de feedback diferenciado (`frontend/src/app/layout/shell.ts:18-43`, `79-82`; `frontend/src/app/core/auth.ts:24-34`).


## Auditoría UX — Área 2: catálogo y ciclo de vida de skills

Alcance estático: `/skills`, `/skills/new`, `/skills/:slug`, `/skills/:slug/edit`, `/skills/:slug/diff` y `shared/skill-*.ts`. No se ejecutó servidor ni se observaron usuarios reales; por tanto, las conclusiones se limitan al código y templates inspeccionados. Se aplican los principios Norman de `web-design-system`, distinguiendo la regla de la skill de la recomendación inferida.

### Lo bueno

- El catálogo hace visible el estado de carga mediante skeleton y ofrece un empty state explícito cuando no hay resultados (`frontend/src/app/features/skills/skills-list.ts:36-44`). Aplica P01/R01 y P05/R40: la inferencia de la skill pide mostrar el estado real y el efecto de la carga.
- La búsqueda filtra por título, descripción, uso y tags, y el selector restringe el stack a opciones válidas (`frontend/src/app/features/skills/skills-list.ts:24-33`, `77-89`). Aplica P06/R50-R52: restricciones semánticas y lógicas reducen entradas inválidas.
- El formulario de creación/edición deriva el slug automáticamente mientras el usuario no lo haya tocado y bloquea el slug en edición (`frontend/src/app/features/skills/skill-form.ts:96-101`, `280-288`). Aplica P06/R50 y P04/R35: reduce trabajo arbitrario y evita dos controles compitiendo por la misma función.
- El formulario detecta duplicados e inconsistencia de idioma durante la escritura, muestra candidatos y explica por qué una acción queda bloqueada (`frontend/src/app/features/skills/skill-form.ts:42-90`, `244-277`). Aplica P05/R40-R42, P06/R51-R52 y P11/R103: feedback contextual, restricciones tempranas y explicación accionable.
- El submit deshabilita el botón mientras guarda y cambia su etiqueta a “Guardando…” (`frontend/src/app/features/skills/skill-form.ts:143-149`, `306-337`). Aplica P05/R40-R41: feedback inmediato y prevención de doble envío.
- El detalle muestra estado, versión, historial, nota de cambio y enlaces de diff en contexto (`frontend/src/app/features/skills/skill-detail.ts:22-30`, `106-120`). Aplica P01/R01, P02/R10-R11 y P04/R31: la system image expone el estado y las acciones están cerca del objeto afectado.
- La carga del detalle y del diff distinguen skeleton de error visible, y el diff valida versiones no numéricas antes de llamar a la API (`frontend/src/app/features/skills/skill-detail.ts:159-163`, `frontend/src/app/features/skills/skill-detail.ts:195-203`, `frontend/src/app/features/skills/skill-diff.ts:80-98`). Aplica P05/R40-R45 y P06/R50: el usuario recibe feedback y se acotan entradas inválidas.
- El preview usa `sandbox="allow-scripts"`, título y skeleton hasta el evento `load` (`frontend/src/app/shared/skill-preview.ts:18-32`). En términos de la skill, esto ofrece estado visible y una restricción de contexto (P01/R01, P06/R50); la seguridad técnica queda fuera del alcance Norman de esta auditoría.

### Lo malo

| Severidad | Pagina/seccion | Problema | Principio violado | Evidencia archivo:linea | Recomendacion |
|---|---|---|---|---|---|
| Alta | `/skills` carga del catálogo | La promesa de listado no tiene `catch`; ante un fallo la UI termina en `loading=false` y presenta el mismo empty state que “sin resultados”, ocultando el estado real. | P01/R06; P05/R45; P11/R103 — el indicador debe representar el estado real y el error debe decir qué pasó/cómo actuar. | `frontend/src/app/features/skills/skills-list.ts:92-96` | Mantener un estado `error` separado del vacío; mostrar “No se pudo cargar el catálogo” con reintento y conservar filtros. |
| Media | `/skills` controles de búsqueda | El input tiene `aria-label`, pero el `select` no tiene etiqueta visible ni asociada; su affordance depende de conocer que filtra por stack. | P03/R24; P07/R60 — cada control debe indicar qué acción admite y mostrar conocimiento en el mundo. | `frontend/src/app/features/skills/skills-list.ts:24-33` | Añadir etiqueta visible “Tecnología/stack” asociada al `select` y comunicar que el filtrado se actualiza al cambiar. |
| Media | `/skills` resultados | Cada resultado es un `<a>` que contiene datos y parece una fila completa clicable; no hay feedback textual de navegación ni acción separada, y el botón “Nuevo skill” también está anidado en `<a>`. | P03/R22-R24; P04/R31; P13/R120 — la forma y zona de operación deben coincidir con la acción. | `frontend/src/app/features/skills/skills-list.ts:21`, `46-60` | Usar el enlace como elemento único con estilo de enlace/tarjeta consistente, y usar un `<a>` estilizado directamente para “Nuevo skill”, sin `<button>` anidado. |
| Alta | `/skills/new` y `/skills/:slug/edit` carga inicial de edición | `loadForEdit()` no captura errores; si falla la carga, el formulario puede quedar vacío sin explicar si se perdió el skill o la red falló. | P05/R45; P08/R72; P11/R103 — un fallo mudo genera culpa propia y una pantalla sin guía. | `frontend/src/app/features/skills/skill-form.ts:213-242` | Añadir estado `loading/error` de precarga, no renderizar el formulario hasta tener datos y ofrecer “Reintentar”/volver al detalle. |
| Media | `/skills/new` y `/skills/:slug/edit` cancelación | Cancelar navega fuera inmediatamente; no se observa estado de cambios sin guardar ni protección ante un click accidental. | P01/R07; P10/R92; P12/R110-R113 — hacer visible el estado y usar una restricción/confirmación cuando el orden importa. | `frontend/src/app/features/skills/skill-form.ts:143-149` | Detectar cambios y mostrar confirmación nombrando la acción (“Salir sin guardar”); conservar borrador o permitir volver sin perderlo. |
| Media | `/skills/new` y edición validación | El error se renderiza como texto genérico o código devuelto (`error()`), sin garantía de “qué pasó, por qué y cómo corregirlo”; tampoco se asocia al campo causante. | P02/R15; P11/R103-R105 — vocabulario de la tarea y mensajes accionables. | `frontend/src/app/features/skills/skill-form.ts:139-141`, `322-334` | Mapear errores conocidos a mensajes de tarea, asociarlos al campo o bloque correspondiente y preservar el contenido ya ingresado. |
| Alta | `/skills/:slug` acciones administrativas | “Descartar” y “Publicar” se ejecutan con un click; “Deprecar” solo abre un panel y luego confirma, pero no nombra claramente el objeto/impacto ni ofrece undo. | P10/R90-R97; P11/R101-R102; P12/R110-R113 — acciones destructivas requieren prevención, confirmación fuerte o reversión. | `frontend/src/app/features/skills/skill-detail.ts:67-75`, `131-151` | Separar acciones destructivas, confirmar con el título/slug y consecuencias, y ofrecer undo o una papelera/estado reversible para descartar/deprecar cuando el dominio lo permita. |
| Media | `/skills/:slug` operación de acciones | `act()` recarga tras mutar, pero no muestra éxito específico: el usuario solo infiere que cambió porque desaparece o cambia el detalle. | P05/R40-R44; P08/R73 — feedback inmediato, contextual y sobre el efecto logrado. | `frontend/src/app/features/skills/skill-detail.ts:205-216` | Mostrar estado “Publicando/Aplicando/Descartando…” por acción y un mensaje de éxito contextual después de la respuesta del servidor. |
| Media | `/skills/:slug` historial | Cuando `history` está vacío no hay empty state ni explicación; queda solo el encabezado “Historial”. | P01/R01; P08/R72; P11/R103 — el vacío debe explicar qué significa y qué se puede hacer. | `frontend/src/app/features/skills/skill-detail.ts:106-123` | Renderizar un estado vacío breve (“Aún no hay versiones anteriores”) y distinguirlo de un fallo de carga. |
| Baja | `/skills/:slug/diff` diff | El diff presenta signos y colores de adición/eliminación, pero el significado de las filas no se ofrece en texto para quien no interpreta esa convención; los contadores sí aparecen sin etiqueta específica por versión. | P02/R10-R11; P03/R24; P13/R120-R125 — convenciones nuevas deben guiarse y la system image debe ser comprensible. | `frontend/src/app/features/skills/skill-diff.ts:23-46` | Añadir una leyenda textual “Añadidas/Eliminadas/Sin cambios” y contexto de qué versión es origen y destino. |
| Media | `shared/skill-markdown.ts` renderizado/resaltado | El contenido se transforma y luego el resaltado asíncrono reemplaza bloques; no hay feedback visible mientras Shiki procesa ni error específico si falla, aunque el bloque plano permanece. | P05/R40-R42; P08/R73 — procesos diferidos deben hacer visible su estado y resultado. | `frontend/src/app/shared/skill-markdown.ts:23-25`, `45-67` | Si el resaltado es perceptible, mostrar estado discreto “Procesando código…” y, ante fallo, “Código mostrado sin resaltado”; mantener el fallback plano. |
| Media | `shared/skill-preview.ts` preview | Se oculta el iframe hasta `load`, pero no existe estado de error ni alternativa si el preview no termina de cargar; el skeleton puede quedar indefinido. | P05/R42-R45; P11/R103 — la ausencia de feedback produce falsa causalidad y el fallo debe ser diagnosticable. | `frontend/src/app/shared/skill-preview.ts:19-32`, `36-49` | Añadir timeout/error de carga con mensaje y opción de abrir/leer el contenido sin preview. |

### Puntuacion 1-10 por pagina

- `/skills`: **6/10** — buena visibilidad de carga, filtros y vacío, pero el error de listado se confunde con “sin resultados” y hay señales/markup de interacción mejorables.
- `/skills/new`: **6/10** — validación progresiva y prevención de duplicados son sólidas, pero faltan precarga/error estructurado y protección ante salida con cambios.
- `/skills/:slug`: **7/10** — modelo de detalle, historial, estados y errores básicos son claros; acciones administrativas sin undo/confirmación reducen la seguridad del flujo.
- `/skills/:slug/edit`: **6/10** — reutiliza buenas restricciones y feedback del formulario, pero un fallo de carga puede dejar un formulario vacío y cancelar no considera cambios sin guardar.
- `/skills/:slug/diff`: **7/10** — valida parámetros, muestra carga/error y contexto de versiones; falta leyenda explícita y guía para interpretar la convención visual del diff.


## Auditoría Área 3 — Administración y observabilidad

Auditoría estática de `/review`, `/insights`, `/audit` y `/admin/users`, sin servidores ni pruebas con usuarios. Se aplica `web-design-system` y sus principios de Norman; las conclusiones son inferencias web basadas en la evidencia citada. Las cuatro rutas declaran `adminGuard` en `frontend/src/app/app.routes.ts:55-72`.

### Lo bueno

- Las cuatro pantallas están protegidas por `adminGuard` (`frontend/src/app/app.routes.ts:55-72`). Principios: visibilidad y constraints (P01/P06).
- `/review` muestra contexto antes de decidir: título, descripción, stack, estado, uso, changelog y enlace al skill (`frontend/src/app/features/review/review.ts:15-36`). Principios: conocimiento en el mundo y golfos de ejecución/evaluación (P07/P08).
- Las revisiones tienen acceso explícito a comparar versiones (`frontend/src/app/features/review/review.ts:78-88`). Principios: mapping y sistema explorable (P04/P14).
- Las acciones usan etiquetas verbales diferenciadas (`frontend/src/app/features/review/review.ts:37-43`, `frontend/src/app/features/review/review.ts:78-88`). Principio: affordances/señales (P03).
- Las páginas tienen encabezados y subtítulos orientativos (`frontend/src/app/features/review/review.ts:15-16`, `frontend/src/app/features/insights/insights.ts:19-20`, `frontend/src/app/features/audit/audit.ts:16-17`, `frontend/src/app/features/admin/admin-users.ts:14-15`). Principios: visibilidad/modelo conceptual (P01/P02).
- Hay empty states reutilizados y contextualizados en las listas principales (`frontend/src/app/features/review/review.ts:18-20`, `frontend/src/app/features/insights/insights.ts:26-28`, `frontend/src/app/features/insights/insights.ts:42-44`, `frontend/src/app/features/insights/insights.ts:58-60`, `frontend/src/app/features/audit/audit.ts:19-21`, `frontend/src/app/features/admin/admin-users.ts:17-19`). Principios: feedback y estados (P05/P08).
- La auditoría asigna tonos/etiquetas a acciones y tolera JSON inválido (`frontend/src/app/features/audit/audit.ts:46-79`). Principios: feedback y diseño para errores (P05/P11).
- `/admin/users` muestra nombre, usuario, equipo y legajo antes de decidir (`frontend/src/app/features/admin/admin-users.ts:20-32`). Principio: conocimiento en el mundo (P07).

### Lo malo

| Severidad | Pagina/seccion | Problema | Principio violado | Evidencia archivo:linea | Recomendacion |
|---|---|---|---|---|---|
| Alta | `/review`, `/insights`, `/audit`, `/admin/users` — carga inicial | Arrays vacíos se muestran como empty state mientras la petición sigue pendiente; no se distingue cargando de sin datos. | P01 Visibilidad; P05 Feedback; P08 golfos de evaluación (R01/R06/R40/R72) | `review.ts:101-114`, `insights.ts:80-90`, `audit.ts:44-58`, `admin-users.ts:55-67`; templates `review.ts:18-20`, `insights.ts:26-28`, `audit.ts:19-21`, `admin-users.ts:17-19` | Añadir `loading`/skeleton o “Cargando…” y mostrar empty solo tras respuesta exitosa. |
| Alta | Las cuatro páginas — GET | Las promesas no tienen `.catch` ni error visible; un fallo puede quedar presentado como lista vacía o sin explicación. | P05 Feedback; P11 mistakes/error (R40/R44/R103) | `review.ts:108-115`, `insights.ts:84-90`, `audit.ts:56-58`, `admin-users.ts:62-67` | Capturar error, explicar qué pasó/cómo reintentar y conservar datos previos si existen. |
| Alta | `/review` — aprobar/rechazar | Mutaciones sin `busy`, deshabilitación ni resultado visible; clics repetidos pueden repetir peticiones. | P05 Feedback; P10 slips; P11 error (R41/R90/R100) | `review.ts:117-134`; botones `review.ts:37-43`, `review.ts:78-88` | Mostrar “Procesando…”, deshabilitar la acción, prevenir doble envío y comunicar éxito/error en la fila. |
| Alta | `/admin/users` — aprobar/rechazar | Cambia el estado de una cuenta sin confirmación, busy, feedback ni undo; fallos tampoco se presentan. | P10 slips; P11 undo/error; P12 forcing functions (R92/R101/R102/R110) | Botones `admin-users.ts:29-32`; métodos `admin-users.ts:69-76` | Confirmar nombrando al usuario y consecuencia; añadir estado ocupado, feedback y recuperación/undo o vía reversible. |
| Alta | `/review` — rechazar/descartar | `prompt()` nativo queda fuera del flujo visual, no nombra el objeto afectado, no comunica errores y solo valida longitud. | P02 Modelo; P03 Affordance; P10/P11/P12 (R12/R23/R101/R103/R110) | `review.ts:122-134` | Usar diálogo integrado con objeto/consecuencia, Cancelar/Rechazar, validación visible, estado de envío y feedback. |
| Alta | `/review` — aprobar/descartar | Decisiones potencialmente irreversibles sin confirmación contextual ni undo; el resultado se reduce a recargar. | P04 Mapping; P10 slips; P11 undo (R31/R92/R101/R102) | Acciones `review.ts:37-43`, `review.ts:78-88`; recarga `review.ts:118-134` | Confirmar junto a la fila, nombrar objeto/consecuencia y preferir “Hecho, Deshacer” si es viable. |
| Media | `/review` — “Corregir”/“Ver diff” | `<button>` dentro de `<a>` duplica affordances y anida controles interactivos; no queda claro si es enlace o botón. | P03 Affordances; P04 Mapping; P13 Consistencia (R22/R31/R120) | `review.ts:39-41`, `review.ts:79-84` | Usar directamente enlace estilizado como botón o un botón que navegue, nunca ambos anidados. |
| Media | `/insights` — métricas | Números separados por “·” y etiquetas breves no explican unidad temporal, alcance ni significado de cada métrica. | P02 Modelo; P07 conocimiento en el mundo; P08 evaluación (R10/R12/R60/R72) | `insights.ts:41-50`, `insights.ts:56-69` | Etiquetar unidades (“consultas”, “personas únicas”), período/fuente y entidad asociada. |
| Media | `/audit` — lista | Solo muestra actor, acción, slug y fecha truncada; no hay detalle/expansión para interpretar eventos o localizar casos. | P01 Visibilidad; P02 Modelo; P04 Mapping (R02/R10/R31) | `audit.ts:19-36`, `audit.ts:60-64` | Mostrar alcance, permitir detalle contextual y filtros si la tarea requiere localizar eventos. |
| Media | `/admin/users` — activas | La sección de activos no tiene empty state: una card vacía no explica si terminó la carga ni qué significa. | P01 Visibilidad; P05 Feedback; P08 estado vacío (R06/R40/R72) | `admin-users.ts:38-47` | Añadir loading y empty state independiente para “No hay usuarios activos”. |
| Baja | Todas — recuperación | No se observa acción de reintento ni ruta de recuperación tras fallar carga/mutación. | P08 Golfos; P11 Error; P14 Explorable (R70/R73/R103/R130) | Templates `review.ts:13-94`, `insights.ts:16-73`, `audit.ts:15-37`, `admin-users.ts:12-48`; cargas citadas arriba | Incluir “Reintentar”, conservar contexto y ofrecer navegación de retorno. |

### Puntuacion 1-10 por pagina con una linea de justificacion

- `/review`: **4/10** — buen contexto y diff, pero decisiones sin feedback/busy, rechazo con `prompt()` y fallos silenciosos.
- `/insights`: **5/10** — estructura y empty states claros, pero carga indistinguible de vacío, errores silenciosos y métricas poco explicadas.
- `/audit`: **5/10** — lista tolerante y legible, pero sin loading/error/reintento ni detalle contextual.
- `/admin/users`: **3/10** — identidad visible, pero acciones de cuenta sin confirmación, undo, feedback o prevención de doble envío; faltan estados de carga/error y empty state de activos.

## Auditoría área 4 — documentación, layout y sistema UI compartido

### Lo bueno

- La navegación global expone Catálogo, key y documentación, y agrega áreas administrativas según rol; hace visibles tareas principales y reduce el golfo de ejecución (P01/R01, P08/R70). Evidencia: `frontend/src/app/layout/shell.ts:21-30`, `frontend/src/app/layout/shell.ts:62-76`. Dice el libro: la visibilidad transmite mapping y distinciones `[CH01-006] [CH01-015]`; inferencia web: funciones esenciales deben descubrirse desde la pantalla.
- La navegación de documentación tiene nombre accesible localizado e índice de secciones con enlace directo y sección activa (P01/P04/P08). Evidencia: `frontend/src/app/features/docs/docs.ts:34-45`, `frontend/src/app/features/docs/docs.ts:118-142`. Dice el libro: un buen display muestra estado y siguiente paso `[CH04-028] [CH01-044]`; inferencia web: el índice ayuda a ubicar y evaluar la lectura.
- Documentación muestra skeleton mientras carga y conserva fallback legible si falla (P05/P11). Evidencia: `frontend/src/app/features/docs/docs.ts:49-55`, `frontend/src/app/features/docs/docs.ts:107-115`. Dice el libro: feedback informa qué ocurrió y resultado `[CH00-017] [CH01-044]`; inferencia web: loading y error deben ser visibles.
- Primitivas de botón contemplan disabled y foco visible; inputs/selects reciben anillo de foco (P01/P03/P05; accesibilidad básica como suplemento externo). Evidencia: `frontend/src/app/shared/ui.ts:8-19`, `frontend/src/app/shared/ui.ts:129-158`, `frontend/src/styles.css:242-245`. Dice el libro: señales perceptibles indican cómo operar `[CH00-019] [CH04-014]`; inferencia web: foco visible hace ubicable la siguiente acción.
- El sistema centraliza tokens para superficies, texto, estados y temas, y respeta reducción de movimiento (P02/P13; accesibilidad como suplemento externo). Evidencia: `frontend/src/styles.css:8-45`, `frontend/src/styles.css:47-93`, `frontend/src/styles.css:161-173`. Dice el libro: el usuario conoce el sistema mediante su system image `[CH01-027] [CH07-006]`; inferencia web: una fuente compartida reduce señales contradictorias.

### Lo malo

| Severidad | Pagina/seccion | Problema | Principio violado | Evidencia archivo:linea | Recomendacion |
|---|---|---|---|---|---|
| Alta | `/docs` · carga | No valida `res.ok`; una respuesta HTTP de error puede presentarse como contenido. El fallback está fijo en español aunque la interfaz esté en inglés. | P05 Feedback, P02 Modelo conceptual, P11 Mistakes, P13 Consistencia. Dice el libro: feedback refleja resultado real `[CH00-017] [CH01-044]` y system image coherente `[CH01-027]`; inferencia web: distinguir loading/HTTP error/contenido inválido y localizar el mensaje. | `frontend/src/app/features/docs/docs.ts:107-115` | Comprobar `res.ok), mantener estados explícitos y mostrar error localizado con qué ocurrió y cómo reintentar. |
| Alta | UI · estados | `UiStatusBadge` codifica etiquetas en español aunque el idioma pueda cambiar; en inglés quedan textos mezclados. | P02 Modelo conceptual, P13 Estandarización. Dice el libro: etiquetas y system image deben permitir un modelo predecible `[CH01-025] [CH01-027]`; inferencia web: primitivas deben consumir vocabulario del locale. | `frontend/src/app/shared/ui.ts:64-73`; `frontend/src/app/core/i18n/i18n.ts:19-25` | Inyectar i18n o pasar etiqueta localizada; dejar en común solo mapeo de tono. |
| Alta | Shell · navegación | `routerLinkActive` solo cambia clases visuales; no declara `aria-current`. | P01 Visibilidad, P04 Mapping, P16 Inclusión. Dice el libro: visibilidad indica distinciones `[CH01-015]`; inferencia web: destino actual debe comunicarse semánticamente. | `frontend/src/app/layout/shell.ts:21-36`; suplemento externo de accesibilidad. | Añadir `ariaCurrentWhenActive="page"` y verificar teclado/viewport estrecho. |
| Media | Shell · logout | Logout no tiene procesamiento, disabled ni feedback; latencia puede parecer clic ignorado y permitir repetición. | P05 Feedback, P11 Mistakes. Dice el libro: sin feedback se repiten operaciones `[CH01-019] [CH00-017]`; inferencia web: bloquear doble activación y comunicar fallo. | `frontend/src/app/layout/shell.ts:38-43`, `79-82` | Añadir estado `loggingOut`, deshabilitar y mostrar error localizado si falla. |
| Media | Shared `UiEmptyState` | Solo presenta título/hint; no ofrece acción contextual ni estado semántico. | P08 Golfos, P01 Visibilidad, P09 Tareas. Dice el libro: pantalla de estado muestra progreso y siguiente paso `[CH04-028] [CH04-029]`; inferencia web: vacío debe incluir acción o instrucción operable. | `frontend/src/app/shared/ui.ts:93-107` | Permitir acción opcional: crear, conectar o limpiar filtros. |
| Media | Shared `UiField` · errores | El error es visual pero no enlaza control con `aria-describedby` ni expone `aria-invalid`. | P01 Visibilidad, P08 Evaluación, P11 Error; accesibilidad suplemento externo. Dice el libro: error ayuda a detectar/corregir `[CH05-035]`; inferencia web: campo y recuperación deben quedar asociados. | `frontend/src/app/shared/ui.ts:109-127` | Generar id estable de hint/error y exponer asociación/invalidación al control. |
| Baja | Tema/i18n · inicialización | `lang` del documento solo se actualiza al cambiar idioma; con cookie inicial puede no coincidir en primer render. | P02 Modelo conceptual, P13 Consistencia; accesibilidad suplemento externo. Dice el libro: system image comunica estado real `[CH00-029] [CH01-027]`; inferencia web: idioma y apariencia deben coincidir desde inicio. | `frontend/src/app/core/i18n/i18n.ts:19-35` | Inicializar `document.lang` y tema leído antes del contenido interactivo. |
| Baja | Sistema visual · contraste | Hay tokens tenues, pero no se midió contraste en esta auditoría; no se afirma incumplimiento numérico. | Suplemento WCAG; P01 Visibilidad. Dice el libro: no ocultar partes funcionales por estética `[CH01-005] [CH04-027]`; inferencia web: texto funcional no debe perder legibilidad. | `frontend/src/styles.css:15-27,47-65`; usos en `shared/ui.ts:97-100` | Ejecutar comprobador de contraste en pares reales claro/oscuro y ajustar solo si falla. |
| Media | Global · feedback | No existe toast/banner global; tampoco región persistente para resultados iniciados desde páginas distintas. | P05 Feedback, P08 Evaluación. Dice el libro: cada acción devuelve información sobre resultado `[CH00-017]`; inferencia web: canal global acotado evita acciones silenciosas. | Inventario de primitivas: `frontend/src/app/shared/ui.ts:163-174`; shell: `frontend/src/app/layout/shell.ts:38-43` | Incorporar región global de avisos con prioridad, duración y cierre accesible; conservar errores inline. |

### Puntuacion 1-10 por pagina con una linea de justificacion

| Página/sección | Puntuación | Justificación |
|---|---:|---|
| `/docs` | 7/10 | Buena orientación por índice, skeleton y fallback visible; baja por error HTTP no distinguido, fallback no localizado y falta de reintento explícito. |
| Shell / navegación global | 7/10 | Rutas principales/admin visibles y foco estilizado; baja por ausencia de `aria-current`, logout sin feedback y responsive no verificado. |
| Primitivas UI compartidas | 6/10 | Botones, campos y tokens dan base consistente; baja por estados sin localización, empty state sin acción y errores sin asociación semántica garantizada. |
| Tema, estilos e i18n | 7/10 | Tokens claro/oscuro, reducción de movimiento y diccionarios completos; baja por inicialización semántica del idioma y contraste no medido. |

Alcance: auditoría estática, sin servidor ni pruebas con usuarios. Las referencias `[CHnn-nnn]` son “Dice el libro”; recomendaciones son inferencias web y WCAG es suplemento externo.



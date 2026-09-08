# Cómo funciona

Qué es esto, para qué sirve, cómo se conecta tu IDE y qué hace la IA con lo que recibe.

## El problema

Somos once equipos trabajando en paralelo sobre el mismo sistema. Sin una fuente única, cada equipo inventa su forma de manejar errores, de nombrar endpoints, de armar un formulario. A los seis meses hay once dialectos y nadie puede moverse entre equipos sin reaprender todo.

Los documentos de Confluence no lo resuelven, porque nadie los abre en el momento exacto en que está escribiendo el código.

## La idea

Un solo catálogo de convenciones, con **dos caras sobre los mismos datos**:

- **Para personas** — esta web. Buscás, leés, proponés cambios. Todo queda versionado y auditado.
- **Para agentes** — un endpoint MCP. Tu IDE se conecta con tu key y el agente consulta el catálogo solo, antes de escribir código.

Las dos leen la misma base. Lo que se aprueba acá es lo que el agente lee un segundo después: no hay `git pull`, no hay versiones desfasadas entre equipos.

## Por qué no es un marketplace

La palabra aparece seguido y conviene sacarla del medio, porque el modelo mental equivocado lleva a decisiones equivocadas.

En un marketplace hay **muchos oferentes compitiendo** y quien consume elige entre opciones. Acá pasa exactamente lo contrario: si aparecen seis versiones distintas del skill de botones, eso no es variedad — es el fracaso del proyecto. Lo que estás usando es un **catálogo canónico**: un skill por problema, curado, con dueño.

| | Un marketplace | Este catálogo |
| --- | --- | --- |
| Cuántos por tema | Los que quieran publicar | Uno solo, el canónico |
| Quién elige | Vos, entre alternativas | Nadie: el agente recibe el que corresponde |
| Publicar | Abierto a cualquiera | Con aprobación de un admin |
| Duplicados | Son la oferta | Son el problema que hay que evitar |
| Si algo está mal | Elegís otro | Se corrige el que existe, y queda versionado |

Por eso la app te avisa antes de dejarte crear algo parecido a lo que ya existe, y por eso nada llega a los agentes sin aprobación. Si esto se pensara como marketplace, el impulso natural sería "que cada uno publique lo suyo y la gente elija", y eso devuelve exactamente la deriva entre equipos que vinimos a eliminar.

Lo único genuinamente de marketplace es el mecanismo de distribución: cada persona se conecta desde afuera con su propia key.

## Qué es un skill

Un archivo markdown con metadatos. El **frontmatter** es lo que lo hace encontrable; el cuerpo es la convención; un bloque `` ```preview `` opcional se renderiza al lado del código y aparece como miniatura en el listado.

```yaml
---
slug: buttons
title: Buttons
description: Every clickable action in the app.
when_to_use: Use when rendering any clickable action - button,
  CTA, primary or secondary action, submit, confirm, cancel.
stack: angular
type: skill
owner_team: platform
tags: [buttons, actions, forms, ui]
related: [form-fields]
---

## Rule

Never a bare button element...
```

El campo que más importa es `when_to_use`: está escrito **para que lo lea una máquina**, no una persona. Es literalmente lo que decide si el agente encuentra el skill correcto, así que se escribe listando las situaciones y los sinónimos que alguien usaría para describir la tarea.

Los skills están **en inglés** porque el índice de búsqueda de Postgres aplica stemming inglés y los agentes consultan en inglés. Si el idioma de la consulta y el del documento no coinciden, "buttons" y "button" dejan de colapsar al mismo lexema y la búsqueda pierde justo lo que la hace útil.

Los tipos son **skill** (cómo se hace algo), **convention** (regla que hay que respetar) y **reference** (datos, como el registro de puertos).

## Qué es MCP

**MCP es el Model Context Protocol**: un protocolo estándar para que un modelo de IA hable con sistemas externos. Es a los agentes lo que HTTP es a los navegadores — un acuerdo sobre cómo se piden y se devuelven cosas.

Antes de MCP, conectar una herramienta a un asistente significaba escribir un plugin distinto para cada uno. Con MCP escribís **un solo servidor** y funciona en Claude Code, Cursor, Windsurf o cualquier otro cliente que hable el protocolo. Por eso el hub expone MCP y no una API propia: el día que tu equipo cambie de IDE, el catálogo sigue funcionando.

- **Cliente** — tu IDE. Abre la conexión, se autentica y le pasa al modelo lo que el servidor ofrece.
- **Servidor** — el hub. Expone capacidades y responde llamadas. No inicia nada por su cuenta.
- **Transporte** — cómo viajan los mensajes. `stdio` para servidores locales; `Streamable HTTP` para servidores remotos como éste.
- **Mensajes** — JSON-RPC 2.0: cada mensaje tiene `method`, `params` y un `id` para aparear pedido y respuesta.

Un servidor MCP puede exponer tres tipos de cosas: **tools** (acciones que el modelo puede invocar), **resources** (documentos que el cliente puede leer) y **prompts** (plantillas). Nosotros usamos **sólo tools**, porque es lo que todos los clientes implementan bien y porque queremos que sea el modelo quien decida cuándo consultar, no la persona.

La conversación empieza siempre igual:

```text
cliente → initialize        "hola, hablo la versión 2025-06-18"
servidor → capabilities + instructions
cliente → tools/list        "¿qué sabés hacer?"
servidor → las tools con sus esquemas
cliente → tools/call        "ejecutá search_skills con estos argumentos"
servidor → el resultado, como texto
```

> **El detalle que hace funcionar todo.** En la respuesta al `initialize` el servidor manda un campo `instructions`: texto libre que el cliente inyecta en el contexto del modelo. Ahí es donde le decimos *"antes de escribir código de Angular o Java acá, buscá primero en el catálogo"*. Sin ese texto, el servidor funcionaría igual pero nadie lo usaría, porque el modelo no tendría motivo para llamarlo.

## Cómo está implementado

En el proyecto Next el servidor MCP era una ruta más de la misma app; en esta versión es un endpoint de la API en Spring Boot, en `{{MCP_URL}}`. Comparte la base de datos con la web, y por eso lo que se aprueba acá está disponible para los agentes al instante.

- **Endpoint** — `{{MCP_URL}}`
- **Transporte** — Streamable HTTP. Responde JSON directo en vez de dejar un stream SSE abierto: las tools de lectura nunca inician mensajes, así que no hay nada que esperar.
- **Estado** — ninguno. Se arma un servidor y un transporte por request. No hay sesiones que mantener ni que limpiar.
- **Autenticación** — header `Authorization: Bearer sk_hub_…`, verificado en cada llamada.
- **Esquemas** — cada tool declara sus parámetros como JSON Schema. El modelo recibe ese esquema y por eso puede armar la llamada bien formada sin adivinar.
- **Permisos** — sólo lectura, salvo `propose_skill` — y ésa únicamente puede crear propuestas provisionales, nunca publicar.

Una llamada real, completa:

```http
POST /api/mcp
Authorization: Bearer sk_hub_xxxxxxxxxxxx
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "search_skills",
    "arguments": { "query": "action button in a form" }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "result": {
    "content": [{ "type": "text", "text": "{ \"results\": [{ \"slug\": \"buttons\", \"when_to_use\": \"Use when rendering any clickable action...\", \"uses_90d\": 312, \"people\": 24 }], \"next_step\": \"Pick the one that applies and fetch it with get_skill(slug).\" }" }]
  }
}
```

Fijate que el resultado viaja como **texto** dentro de `content`. MCP no devuelve objetos tipados al modelo: le devuelve algo que leer. Por eso las claves están en inglés y el JSON va indentado — lo que llega es, literalmente, lo que el modelo va a leer.

## Qué es tu API key

Una API key es una contraseña para máquinas. Tu IDE no puede completar un formulario de login, así que le das una cadena secreta que lo identifica en cada pedido.

```text
sk_hub_Kb3vP9xLmQ2tR7wY4nZ8jH6c
└─────┘ └──────────────────────┘
prefijo  24 bytes al azar (base64url)
```

El prefijo `sk_hub_` existe para que sea reconocible: si aparece en un log o en un repositorio, se ve de inmediato qué es y de dónde salió.

- **Dónde se guarda** — en la base queda **sólo el hash SHA-256**, nunca el valor. No es que no te la mostremos de nuevo por política: es que no la tenemos.
- **Cómo viaja** — en el header `Authorization` de cada pedido, sobre HTTPS.
- **Qué puede hacer** — leer el catálogo, y proponer una convención cuando no existe ninguna. No puede editar, publicar ni borrar nada.
- **A quién identifica** — a vos y a tu equipo. Es lo que permite decir "este skill lo consultan 9 personas" sin exponer quién es cada una.
- **Revocar** — inmediato. La verificación filtra por revocadas en cada llamada, así que el siguiente pedido ya recibe un 401.

> **Tratala como una contraseña.** No la subas al repositorio ni la pegues en un chat. Usá una key por dispositivo, así podés revocar sólo la de la notebook que perdiste sin cortarle el acceso al resto. Si sospechás que se filtró, revocala y generá otra: son gratis.

Como la key no puede publicar, quién cambió qué lo registra la auditoría de la web, que es otra cosa: ahí la identidad viene de tu sesión, no de la key.

## Conectar tu IDE

1. Generá tu key en **Mi key**. Se muestra una sola vez.
2. Pegá el snippet de tu IDE. Está listo para copiar en esa misma página.
3. Trabajá normal. No hace falta que menciones el catálogo: al conectarse, el servidor le da al agente la instrucción de buscar antes de escribir código.

> **La prueba de que funciona.** Abrí una sesión limpia y pedí *"hacé un botón de guardar en este formulario"* sin nombrar ningún skill. El agente debería llamar a `search_skills` por su cuenta y traer el skill de botones.

## El orden de todo

Entre que abrís tu IDE y que el código sale escrito según la convención. Los pasos 2 a 6 los hace el agente solo.

1. **El IDE se conecta** *(IDE)* — una vez por sesión. Manda tu API key en el header y el servidor responde con la lista de las tools y con el texto de instructions.
2. **El agente lee las instructions** *(Agente)* — ese texto le dice: antes de escribir código de Angular o Java acá, buscá primero en el catálogo, en inglés. Es lo que hace que el resto ocurra sin que nadie lo pida.
3. **Le pedís algo** *(Vos)* — "hacé un botón de guardar en este formulario". No nombrás ningún skill.
4. **`search_skills("action button in a form")`** *(Agente)* — el agente traduce tu pedido a una consulta en inglés y busca. Recibe hasta 5 candidatos con su `when_to_use` y cuánto se usa cada uno. Sin contenido: es la llamada barata.
5. **Elige uno** *(Agente)* — compara los `when_to_use` contra la tarea. Si dos compiten, desempata con `uses_90d` y `people`: el que usan 24 personas es más canónico que el que usan 2.
6. **`get_skill("buttons")`** *(Agente)* — recién acá baja el contenido completo, el de un solo skill. Si estuviera deprecado, en vez del contenido recibe el slug del reemplazo y vuelve a llamar con ése.
7. **Escribe el código siguiendo la regla** *(Agente)* — y la consulta queda registrada, que es lo que después dice qué skills se usan de verdad.

Si la búsqueda vuelve vacía hay un octavo paso: el agente resuelve la tarea y después llama a `propose_skill`, para que la próxima persona reciba la misma respuesta en vez de improvisar otra distinta.

## ¿Se instala?

**Sólo los que usás, y sólo como caché.** No se instala nada en bloque y el catálogo sigue siendo la fuente de verdad.

Cuando el agente llama a `get_skill`, la respuesta trae dos campos de más: `file`, el skill como un `.md` autocontenido con frontmatter, y `save_as`, una ruta relativa tipo `.skill-hub/buttons.md`. El agente lo escribe ahí y la próxima vez lee la copia local en vez de volver a llamar — salvo que el catálogo reporte una `version` mayor que la del frontmatter del archivo, y ahí lo vuelve a bajar y lo sobrescribe. Si el skill está deprecado, le dice al agente que borre su copia y baje el reemplazo.

Para no chequearlos de a uno está `sync_skills`: el agente manda cada copia local como `{ slug, version }` y recibe, en un solo llamado, cuáles quedaron viejas (con el `file` nuevo), cuáles están deprecadas y cuáles ya no existen. Se corre una vez al arrancar la sesión.

| | Instalar en bloque | Cachear lo que usás |
| --- | --- | --- |
| Sin red | Todo | Los skills que ya bajaste |
| Actualizarse | Cada uno queda en la versión que bajó | El campo `version` trae cada archivo viejo al día en el próximo uso |
| Deriva | A los dos meses hay 11 versiones | Acotada: el catálogo manda, las copias no se editan a mano |
| Medir el uso | No se puede | `get_skill` igual registra la consulta que alimenta el ranking |
| Deprecar algo | Hay que avisar uno por uno | El agente recibe el redirect y descarta su copia solo |

Que el catálogo llegue a todos apenas cambia es potente y peligroso a la vez: un cambio malo se propagaría en la próxima consulta. Por eso nada se publica sin que un admin lo apruebe.

## Cómo lo usa la IA

El modelo no "sabe" que existe este catálogo. Lo que ocurre es más mecánico y vale entenderlo, porque explica varias decisiones del diseño.

Al conectarse, el cliente mete en el contexto del modelo dos cosas: el texto de `instructions` y la **definición de cada tool** — su nombre, su descripción y el esquema de sus parámetros. Eso queda ahí durante toda la sesión, ocupando lugar. Cuando le pedís algo, el modelo compara tu pedido contra esas descripciones y decide si alguna aplica.

> **Por qué seis tools y no cien.** Si el servidor publicara un tool por skill, las cien definiciones estarían permanentemente en el contexto de todos los agentes, y el modelo tendría que elegir entre cien opciones parecidas en cada turno. Con un puñado de tools genéricas, el catálogo puede crecer a mil skills sin que el costo en contexto cambie: lo que crece es lo que devuelve la búsqueda, no lo que el modelo carga de entrada.

Por eso también `search_skills` devuelve como máximo 5 resultados y sin contenido, por eso `description` y `when_to_use` tienen un tope de 200 caracteres validado al publicar, y por eso `get_skill` saca el HTML del preview — medido sobre el skill de botones, ese bloque solo era el 44% del payload, mandado a un lector que no puede usarlo.

Lo que el modelo recibe de vuelta es texto plano, que se suma a la conversación como si fuera un mensaje más. No hay magia: si el skill dice *"nunca un button pelado"*, el modelo lo lee y lo tiene presente al escribir, del mismo modo que tendría presente cualquier cosa que le hubieras dicho vos.

Consecuencia práctica: si un skill está mal escrito o es ambiguo, el agente lo va a seguir mal. La calidad del catálogo es la calidad del resultado — no hay una capa que corrija en el medio.

## Las tools

El servidor expone **seis**. Cinco son de sólo lectura; la sexta sólo puede crear propuestas provisionales. El patrón es divulgación progresiva: primero se busca barato, después se trae sólo lo que hace falta.

### search_skills

Encontrar la convención que aplica a la tarea que estás por hacer. Es la que más se usa: el agente la llama antes de escribir código, en cada tarea. Por eso su respuesta es barata — títulos y descripciones, sin contenido.

| Parámetro | Tipo | | Detalle |
| --- | --- | --- | --- |
| `query` | string | requerido | La tarea en lenguaje natural, en inglés. Ej: `"action button in a form"` |
| `stack` | angular · java · shared · infra | opcional | Acota a un stack |
| `type` | skill · convention · reference | opcional | Acota a un tipo |

**Devuelve:** hasta 5 candidatos con slug, título, `when_to_use` y las señales de uso (`uses_90d` y `people`) para desempatar. Si no hay nada, devuelve vacío y registra la búsqueda como convención faltante.

### get_skill

Traer el contenido completo del skill que el agente ya eligió. Siempre después de `search_skills`, con el slug que ésa devolvió. Nunca a ciegas: adivinar slugs desperdicia llamadas.

| Parámetro | Tipo | | Detalle |
| --- | --- | --- | --- |
| `slug` | string | requerido | Tal como lo devolvió `search_skills` |
| `version` | number | opcional | Una versión puntual; por defecto la última |

**Devuelve:** el markdown completo, con tags y versión, más `file` (el skill como `.md` autocontenido) y `save_as` (ruta relativa) para la copia local. El bloque de preview se saca. Si está deprecado, en vez del contenido devuelve el slug del reemplazo.

### sync_skills

Poner al día en un solo llamado las copias locales de `.skill-hub/`. Al arrancar una sesión, en vez de re-pedir cada skill para chequearlo.

| Parámetro | Tipo | | Detalle |
| --- | --- | --- | --- |
| `have` | `{ slug, version }[]` | requerido | Cada copia local, con la `version` de su frontmatter. Máximo 100 |

**Devuelve:** por cada slug su estado — `current` (dejarlo), `stale` (sobrescribir con el `file` que viene), `deprecated` (borrarlo y bajar `superseded_by`) o `gone` (borrarlo). No cuenta como uso.

### list_skills

Ver el índice completo de lo que existe. Para orientarse, no para resolver una tarea concreta — para eso `search_skills` es mejor.

| Parámetro | Tipo | | Detalle |
| --- | --- | --- | --- |
| `stack` | angular · java · shared · infra | opcional | Acota a un stack |
| `type` | skill · convention · reference | opcional | Acota a un tipo |

**Devuelve:** slug, título, `when_to_use` y `version` de todos los publicados. Sin contenido.

### get_port_registry

Saber qué puerto le corresponde a un servicio sin pisar el rango de otro equipo. Antes de levantar un servicio nuevo o escribir un docker-compose.

| Parámetro | Tipo | | Detalle |
| --- | --- | --- | --- |
| `service` | string | opcional | Filtra por servicio o equipo. Sin filtro devuelve el registro entero |

**Devuelve:** las líneas del registro que coinciden con el filtro, o la tabla completa.

### propose_skill

Llenar un hueco cuando no existe ninguna convención para la tarea. Sólo cuando `search_skills` no devolvió nada. La propuesta se sirve a los demás agentes enseguida, marcada como provisional, y se rechaza de plano si ya existe algo parecido.

| Parámetro | Tipo | | Detalle |
| --- | --- | --- | --- |
| `title` | string | requerido | Frase nominal corta, en inglés |
| `description` | string | requerido | Una oración, máximo 200 caracteres |
| `when_to_use` | string | requerido | Situaciones y sinónimos, máximo 200 caracteres |
| `stack` | angular · java · shared · infra | requerido | A qué lado aplica |
| `content` | string | requerido | Markdown que arranca con `## Rule` |
| `from_query` | string | requerido | La búsqueda que no devolvió nada |
| `rationale` | string | requerido | En qué se basó la regla. Esto lo lee un admin |
| `type` / `tags` / `slug` | opcionales | | El slug se deriva del título si se omite |

**Devuelve:** el slug que creó, o un rechazo con el skill existente cuando ya hay algo equivalente.

No hay ninguna tool que edite ni publique, a propósito. Si un agente pudiera publicar, cien agentes generarían casi-duplicados más rápido de lo que un admin puede revisar. Todo lo que se vuelve una decisión real pasa por esta web, por una persona.

## Las reglas

**Un skill por problema.** Si ya existe algo parecido, se propone un cambio ahí. Al crear uno nuevo, la app te avisa antes de que escribas el cuerpo. Podés crearlo igual, pero te pide una justificación que el admin lee al aprobar.

**Las versiones no se sobrescriben.** Cada cambio crea una versión nueva. Las anteriores quedan intactas y se pueden comparar. Volver atrás es un click.

**Nada se vuelve una decisión sin aprobación.** Un skill entra como borrador, o como propuesta provisional si lo escribió un agente. Un admin lo publica. Como todos leen siempre la última versión, un cambio malo llegaría a las 100 personas al instante: la aprobación es el contrapeso.

**Deprecar apunta al reemplazo.** Un skill deprecado deja de aparecer en las búsquedas, y los agentes que tenían el slug viejo reciben el puntero al nuevo. Se corrigen solos.

## Qué se registra

Dos cosas distintas, con reglas distintas:

**Auditoría de cambios.** Quién creó, editó, publicó o deprecó qué, y qué campos tocó. Se guarda para siempre y la ven los admins en Auditoría. La identidad queda congelada en el evento, así que el registro sigue siendo legible aunque la cuenta se dé de baja después.

**Telemetría de uso.** Qué skill se consultó y desde qué equipo, para saber cuáles se usan de verdad y cuáles conviene deprecar. **El detalle por persona se borra a los 90 días** y sólo quedan totales por skill y por equipo. En la app nunca se muestra quién consultó qué: se muestra "consultado 47 veces por 9 personas".

También se registran las búsquedas que **no encontraron nada**. Esa lista es la señal más valiosa del sistema: es el inventario, rankeado, de las convenciones que nos faltan escribir.

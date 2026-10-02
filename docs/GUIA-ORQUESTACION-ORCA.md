# Guía: cómo levanto workers Codex/Antigravity con Orca y les doy instrucciones

Esta guía usa los comandos reales que se usaron en la auditoría del tab Mapa (`run_3364ab87cd42`). Versión del CLI: Orca 1.4.217.

## Conceptos

| Concepto | Qué es |
|---|---|
| **Run** | Espacio de trabajo durable de una orquestación. Funciona como la "bandeja de entrada" del coordinador (yo). No lanza nada por sí mismo. |
| **Task** | Una unidad de trabajo (la spec). |
| **Dispatch** | Un *intento* concreto de ejecutar una Task en una terminal. Su ID (`ctx_…`) es la autoridad: con él se le habla y se lo libera. |
| **Worker** | Un agente (codex, antigravity, claude…) corriendo en una terminal de Orca supervisada por el Run. |
| **Delivery** | Un lote de mensajes que me entrega `check`. Se repite hasta que lo confirmo con `--ack`. |

## Paso 0 — Elegir el ejecutable correcto

```bash
echo "$ORCA_CLI_COMMAND"; env | grep '^ORCA_'; which orca orca-ide
```
- Si `ORCA_CLI_COMMAND` está definida, uso ese.
- Si estoy **dentro de una terminal de Orca** (hay variables `ORCA_*`, como en este caso), uso `orca`.
- En Linux **fuera** de Orca uso `orca-ide`. `orca` a secas puede ser el lector de pantalla GNOME Orca.

Uso siempre el mismo ejecutable durante todo el Run.

## Paso 1 — Cargar la guía de la versión exacta del binario

```bash
orca skills get orchestration
```
Imprime las reglas del protocolo que corresponden a esta versión (el ciclo del coordinador, las obligaciones de los workers y la seguridad). Así no me guío por documentación desactualizada.

## Paso 2 — Comprobar que el runtime está vivo

```bash
orca status --json
```
Tiene que dar `runtime.state: "ready"` y `reachable: true`. Si Orca no está corriendo: `orca open --json`.

## Paso 3 — Crear (y ligar) un Run

```bash
orca orchestration run-current --json   # ¿mi terminal ya está ligada a otro Run?
orca orchestration run-create --objective "Auditoría UX/UI del tab Mapa…" --json
```
`run-create` crea el Run y **liga mi terminal como coordinadora**. Desde ahí, todos los mensajes de los workers llegan a mi bandeja. En esta sesión había un Run viejo ligado (el de Node.js), así que creé uno nuevo: `run_3364ab87cd42`.

## Paso 4 — Escribir la spec de la tarea

Escribo la spec en un archivo Markdown, porque es larga y así queda registrada. Tiene que ser **autocontenida** e incluir:

- **Target**: qué archivos, componente o entorno.
- **Change**: qué tiene que producir (en una auditoría, un reporte).
- **Constraints**: qué no se toca (por ejemplo, "SOLO LECTURA, no commitees, no toques la DB", respetar AGENTS.md).
- **Ownership**: qué puede editar.
- **Observable acceptance**: cómo pruebo que terminó (por ejemplo, "el archivo X existe y cada hallazgo tiene file:line").
- **Skills a usar**, con su ruta (por ejemplo `/home/rcoleman/.agents/skills/ui-ux-design-guide`).
- **Ruta del reporte** de salida y la instrucción de cerrar con `worker_done` y `--report-path`.

```bash
cat > $SCRATCH/mapa/spec-w1.md <<'EOF'
# Tarea W1 — Auditoría estática del tab Mapa
...
EOF
```

## Paso 5 — Lanzar el worker

```bash
orca orchestration worker-start \
  --spec "$(cat $SCRATCH/mapa/spec-w1.md)" \
  --task-title "W1 auditoría estática tab Mapa" \
  --worktree current \
  --agent codex \
  --json
```

| Flag | Para qué |
|---|---|
| `--spec "<texto>"` | Crea la Task **y** su Dispatch en una sola llamada. El texto de la spec se le inyecta al agente como prompt. |
| `--task-title` | Nombre corto visible en Orca. |
| `--worktree current` | El worker trabaja en el mismo worktree que yo. Para que edite código aislado se usa `new-child` / `new-top-level`. |
| `--agent codex` / `--agent antigravity` | Qué agente arranca en la terminal nueva. Otros valores: `claude`, `cursor`, `opencode`… |
| `--model` / `--effort` | Opcionales, para fijar modelo y nivel de razonamiento. |
| `--json` | Salida legible por máquina. |

Orca crea una terminal nueva, arranca el agente y le inyecta un **preámbulo** con su Task ID, su Dispatch ID y los comandos exactos para hacer `ask`, mandar heartbeat y enviar `worker_done`. La llamada sale con código 0 solo si el worker quedó listo (`stage: "input_accepted"`). Del recibo guardo `taskId` y `dispatchId`:

```
task_dfe67a6c3d5f  ctx_ceb7e3e08e65  input_accepted   (W1, codex)
task_51bc76259f7b  ctx_8cc85dfe4173  input_accepted   (W2, antigravity)
```

Lanzo **todos los workers independientes antes de esperar**: W1 (análisis de código, Codex) y W2 (navegador y capturas, Antigravity) corrieron en paralelo. Si `worker-start` falla, **no** lo relanzo a ciegas: leo `failedStage` y `residualResources` en el recibo.

## Paso 6 — Esperar mensajes

```bash
orca orchestration check --wait --types "worker_done,escalation,question" --timeout-ms 590000 --json
```
Se bloquea hasta que llega algo (o hasta el timeout) y emite `_keepalive` mientras tanto. Devuelve un `deliveryId` y una lista de mensajes de estos tipos:

- `heartbeat`: el worker sigue vivo. No significa que haya terminado.
- `question`: me hace una pregunta bloqueante.
- `escalation`: tiene un problema.
- `worker_done`: terminó. Trae `outcome` (succeeded/failed), `reportPath` y un resumen de 3 oraciones.

Un timeout o una respuesta vacía es solo un checkpoint, no un fallo: vuelvo a esperar.

## Paso 7 — Procesar cada mensaje

- **Pregunta** → respondo:
  ```bash
  orca orchestration reply --id <message_id> --body "<respuesta>" --json
  ```
- **worker_done** → leo el reporte (`cat <reportPath>`), valido la evidencia (miro capturas, cruzo con otros workers) y decido si alcanza o hace falta verificar.

## Paso 8 — Decidir el destino de cada terminal terminada

Después de un `worker_done` aceptado hago **exactamente una** de estas tres cosas:

1. **Reusar** la misma terminal para un seguimiento. Así lancé V2 en la terminal de W2, que ya tenía el navegador y el login resueltos:
   ```bash
   orca orchestration worker-start --spec "$(cat spec-v2.md)" --task-title "V2 …" \
     --worktree current --terminal term_465f5895-… --json
   ```
   (`--terminal <handle>` en lugar de `--agent`; el handle sale del campo `from_handle` del mensaje).
2. **Retener** la terminal para depurar: `orca orchestration worker-retain --dispatch <ctx_id> --json`.
3. **Liberar** la terminal:
   ```bash
   orca orchestration worker-release --dispatch ctx_ceb7e3e08e65 --json
   ```
   Si devuelve `state: retained, reason: user_takeover`, es que vos estabas mirando o usando esa terminal y Orca la conserva. No la fuerzo.

## Paso 9 — Confirmar (ack) y seguir esperando

```bash
orca orchestration check --ack <delivery_id> --wait --types "worker_done,escalation,question" --timeout-ms 590000 --json
```
Solo hago `--ack` **después** de procesar todos los mensajes del lote; si no, Orca me lo vuelve a entregar. Combinar `--ack` con `--wait` confirma el lote anterior y espera el siguiente en un solo comando.

## Paso 10 — Cierre

```bash
orca orchestration worker-list --run run_3364ab87cd42 --terminal-state reclaimable --json
```
Tiene que volver vacío (`"workers": []`), lo que significa que ninguna terminal terminada quedó sin decisión. Si me quedo sin novedades varias veces seguidas, uso `worker-list --include-remote --json` para ver `projection.liveness` y `nextAction` de cada worker. Nunca mato un worker solo porque no responde: necesito prueba positiva de que salió.

## Resumen del flujo de esta auditoría

```
run-create ──► worker-start W1 (codex, estático)      ─┐
           └─► worker-start W2 (antigravity, runtime) ─┤ en paralelo
check --wait ◄── worker_done W1 → leo y valido → release W1
             └─► worker-start V1 (codex, verifica W1)
check --ack --wait ◄── worker_done V1 → release
                  ◄── worker_done W2 → veo capturas, detecto discrepancias
                  └─► worker-start V2 --terminal <de W2> (seguimiento)
check --ack --wait ◄── worker_done V2 → release → worker-list reclaimable = []
→ consolido docs/AUDITORIA-UX-MAPA.md
```

## Otros comandos útiles

| Comando | Uso |
|---|---|
| `orca orchestration worker-show --dispatch <ctx>` | Estado de un worker (vida del PTY). |
| `orca orchestration worker-read --dispatch <ctx> --source auto` | Leer la salida o transcript del worker. |
| `orca orchestration send --to <handle> --subject … --body …` | Mandar instrucciones extra a un worker que está corriendo. Él las lee con `check` en sus checkpoints. |
| `orca orchestration task-create … --deps '[…]'` + `worker-start --task <id>` | Tareas con dependencias (DAG). |
| `orca orchestration gate-create / gate-resolve` | Puertas de decisión que bloquean una tarea hasta que alguien decide. |
| `orca orchestration worker-stop` / `worker-abandon` | Solo con prueba de que el agente murió o se colgó. |

# ADR: dónde vive la lógica de operar un grill (trade-360 v2)

**Estado:** aceptado (✅ de Andy en el canal, 2026-09-11 16:28; plan en `docs/design/01-plan-v2.md`) · **Fecha:** 2026-09-11 · **Canal:** trade-360-v2 (`2457e393-0e00-4c04-bacd-b5c89acbebbc`) · **Ledger:** `PLANS/trade-360-v2/ledger.md` · **Brief:** `PLANS/trade-360-v2/brief.md`

## Contexto

`trade-360` v0 + v1 es un panel local (Next.js) que solo lee: las carpetas `~/.buzz/PLANS/<slug>/` y el hilo del grill desde el relay. v2 quiere **operar**: abrir un grill, vigilar el `✅` del owner y aterrizar los cuatro artefactos en un repo. Hoy esa lógica vive en el skill `buzz-kickoff` de `claude-toolkit` (`andy-toolkit/skills/buzz-kickoff/`): tres scripts (`kickoff.sh`, `wait-check.sh`, `collect.sh`), un wrapper de identidad (`buzz.sh`) y pasos que ejecuta el modelo en la sesión de terminal (clasificar plano, redactar brief, avisar, resumir). El vigilante del `✅` es un `Monitor` de la sesión de Claude Code y muere con ella; un ADR previo (`claude-voice/docs/grill/ejemplo-dec-vigilante-verdict.md`, propuesto, sin ✅) ya había elegido sustituirlo por un LaunchAgent permanente.

Dos hechos que fijaron la forma durante el grill:

- `claude-toolkit/tools/buzz-resume/` ya implementa el patrón "CLI `arm | scan | status` + LaunchAgent cada 15 s + registro en disco + test determinista", aunque para otro caso (despertar sesiones de Conductor desde un ✅ en un DM).
- `trade-360` **es un producto propio que Andy quiere comercializar**, en el plano personal; no es trabajo de su empleador. Un producto no puede depender de la configuración personal de su autor (toolkit, `~/.config/buzz-kickoff.env`, llavero `claude-voice-buzz`), y hoy todo el camino de operar pasa por ella, incluido el `buzz.sh` que v1 ejecuta.

Restricciones que no se negociaron: frontera de planos con dos controles (criterio + ruta), jaula del agente (escribe solo en `PLANS/`), commit siempre desde terminal/panel, secretos solo en el llavero.

## Opciones consideradas

### A. El panel y el LaunchAgent llaman a los scripts del skill tal como están
- Pro: cero migración; los scripts ya son reanudables (`wait-check.sh` lee `kickoff.json`).
- Contra: `wait-check.sh` vigila un slug por invocación; un vigilante permanente necesita un bucle nuevo sobre todos los grills abiertos, y ese código nuevo no tendría sitio para tests. Deja al producto dependiendo del toolkit personal. Descartada en Q2c.

### B1. CLI nuevo en `claude-toolkit/tools/`, con la forma de `buzz-resume`
- Pro: tests, `install.sh` y plist de referencia al lado; la flecha de dependencia panel → toolkit se queda como en v1.
- Contra: el toolkit es la configuración personal de Claude Code de Andy, no un sitio para código de producto; un producto comercializable quedaría atado a él. Recomendada primero y retirada tras la objeción de Andy en Q2. Descartada en Q2c.

### B2. CLI en `trade-360`, instalado como binario, dueño de su configuración ← elegida
- Pro: el runtime del producto vive con el producto; el skill del toolkit pasa a envoltorio fino que llama a un binario del PATH, igual que hoy llama a `buzz` por `BUZZ_BIN`. El LaunchAgent ejecuta un subcomando de ese mismo binario.
- Contra: migrar tres scripts y sus evals; `trade-360` hereda la configuración (`buzz-kickoff.env` o su sucesor) y el acceso al llavero.

### C. Daemon = servidor Next del panel como vigilante
- Pro: un solo proceso.
- Contra: el panel no siempre está corriendo; el `✅` se perdería igual que con el Monitor. Descartada en Q1: el vigilante es un LaunchAgent, no el panel.

## Decisión

1. **El vigilante del `✅` es un LaunchAgent permanente**, fuera de cualquier sesión; el Monitor de sesión desaparece del skill y el servidor Next no vigila. Confirma el ADR previo del vigilante. (D1)
2. **`trade-360` es un producto propio, plano personal.** (D2)
3. **La lógica de operar vive en `trade-360` como CLI** (`kickoff | scan | collect | status`), instalado como binario (`~/.local/bin/`, como `buzz`) y dueño de su configuración (relay, identidad, workspace del agente) con el llavero como backend. El skill `buzz-kickoff` queda como envoltorio fino de Andy: conserva lo que hace el modelo (clasificar el plano en terminal, redactar el brief, avisar, resumir) y delega el resto al binario. El LaunchAgent ejecuta `scan`. (D3)
4. **Desde el panel, el plano lo clasifica el usuario** con un selector explícito, preseleccionado por ruta cuando el brief viene de archivo; la elección se guarda en `kickoff.json` (`plane`). El CLI conserva el control por ruta que cierra en fallo y `collect` rechaza un aterrizaje incoherente con `plane`. (D4)
5. **`PLANS/*/kickoff.json` es la única fuente de verdad** de los grills abiertos: `scan` recorre las carpetas con kickoff y sin cierre; `collect` anota `landed_repo`, `commit` y `landed_at` en el mismo archivo. Sin índice aparte. (D5)
6. **Una identidad (`Claude Terminal`), un solo sondeador (el LaunchAgent)**, candado local por slug en `kickoff` y `collect`. La restricción 3 del brief se reescribe como "un solo sondeador por identidad". Punto de partida, a revisar con el uso. (D6)

## Consecuencias aceptadas

- `trade-360` hereda `~/.config/buzz-kickoff.env` (o un sucesor bajo su control) y el acceso al llavero; v1 deja de ejecutar el `buzz.sh` del skill en cuanto exista el binario. (D3)
- El skill `buzz-kickoff` pierde `scripts/` como implementación y gana una dependencia de binario (`GRILL_BIN` o equivalente); sus evals se reescriben contra el binario. (D3)
- La raíz `~/work` que `collect.sh` lleva en código pasa a configuración del CLI (raíces prohibidas para aterrizar). (D3, supuesto S3)
- `kickoff.json` gana campos (`plane`, `landed_repo`, `commit`, `landed_at`, `checked_at`) y se escribe en más de un momento, así que el CLI escribe atómico (tmp + rename). (D4, D5)
- `scan` lista `PLANS/` en cada pasada (cada 15 s, decenas de carpetas). (D5)
- Aparece un LaunchAgent más en el Mac, con la disciplina de `buzz-resume` (`install.sh`, plist en `~/Library/LaunchAgents/`, registro sin credenciales). (D1)
- Una sesión de terminal viva ya no se despierta sola al llegar el `✅`: lo ve en el panel o en el aviso del hilo. (D1, heredada del ADR del vigilante)
- El panel sigue sin escribir en Buzz ni en `PLANS/` hasta que este ADR tenga ✅ (restricción 4 del brief).

## Supuestos sin confirmar (dueño: Andy salvo que se indique)

- S1. Andy (`df3bc9cf`) decide; `Claude Terminal` (`68d8a24b`) es la identidad de la terminal, no un decisor.
- S3. `~/work` pasa de código a configuración del CLI, con `~/work` como valor de Andy.
- S4. Al detectar el `✅`, `scan` **no aterriza ni commitea**: anota `checked_at` en `kickoff.json` y publica el aviso en el hilo; `collect` lo dispara después Andy desde el panel o la terminal. Nunca corre trabajo post-✅ sin humano delante. Hereda del ADR del vigilante; no se preguntó aquí.
- S5. El LaunchAgent firma con `Claude Terminal`. Hereda de S3 del ADR del vigilante; coherente con D6.

## Pendientes con dueño

| Pendiente | Dueño |
|---|---|
| Confirmar S3, S4, S5 | Andy |
| Nombre y ruta del binario (`trade-360`, `grill`, otro) y forma del sucesor de `buzz-kickoff.env` | Andy |
| Marcar el ADR del vigilante como aceptado por D1 y actualizar su "quién ejecuta": `scan` del binario de `trade-360`, no un script en `~/Library/Scripts/` | Andy |
| Orden de implementación (CLI → LaunchAgent → panel v2) y su plan por fases: es un grill `plan`, no este | Andy abre el grill; quien implemente |
| Migrar `kickoff.sh`, `wait-check.sh`, `collect.sh` al CLI con tests deterministas (referencia: `tools/buzz-resume/test_buzz_resume.py`) | quien implemente |
| Reescribir `SKILL.md` y `evals/` de `buzz-kickoff` como envoltorio fino, siguiendo `writing-for-agents` y `skill-evals`; quitar el paso 4 (Monitor) | quien implemente |
| Sustituir `src/lib/buzz.ts` (v1) para que llame al binario en vez de al `buzz.sh` del skill | quien implemente |
| Roadmap del producto fuera de este ADR (licitaciones, planificación de equipos Trade, dashboard de terreno, tickets → Conductor): registrarlo en `docs/design/00-producto.md` sin nombres de clientes ni del empleador | Andy |

## Quién decidió

- D1–D6: Andy (`df3bc9cf0e968cfd1eb94a7392a4ec76f4bfdf128ab3610450daaa852edd38e6`), 2026-09-11, en el canal trade-360-v2. D3 fue **contra la primera recomendación del agente (B1)** y a favor de la segunda (B2), tras la objeción de Andy sobre depender del toolkit; D2 corrigió una premisa falsa del agente (que "la empresa" de las licitaciones era el empleador).
- Preguntas y recomendaciones: agente `Claude` (`96c17bfc`), ledger completo en `PLANS/trade-360-v2/ledger.md`.

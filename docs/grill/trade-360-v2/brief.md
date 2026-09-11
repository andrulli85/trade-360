# trade-360 v2: dónde vive la lógica de "operar" un grill

**Fuente:** repo personal `andrulli85/trade-360` (visible para ti en
`REPOS/personal/claude-toolkit/trade-360/`). Lee antes `docs/design/00-producto.md` de ese repo:
tiene el contexto heredado, las decisiones ya tomadas y el roadmap. Modo de este grill: **dec**.

## Qué es trade-360 hoy (v0 + v1, mergeado en `main`)

Panel web local (Next.js, corre desde la pestaña Run de Conductor) que **solo lee**:

- v0: las carpetas `~/.buzz/PLANS/<slug>/` (brief, kickoff.json, ledger, verdict) → lista de
  grills con estado abierto / cerrado ✅ / notas, y lectura de los artefactos.
- v1: el hilo del grill desde el relay (`buzz messages get` vía el `buzz.sh` del skill
  `buzz-kickoff`, identidad `Claude Terminal` desde el llavero) → tarjeta "te toca responder /
  turno de Claude / cerrado" y pestaña Hilo. Lista blanca de subcomandos de lectura.

## Qué es v2

"Operar" desde el panel lo que hoy hace el skill `/buzz-kickoff` desde una sesión de Claude Code
en la terminal: (a) abrir un grill (brief → canal privado → `@Claude /grill-me <modo>` →
kickoff.json), (b) vigilar el `✅` del owner, (c) aterrizar los cuatro artefactos en
`docs/grill/<slug>/` del repo correcto y commitear.

Hoy esa lógica está repartida así (todo en `claude-toolkit/andy-toolkit/skills/buzz-kickoff/`):

- `SKILL.md`: pasos que ejecuta **el modelo** en la sesión: clasificar la historia por plano
  (personal vs trabajo), redactar el brief, avisar al owner, resumir el veredicto.
- `scripts/kickoff.sh`: crea canal, añade miembros, publica el kickoff, escribe `kickoff.json`.
- `scripts/wait-check.sh`: sondea el canal hasta el `✅` exacto del owner, espera los artefactos.
  Lo sostiene un `Monitor` de la sesión de Claude Code: **muere con la sesión**.
- `scripts/collect.sh`: copia todo-o-nada al repo, rechaza cruces de plano (`~/work/`).
- `scripts/buzz.sh`: wrapper que carga la clave de `Claude Terminal` del llavero.

## La decisión que hay que tomar

**¿Dónde vive la lógica de operar un grill a partir de v2?** Tres opciones sobre la mesa:

- **A. El panel llama a los scripts del skill tal como están.** Panel = UI fina sobre
  `~/.claude/skills/buzz-kickoff/scripts/`. Cero duplicación. Problema: la clasificación de
  plano y la redacción del brief las hace hoy el modelo, no un script; el panel tendría que
  reimplementarlas o delegarlas al usuario (formulario).
- **B. La lógica se muda a este repo como CLI** (p. ej. `trade-360 kickoff | watch | collect`),
  y el skill `buzz-kickoff` pasa a ser un envoltorio fino que llama a ese CLI. Una sola
  implementación, testeable; panel y terminal usan lo mismo. Coste: migrar scripts + evals del
  skill; acopla `claude-toolkit` a `trade-360`.
- **C. Un daemon local** (el propio servidor Next del panel, o un proceso aparte) que además es
  el **vigilante permanente del ✅** para todos los grills abiertos, en vez de un Monitor por
  sesión. Resuelve el ADR pendiente del vigilante (`claude-voice/docs/grill/ejemplo-dec-vigilante-verdict.md`).
  Coste: el diseño más grande; exige un registro persistente de grills abiertos y decidir qué
  pasa cuando el panel no está corriendo.

Recomendación previa del terminal (no confirmada por Andy): **B, dejando la puerta abierta a C**
como primera capa encima (el watcher permanente).

## Lo que NO se negocia (restricciones)

1. **Frontera de planos.** Artefactos de historias del plano de trabajo (`~/work/`, trackers
   corporativos) nunca aterrizan en repos personales. Hoy lo impone `collect.sh` por ruta y el
   modelo por criterio. Cualquier opción debe conservar ambos controles.
2. **Jaula del agente.** El agente `Claude` de Buzz escribe solo en `~/.buzz/PLANS/`. El commit
   al repo lo hace siempre la terminal/panel (autor = Andy), nunca el agente.
3. **Una sola identidad terminal por proceso.** `Claude Terminal` no debe correr en dos sitios
   a la vez con la misma clave (panel + sesión de Claude Code sondeando el mismo canal es un
   caso a resolver, no a ignorar).
4. **El panel no escribe** en Buzz ni en `PLANS/` hasta que esta decisión esté tomada.
5. Secretos solo en el llavero; el panel nunca ve la clave (hoy pasa por `buzz.sh`).

## Preguntas abiertas que el grill debería cerrar o asignar

- Q-a: ¿A, B o C? ¿Y en qué orden si es B→C?
- Q-b: Si B: ¿el CLI vive en `trade-360` (y `claude-toolkit` depende de él) o en
  `claude-toolkit` (y `trade-360` depende del toolkit, como ya hace con `buzz.sh`)?
- Q-c: ¿Quién clasifica el plano cuando el grill se abre desde el panel: el usuario (selector
  explícito), una heurística por ruta, o se pide a un modelo? ¿Qué pasa si se equivoca?
- Q-d: ¿Cómo sabe el panel en qué repo aterrizó un grill? Propuesta: `collect.sh` anota
  `landed_repo` y `commit` en `kickoff.json`.
- Q-e: Registro de grills abiertos: ¿basta `PLANS/*/kickoff.json` como fuente de verdad, o hace
  falta un índice propio (sqlite/json) para el vigilante?
- Q-f: Coexistencia: mientras el panel vigila, ¿la sesión de Claude Code deja de armar su
  Monitor, o ambos pueden observar el mismo canal en solo lectura sin conflicto de identidad?

## Fuera de alcance de este grill

Diseño visual del formulario de kickoff, soporte para compañeros de equipo (allowlist del
agente), workflows del vault desde el panel, puesto de trabajo portable.

# Grill: trade-360-v2

**Modo:** dec · **Canal:** trade-360-v2 (`2457e393-0e00-4c04-bacd-b5c89acbebbc`) · **Inicio:** 2026-09-11
**Brief:** `PLANS/trade-360-v2/brief.md` — dónde vive la lógica de operar un grill a partir de v2 (A scripts del skill / B CLI / C daemon vigilante)
**Hilo:** raíz `1984b9262f25c0f971f16685b1fb5d10a3518d7b6b235e37a032b60bc1bbe90a` · **Owner:** Andy `df3bc9cf`

Hechos leídos antes de la primera pregunta (no se preguntan):

- `trade-360` `origin/main` (`d885a3d`): `src/lib/buzz.ts` ejecuta `~/.claude/skills/buzz-kickoff/scripts/buzz.sh` con lista blanca `messages get | users get | channels get`. El panel ya depende del toolkit.
- `claude-toolkit/andy-toolkit/skills/buzz-kickoff/`: `SKILL.md` (120 líneas; pasos 1, 2 y 5 los hace el modelo: clasificar plano, redactar brief, avisar), `scripts/kickoff.sh` (40), `wait-check.sh` (68, bucle `sleep 30` + espera de artefactos 120 s), `collect.sh` (67, frontera `~/work` por ruta, exit 3), `buzz.sh` (14, llavero). `evals/evals.json` + `harness/` prueban el skill.
- ADR del vigilante (`claude-voice/docs/grill/ejemplo-dec-vigilante-verdict.md`): **propuesto, sin ✅**. Eligió O4: LaunchAgent permanente que **reemplaza** al Monitor de sesión, solo avisa por Buzz, nunca reanuda sesiones. Pide un registro en disco de grills abiertos.
- `wait-check.sh` ya es reanudable: lee `channel_id` y `started_at` de `kickoff.json`, así que cualquier proceso puede retomar la misma ventana.

## Árbol de diseño (estado)

- [x] **Criterio que separa las opciones**: el vigilante del ✅ es un LaunchAgent permanente — DECIDIDA (Q1, D1)
  - [x] Qué pasa cuando el panel no corre: el LaunchAgent sigue vigilando; el panel solo lee — RESUELTA por D1
  - [x] Opción C como "servidor Next = daemon": descartada por D1 — RESUELTA
  - [x] **En qué plano vive `trade-360`**: personal; producto propio a comercializar, no trabajo del empleador — DECIDIDA (Q3, D2)
    - [ ] Producto comercializable ⇒ nada de su runtime puede depender de la configuración personal de Andy (toolkit, `~/.config/buzz-kickoff.env`, llavero `claude-voice-buzz`) — consecuencia de D2, pendiente de aceptar en Q2c
  - [x] Dónde vive el código: **B2**, CLI en `trade-360` instalado como binario, dueño de su configuración; el skill `buzz-kickoff` queda como envoltorio fino — DECIDIDA (Q2c, D3)
    - [x] Qué ejecuta el LaunchAgent: el binario de `trade-360` (`scan`), no `buzz-resume` — RESUELTA por D3; `buzz-resume` queda como referencia de forma
    - [x] Producto comercializable ⇒ el runtime no depende del toolkit — ACEPTADA en D3
- [ ] **Consecuencias**
  - [x] Clasificación de plano desde el panel: **el usuario, selector explícito** guardado en `kickoff.json` (`plane`), preseleccionado por ruta; control por ruta del CLI cierra en fallo — DECIDIDA (Q4, D4)
    - [ ] La regla `~/work` de `collect.sh` pasa a ser configuración del CLI (raíces prohibidas), no código — consecuencia de D3, sin objeción en Q4; se lista como supuesto S3
  - [x] Registro de grills abiertos: **`PLANS/*/kickoff.json` es la única fuente**; `collect` anota `landed_repo`, `commit`, `landed_at` — DECIDIDA (Q5, D5)
    - [x] Cómo sabe el panel dónde aterrizó (Q-d) — RESUELTA por D5
  - [x] Coexistencia de la identidad `Claude Terminal`: **una identidad, un solo sondeador, candado local por slug**; a revisar con el uso — DECIDIDA (Q6, D6)
- [x] **Problema**: dado por el brief; cerrado con D1–D6 — frontera vacía el 2026-09-11
  - [x] Qué parte del skill sigue siendo del modelo: clasificar (ahora solo en terminal; en panel es D4), redactar brief, avisar, resumir; todo lo demás al CLI — RESUELTA por D3

## Decisiones (confirmadas por un humano)

- D1. El vigilante del ✅ a partir de v2 es un **proceso permanente fuera de la sesión (LaunchAgent)**, que también alimenta al panel. Ni el Monitor de sesión ni el servidor Next. Confirma la intención del ADR O4 del vigilante. (Q1, 2026-09-11, Andy `df3bc9cf`)
- D2. `trade-360` vive en el **plano personal**: es un producto propio que Andy quiere comercializar (cockpit con pestaña Buzz, licitaciones, planificación de equipos Trade, dashboard de terreno, tickets → Conductor). No es trabajo del empleador; las licitaciones son de un cliente del producto. (Q3, 2026-09-11, Andy `df3bc9cf`)
- D3. **B2.** El CLI de operar (`kickoff | scan | collect | status`) vive en `trade-360`, se instala como binario y es dueño de su configuración (relay, identidad, workspace del agente) con el llavero como backend. El skill `buzz-kickoff` del toolkit pasa a ser un envoltorio fino que llama a ese binario y conserva solo la parte del modelo (clasificar, redactar brief, avisar, resumir). Consecuencias aceptadas: `trade-360` hereda `buzz-kickoff.env` o su sucesor; v1 deja de ejecutar el `buzz.sh` del skill en cuanto exista el binario; el LaunchAgent de D1 ejecuta `scan` de ese binario. (Q2c, 2026-09-11, Andy `df3bc9cf`)
- D4. Cuando el grill se abre desde el panel, **el usuario clasifica el plano con un selector explícito** en el formulario, preseleccionado por ruta cuando el brief viene de archivo; la elección se guarda en `kickoff.json` (`plane`). El CLI conserva el control por ruta que cierra en fallo; `collect` rechaza un aterrizaje incoherente con `plane`. (Q4, 2026-09-11, Andy `df3bc9cf`)
- D5. **`PLANS/*/kickoff.json` es la única fuente de verdad** de los grills abiertos: `scan` recorre las carpetas con kickoff y sin cierre; `collect` anota `landed_repo`, `commit` y `landed_at` en el mismo archivo (cierra Q-d del brief). Sin índice aparte. Consecuencias aceptadas: `scan` lista `PLANS/` en cada pasada; el CLI escribe `kickoff.json` de forma atómica (tmp + rename). (Q5, 2026-09-11, Andy `df3bc9cf`)
- D6. **Una sola identidad (`Claude Terminal`), un solo sondeador (el LaunchAgent)**; el CLI toma un candado local por slug en `kickoff` y `collect`. La restricción 3 del brief se reescribe como "un solo sondeador por identidad". Aceptada como punto de partida: "probemos con 1 y vamos evolucionando con el tiempo". (Q6, 2026-09-11, Andy `df3bc9cf`)

## Supuestos (míos, hasta que alguien los confirme o corrija)

- S1. "Andy" (`df3bc9cf`) es quien decide; `Claude Terminal` (`68d8a24b`) es la identidad de la terminal que abrió el canal, no un decisor. Corrígeme si no.
- S2. ~~El ADR del vigilante (O4, LaunchAgent) sigue siendo la intención vigente aunque no tenga ✅.~~ Confirmado por D1.
- S3. Con D3, la raíz `~/work` que `collect.sh` lleva en código pasa a ser configuración del CLI (lista de raíces prohibidas para aterrizar), con `~/work` como valor de Andy. Sin objeción en Q4. Corrígeme si no.
- S4. Al detectar el ✅, `scan` **no aterriza ni commitea**: anota `checked_at` en `kickoff.json` y publica el aviso en el hilo (como pide el ADR del vigilante, S2 de ese ADR); `collect` lo dispara después Andy desde el panel o la terminal. Nunca corre trabajo post-✅ sin humano delante. No se preguntó; hereda del ADR del vigilante.
- S5. El LaunchAgent firma con `Claude Terminal` (S3 del ADR del vigilante), coherente con D6.

## Registro de preguntas

### Q1 — Quién sostiene el vigilante del ✅ en v2
**Pregunta:** ¿quién detecta el `✅` del owner a partir de v2? (1) la sesión de Claude Code con su Monitor, como hoy; (2) un proceso permanente fuera de la sesión (LaunchAgent, como eligió el ADR O4), que también sirve al panel; (3) el servidor Next del panel mientras esté corriendo.
**Recomendación:** (2). El ADR ya lo eligió y el brief exige decidir qué pasa con el panel apagado: un LaunchAgent sigue vigilando; el panel no. (1) es lo que v2 quiere dejar atrás. Con (2), C se reduce a "el panel lee el registro que escribe el vigilante" y A/B pasan a ser solo dónde vive el código que el LaunchAgent ejecuta.
**Respuesta:** "2" — Andy `df3bc9cf`, 2026-09-11

### Q2 — Dónde vive el código que corre el LaunchAgent y llama el panel
**Hecho nuevo:** `claude-toolkit/tools/buzz-resume/` ya es exactamente ese patrón: `buzz_resume.py arm|scan|status`, registro en `~/.buzz/RESUME/<slug>.json` (0600, sin credenciales), LaunchAgent cada 15 s vía `install.sh`, test determinista `test_buzz_resume.py` con Buzz y Conductor falsos. Vigila un `✅` del owner en un DM y despierta una sesión de Conductor; no sabe de grills.
**Pregunta:** (A) el LaunchAgent y el panel llaman a los scripts del skill tal cual (`kickoff.sh`, `wait-check.sh`, `collect.sh`) y se añade al skill un bucle sobre todos los grills abiertos; (B1) un CLI nuevo en `claude-toolkit/tools/` con la forma de `buzz-resume` (`kickoff | scan | collect | status`), que el skill y el panel llaman; la flecha de dependencia panel → toolkit se queda como está; (B2) el CLI en `trade-360` y el skill del toolkit depende de `trade-360`.
**Recomendación (primera):** B1. La flecha ya apunta panel → toolkit (`src/lib/buzz.ts` ejecuta el `buzz.sh` del skill); B2 la invierte y hace que el skill dependa de un checkout que en otro Mac puede no existir (`SETUP.md`, puesto portable). A necesita código nuevo igual (el bucle sobre el registro) y lo deja sin sitio para tests; en `tools/` ya hay tests, `install.sh` y plist de referencia. Coste de B1: migrar tres scripts y sus evals; `claude-toolkit` sigue sin saber nada de `trade-360`.
**Objeción de Andy (2026-09-11, `df3bc9cf`):** "¿tiene sentido como solución definitiva, al construir agentes en Conductor, que los skills se encuentren en mi toolkit? No estoy seguro."
**Recomendación (revisada):** B2 con forma de **binario instalado**. La prueba que decide el sitio: *¿quién tiene que poder ejecutar esta lógica sin la configuración personal de Andy delante?* Un LaunchAgent y un panel son procesos de runtime, no instrucciones para un modelo: pertenecen al repo del producto (`trade-360`). En el toolkit queda solo lo que consume el modelo: la prosa de `/buzz-kickoff` (clasificar plano, redactar brief, avisar) y un puntero al binario. El skill ya depende así de `buzz` (`BUZZ_BIN` en `~/.config/buzz-kickoff.env`); un `GRILL_BIN` más no invierte ninguna flecha. Mi primera recomendación pesó la flecha de dependencia y no esta prueba.
**Respuesta:** (pendiente; Q2 reformulada como Q2b)

### Q2b — Sitio del CLI, reformulada tras la objeción
**Pregunta:** (B2) el CLI vive en `trade-360` y se instala como binario (`~/.local/bin/`, como `buzz`); el skill `buzz-kickoff` lo llama por `GRILL_BIN` desde `~/.config/buzz-kickoff.env` y se queda con la parte del modelo. (B1) el CLI en `claude-toolkit/tools/`, como `buzz-resume`. (A) scripts del skill tal cual más un bucle.
**Recomendación:** B2.
**Respuesta:** sin respuesta directa. Andy (2026-09-11, `df3bc9cf`) amplía la visión del repo: "quiero construir en este repositorio un aplicativo que me permita organizar las cosas": pestaña Buzz (grill-me, wayfinder y otros en colaboración), generador de licitaciones (datos de la empresa, carpeta en su Escritorio), generador de planificación del equipo Trade, dashboard en vivo del equipo en terreno, tickets de issues de la plataforma en un tracker (Jira o uno con integración con Conductor) que se comunican con Conductor para levantar y resolver el problema. Pregunta si tiene sentido. → Q2b queda **en espera** de Q3: el sitio del CLI depende del plano del repo.

### Q3 — En qué plano vive `trade-360`
**Hecho (como lo leí entonces, corregido más abajo):** de la lista de Andy, cuatro de cinco piezas consumen datos o usuarios de una empresa (licitaciones, planificación Trade, terreno, tickets de plataforma). Restricción 1 del brief y regla de registro de `claude-toolkit/CLAUDE.md`: contenido del plano de trabajo nunca aterriza en repos personales; `andrulli85/trade-360` está en GitHub personal. Si esa empresa fuera el empleador, la lista fallaría la prueba de plano.
**Pregunta:** (1) `trade-360` se queda en el plano personal: es el cockpit de Andy (pestaña Buzz + operar grills, incluidos grills de historias de trabajo, cuyos artefactos ya se quedan en `PLANS/`); licitaciones, planificación, terreno y tickets van a un repo del plano de trabajo. (2) `trade-360` pasa al plano de trabajo (se convierte en la app del equipo Trade); entonces el operador de grills necesita un hogar instalable desde ambos planos, separado del toolkit y de la app. (3) todo en este repo, en el plano personal.
**Recomendación:** (1). Es la única que pasa la prueba de plano sin mover nada hoy y mantiene válida la respuesta B2 a Q2b. (3) la descarto: rompe la restricción 1. (2) es legítima pero es otro producto y otro grill.
**Respuesta:** "personal: es una aplicación que quiero en el futuro comercializar y no es el trabajo que realizo en [su empleador]" — Andy `df3bc9cf`, 2026-09-11.
**Corrección mía:** en Q3 supuse que "la empresa" de las licitaciones era el empleador de Andy. No: es un cliente de su propio producto. Las cinco piezas de la lista están en el plano personal; la prueba de plano pasa entera. La premisa de la opción (2) era falsa. Lo que sí queda en pie: la regla de no escribir nombres del empleador en archivos que acaban en GitHub personal.

### Q2c — Sitio del CLI, con D2 encima
**Consecuencia de D2:** un producto que se va a vender no puede depender de la configuración personal de su autor. Hoy todo el camino de operar pasa por ella: el skill `buzz-kickoff` (toolkit), `~/.config/buzz-kickoff.env`, el llavero `claude-voice-buzz`, y en v1 el propio panel ejecuta `~/.claude/skills/buzz-kickoff/scripts/buzz.sh`. Eso responde a la duda de Q2: el toolkit es la configuración de Andy, no un sitio para código de producto.
**Pregunta:** (B2) el CLI (`kickoff | scan | collect | status`) vive en `trade-360`, se instala como binario, y es el dueño de su configuración (relay, identidad, workspace del agente) con el llavero como backend; el skill `buzz-kickoff` queda como envoltorio fino de Andy que llama a ese binario. (B1) en `claude-toolkit/tools/`. (A) scripts del skill más un bucle.
**Recomendación:** B2. Con D2 es la única coherente. Consecuencia a aceptar: `trade-360` hereda la configuración (`buzz-kickoff.env` o sucesor) y v1 deja de llamar al `buzz.sh` del skill en cuanto exista el binario.
**Respuesta:** "B2" — Andy `df3bc9cf`, 2026-09-11

### Q4 — Quién clasifica el plano cuando el grill se abre desde el panel
**Hecho:** hoy hay dos controles (restricción 1): el modelo clasifica por criterio en el paso 1 de `SKILL.md` (¿el universo de trabajo abriría la fuente de esta historia?) y `collect.sh` lo impone por ruta (`~/work`, exit 3, fail-closed) sobre el destino y sobre `brief_source` de `kickoff.json`. Con D3 el segundo control pasa al CLI, y en un producto la raíz `~/work` deja de ser código para ser configuración (raíces prohibidas para aterrizar).
**Pregunta:** ¿quién sustituye al modelo en el primer control cuando no hay sesión de Claude Code? (a) el usuario, con un selector explícito en el formulario, preseleccionado por ruta cuando el brief viene de archivo; (b) una heurística por ruta y palabras clave, sin preguntar; (c) se pide a un modelo desde el panel. Y qué pasa si se equivoca.
**Recomendación:** (a) + el control por ruta fail-closed del CLI. Quien abre el grill es quien sabe de quién es la historia; un selector que se guarda en `kickoff.json` (`plane`) deja rastro de la decisión y hace que `collect` pueda rechazar un aterrizaje incoherente con ella. (b) adivina con texto pegado y falla en silencio; (c) mete un modelo en el camino de un formulario para responder una pregunta de una línea. Si el usuario se equivoca y marca personal una historia de trabajo, el control por ruta sigue atrapando los casos que una ruta puede decir; los que no, quedan como hoy (criterio humano), con la diferencia de que la elección queda escrita.
**Respuesta:** "A" (= opción a, el usuario con selector) — Andy `df3bc9cf`, 2026-09-11

### Q5 — Registro de grills abiertos: fuente única o índice aparte
**Hecho:** `wait-check.sh` ya lee todo lo que necesita de `PLANS/<slug>/kickoff.json` (`channel_id`, `started_at`); el panel v0 deriva "abierto" de "kickoff sin verdict" leyendo `PLANS/*/`; `buzz-resume` en cambio usa un índice aparte (`~/.buzz/RESUME/<slug>.json`) porque no tiene una carpeta por caso. `kickoff.json` lo escribe el lado terminal/panel, nunca el agente (la jaula del agente solo protege sus propios archivos: brief, ledger, verdict), así que el CLI puede mutarlo sin romper la restricción 2.
**Pregunta:** (1) `PLANS/*/kickoff.json` es la única fuente: `scan` recorre las carpetas con kickoff y sin cierre, y `collect` anota ahí `landed_repo`, `commit` y `landed_at` (esto es la propuesta Q-d del brief); (2) un índice aparte (`~/.buzz/GRILLS/<slug>.json` o sqlite) escrito por `kickoff`, `scan` y `collect`, y `kickoff.json` se queda como está.
**Recomendación:** (1). Prueba: ¿hay un dato que el vigilante o el panel necesiten y que no quepa en `kickoff.json`? No: canal, raíz y cutoff ya están; faltan `plane` (D4), `landed_repo`, `commit`. Un índice aparte son dos verdades que pueden discrepar (kickoff sin entrada, entrada sin carpeta) y el panel tendría que reconciliarlas. Coste de (1): `scan` hace un `ls` de `PLANS/` cada 15 s (decenas de carpetas, no miles) y `kickoff.json` pasa a tener escritura en dos momentos (kickoff, collect), así que el CLI escribe atómico (tmp + rename).
**Respuesta:** "1" — Andy `df3bc9cf`, 2026-09-11

### Q6 — Coexistencia de la identidad `Claude Terminal`
**Hecho:** la restricción 3 del brief nace del caso "panel + sesión de Claude Code sondeando el mismo canal". Con D1 ese caso desaparece: el único proceso que sondea es el LaunchAgent (`scan`). Panel y sesión de terminal solo hacen llamadas de una vez (`kickoff`, `collect`, lecturas) a través del mismo binario. Firmar con la misma clave desde varios procesos no es un conflicto para el relay; el conflicto real es que dos procesos produzcan el mismo efecto secundario (dos canales para un slug, dos avisos, dos aterrizajes). `tools/lib/lease.mjs` del toolkit no aplica (es un lease entre máquinas sobre git); basta un candado local por slug.
**Pregunta:** (1) cerrada por D1: una sola identidad, un solo sondeador (LaunchAgent), y el CLI toma un candado local por slug en `kickoff` y `collect` para que panel y terminal no dupliquen efectos; la restricción 3 se reescribe como "un solo sondeador por identidad". (2) identidad aparte para el LaunchAgent y el panel (p. ej. `Claude Panel`): otra clave en el llavero, otro miembro en cada canal, y `wait-check`/`scan` deben reconocer el ✅ igual; el skill de terminal sigue con `Claude Terminal`.
**Recomendación:** (1). Prueba: ¿pueden dos procesos producir el mismo efecto sobre el mismo grill? Solo si sondean los dos, y D1 deja uno. (2) añade una identidad para resolver un problema que ya no existe y ensucia cada canal con un miembro más.
**Respuesta:** "probemos con 1 y vamos evolucionando con el tiempo" — Andy `df3bc9cf`, 2026-09-11

## Cierre

Frontera vacía tras Q6. Veredicto (ADR) en `PLANS/trade-360-v2/verdict.md`, 2026-09-11.

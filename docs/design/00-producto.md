# trade-360: panel local de la integración Buzz ↔ Conductor

Estado: borrador inicial, 2026-09-11. Repo nuevo, arrancado desde cero; el contexto viene de
`claude-voice` (rama `redefinir-proyecto-claude-voice` y PRs #1–#4) y de `claude-toolkit`
(skill `buzz-kickoff`). Este documento recoge lo decidido allí para no volver a investigarlo.

## De dónde viene

En `claude-voice` se construyó y probó el flujo completo terminal → Buzz → repo:

| Pieza | Dónde vive | Qué hace |
|---|---|---|
| Agente `Claude` (Buzz Desktop, runtime Claude Code) | `~/.buzz` (cwd), jaula en `~/.buzz/.claude/settings.json` | Interroga en el hilo con el skill `grill-me`; escribe **solo** en `~/.buzz/PLANS/<slug>/` |
| Identidad `Claude Terminal` | llavero `claude-voice-buzz`; nunca arrancar ni borrar | Con ella la terminal lee/escribe Buzz vía `buzz-cli` |
| Skill `/buzz-kickoff` | `claude-toolkit/andy-toolkit/skills/buzz-kickoff` | Brief → canal privado → `/grill-me` → espera `✅` → copia artefactos a `docs/grill/<slug>/` y commitea |
| Config local | `~/.config/buzz-kickoff.env` | Relay, pubkeys, cuentas del llavero, `AGENT_HOME` |
| Reproducir en otro Mac | `claude-voice/buzz/SETUP.md` + `install.sh` | Pasos por máquina; investigación en `docs/research/2026-09-11-puesto-de-trabajo-portable.md` |

Artefactos de un grill (cuatro archivos en `PLANS/<slug>/`): `brief.md`, `kickoff.json`
(`channel_id`, `root_event_id`, `mode`, `started_at`), `ledger.md` (árbol de diseño, decisiones,
supuestos, registro Q/A) y `verdict.md` (forma según modo `rf|oq|dec|plan|doc`).

Decisiones ya tomadas que este repo respeta:

- El agente escribe solo en `PLANS/`; la copia al repo la hace la terminal (autor = terminal).
- Frontera de planos: historias de trabajo (`~/work`, trackers corporativos) nunca aterrizan en
  repos personales. `collect.sh` lo impone por ruta; el panel no debe saltárselo.
- En canal se escribe siempre `@Claude`; el cierre es un mensaje con `✅`, no una reacción.
- Fork de la UI de Buzz descartado (solo lo vería quien instale el build); la vía para el equipo
  es upstream (block/buzz#2528). Por eso el front vive **fuera** de Buzz, como app local.

## Qué es trade-360

Un **producto propio de Andrés**, en el plano personal, con intención de comercializarlo (D2 del
ADR `docs/grill/trade-360-v2/verdict.md`). No depende de la configuración personal de su autor
(toolkit, `buzz-kickoff.env`, llavero de `claude-voice`); lo que hoy la usa está en transición
(ver `01-plan-v2.md`). Roadmap de producto, sin registrar todavía en detalle: apoyo a
licitaciones, planificación de equipos de trade marketing, dashboard de terreno, y tickets que
se convierten en trabajo para agentes en Conductor.

Su primera pieza es una **web app local** (Next.js, se levanta desde la pestaña Run de Conductor)
que da la vista que hoy solo existe repartida entre la terminal, `PLANS/` y los canales de Buzz:

1. **v0 — leer (hecho)**: lista de grills en `<AGENT_HOME>/PLANS/`, estado
   (`abierto` = kickoff sin verdict, `cerrado` = verdict presente, `notas` = carpeta sin kickoff),
   modo, canal, fechas, y lectura de brief/ledger/verdict renderizados. Cero escrituras.
2. **v1 — observar Buzz (hecho)**: en la página del grill, tarjeta de turno ("te toca
   responder" con la última pregunta del agente / "turno de Claude" / "cerrado con ✅") y pestaña
   **Hilo** con los mensajes del kickoff y sus respuestas, autores resueltos por pubkey. Se lee
   con `buzz messages get` con la identidad `Claude Terminal` (desde F1, `src/core/relay.ts`
   en vez del `buzz.sh` del skill); la lista principal sigue siendo de disco para no golpear el
   relay por cada fila.
3. **v2 — operar (decidido, en plan)**: la lógica de operar pasa a un CLI **`t360`** en este
   repo (`kickoff | scan | collect | status`), el vigilante del ✅ es un LaunchAgent que ejecuta
   `t360 scan`, y el skill `buzz-kickoff` queda como envoltorio fino. El panel abre grills y
   aterriza artefactos solo a través de `t360`. ADR: `docs/grill/trade-360-v2/verdict.md`;
   fases: `01-plan-v2.md`.
4. **Después**: workflows del vault (`/deep-research-lite`, `/retro`) como atajos, estado de los
   agentes (`buzz-acp` corriendo, cuál), y puesto portable (qué falta en esta máquina según
   `SETUP.md`).

## Arquitectura (F1–F3 del plan v2, 2026-09-11)

La lógica vive en `src/core/`, sin dependencias de Next, y la consumen dos caras: el panel (vía
`src/lib/`, reexportaciones `server-only`) y el CLI `t360` (`src/cli/`). Tests con `node --test`
sobre un `$HOME` temporal, un `buzz` falso y un `security` falso: sin red ni llavero.

- `src/core/config.ts`: lee `~/.config/t360/config.toml` (`[agent]`, `[owner]`, `[relay]`,
  `[keychain]`, `[landing]`) y, si no existe, `~/.config/buzz-kickoff.env` con las claves del
  skill. Solo rutas, nombres y pubkeys; la referencia al llavero son nombres de servicio y cuenta.
- `src/core/grills.ts`: modelo `Grill` a partir del disco. Los slugs se validan (`^[a-z0-9-]+$`)
  antes de convertirse en ruta. `STATUS_LABEL` y `MODE_LABEL` son las etiquetas que comparten
  panel y CLI.
- `src/core/relay.ts`: sustituye el exec de `buzz.sh`. `createRelay({ allow })` lee la clave
  con `security find-generic-password` en el momento de la llamada y ejecuta `buzz_bin` con
  `BUZZ_PRIVATE_KEY`/`BUZZ_AUTH_TAG` en el entorno del hijo. La lista blanca por defecto es de
  lectura (`messages get`, `users get`, `channels get`) y es la única que ve el panel; el CLI la
  amplía por subcomando cuando lleguen `kickoff`/`collect`/`scan`.
- `src/core/thread.ts`: filtra los mensajes del canal a los que responden al `root_event_id`,
  resuelve autores (cache por relay) y deriva el **turno**; `describeTurn` produce el texto de la
  tarjeta que pintan tanto el panel como `t360 status`.
- `src/core/kickoff-file.ts`: `kickoff.json` como único registro (D5): campos v2 (`plane`,
  `brief_source`, `checked_at`, `landed_repo`, `commit`, `landed_at`), escritura atómica
  (tmp + rename) y candado por slug (`PLANS/<slug>/.lock`, O_EXCL; uno rancio se borra a mano).
- `src/core/plane.ts`: la frontera de planos que una ruta puede decidir: `landing.forbidden_roots`
  de la config (`~/work` por defecto), realpath con symlinks seguidos y colas inexistentes.
- `src/core/kickoff.ts` (`t360 kickoff`): migra `kickoff.sh`. `--plane` obligatorio (D4); un
  brief bajo raíz prohibida solo puede abrirse como `work`. Escribe `brief.md`, crea el canal
  privado, añade miembros, publica `@<agente> /grill-me <modo> PLANS/<slug>/brief.md` y guarda
  `kickoff.json` bajo candado. Si el relay falla a medias no hay `kickoff.json` y el error nombra
  el canal creado.
- `src/core/collect.ts` (`t360 collect`): migra `collect.sh` y lo que el skill hacía a mano:
  copia todo-o-nada por directorio temporal + rename, rechaza `plane=work`, brief/repo/destino
  bajo raíz prohibida y destino symlink; commitea `docs(grill): <slug> verdict` (solo esa ruta),
  anota `landed_*` y publica el cierre en el hilo (best effort: si falla, lo imprime para
  publicarlo a mano). Nunca hace push.
- `src/core/scan.ts` (`t360 scan`): migra `wait-check.sh` como pasada única para el LaunchAgent.
  Recorre los `kickoff.json` abiertos por `t360 kickoff` (llevan `plane`; los del skill quedan
  para su Monitor durante la transición) sin `checked_at`/`landed_at`, aplica la misma regla que
  la tarjeta del panel (`threadMessages` + `turnFrom`: ✅ exacto del owner en el hilo), anota
  `checked_at` bajo candado y publica en el hilo qué artefactos faltan. Nunca aterriza (S4);
  idempotente.
- `src/core/launchd.ts` (`t360 install-agent | uninstall-agent`): plist `com.andrulli.t360`
  (`StartInterval` 15, node absoluto de `process.execPath`, `PATH` con el dir de `buzz_bin`,
  logs en `~/Library/Logs/t360*.log`, sin credenciales), escritura atómica, rehúsa symlinks;
  `launchctl bootout/bootstrap/enable`. Plantilla y notas en `launchd/`.
- `src/cli/main.ts`: `t360 status | kickoff | collect | scan | install-agent | uninstall-agent`
  (`--json`; códigos de salida 0/1/2 y los de
  `collect.sh`: 3 plano, 4 artefacto faltante, 5 destino existe, 6 candado). `bin` en
  `package.json` apunta a `dist/cli/main.js` (`npm run build:cli`); la fuente corre directa con
  `node src/cli/main.ts` gracias al type stripping de Node.
- `src/app/page.tsx` y `src/app/grills/[slug]/page.tsx`: Server Components, `force-dynamic`,
  leen el disco en cada petición; la tarjeta de turno y la pestaña **Hilo** llegan en streaming
  bajo `Suspense` con una sola lectura del relay por petición (`react.cache`).
- `.conductor/settings.toml`: `dev` en `$CONDUCTOR_PORT` (por defecto) y `check`.

## Abierto

- Nombre comercial del producto (`trade-360` es el nombre del repo).
- Detalle del roadmap de producto más allá del panel (F6 del plan).

Cerrado el 2026-09-11 por el ADR v2: dónde vive la lógica (CLI `t360` en este repo), cómo se
representa "aterrizado" (`landed_repo`/`commit`/`landed_at` en `kickoff.json`), y el vigilante
(LaunchAgent con `t360 scan`; `PLANS/*/kickoff.json` como único registro).

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

Una **web app local** (Next.js, se levanta desde la pestaña Run de Conductor) que da la vista que
hoy solo existe repartida entre la terminal, `PLANS/` y los canales de Buzz:

1. **v0 — leer (hecho en este commit)**: lista de grills en `<AGENT_HOME>/PLANS/`, estado
   (`abierto` = kickoff sin verdict, `cerrado` = verdict presente, `notas` = carpeta sin kickoff),
   modo, canal, fechas, y lectura de brief/ledger/verdict renderizados. Cero escrituras.
2. **v1 — observar Buzz**: hilo del grill en vivo (`buzz messages get` con la identidad
   `Claude Terminal`), última pregunta pendiente, quién debe responder. Solo lectura del relay.
3. **v2 — operar**: abrir un grill desde el panel (misma lógica que `/buzz-kickoff`: brief,
   canal, kickoff, watcher) y aterrizar artefactos en el repo elegido, reutilizando los scripts
   del skill, no reimplementándolos. Aquí entra la clasificación de plano antes de crear nada.
4. **Después**: workflows del vault (`/deep-research-lite`, `/retro`) como atajos, estado de los
   agentes (`buzz-acp` corriendo, cuál), y puesto portable (qué falta en esta máquina según
   `SETUP.md`).

## Arquitectura v0

- `src/lib/config.ts`: lee `~/.config/buzz-kickoff.env` (solo `AGENT_HOME`, `AGENT_NAME`,
  `BUZZ_RELAY_URL`; las cuentas del llavero no salen del servidor). Sin archivo → `~/.buzz`.
- `src/lib/grills.ts`: modelo `Grill` a partir del disco. Los slugs se validan (`^[a-z0-9-]+$`)
  antes de convertirse en ruta.
- `src/app/page.tsx` y `src/app/grills/[slug]/page.tsx`: Server Components, `force-dynamic`,
  leen el disco en cada petición; sin API pública ni estado.
- `.conductor/settings.toml`: `dev` en `$CONDUCTOR_PORT` (por defecto) y `check` (lint + tipos).

## Abierto

- Nombre: `trade-360` es el nombre del repo en GitHub; el producto no tiene nombre todavía.
- Si v2 debe llamar a los scripts del skill (`kickoff.sh`, `wait-check.sh`, `collect.sh`) o si
  el skill debe pasar a llamar a un CLI/servicio de este repo. Decide dónde vive la lógica.
- Cómo se representa "aterrizado": hoy el panel no sabe en qué repo quedó `docs/grill/<slug>/`.
  Candidato: que `collect.sh` anote `landed_repo` y commit en `kickoff.json`.
- Vigilante permanente del `✅` (ADR en `claude-voice/docs/grill/ejemplo-dec-vigilante-verdict.md`)
  vs Monitor por sesión: el panel podría ser el dueño natural del registro de grills abiertos.

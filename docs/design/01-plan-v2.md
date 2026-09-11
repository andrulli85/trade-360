# Plan de implementación v2: CLI `t360` + LaunchAgent + panel que opera

Estado: propuesto, 2026-09-11. Ejecuta el ADR `docs/grill/trade-360-v2/verdict.md` (D1–D6, aceptado
con ✅ en `#trade-360-v2`). Confirmados por Andy junto con este plan: nombre del binario **`t360`**,
supuestos S3 (`~/work` pasa a configuración), S4 (`scan` no aterriza ni commitea solo) y S5 (el
LaunchAgent firma como `Claude Terminal`).

## Forma final

```
trade-360/
├── src/core/        # lógica sin dependencias de Next: config, grills, relay, plano, kickoff.json
├── src/cli/         # t360: kickoff | scan | collect | status  (+ install-agent)
├── src/lib/         # adaptadores para el panel (server-only) sobre src/core
├── src/app/         # panel Next
└── launchd/         # plantilla del plist y notas
```

- **`t360`** es un binario Node (`bin` en `package.json`, TypeScript compilado a `dist/cli/`),
  instalado con `npm link` o un shim en `~/.local/bin/t360`, igual que `buzz`.
- **Configuración**: `~/.config/t360/config.toml` (sucesor de `buzz-kickoff.env`): relay,
  `agent_home`, pubkeys, referencia al llavero (servicio + cuentas), **raíces prohibidas para
  aterrizar** (`["~/work"]`) y repos permitidos por defecto. `t360 config migrate` la genera a
  partir de `buzz-kickoff.env` mientras convivan. La clave sigue en el llavero; el CLI la lee con
  `security find-generic-password` en el momento de la llamada y nunca la escribe en disco.
- **`kickoff.json`** gana `plane` (`personal|work`), `checked_at`, `landed_repo`, `commit`,
  `landed_at`; el CLI escribe siempre atómico (tmp + rename) y con candado por slug
  (`PLANS/<slug>/.lock`).
- **Un solo sondeador**: el LaunchAgent `com.andrulli.t360` ejecuta `t360 scan` cada 15 s. El
  skill deja de armar Monitor; el panel no sondea.

## Fases

Cada fase termina con un PR mergeable por sí solo; el panel sigue funcionando en todo momento.

### F1 — `src/core` y `t360 status` (cimiento) — hecho (2026-09-11)

- Mover `config.ts`, `grills.ts`, `buzz.ts`, `thread.ts` a `src/core/` sin `server-only`; los
  archivos de `src/lib/` quedan como reexportaciones marcadas `server-only`.
- `src/core/relay.ts` sustituye el exec de `buzz.sh`: lee la config, saca la clave del llavero y
  ejecuta `$BUZZ_BIN` con `BUZZ_PRIVATE_KEY`/`BUZZ_AUTH_TAG` en el entorno del hijo. Lista blanca
  de subcomandos ampliable por llamador (el panel sigue solo lectura).
- `src/core/config.ts` lee `~/.config/t360/config.toml` y, si no existe, `buzz-kickoff.env`.
- `t360 status [slug]`: lista grills y turno (lo mismo que ve el panel), en JSON con `--json`.
- Tests deterministas (`node --test`) con un `PLANS/` temporal y un `buzz` falso (patrón
  `tools/buzz-resume/test_buzz_resume.py`): sin red, sin llavero, sin launchd.
- Aceptación: el panel v1 funciona idéntico usando `src/core`; `t360 status` coincide con él.

### F2 — `t360 kickoff` y `t360 collect` (migran `kickoff.sh` y `collect.sh`) — hecho (2026-09-11)

- `t360 kickoff <slug> --mode dec --plane personal|work --brief <path>|--stdin --description "…"
  [--with <pubkey>]`: valida slug (≤23), exige `plane`, crea canal privado, añade miembros,
  publica el kickoff, escribe `kickoff.json` con `plane` y `brief_source`. Preselección de
  `plane` por ruta del brief cuando viene de archivo; error si la ruta contradice el `plane`
  dado (raíces prohibidas de la config).
- `t360 collect <slug> --repo <path>`: todo-o-nada (los cuatro archivos), rechaza `plane=work`
  hacia cualquier repo, rechaza destino o brief bajo raíces prohibidas o destino symlink,
  copia a `<repo>/docs/grill/<slug>/`, commitea `docs(grill): <slug> verdict`, anota
  `landed_repo`, `commit`, `landed_at` en `kickoff.json` y publica la línea de cierre en el hilo.
  **No hace push**: eso sigue siendo del humano o del skill según `git-conventions`.
- Tests: kickoff contra `buzz` falso; collect contra un repo git temporal, casos de frontera
  (work → personal, symlink, brief bajo `~/work`, artefacto faltante).
- Aceptación: reproducir el grill `proj-7-export-cal` en un `PLANS/` temporal con el `buzz`
  falso da los mismos cuatro archivos.

### F3 — `t360 scan` + LaunchAgent (migra `wait-check.sh`, cumple D1) — hecho (2026-09-11)

- `t360 scan`: recorre `PLANS/*/kickoff.json` sin `checked_at`, lee el canal desde
  `started_at - 1`, busca el `✅` exacto del owner en el hilo, y al encontrarlo anota
  `checked_at` y publica en el hilo un aviso ("✅ recibido; artefactos: brief ✔ ledger ✔ verdict ✘")
  con lo que falte. Nunca aterriza (S4). Idempotente: una segunda pasada no vuelve a avisar.
- `t360 install-agent` / `uninstall-agent`: plist en `~/Library/LaunchAgents/com.andrulli.t360.plist`
  (`StartInterval` 15, logs en `~/Library/Logs/t360.log`, sin credenciales en el plist), con las
  mismas defensas que `buzz-resume/install.sh` (no reemplazar symlinks, escritura atómica).
- Tests: `scan` con `buzz` falso que devuelve hilos con y sin ✅, de otro pubkey, antes del cutoff.
- Aceptación: con el LaunchAgent instalado, un `✅` en un grill abierto queda anotado en
  `kickoff.json` en ≤30 s y el panel lo muestra como "✅ recibido, pendiente de aterrizar".

### F4 — Skill `buzz-kickoff` como envoltorio fino (en `claude-toolkit`)

- `SKILL.md` conserva lo que hace el modelo (clasificar plano en terminal, redactar brief, avisar,
  resumir) y delega en `t360 kickoff` / `t360 collect`; desaparece el paso 4 (Monitor) y la
  espera pasa a ser: "cuando el panel o el hilo muestren el ✅, ejecuta `t360 collect`".
- `scripts/` se elimina; `evals/` se reescribe contra un `t360` falso (`skill-evals`).
- Revisión con `writing-for-agents`; PR en `claude-toolkit` (repo personal, push directo).
- Aceptación: un grill real abierto con el skill nuevo y aterrizado con `t360 collect`.

### F5 — Panel v2: operar

- Formulario **Abrir grill**: historia (texto o archivo), modo, **selector de plano** obligatorio
  (preseleccionado por ruta), descripción, miembros extra → `t360 kickoff` en el servidor.
- En la página del grill: botón **Aterrizar** visible solo cuando `checked_at` existe y
  `plane=personal`, con selector de repo (lista de la config) → `t360 collect`. Para
  `plane=work` muestra la ruta `PLANS/<slug>/` y el aviso de aterrizar desde el plano de trabajo.
- Refresco automático de la tarjeta de turno (polling del panel al disco, no al relay).
- La regla "el panel no escribe" de `CLAUDE.md` se sustituye por: el panel escribe solo a través
  de `t360`, nunca con `buzz` directo.
- Aceptación: un grill abierto, seguido y aterrizado sin abrir una terminal.

### F6 — Cierre

- Marcar aceptado el ADR del vigilante en `claude-voice` y apuntar a `t360 scan`.
- `docs/design/00-producto.md`: roadmap del producto más allá del panel (sin nombres de clientes
  ni del empleador); `buzz/SETUP.md` de `claude-voice` actualizado con `t360 install-agent`.
- Retirar `buzz-kickoff.env` cuando todas las máquinas usen `config.toml`.

## Orden y tamaño

F1 → F2 → F3 → F4 → F5 → F6, un PR por fase. F1–F3 son las que cambian el runtime y se pueden
hacer seguidas; F4 toca otro repo; F5 es la primera con UI nueva. Estimación: F1–F3 dos o tres
sesiones; F4 una; F5 una o dos.

## Riesgos

- **Dos sondeadores durante la transición** (Monitor del skill viejo + LaunchAgent nuevo). Regla
  aplicada en F3: `scan` solo vigila los grills abiertos por `t360 kickoff` (llevan `plane`); los
  abiertos por los scripts del skill quedan para su Monitor. Un grill, un sondeador.
- **Node en el LaunchAgent**: la ruta de `node` debe ir absoluta en el plist (`install-agent` la
  resuelve con `process.execPath`); un `nvm` que cambie de versión rompe el agente. Alternativa si
  molesta: compilar `t360` a binario único (`node --experimental-sea` o `bun build --compile`).
- **`kickoff.json` escrito por dos procesos** (`scan` y `collect`): el candado por slug y la
  escritura atómica son obligatorios desde F2, no opcionales.

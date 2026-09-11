# trade-360

Local web panel for the Buzz ↔ Conductor grill flow: the grills the `buzz-kickoff` skill opens
from a Claude Code session, their state, their artifacts (brief, ledger, verdict) as written by
the Buzz agent under `~/.buzz/PLANS/`, and the live thread of each grill read from the relay
(whose turn it is, last question pending). Read-only: it never writes to Buzz or to `PLANS/`.

The same logic is exposed as a CLI, `t360`, the operator of the flow (`docs/design/01-plan-v2.md`):
`status`, `kickoff` and `collect` today; `scan` and the LaunchAgent next. The panel itself stays
read-only; every write to Buzz or to `PLANS/` goes through `t360`.

Context, decisions and roadmap: [`docs/design/00-producto.md`](docs/design/00-producto.md).

## Run

From Conductor, the **Run** tab has `dev` (default) and `check`. From a terminal:

```bash
npm ci
npm run dev        # http://localhost:3000 (bound to 127.0.0.1 only)
npm run check      # eslint + next typegen + tsc + node --test
npm test           # tests only: temporary PLANS/, fake buzz, fake keychain; no network
```

### `t360`

```bash
node src/cli/main.ts status              # runs the sources directly (Node ≥ 23.6 type stripping)
node src/cli/main.ts status <slug>       # adds the turn and the thread read from the relay
node src/cli/main.ts status --json

npm run build:cli && npm link            # installs `t360` from dist/cli/ on the PATH
t360 status trade-360-v2
```

`t360 status` prints exactly what the panel shows (same status labels, same turn card text);
the list is read from disk, the per-slug view reads the relay.

```bash
# Open a grill: private channel + members + kickoff message + PLANS/<slug>/{brief.md,kickoff.json}
t360 kickoff <slug> --mode dec --plane personal --brief story.md --description "one line" [--with <pubkey>]
cat story.md | t360 kickoff <slug> --mode rf --plane work --stdin --description "…"

# Land the four artifacts in a repo, commit "docs(grill): <slug> verdict", record landed_* in
# kickoff.json and post the closing line in the thread. Never pushes.
t360 collect <slug> --repo ~/personal/some-repo
```

`--plane` is mandatory (ADR D4): the user classifies the story. A brief file under a forbidden
root (`[landing] forbidden_roots`, `~/work` by default) can only be opened as `work`, and
`collect` refuses `plane = work` grills, repos or destinations under a forbidden root, symlinked
destinations and grills opened by the old scripts whose brief came from there. Exit codes follow
`collect.sh`: `3` plane boundary / not found, `4` missing artifact, `5` destination exists or
already landed, `6` the slug is locked (`PLANS/<slug>/.lock`, left by a crashed run).

## Configuration

`~/.config/t360/config.toml` (override with `T360_CONFIG`). While the `buzz-kickoff` skill still
uses `~/.config/buzz-kickoff.env`, that file is read as a fallback when the TOML is missing
(`BUZZ_KICKOFF_CONFIG`). Without either, the panel falls back to `~/.buzz` and shows a notice.

```toml
[agent]
home = "~/.buzz"                # PLANS/<slug>/ lives here
name = "Claude"
pubkey = "<hex>"

[owner]
pubkey = "<hex>"

[relay]
url = "wss://…"
buzz_bin = "~/.local/bin/buzz"

[keychain]                      # names only; the secrets never leave the login keychain
service = "claude-voice-buzz"
nsec_account = "…"
auth_account = "…"

[landing]                       # used by `t360 collect` (F2)
forbidden_roots = ["~/work"]
repos = []
```

Relay access (`src/core/relay.ts`) reads the terminal identity with
`security find-generic-password` at call time and passes it to the `buzz` child process through
its environment; nothing is written to disk and the panel only ever gets the read-only
subcommands (`messages get`, `users get`, `channels get`).

## Layout

- `src/core/` — logic with no Next dependency: `config.ts`, `grills.ts` (`Grill` model from
  `<agent home>/PLANS/<slug>/`), `kickoff-file.ts` (`kickoff.json`, atomic writes, slug lock),
  `plane.ts` (forbidden roots), `relay.ts`, `thread.ts` (thread + turn), `kickoff.ts`,
  `collect.ts`, `format.ts`.
- `src/cli/` — the `t360` binary (`main.ts`, `status.ts`); built to `dist/cli/` by `build:cli`.
- `src/lib/` — `server-only` re-exports of `src/core` for the panel.
- `src/app/page.tsx` — grill list; `src/app/grills/[slug]/page.tsx` — thread and artifacts viewer.
- `tests/` — `node --test` suites with a sandboxed `$HOME`, fake `buzz` and fake `security`.
- `.conductor/settings.toml` — workspace scripts.

Stack: Next.js 16 (App Router, Server Components), TypeScript, Tailwind CSS 4, `smol-toml`.

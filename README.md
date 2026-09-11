# trade-360

Local web panel for the Buzz ↔ Conductor grill flow: the grills the `buzz-kickoff` skill opens
from a Claude Code session, their state, their artifacts (brief, ledger, verdict) as written by
the Buzz agent under `~/.buzz/PLANS/`, and the live thread of each grill read from the relay
(whose turn it is, last question pending). Read-only: it never writes to Buzz or to `PLANS/`.

Context, decisions and roadmap: [`docs/design/00-producto.md`](docs/design/00-producto.md).

## Run

From Conductor, the **Run** tab has `dev` (default) and `check`. From a terminal:

```bash
npm ci
npm run dev        # http://localhost:3000 (bound to 127.0.0.1 only)
npm run check      # eslint + next typegen + tsc
```

Configuration is read from `~/.config/buzz-kickoff.env` (`AGENT_HOME`, `AGENT_NAME`,
`BUZZ_RELAY_URL`, `AGENT_PUBKEY`, `OWNER_PUBKEY`), the same file the `buzz-kickoff` skill uses.
Without it the panel falls back to `~/.buzz` and shows a notice.

The thread view calls the skill's `buzz.sh` wrapper (`~/.claude/skills/buzz-kickoff/scripts/buzz.sh`,
override with `BUZZ_SH`), which loads the terminal identity from the keychain; the panel itself
never touches the key and only runs `messages get`, `users get` and `channels get`.

## Layout

- `src/lib/config.ts` — non-secret view of the local env file.
- `src/lib/grills.ts` — `Grill` model from `<AGENT_HOME>/PLANS/<slug>/`.
- `src/lib/buzz.ts` — read-only relay access through `buzz.sh`; `src/lib/thread.ts` — thread + turn.
- `src/app/page.tsx` — grill list; `src/app/grills/[slug]/page.tsx` — thread and artifacts viewer.
- `.conductor/settings.toml` — workspace scripts.

Stack: Next.js 16 (App Router, Server Components), TypeScript, Tailwind CSS 4.

# trade-360

Local web panel for the Buzz ↔ Conductor grill flow: the grills the `buzz-kickoff` skill opens
from a Claude Code session, their state, and their artifacts (brief, ledger, verdict) as written
by the Buzz agent under `~/.buzz/PLANS/`. Read-only for now; it never writes to Buzz or to
`PLANS/`.

Context, decisions and roadmap: [`docs/design/00-producto.md`](docs/design/00-producto.md).

## Run

From Conductor, the **Run** tab has `dev` (default) and `check`. From a terminal:

```bash
npm ci
npm run dev        # http://localhost:3000
npm run check      # eslint + next typegen + tsc
```

Configuration is read from `~/.config/buzz-kickoff.env` (`AGENT_HOME`, `AGENT_NAME`,
`BUZZ_RELAY_URL`), the same file the `buzz-kickoff` skill uses. Without it the panel falls back
to `~/.buzz` and shows a notice.

## Layout

- `src/lib/config.ts` — non-secret view of the local env file.
- `src/lib/grills.ts` — `Grill` model from `<AGENT_HOME>/PLANS/<slug>/`.
- `src/app/page.tsx` — grill list; `src/app/grills/[slug]/page.tsx` — artifacts viewer.
- `.conductor/settings.toml` — workspace scripts.

Stack: Next.js 16 (App Router, Server Components), TypeScript, Tailwind CSS 4.

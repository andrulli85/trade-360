@AGENTS.md

# trade-360

Local web panel for the Buzz ↔ Conductor grill flow. Read `docs/design/00-producto.md` first:
it holds the context inherited from `claude-voice` and `claude-toolkit`, the decisions this repo
respects, and the roadmap (v0 read-only → v1 observe Buzz → v2 operate).

Rules of record:

- The panel is read-only against Buzz and `~/.buzz/PLANS/` until v2 is designed. Do not add
  writes casually.
- Plane boundary: artifacts of work-plane stories never land in personal repos. Reuse the
  `buzz-kickoff` scripts' checks; never bypass them.
- Secrets (keychain accounts, nsec, auth tags) never reach the client or the repo. The panel
  reads only paths, names and public keys from `~/.config/buzz-kickoff.env` (`AGENT_HOME`,
  `AGENT_NAME`, `BUZZ_RELAY_URL`, `AGENT_PUBKEY`, `OWNER_PUBKEY`). Relay access goes through
  the skill's `buzz.sh` wrapper (`src/lib/buzz.ts`), restricted to an allowlist of read-only
  subcommands; extend that allowlist only with a v2 design behind it.
- `npm run check` (eslint + typegen + tsc) must pass before a commit.

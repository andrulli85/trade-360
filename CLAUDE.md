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
- Secrets (keychain accounts, nsec, auth tags) never reach the client or the repo. Only
  `AGENT_HOME`, `AGENT_NAME`, `BUZZ_RELAY_URL` are read from `~/.config/buzz-kickoff.env`.
- `npm run check` (eslint + typegen + tsc) must pass before a commit.

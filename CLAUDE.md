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
- Secrets (nsec, auth tags) never reach the client, the repo or the disk. Config
  (`src/core/config.ts`: `~/.config/t360/config.toml`, fallback `~/.config/buzz-kickoff.env`)
  holds only paths, names, public keys and the *names* of the keychain items. Relay access goes
  through `src/core/relay.ts`, which reads the keychain at call time and hands the secrets to the
  `buzz` child through its environment. The default allowlist is read-only and is all the panel
  gets; a caller extends it per subcommand only with a v2 design behind it (`01-plan-v2.md`).
- Logic lives in `src/core/` (no Next imports, relative imports with `.ts` extension so Node runs
  it unbuilt); `src/lib/` is `server-only` re-exports for the panel; `src/cli/` is `t360`.
- `npm run check` (eslint + typegen + tsc + `node --test`) must pass before a commit. Tests never
  touch the network, the keychain or launchd: use the sandbox in `tests/helpers.ts`.

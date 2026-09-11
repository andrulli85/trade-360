# LaunchAgent `com.andrulli.t360`

The permanent ✅ watcher (ADR D1): a user LaunchAgent that runs `t360 scan` every 15 s.
`t360 install-agent` writes `~/Library/LaunchAgents/com.andrulli.t360.plist` from the running
process (absolute `node` via `process.execPath`, the entry point that was invoked, the directory
of `buzz_bin` on `PATH`, `T360_CONFIG` if set) and loads it with `launchctl bootstrap`.
`com.andrulli.t360.plist.example` shows the rendered shape; nothing in it is a secret, the
identity is read from the keychain on every run.

```bash
npm run build:cli && npm link      # or a shim: node /path/to/trade-360/src/cli/main.ts
t360 install-agent
tail -f ~/Library/Logs/t360.log    # one line per event; nothing while waiting
t360 uninstall-agent
```

What `scan` does on each pass: for every `PLANS/<slug>/kickoff.json` opened by `t360 kickoff`
(it carries `plane`) without `checked_at`/`landed_at`, read the thread and apply the panel's rule
(`turnFrom`): the owner's exact `✅` as a reply to the kickoff closes it. Then it records
`checked_at` under the slug lock and posts one line in the thread naming the missing artifacts.
It never lands or commits (S4): that is `t360 collect`, run by a human from the panel or the
terminal. Grills opened by the skill's scripts (no `plane`) are left to the skill's Monitor, so
there is one poller per grill during the transition.

Notes:

- `install-agent` refuses to replace a symlinked plist and writes atomically.
- The `node` path is absolute; if `nvm` changes versions, run `t360 install-agent` again.
- `StandardErrorPath` is `~/Library/Logs/t360.err.log`; a relay that is down shows there.

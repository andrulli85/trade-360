import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { BuzzMessage, BuzzUser } from "../src/core/relay.ts";

const execFileAsync = promisify(execFile);

/**
 * Deterministic sandbox for the core and the CLI: a temporary `$HOME` with its
 * own PLANS/, a fake `buzz` that answers from fixture files and a fake
 * `security` that hands out predictable "secrets". No network, no keychain.
 */
export const OWNER = "a".repeat(64);
export const AGENT = "b".repeat(64);
export const TERMINAL = "c".repeat(64);
export const CHANNEL = "11111111-1111-1111-1111-111111111111";
export const ROOT = "d".repeat(64);
/** What the fake `buzz channels create` returns. */
export const NEW_CHANNEL = "22222222-2222-2222-2222-222222222222";
/** Event id of the n-th (0-based) `messages send` of a sandbox. */
export const sentEventId = (n: number) => "f".repeat(60) + String(n).padStart(4, "0");

export type Sandbox = {
  root: string;
  home: string;
  plansDir: string;
  binDir: string;
  fixtures: string;
  configPath: string;
  /** Environment for subprocesses (and to assign to process.env in-process). */
  env: Record<string, string>;
  setMessages(messages: BuzzMessage[]): Promise<void>;
  setUsers(users: BuzzUser[]): Promise<void>;
  /** Make the fake buzz fail with buzz-cli's JSON error on stderr (every command, or `only` one). */
  setFailure(error: { error: string; message: string; only?: string } | null): Promise<void>;
  /** A temporary git repo under the sandbox home (identity configured, no signing, no hooks). */
  makeRepo(rel: string): Promise<string>;
  calls(): Promise<{ argv: string[]; env: Record<string, string | undefined> }[]>;
  securityCalls(): Promise<string[][]>;
  writeGrill(slug: string, files: Record<string, string>): Promise<string>;
  cleanup(): Promise<void>;
};

const FAKE_BUZZ = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const dir = process.env.T360_FAKE_DIR;
const argv = process.argv.slice(2);
const priorCalls = fs.existsSync(path.join(dir, "calls.jsonl"))
  ? fs.readFileSync(path.join(dir, "calls.jsonl"), "utf8").split("\\n").filter(Boolean).map((l) => JSON.parse(l).argv.slice(0, 2).join(" "))
  : [];
fs.appendFileSync(path.join(dir, "calls.jsonl"), JSON.stringify({ argv, env: {
  BUZZ_PRIVATE_KEY: process.env.BUZZ_PRIVATE_KEY,
  BUZZ_AUTH_TAG: process.env.BUZZ_AUTH_TAG,
  BUZZ_RELAY_URL: process.env.BUZZ_RELAY_URL,
} }) + "\\n");
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const cmd = argv.slice(0, 2).join(" ");
if (fs.existsSync(path.join(dir, "failure.json"))) {
  const failure = read("failure.json");
  if (!failure.only || failure.only === cmd) {
    process.stderr.write(JSON.stringify({ error: failure.error, message: failure.message }));
    process.exit(1);
  }
}
const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
let out;
if (cmd === "channels create") {
  out = { channel_id: "${NEW_CHANNEL}", name: flag("--name") };
} else if (cmd === "channels add-member" || cmd === "channels topic") {
  // Like buzz-cli, these print a line of text, not JSON.
  process.stdout.write("ok\\n");
  process.exit(0);
} else if (cmd === "messages send") {
  const sent = priorCalls.filter((c) => c === "messages send").length;
  out = { event_id: "f".repeat(60) + String(sent).padStart(4, "0") };
} else if (cmd === "messages get") {
  const since = Number(flag("--since") ?? 0);
  out = read("messages.json").filter((m) => m.created_at >= since);
} else if (cmd === "users get") {
  out = read("users.json").filter((u) => u.pubkey === flag("--pubkey"));
} else if (cmd === "channels get") {
  out = { channel_id: flag("--channel"), name: "fake", created_at: 1, pubkey: "${TERMINAL}" };
} else {
  process.stderr.write(JSON.stringify({ error: "usage", message: "unknown command " + cmd }));
  process.exit(2);
}
process.stdout.write(JSON.stringify(out));
`;

const FAKE_SECURITY = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
fs.appendFileSync(path.join(process.env.T360_FAKE_DIR, "security.jsonl"), JSON.stringify(argv) + "\\n");
const flag = (name) => argv[argv.indexOf(name) + 1];
if (argv[0] !== "find-generic-password" || !argv.includes("-w")) { process.stderr.write("security: bad args\\n"); process.exit(2); }
if (flag("-s") === "locked") { process.stderr.write("security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\\n"); process.exit(44); }
process.stdout.write("secret:" + flag("-s") + ":" + flag("-a") + "\\n");
`;

export async function makeSandbox(opts: { config?: "toml" | "env" | "none" } = {}): Promise<Sandbox> {
  // realpath: on macOS the temp dir is under /var → /private/var, and collect
  // reports resolved paths.
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "t360-test-")));
  const home = path.join(root, "home");
  const plansDir = path.join(home, ".buzz", "PLANS");
  const binDir = path.join(root, "bin");
  const fixtures = path.join(root, "fixtures");
  await Promise.all([mkdir(plansDir, { recursive: true }), mkdir(binDir), mkdir(fixtures)]);
  await mkdir(path.join(home, ".config", "t360"), { recursive: true });

  const buzz = path.join(binDir, "buzz");
  await writeFile(buzz, FAKE_BUZZ);
  await writeFile(path.join(binDir, "security"), FAKE_SECURITY);
  await Promise.all([chmod(buzz, 0o755), chmod(path.join(binDir, "security"), 0o755)]);

  const kind = opts.config ?? "toml";
  const configPath =
    kind === "env" ? path.join(home, ".config", "buzz-kickoff.env") : path.join(home, ".config", "t360", "config.toml");
  if (kind === "toml") {
    await writeFile(
      configPath,
      `[agent]
home = "~/.buzz"
name = "Claude"
pubkey = "${AGENT}"

[owner]
pubkey = "${OWNER}"

[relay]
url = "wss://relay.test"
buzz_bin = "${buzz}"

[keychain]
service = "t360-test"
nsec_account = "nsec"
auth_account = "auth"

[landing]
forbidden_roots = ["~/work", "/srv/corp"]
repos = ["~/personal/trade-360"]
`,
    );
  } else if (kind === "env") {
    await writeFile(
      configPath,
      `# fake buzz-kickoff.env
BUZZ_BIN=${buzz}
BUZZ_RELAY_URL="wss://relay.test"
KEYCHAIN_SERVICE=t360-test
KEYCHAIN_NSEC_ACCOUNT=nsec
KEYCHAIN_AUTH_ACCOUNT=auth
AGENT_PUBKEY=${AGENT}
AGENT_NAME='Claude'
OWNER_PUBKEY=${OWNER}
AGENT_HOME=$HOME/.buzz
`,
    );
  }

  const gitConfig = path.join(root, "gitconfig");
  await writeFile(gitConfig, "[user]\n\tname = Test\n\temail = test@example.invalid\n[commit]\n\tgpgsign = false\n[core]\n\thooksPath = /dev/null\n");
  const env: Record<string, string> = {
    HOME: home,
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    T360_FAKE_DIR: fixtures,
    // Never let the developer's real files leak into a test.
    T360_CONFIG: path.join(home, ".config", "t360", "config.toml"),
    BUZZ_KICKOFF_CONFIG: path.join(home, ".config", "buzz-kickoff.env"),
  };

  const readLines = async (file: string) => {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(path.join(fixtures, file), "utf8").catch(() => "");
    return text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  };

  return {
    root,
    home,
    plansDir,
    binDir,
    fixtures,
    configPath,
    env,
    setMessages: (m) => writeFile(path.join(fixtures, "messages.json"), JSON.stringify(m)),
    setUsers: (u) => writeFile(path.join(fixtures, "users.json"), JSON.stringify(u)),
    setFailure: async (f) => {
      const p = path.join(fixtures, "failure.json");
      if (f) await writeFile(p, JSON.stringify(f));
      else await rm(p, { force: true });
    },
    calls: () => readLines("calls.jsonl"),
    async makeRepo(rel) {
      const dir = path.join(home, rel);
      await mkdir(dir, { recursive: true });
      const run = (...args: string[]) => execFileAsync("git", ["-C", dir, ...args], { env: { ...process.env, ...env } });
      await run("init", "-q", "-b", "main");
      await writeFile(path.join(dir, "README.md"), "# repo\n");
      await run("add", "README.md");
      await run("commit", "-q", "-m", "init");
      return dir;
    },
    securityCalls: () => readLines("security.jsonl"),
    async writeGrill(slug, files) {
      const dir = path.join(plansDir, slug);
      await mkdir(dir, { recursive: true });
      for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text);
      return dir;
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/** Apply the sandbox env to this process (core functions read `$HOME`, `PATH`, `T360_CONFIG`). */
export function useEnv(env: Record<string, string>): () => void {
  const saved = new Map(Object.keys(env).map((k) => [k, process.env[k]] as const));
  Object.assign(process.env, env);
  return () => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

export function kickoffJson(over: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify(
    { channel_id: CHANNEL, root_event_id: ROOT, slug: "demo", mode: "dec", brief: "brief.md", started_at: 1000, ...over },
    null,
    2,
  );
}

export function msg(over: Partial<BuzzMessage> & { pubkey: string; content: string; created_at: number }): BuzzMessage {
  return { id: over.id ?? `id-${over.created_at}`, kind: 42, tags: [["e", ROOT, "", "reply"]], ...over };
}

export const rootMsg = (): BuzzMessage =>
  msg({ id: ROOT, pubkey: TERMINAL, content: "@Claude /grill-me dec", created_at: 1000, tags: [] });

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";

/**
 * Machine-local configuration of trade-360. Read from `~/.config/t360/config.toml`
 * and, while both files coexist, from the `buzz-kickoff` skill's
 * `~/.config/buzz-kickoff.env` when the TOML file is missing.
 *
 * Nothing here is a secret: the private key and the auth tag stay in the login
 * keychain and are pulled by `relay.ts` at call time. The `keychain` block only
 * says *where* they are (service + account names).
 */
export type Config = {
  /** Absolute path of the managed agent's workspace (default `~/.buzz`). */
  agentHome: string;
  /** Display name of the grill agent in Buzz (default `Claude`). */
  agentName: string;
  /** Relay the agent is connected to, if configured. */
  relayUrl: string | null;
  /** Public keys (not secrets) used to tell who is who in a thread. */
  agentPubkey: string | null;
  ownerPubkey: string | null;
  /** `buzz` CLI to run; a bare name is resolved through PATH (default `buzz`). */
  buzzBin: string;
  /** Where the terminal identity lives in the keychain; null when not configured. */
  keychain: KeychainRef | null;
  /** Rules for `t360 collect` (F2): where artifacts may and may not land. */
  landing: { forbiddenRoots: string[]; repos: string[] };
  /** Which file was read, so callers can say "not configured". */
  source: ConfigSource;
  path: string | null;
};

export type KeychainRef = { service: string; nsecAccount: string; authAccount: string };

export type ConfigSource = "toml" | "env-file" | "defaults";

/** Where the two config files live for the current `$HOME`. */
export function configPaths(): { toml: string; env: string } {
  return {
    toml: process.env.T360_CONFIG || path.join(homedir(), ".config", "t360", "config.toml"),
    env: process.env.BUZZ_KICKOFF_CONFIG || path.join(homedir(), ".config", "buzz-kickoff.env"),
  };
}

export function defaultConfig(): Config {
  return {
    agentHome: path.join(homedir(), ".buzz"),
    agentName: "Claude",
    relayUrl: null,
    agentPubkey: null,
    ownerPubkey: null,
    buzzBin: "buzz",
    keychain: null,
    landing: { forbiddenRoots: [path.join(homedir(), "work")], repos: [] },
    source: "defaults",
    path: null,
  };
}

/** `~/x`, `$HOME/x` and `${HOME}/x` → absolute; quotes from the env file stripped. */
export function expandHome(value: string): string {
  return value
    .replace(/^"(.*)"$/, "$1")
    .replace(/^'(.*)'$/, "$1")
    .replace(/\$HOME|\$\{HOME\}|^~(?=\/|$)/g, homedir());
}

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = expandHome(line.slice(eq + 1).trim());
  }
  return out;
}

function fromEnvFile(env: Record<string, string>, file: string): Config {
  const d = defaultConfig();
  const keychain =
    env.KEYCHAIN_SERVICE && env.KEYCHAIN_NSEC_ACCOUNT && env.KEYCHAIN_AUTH_ACCOUNT
      ? {
          service: env.KEYCHAIN_SERVICE,
          nsecAccount: env.KEYCHAIN_NSEC_ACCOUNT,
          authAccount: env.KEYCHAIN_AUTH_ACCOUNT,
        }
      : null;
  return {
    ...d,
    agentHome: env.AGENT_HOME || d.agentHome,
    agentName: env.AGENT_NAME || d.agentName,
    relayUrl: env.BUZZ_RELAY_URL || null,
    agentPubkey: env.AGENT_PUBKEY || null,
    ownerPubkey: env.OWNER_PUBKEY || null,
    buzzBin: env.BUZZ_BIN || d.buzzBin,
    keychain,
    source: "env-file",
    path: file,
  };
}

type TomlTable = Record<string, unknown>;

function table(v: unknown): TomlTable {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as TomlTable) : {};
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? expandHome(v.trim()) : null;
}

function strList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter((x): x is string => typeof x === "string").map(expandHome);
}

/**
 * Shape of `config.toml`:
 *
 * ```toml
 * [agent]
 * home = "~/.buzz"          # PLANS/<slug>/ lives here
 * name = "Claude"
 * pubkey = "<hex>"
 *
 * [owner]
 * pubkey = "<hex>"
 *
 * [relay]
 * url = "wss://relay.example"
 * buzz_bin = "~/.local/bin/buzz"
 *
 * [keychain]                # names only; the secrets stay in the keychain
 * service = "claude-voice-buzz"
 * nsec_account = "terminal-nsec"
 * auth_account = "terminal-auth"
 *
 * [landing]
 * forbidden_roots = ["~/work"]
 * repos = ["~/personal/trade-360"]
 * ```
 */
export function fromToml(text: string, file: string): Config {
  const d = defaultConfig();
  const doc = table(parseToml(text));
  const agent = table(doc.agent);
  const owner = table(doc.owner);
  const relay = table(doc.relay);
  const kc = table(doc.keychain);
  const landing = table(doc.landing);
  const keychain =
    str(kc.service) && str(kc.nsec_account) && str(kc.auth_account)
      ? { service: str(kc.service)!, nsecAccount: str(kc.nsec_account)!, authAccount: str(kc.auth_account)! }
      : null;
  return {
    agentHome: str(agent.home) ?? d.agentHome,
    agentName: str(agent.name) ?? d.agentName,
    relayUrl: str(relay.url),
    agentPubkey: str(agent.pubkey),
    ownerPubkey: str(owner.pubkey),
    buzzBin: str(relay.buzz_bin) ?? d.buzzBin,
    keychain,
    landing: {
      forbiddenRoots: strList(landing.forbidden_roots) ?? d.landing.forbiddenRoots,
      repos: strList(landing.repos) ?? d.landing.repos,
    },
    source: "toml",
    path: file,
  };
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * `config.toml` if present, else `buzz-kickoff.env`, else defaults. A malformed
 * TOML file throws: silently falling back would hide a typo behind the old file.
 */
export async function loadConfig(): Promise<Config> {
  const { toml, env } = configPaths();
  const tomlText = await readIfExists(toml);
  if (tomlText !== null) return fromToml(tomlText, toml);
  const envText = await readIfExists(env);
  if (envText !== null) return fromEnvFile(parseEnvFile(envText), env);
  return defaultConfig();
}

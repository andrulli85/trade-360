import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig, type Config, type KeychainRef } from "./config.ts";

const execFileAsync = promisify(execFile);

/**
 * Access to the relay through the terminal identity ("Claude Terminal").
 *
 * Replaces the `buzz.sh` wrapper of the `buzz-kickoff` skill: the config says
 * which `buzz` to run and where the identity lives in the keychain; the secrets
 * are read with `security` at call time and handed to the child process through
 * its environment (`BUZZ_PRIVATE_KEY`, `BUZZ_AUTH_TAG`). They are never written
 * to disk and never returned to callers.
 *
 * A relay only runs the subcommands it was created with. The default set is
 * read-only and is all the panel gets; the CLI extends it per subcommand.
 */
export const READ_ONLY_COMMANDS: ReadonlySet<string> = new Set(["messages get", "users get", "channels get"]);

/** What `t360 kickoff` needs on top of reading: open the channel and post the kickoff. */
export const KICKOFF_COMMANDS: ReadonlySet<string> = new Set([
  ...READ_ONLY_COMMANDS,
  "channels create",
  "channels add-member",
  "channels topic",
  "messages send",
]);

/** What `t360 collect` needs on top of reading: the closing line in the thread. */
export const COLLECT_COMMANDS: ReadonlySet<string> = new Set([...READ_ONLY_COMMANDS, "messages send"]);

export type RelayReason =
  /** The config has no `[keychain]` block: nothing to sign with. */
  | "no-identity"
  /** `security` could not return the secrets (locked keychain, missing item). */
  | "keychain"
  /** The `buzz` binary is missing or not executable. */
  | "no-bin"
  /** `buzz` ran and failed; `message` carries its error. */
  | "cli-error";

export class RelayUnavailable extends Error {
  readonly reason: RelayReason;
  constructor(message: string, reason: RelayReason) {
    super(message);
    this.name = "RelayUnavailable";
    this.reason = reason;
  }
}

export type Secrets = { privateKey: string; authTag: string };
export type SecretsProvider = (keychain: KeychainRef) => Promise<Secrets>;

async function findGenericPassword(service: string, account: string): Promise<string> {
  const { stdout } = await execFileAsync("security", ["find-generic-password", "-s", service, "-a", account, "-w"], {
    timeout: 10_000,
  });
  return stdout.replace(/\r?\n$/, "");
}

/** Default provider: the login keychain, exactly as `buzz.sh` did. */
export const keychainSecrets: SecretsProvider = async (kc) => {
  try {
    const [privateKey, authTag] = await Promise.all([
      findGenericPassword(kc.service, kc.nsecAccount),
      findGenericPassword(kc.service, kc.authAccount),
    ]);
    return { privateKey, authTag };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    throw new RelayUnavailable(
      `no se pudo leer la identidad del llavero (${kc.service}): ${e.stderr?.trim() || e.message || "error"}`,
      "keychain",
    );
  }
};

export type BuzzMessage = {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
  kind: number;
  tags: string[][];
};

export type BuzzUser = { pubkey: string; display_name?: string; name?: string; picture?: string };

export type BuzzChannel = {
  channel_id: string;
  name: string;
  description?: string;
  created_at: number;
  pubkey: string;
};

export type RunOptions = {
  /** Return stdout as text instead of parsing JSON (subcommands that print nothing useful). */
  raw?: boolean;
};

export type Relay = {
  /** Run one allowed subcommand (`"messages get"`) and parse its JSON output. */
  run<T>(command: string, args: string[], opts?: RunOptions): Promise<T>;
  getMessages(channelId: string, opts?: { since?: number; limit?: number }): Promise<BuzzMessage[]>;
  getChannel(channelId: string): Promise<BuzzChannel>;
  /** Profile by pubkey, cached for the life of the relay; null when unknown or unreachable. */
  getUser(pubkey: string): Promise<BuzzUser | null>;
};

export type RelayOptions = {
  /** Config to use, or a loader called on every run (default: `loadConfig`). */
  config?: Config | (() => Promise<Config>);
  /** Subcommands this relay may run (default: read-only set). */
  allow?: Iterable<string>;
  secrets?: SecretsProvider;
  timeoutMs?: number;
};

function parseCliError(err: unknown): string {
  const e = err as { stderr?: string; message?: string; code?: string | number };
  let detail = e.stderr?.trim() || e.message || "unknown error";
  try {
    // buzz-cli reports errors as JSON on stderr: {"error": "...", "message": "..."}
    const parsed = JSON.parse(detail) as { error?: string; message?: string };
    detail = [parsed.error, parsed.message].filter(Boolean).join(": ") || detail;
  } catch {
    // keep raw text
  }
  return detail;
}

export function createRelay(options: RelayOptions = {}): Relay {
  const allow = new Set(options.allow ?? READ_ONLY_COMMANDS);
  const secrets = options.secrets ?? keychainSecrets;
  const timeout = options.timeoutMs ?? 20_000;
  const configOf = async (): Promise<Config> =>
    typeof options.config === "function" ? options.config() : (options.config ?? loadConfig());

  async function run<T>(command: string, args: string[], opts: RunOptions = {}): Promise<T> {
    if (!allow.has(command)) {
      throw new Error(`relay: "${command}" no está en la lista de subcomandos permitidos de este llamador`);
    }
    const config = await configOf();
    if (!config.keychain) {
      throw new RelayUnavailable(
        `sin identidad: ${config.path ?? "la configuración"} no tiene bloque [keychain] (servicio y cuentas del llavero)`,
        "no-identity",
      );
    }
    const { privateKey, authTag } = await secrets(config.keychain);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      BUZZ_PRIVATE_KEY: privateKey,
      BUZZ_AUTH_TAG: authTag,
    };
    if (config.relayUrl) env.BUZZ_RELAY_URL = config.relayUrl;
    try {
      const { stdout } = await execFileAsync(config.buzzBin, [...command.split(" "), ...args], {
        env,
        timeout,
        maxBuffer: 8 * 1024 * 1024,
      });
      return (opts.raw ? stdout : JSON.parse(stdout)) as T;
    } catch (err) {
      const code = (err as { code?: string | number }).code;
      if (code === "ENOENT" || code === "EACCES") {
        throw new RelayUnavailable(`no se encontró el binario buzz en ${config.buzzBin} (${code})`, "no-bin");
      }
      throw new RelayUnavailable(parseCliError(err), "cli-error");
    }
  }

  // Profiles change rarely; keep them for the life of the relay.
  const userCache = new Map<string, Promise<BuzzUser | null>>();

  return {
    run,
    getMessages(channelId, opts = {}) {
      const args = ["--channel", channelId, "--limit", String(opts.limit ?? 500)];
      if (opts.since !== undefined) args.push("--since", String(opts.since));
      return run<BuzzMessage[]>("messages get", args);
    },
    getChannel(channelId) {
      return run<BuzzChannel>("channels get", ["--channel", channelId]);
    },
    getUser(pubkey) {
      let p = userCache.get(pubkey);
      if (!p) {
        p = run<BuzzUser[]>("users get", ["--pubkey", pubkey])
          .then((list) => list[0] ?? null)
          .catch(() => null);
        userCache.set(pubkey, p);
      }
      return p;
    },
  };
}

let shared: Relay | null = null;

/** The process-wide read-only relay (config re-read on every call). */
export function defaultRelay(): Relay {
  shared ??= createRelay();
  return shared;
}

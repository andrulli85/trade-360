import "server-only";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Read-only access to the relay through the terminal identity ("Claude
 * Terminal"). The panel never handles the key itself: it calls the same
 * `buzz.sh` wrapper the `buzz-kickoff` skill uses, which pulls the secrets from
 * the login keychain at call time. Only the subcommands listed here can run.
 */
const READ_ONLY_COMMANDS = new Set(["messages get", "users get", "channels get"]);

const DEFAULT_BUZZ_SH = path.join(homedir(), ".claude", "skills", "buzz-kickoff", "scripts", "buzz.sh");

export function buzzWrapperPath(): string {
  return process.env.BUZZ_SH || DEFAULT_BUZZ_SH;
}

export class BuzzUnavailable extends Error {
  constructor(
    message: string,
    readonly reason: "no-wrapper" | "cli-error",
  ) {
    super(message);
  }
}

export async function buzzAvailable(): Promise<boolean> {
  try {
    await access(buzzWrapperPath());
    return true;
  } catch {
    return false;
  }
}

export async function buzz<T>(command: string, args: string[]): Promise<T> {
  if (!READ_ONLY_COMMANDS.has(command)) {
    throw new Error(`buzz: "${command}" is not a read-only command allowed from the panel`);
  }
  const wrapper = buzzWrapperPath();
  if (!(await buzzAvailable())) {
    throw new BuzzUnavailable(`buzz.sh not found at ${wrapper}`, "no-wrapper");
  }
  try {
    const { stdout } = await execFileAsync(wrapper, [...command.split(" "), ...args], {
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return JSON.parse(stdout) as T;
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    let detail = e.stderr?.trim() || e.message || "unknown error";
    try {
      // buzz-cli reports errors as JSON on stderr: {"error": "...", "message": "..."}
      const parsed = JSON.parse(detail) as { error?: string; message?: string };
      detail = [parsed.error, parsed.message].filter(Boolean).join(": ");
    } catch {
      // keep raw text
    }
    throw new BuzzUnavailable(detail, "cli-error");
  }
}

/* ---------- Typed wrappers ---------- */

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

export function getMessages(channelId: string, opts: { since?: number; limit?: number } = {}) {
  const args = ["--channel", channelId, "--limit", String(opts.limit ?? 500)];
  if (opts.since !== undefined) args.push("--since", String(opts.since));
  return buzz<BuzzMessage[]>("messages get", args);
}

export function getChannel(channelId: string) {
  return buzz<BuzzChannel>("channels get", ["--channel", channelId]);
}

// Profiles change rarely; keep them for the life of the dev server process.
const userCache = new Map<string, Promise<BuzzUser | null>>();

export function getUser(pubkey: string): Promise<BuzzUser | null> {
  let p = userCache.get(pubkey);
  if (!p) {
    p = buzz<BuzzUser[]>("users get", ["--pubkey", pubkey])
      .then((list) => list[0] ?? null)
      .catch(() => null);
    userCache.set(pubkey, p);
  }
  return p;
}

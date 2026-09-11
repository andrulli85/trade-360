import "server-only";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Non-secret view of `~/.config/buzz-kickoff.env`, the machine-local file the
 * `buzz-kickoff` skill already reads. Only the keys the UI needs are exposed;
 * keychain account names and anything else never leave the server.
 */
export type AppConfig = {
  /** Absolute path of the managed agent's workspace (default `~/.buzz`). */
  agentHome: string;
  /** Display name of the grill agent in Buzz (default `Claude`). */
  agentName: string;
  /** Relay the agent is connected to, if configured. */
  relayUrl: string | null;
  /** Where the config came from, so the UI can say "not configured". */
  source: "env-file" | "defaults";
};

const ENV_FILE = path.join(homedir(), ".config", "buzz-kickoff.env");

function expandHome(value: string): string {
  return value
    .replace(/^"(.*)"$/, "$1")
    .replace(/^'(.*)'$/, "$1")
    .replace(/\$HOME|\$\{HOME\}|^~(?=\/|$)/g, homedir());
}

function parseEnv(text: string): Record<string, string> {
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

export async function loadConfig(): Promise<AppConfig> {
  const defaults: AppConfig = {
    agentHome: path.join(homedir(), ".buzz"),
    agentName: "Claude",
    relayUrl: null,
    source: "defaults",
  };
  let env: Record<string, string>;
  try {
    env = parseEnv(await readFile(ENV_FILE, "utf8"));
  } catch {
    return defaults;
  }
  return {
    agentHome: env.AGENT_HOME || defaults.agentHome,
    agentName: env.AGENT_NAME || defaults.agentName,
    relayUrl: env.BUZZ_RELAY_URL || null,
    source: "env-file",
  };
}

export const CONFIG_FILE_PATH = ENV_FILE;

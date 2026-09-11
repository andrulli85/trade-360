import { execFile } from "node:child_process";
import { lstat, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Config } from "./config.ts";
import { writeAtomic } from "./fs.ts";

const execFileAsync = promisify(execFile);

/**
 * The permanent watcher (ADR D1): a user LaunchAgent that runs `t360 scan`
 * every 15 s. Same discipline as `buzz-resume/install.sh`: absolute paths,
 * no credentials in the plist (the identity comes from the keychain at each
 * run), atomic write, never replace a symlinked plist.
 */
export const AGENT_LABEL = "com.andrulli.t360";
export const SCAN_INTERVAL_SECONDS = 15;

export function agentPaths(): { plist: string; log: string; errLog: string } {
  return {
    plist: path.join(homedir(), "Library", "LaunchAgents", `${AGENT_LABEL}.plist`),
    log: path.join(homedir(), "Library", "Logs", "t360.log"),
    errLog: path.join(homedir(), "Library", "Logs", "t360.err.log"),
  };
}

export type PlistInput = {
  /** Absolute node binary (`process.execPath`). */
  node: string;
  /** Absolute `t360` entry point: `dist/cli/main.js` or `src/cli/main.ts`. */
  entry: string;
  /** Extra directories to put on PATH (where `buzz` lives). */
  pathDirs?: string[];
  /** Extra environment (e.g. `T360_CONFIG`); values are copied verbatim, so never secrets. */
  env?: Record<string, string>;
};

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderPlist(input: PlistInput): string {
  const { log, errLog } = agentPaths();
  const pathDirs = [...new Set([...(input.pathDirs ?? []), path.dirname(input.node), "/usr/local/bin", "/usr/bin", "/bin"])];
  const env: Record<string, string> = { HOME: homedir(), PATH: pathDirs.join(":"), ...(input.env ?? {}) };
  const envXml = Object.entries(env)
    .map(([k, v]) => `    <key>${xml(k)}</key>\n    <string>${xml(v)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(input.node)}</string>
    <string>${xml(input.entry)}</string>
    <string>scan</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${SCAN_INTERVAL_SECONDS}</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(errLog)}</string>
</dict>
</plist>
`;
}

export class LaunchdError extends Error {}

async function launchctl(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("launchctl", args);
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new LaunchdError(`launchctl ${args.join(" ")}: ${e.stderr?.trim() || e.message}`);
  }
}

function domain(): string {
  return `gui/${process.getuid?.() ?? 0}`;
}

async function refuseSymlink(file: string): Promise<void> {
  const st = await lstat(file).catch(() => null);
  if (st?.isSymbolicLink()) throw new LaunchdError(`no se reemplaza un plist que es symlink: ${file}`);
}

/** What the agent will run, derived from the current process. */
export async function currentEntry(): Promise<{ node: string; entry: string }> {
  return { node: process.execPath, entry: await realpath(process.argv[1]) };
}

export async function installAgent(config: Config, input: PlistInput): Promise<{ plist: string; content: string }> {
  const { plist } = agentPaths();
  await refuseSymlink(plist);
  const pathDirs = [...(input.pathDirs ?? [])];
  if (path.isAbsolute(config.buzzBin)) pathDirs.push(path.dirname(config.buzzBin));
  pathDirs.push(path.join(homedir(), ".local", "bin"), "/opt/homebrew/bin");
  const env = { ...(input.env ?? {}) };
  if (process.env.T360_CONFIG) env.T360_CONFIG = process.env.T360_CONFIG;
  if (process.env.BUZZ_KICKOFF_CONFIG) env.BUZZ_KICKOFF_CONFIG = process.env.BUZZ_KICKOFF_CONFIG;
  const content = renderPlist({ ...input, pathDirs, env });
  await writeAtomic(plist, content);
  await launchctl(["bootout", domain(), plist]).catch(() => undefined);
  await launchctl(["bootstrap", domain(), plist]);
  await launchctl(["enable", `${domain()}/${AGENT_LABEL}`]);
  return { plist, content };
}

export async function uninstallAgent(): Promise<{ plist: string; existed: boolean }> {
  const { plist } = agentPaths();
  await refuseSymlink(plist);
  const existed = (await lstat(plist).catch(() => null)) !== null;
  if (existed) await launchctl(["bootout", domain(), plist]).catch(() => undefined);
  await rm(plist, { force: true });
  return { plist, existed };
}

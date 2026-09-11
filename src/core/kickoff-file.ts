import { mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { writeAtomic } from "./fs.ts";
import type { Plane } from "./plane.ts";

export { writeAtomic };

/**
 * `PLANS/<slug>/kickoff.json` is the only record of a grill (ADR D5). Written by
 * `kickoff`, updated by `scan` (F3) and `collect`, so every write is atomic
 * (tmp + rename in the same directory) and runs under a per-slug lock.
 */
export type GrillMode = "rf" | "oq" | "dec" | "plan" | "doc";

export const MODES: readonly GrillMode[] = ["rf", "oq", "dec", "plan", "doc"];

export function isMode(v: unknown): v is GrillMode {
  return (MODES as readonly unknown[]).includes(v);
}

export type Kickoff = {
  channel_id: string;
  root_event_id: string;
  slug: string;
  mode: GrillMode;
  /** Path of the brief relative to the agent home (`PLANS/<slug>/brief.md`). */
  brief: string;
  /** Epoch seconds taken before the channel exists: the cutoff for the thread. */
  started_at: number;
  /** Resolved file the brief came from, or "inline" for typed/pasted text. */
  brief_source?: string;
  /** Set by v2 kickoffs; absent in grills opened by the skill's scripts. */
  plane?: Plane;
  /** Epoch seconds when `scan` saw the owner's ✅ (F3). */
  checked_at?: number;
  /** Set by `collect`. */
  landed_repo?: string;
  commit?: string;
  landed_at?: number;
};

export const KICKOFF_FILE = "kickoff.json";
const LOCK_FILE = ".lock";

export async function readKickoffFile(dir: string): Promise<Kickoff | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, KICKOFF_FILE), "utf8")) as Kickoff;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export function writeKickoffFile(dir: string, rec: Kickoff): Promise<void> {
  return writeAtomic(path.join(dir, KICKOFF_FILE), `${JSON.stringify(rec, null, 2)}\n`);
}

export class SlugLocked extends Error {
  readonly lockFile: string;
  constructor(lockFile: string, holder: string) {
    super(`otro proceso tiene el candado de este grill (${lockFile}: ${holder.trim() || "sin datos"})`);
    this.name = "SlugLocked";
    this.lockFile = lockFile;
  }
}

/**
 * Run `fn` holding `PLANS/<slug>/.lock`. The lock is an O_EXCL file with the
 * holder's pid; a stale one (crashed process) must be removed by hand, which
 * is the safe failure for a file two commands may write.
 */
export async function withSlugLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(dir, { recursive: true });
  const lockFile = path.join(dir, LOCK_FILE);
  let handle;
  try {
    handle = await open(lockFile, "wx");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const holder = await readFile(lockFile, "utf8").catch(() => "");
    throw new SlugLocked(lockFile, holder);
  }
  try {
    await handle.writeFile(`pid ${process.pid} ${new Date().toISOString()}\n`);
    return await fn();
  } finally {
    await handle.close();
    await rm(lockFile, { force: true });
  }
}

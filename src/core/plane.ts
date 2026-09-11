import { realpath } from "node:fs/promises";
import path from "node:path";
import type { Config } from "./config.ts";

/**
 * The plane boundary, as far as a path can tell (ADR D4, SPEC D5–D7 of the
 * skill): anything under a forbidden root (`~/work` by default) belongs to the
 * work plane and never lands in a personal repo. What a path cannot tell
 * (pasted corporate text) is the user's call, recorded as `plane` in
 * `kickoff.json` at kickoff time.
 */
export type Plane = "personal" | "work";

export const PLANES: readonly Plane[] = ["personal", "work"];

export function isPlane(v: unknown): v is Plane {
  return v === "personal" || v === "work";
}

/**
 * `realpath` that tolerates a missing tail: resolves the longest existing
 * prefix and appends the rest, like Python's `os.path.realpath`.
 */
export async function realpathLenient(p: string): Promise<string> {
  let head = path.resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await realpath(head);
      return tail.length ? path.join(real, ...tail) : real;
    } catch {
      const parent = path.dirname(head);
      if (parent === head) return path.join(head, ...tail);
      tail.unshift(path.basename(head));
      head = parent;
    }
  }
}

export function isUnderResolved(resolved: string, root: string): boolean {
  return resolved === root || resolved.startsWith(root + path.sep);
}

/** True when `p` resolves inside `root` (both realpath'd, symlinks followed). */
export async function isUnder(p: string, root: string): Promise<boolean> {
  const [rp, rr] = await Promise.all([realpathLenient(p), realpathLenient(root)]);
  return isUnderResolved(rp, rr);
}

/** The forbidden root that contains `p`, or null when it is on the personal plane. */
export async function forbiddenRootOf(p: string, config: Config): Promise<string | null> {
  const rp = await realpathLenient(p);
  for (const root of config.landing.forbiddenRoots) {
    if (isUnderResolved(rp, await realpathLenient(root))) return root;
  }
  return null;
}

export async function planeOfPath(p: string, config: Config): Promise<Plane> {
  return (await forbiddenRootOf(p, config)) ? "work" : "personal";
}

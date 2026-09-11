import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { loadConfig, type Config } from "./config.ts";
import { ARTIFACT_FILE, ARTIFACT_NAMES, getGrill, isValidSlug, type Grill } from "./grills.ts";
import { withSlugLock, writeKickoffFile, type Kickoff } from "./kickoff-file.ts";
import { forbiddenRootOf, realpathLenient, type Plane } from "./plane.ts";
import { COLLECT_COMMANDS, createRelay, type Relay } from "./relay.ts";

const execFileAsync = promisify(execFile);

/**
 * `t360 collect`: land the four artifacts of a grill in a repo. Migrates the
 * skill's `collect.sh` (all-or-nothing copy, plane checks that fail closed)
 * plus what the skill did by hand afterwards: the commit, the `landed_*`
 * fields in `kickoff.json` and the closing line in the thread. Never pushes.
 */
export type CollectInput = { slug: string; repo: string };

export type CollectDeps = { config?: Config; relay?: Relay; now?: () => number };

export type CollectResult = {
  slug: string;
  /** Resolved repo root and destination folder. */
  repo: string;
  dest: string;
  files: string[];
  commit: string;
  kickoff: Kickoff;
  /** The closing line is best effort: the artifacts are landed either way. */
  closing: { ok: true; eventId: string } | { ok: false; detail: string; content: string };
};

/** Mirrors `collect.sh`: 3 plane boundary · 4 missing artifact · 5 destination exists. */
export type CollectErrorCode = "usage" | "not-found" | "plane" | "missing" | "exists" | "landed" | "git";

export class CollectError extends Error {
  readonly code: CollectErrorCode;
  constructor(code: CollectErrorCode, message: string) {
    super(message);
    this.name = "CollectError";
    this.code = code;
  }
}

const REQUIRED = [ARTIFACT_FILE.brief, ARTIFACT_FILE.ledger, ARTIFACT_FILE.verdict, ARTIFACT_FILE.kickoff];

function refuse(what: string, grill: Grill): never {
  throw new CollectError("plane", `${what}. Los artefactos siguen en ${grill.dir}; aterrízalos desde una sesión del plano de trabajo, nunca desde aquí.`);
}

async function assertPersonalPath(label: string, p: string, config: Config, grill: Grill): Promise<void> {
  const root = await forbiddenRootOf(p, config);
  if (root) refuse(`${label} ${p} está bajo la raíz prohibida ${root}: el plano personal no escribe ahí`, grill);
}

async function assertNoSymlinkOrEntry(dest: string, grill: Grill): Promise<void> {
  const st = await lstat(dest).catch(() => null);
  if (!st) return;
  if (st.isSymbolicLink()) refuse(`el destino ${dest} es un symlink; los artefactos exigen un directorio real`, grill);
  throw new CollectError("exists", `el destino ya existe: ${dest}`);
}

async function git(repo: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repo, ...args], { maxBuffer: 4 * 1024 * 1024 });
    return stdout.trim();
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new CollectError("git", `git ${args[0]}: ${e.stderr?.trim() || e.message}`);
  }
}

/** The plane of a grill: explicit since v2, derived from the brief's path before that. */
export async function planeOfGrill(kickoff: Kickoff, config: Config): Promise<{ plane: Plane; why: string }> {
  if (kickoff.plane) return { plane: kickoff.plane, why: "kickoff.json" };
  const source = kickoff.brief_source ?? "inline";
  if (source === "inline") return { plane: "personal", why: "brief inline" };
  const root = await forbiddenRootOf(source, config);
  return root
    ? { plane: "work", why: `el brief vino de ${source}, bajo ${root}` }
    : { plane: "personal", why: `el brief vino de ${source}` };
}

export async function collect(input: CollectInput, deps: CollectDeps = {}): Promise<CollectResult> {
  if (!isValidSlug(input.slug)) throw new CollectError("usage", `slug inválido "${input.slug}"`);
  const config = deps.config ?? (await loadConfig());
  const relay = deps.relay ?? createRelay({ config, allow: COLLECT_COMMANDS });
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));

  const grill = await getGrill(input.slug, config);
  if (!grill) throw new CollectError("not-found", `no hay artefactos en ${path.join(config.agentHome, "PLANS", input.slug)}`);
  const missing = ARTIFACT_NAMES.filter((a) => !grill.artifacts[a]).map((a) => ARTIFACT_FILE[a]);
  if (missing.length) throw new CollectError("missing", `faltan ${missing.join(", ")} en ${grill.dir}`);
  const kickoff = grill.kickoff;
  if (!kickoff) throw new CollectError("missing", `kickoff.json ilegible en ${grill.dir}`);
  if (kickoff.landed_at) {
    throw new CollectError("landed", `${input.slug} ya aterrizó en ${kickoff.landed_repo} (${kickoff.commit}) el ${new Date(kickoff.landed_at * 1000).toISOString()}`);
  }

  // Plane boundary, criterion first (what the user said at kickoff) then paths.
  const { plane, why } = await planeOfGrill(kickoff, config);
  if (plane === "work") refuse(`el grill es del plano de trabajo (${why})`, grill);
  const repo = await realpathLenient(input.repo);
  const top = await git(repo, ["rev-parse", "--show-toplevel"]).catch(() => {
    throw new CollectError("usage", `${input.repo} no es un repositorio git`);
  });
  const dest = path.join(top, "docs", "grill", input.slug);
  await assertPersonalPath("el repositorio", top, config, grill);
  await assertPersonalPath("el destino", dest, config, grill);
  await assertNoSymlinkOrEntry(dest, grill);

  return withSlugLock(grill.dir, async () => {
    const parent = path.dirname(dest);
    await mkdir(parent, { recursive: true });
    // The parent can change under us: recheck the resolved destination after
    // mkdir and right before the rename, as collect.sh did.
    await assertPersonalPath("el destino", dest, config, grill);
    await assertNoSymlinkOrEntry(dest, grill);

    const stage = await mkdtemp(path.join(parent, `.${input.slug}.tmp.`));
    try {
      await assertPersonalPath("el directorio temporal", stage, config, grill);
      for (const f of REQUIRED) await copyFile(path.join(grill.dir, f), path.join(stage, f));
      await assertNoSymlinkOrEntry(dest, grill);
      await rename(stage, dest);
    } catch (err) {
      await rm(stage, { recursive: true, force: true });
      throw err;
    }
    const files = REQUIRED.map((f) => path.join(dest, f));

    await git(top, ["add", "--", path.relative(top, dest)]);
    await git(top, ["commit", "-q", "-m", `docs(grill): ${input.slug} verdict`, "--", path.relative(top, dest)]);
    const commit = await git(top, ["rev-parse", "HEAD"]);

    const updated: Kickoff = { ...kickoff, landed_repo: top, commit, landed_at: now() };
    await writeKickoffFile(grill.dir, updated);

    const content = `Aterrizado en ${top}/docs/grill/${input.slug}/ · commit ${commit.slice(0, 7)}`;
    let closing: CollectResult["closing"];
    try {
      const { event_id } = await relay.run<{ event_id: string }>("messages send", [
        "--channel", kickoff.channel_id, "--reply-to", kickoff.root_event_id, "--content", content,
      ]);
      closing = { ok: true, eventId: event_id };
    } catch (err) {
      closing = { ok: false, detail: (err as Error).message, content };
    }
    return { slug: input.slug, repo: top, dest, files, commit, kickoff: updated, closing };
  });
}

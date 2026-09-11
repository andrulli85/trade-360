import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { loadConfig, type Config } from "./config.ts";
import { readKickoffFile, type GrillMode, type Kickoff } from "./kickoff-file.ts";

/**
 * A grill is one Buzz thread where the agent interrogates humans about a brief.
 * On disk it is `<agentHome>/PLANS/<slug>/` with up to four artifacts written by
 * the `buzz-kickoff` skill (terminal side) and the `grill-me` skill (agent side).
 */
export type { GrillMode, Kickoff } from "./kickoff-file.ts";

export type ArtifactName = "brief" | "ledger" | "verdict" | "kickoff";

export type GrillStatus =
  /** kickoff.json exists, verdict.md does not: the thread is still open. */
  | "open"
  /** verdict.md exists: the owner closed it with ✅. */
  | "closed"
  /** A PLANS folder with notes but no kickoff.json (handoffs, drafts). */
  | "notes";

export type Grill = {
  slug: string;
  dir: string;
  status: GrillStatus;
  mode: GrillMode | null;
  kickoff: Kickoff | null;
  artifacts: Record<ArtifactName, boolean>;
  /** Other markdown files in the folder, not part of the four artifacts. */
  extraFiles: string[];
  /** Epoch ms of the most recent file in the folder. */
  updatedAt: number;
};

const ARTIFACT_FILES: Record<ArtifactName, string> = {
  brief: "brief.md",
  ledger: "ledger.md",
  verdict: "verdict.md",
  kickoff: "kickoff.json",
};

export const ARTIFACT_NAMES: readonly ArtifactName[] = ["brief", "ledger", "verdict", "kickoff"];

export const MODE_LABEL: Record<GrillMode, string> = {
  rf: "Requisitos funcionales",
  oq: "Preguntas abiertas",
  dec: "Decisión",
  plan: "Plan",
  doc: "Documento",
};

/** What the panel and the CLI print for each status; kept together so they agree. */
export const STATUS_LABEL: Record<GrillStatus, string> = {
  open: "Abierto",
  closed: "Cerrado ✅",
  notes: "Notas",
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Slugs are kebab-case folder names; anything else must not become a path segment. */
export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

export function plansDirOf(config: Config): string {
  return path.join(config.agentHome, "PLANS");
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function readKickoff(dir: string): Promise<Kickoff | null> {
  return readKickoffFile(dir).catch(() => null);
}

async function readGrill(plansDir: string, slug: string): Promise<Grill | null> {
  const dir = path.join(plansDir, slug);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return null;

  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  const artifacts = Object.fromEntries(
    Object.entries(ARTIFACT_FILES).map(([k, f]) => [k, files.includes(f)]),
  ) as Record<ArtifactName, boolean>;

  const kickoff = artifacts.kickoff ? await readKickoff(dir) : null;
  const knownFiles = new Set(Object.values(ARTIFACT_FILES));
  const extraFiles = files.filter((f) => !knownFiles.has(f) && f.endsWith(".md")).sort();

  const mtimes = await Promise.all(
    files.map((f) => stat(path.join(dir, f)).then((s) => s.mtimeMs, () => 0)),
  );

  let status: GrillStatus = "notes";
  if (kickoff) status = artifacts.verdict ? "closed" : "open";

  return {
    slug,
    dir,
    status,
    mode: kickoff?.mode ?? null,
    kickoff,
    artifacts,
    extraFiles,
    updatedAt: Math.max(0, ...mtimes),
  };
}

/** Every folder under `<agentHome>/PLANS/`, newest first. */
export async function listGrills(config?: Config): Promise<{ plansDir: string; grills: Grill[] }> {
  const plansDir = plansDirOf(config ?? (await loadConfig()));
  const entries = await readdir(plansDir, { withFileTypes: true }).catch(() => []);
  const slugs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const grills = (await Promise.all(slugs.map((s) => readGrill(plansDir, s)))).filter(
    (g): g is Grill => g !== null,
  );
  grills.sort((a, b) => b.updatedAt - a.updatedAt);
  return { plansDir, grills };
}

export async function getGrill(slug: string, config?: Config): Promise<Grill | null> {
  if (!isValidSlug(slug)) return null;
  return readGrill(plansDirOf(config ?? (await loadConfig())), slug);
}

/** Read one markdown artifact (or extra file) of a grill; null when missing. */
export async function readGrillFile(grill: Grill, file: string): Promise<string | null> {
  const allowed = new Set([...Object.values(ARTIFACT_FILES), ...grill.extraFiles]);
  if (!allowed.has(file)) return null;
  const p = path.join(grill.dir, file);
  if (!(await exists(p))) return null;
  return readFile(p, "utf8");
}

export const ARTIFACT_FILE = ARTIFACT_FILES;

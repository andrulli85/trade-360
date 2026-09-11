import "server-only";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";

/**
 * A grill is one Buzz thread where the agent interrogates humans about a brief.
 * On disk it is `<AGENT_HOME>/PLANS/<slug>/` with up to four artifacts written by
 * the `buzz-kickoff` skill (terminal side) and the `grill-me` skill (agent side).
 */
export type GrillMode = "rf" | "oq" | "dec" | "plan" | "doc";

export type ArtifactName = "brief" | "ledger" | "verdict" | "kickoff";

export type Kickoff = {
  channel_id: string;
  root_event_id: string;
  slug: string;
  mode: GrillMode;
  brief: string;
  started_at: number;
};

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

export const MODE_LABEL: Record<GrillMode, string> = {
  rf: "Requisitos funcionales",
  oq: "Preguntas abiertas",
  dec: "Decisión",
  plan: "Plan",
  doc: "Documento",
};

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readKickoff(dir: string): Promise<Kickoff | null> {
  try {
    const raw = await readFile(path.join(dir, ARTIFACT_FILES.kickoff), "utf8");
    return JSON.parse(raw) as Kickoff;
  } catch {
    return null;
  }
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

/** Every folder under `<AGENT_HOME>/PLANS/`, newest first. */
export async function listGrills(): Promise<{ plansDir: string; grills: Grill[] }> {
  const { agentHome } = await loadConfig();
  const plansDir = path.join(agentHome, "PLANS");
  const entries = await readdir(plansDir, { withFileTypes: true }).catch(() => []);
  const slugs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const grills = (await Promise.all(slugs.map((s) => readGrill(plansDir, s)))).filter(
    (g): g is Grill => g !== null,
  );
  grills.sort((a, b) => b.updatedAt - a.updatedAt);
  return { plansDir, grills };
}

export async function getGrill(slug: string): Promise<Grill | null> {
  // Slugs are kebab-case folder names; anything else is not a grill and must not
  // become a path segment.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
  const { agentHome } = await loadConfig();
  return readGrill(path.join(agentHome, "PLANS"), slug);
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

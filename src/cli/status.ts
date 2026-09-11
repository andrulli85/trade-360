import { loadConfig, type Config } from "../core/config.ts";
import { formatEpochMs, formatEpochSeconds, shortId } from "../core/format.ts";
import {
  ARTIFACT_NAMES,
  getGrill,
  isValidSlug,
  listGrills,
  MODE_LABEL,
  STATUS_LABEL,
  type Grill,
} from "../core/grills.ts";
import type { Relay } from "../core/relay.ts";
import { describeTurn, getThread, type Thread } from "../core/thread.ts";

/**
 * `t360 status [slug]`: the same picture the panel gives. Without a slug it is
 * the list read from disk (no relay call, like the panel's home); with a slug it
 * adds the turn and the thread read from the relay.
 */
export type StatusList = {
  config: Pick<Config, "source" | "path" | "agentHome" | "agentName" | "relayUrl">;
  plansDir: string;
  grills: Grill[];
};

export type StatusOne = { grill: Grill; thread: Thread };

export class NotFound extends Error {}

export async function statusList(config?: Config): Promise<StatusList> {
  const cfg = config ?? (await loadConfig());
  const { plansDir, grills } = await listGrills(cfg);
  const { source, path, agentHome, agentName, relayUrl } = cfg;
  return { config: { source, path, agentHome, agentName, relayUrl }, plansDir, grills };
}

export async function statusOne(slug: string, deps: { config?: Config; relay?: Relay } = {}): Promise<StatusOne> {
  if (!isValidSlug(slug)) throw new NotFound(`"${slug}" no es un slug válido (kebab-case)`);
  const config = deps.config ?? (await loadConfig());
  const grill = await getGrill(slug, config);
  if (!grill) throw new NotFound(`no existe ${slug} en ${config.agentHome}/PLANS`);
  const thread = await getThread(grill, { config, relay: deps.relay });
  return { grill, thread };
}

/* ---------- Text rendering ---------- */

function artifactLetters(g: Grill): string {
  return ARTIFACT_NAMES.map((a) => (g.artifacts[a] ? a[0] : "·")).join("") + (g.extraFiles.length ? `+${g.extraFiles.length}` : "");
}

function table(rows: string[][]): string {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows
    .map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join("  "))
    .join("\n");
}

export function renderList(s: StatusList): string {
  const open = s.grills.filter((g) => g.status === "open").length;
  const closed = s.grills.filter((g) => g.status === "closed").length;
  const cfg = s.config.path ? `${s.config.path} (${s.config.source})` : "sin archivo, valores por defecto";
  const head = [
    `PLANS: ${s.plansDir}`,
    `Config: ${cfg}`,
    `Agente: ${s.config.agentName} · Relay: ${s.config.relayUrl ?? "—"}`,
    `${open} abiertos · ${closed} cerrados · ${s.grills.length - open - closed} carpetas de notas`,
  ];
  if (s.grills.length === 0) return [...head, "", `No hay carpetas en ${s.plansDir}.`].join("\n");
  const rows = [
    ["GRILL", "ESTADO", "MODO", "ARTEF.", "CANAL", "INICIO", "ACTUALIZADO"],
    ...s.grills.map((g) => [
      g.slug,
      STATUS_LABEL[g.status],
      g.mode ?? "—",
      artifactLetters(g),
      g.kickoff ? shortId(g.kickoff.channel_id) : "—",
      g.kickoff ? formatEpochSeconds(g.kickoff.started_at) : "—",
      formatEpochMs(g.updatedAt),
    ]),
  ];
  return [...head, "", table(rows), "", "Artefactos: brief · ledger · verdict · kickoff."].join("\n");
}

export function renderOne({ grill, thread }: StatusOne, agentName: string): string {
  const lines = [
    [grill.slug, STATUS_LABEL[grill.status], grill.mode ? `${MODE_LABEL[grill.mode]} (${grill.mode})` : null]
      .filter(Boolean)
      .join(" · "),
    `Carpeta     ${grill.dir}`,
  ];
  if (grill.kickoff) {
    lines.push(
      `Canal       ${grill.kickoff.channel_id}`,
      `Hilo raíz   ${grill.kickoff.root_event_id}`,
      `Inicio      ${formatEpochSeconds(grill.kickoff.started_at)}`,
    );
  }
  if (grill.kickoff?.plane) lines.push(`Plano       ${grill.kickoff.plane}`);
  if (grill.kickoff?.checked_at && !grill.kickoff.landed_at) {
    lines.push(`✅ recibido ${formatEpochSeconds(grill.kickoff.checked_at)} · pendiente de aterrizar (t360 collect ${grill.slug} --repo …)`);
  }
  if (grill.kickoff?.landed_at) {
    lines.push(`Aterrizado  ${grill.kickoff.landed_repo}/docs/grill/${grill.slug}/ · ${grill.kickoff.commit?.slice(0, 7)} · ${formatEpochSeconds(grill.kickoff.landed_at)}`);
  }
  lines.push(`Artefactos  ${ARTIFACT_NAMES.map((a) => `${a} ${grill.artifacts[a] ? "✔" : "✘"}`).join("  ")}`);
  if (grill.extraFiles.length) lines.push(`Otros       ${grill.extraFiles.join(", ")}`);
  lines.push("");
  if (!thread.ok) {
    if (thread.reason !== "no-kickoff") lines.push(`Hilo de Buzz no disponible: ${thread.detail}`);
    return lines.join("\n");
  }
  const t = describeTurn(thread.turn, agentName);
  lines.push([t.title, t.meta].filter(Boolean).join(" — "));
  if (t.body) lines.push(`  ${t.body}`);
  lines.push(`${thread.messages.length} mensajes · leído del relay ${formatEpochSeconds(thread.fetchedAt)}`);
  return lines.join("\n");
}

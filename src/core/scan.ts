import { loadConfig, type Config } from "./config.ts";
import { ARTIFACT_FILE, ARTIFACT_NAMES, listGrills, type ArtifactName, type Grill } from "./grills.ts";
import { readKickoffFile, SlugLocked, withSlugLock, writeKickoffFile } from "./kickoff-file.ts";
import { createRelay, RelayUnavailable, SCAN_COMMANDS, type Relay } from "./relay.ts";
import { threadMessages, turnFrom } from "./thread.ts";

/**
 * `t360 scan`: one pass over the open grills looking for the owner's ✅. Run
 * by the LaunchAgent every 15 s (ADR D1); the only poller (D6). It never
 * lands anything (S4): it records `checked_at` in `kickoff.json` and tells the
 * thread which artifacts are still missing, so a human runs `collect`.
 *
 * "Closed" means exactly what the panel's turn card means: the same thread
 * filter and the same rule (`turnFrom`), so the two never disagree.
 *
 * Only grills opened by `t360 kickoff` (they carry `plane`) are watched; the
 * ones the skill's scripts opened stay with the skill's Monitor.
 */
export type ScanOutcome =
  | { slug: string; result: "checked"; checkedAt: number; missing: string[]; notice: { ok: true; eventId: string } | { ok: false; detail: string } }
  | { slug: string; result: "waiting" }
  | { slug: string; result: "skipped"; why: "checked" | "landed" | "locked" | "legacy" }
  | { slug: string; result: "error"; detail: string };

export type ScanDeps = { config?: Config; relay?: Relay; now?: () => number };

export function missingArtifacts(grill: Grill): string[] {
  return ARTIFACT_NAMES.filter((a) => !grill.artifacts[a]).map((a) => ARTIFACT_FILE[a]);
}

/** The line posted in the thread when the ✅ is seen. */
export function noticeText(artifacts: Record<ArtifactName, boolean>): string {
  const marks = ARTIFACT_NAMES.map((a) => `${a} ${artifacts[a] ? "✔" : "✘"}`).join(" · ");
  const missing = ARTIFACT_NAMES.filter((a) => !artifacts[a]).map((a) => ARTIFACT_FILE[a]);
  const tail = missing.length
    ? `Falta ${missing.join(", ")}; aterrizo con t360 collect cuando estén los cuatro.`
    : "Listo para aterrizar con t360 collect.";
  return `✅ recibido. Artefactos: ${marks}. ${tail}`;
}

async function scanOne(grill: Grill, config: Config, relay: Relay): Promise<ScanOutcome> {
  const { slug } = grill;
  const kickoff = grill.kickoff!;
  // Grills opened by the skill's scripts (no `plane`) belong to its Monitor:
  // one poller per grill during the transition, and no notices in old threads.
  if (!kickoff.plane) return { slug, result: "skipped", why: "legacy" };
  if (kickoff.landed_at) return { slug, result: "skipped", why: "landed" };
  if (kickoff.checked_at) return { slug, result: "skipped", why: "checked" };

  const raw = await relay.getMessages(kickoff.channel_id, { since: kickoff.started_at - 1 });
  const messages = await threadMessages(raw, kickoff.root_event_id, config, async () => null);
  const turn = turnFrom(messages);
  if (turn.kind !== "closed") return { slug, result: "waiting" };

  try {
    return await withSlugLock(grill.dir, async (): Promise<ScanOutcome> => {
      // Re-read under the lock: collect or a previous pass may have written.
      const current = (await readKickoffFile(grill.dir)) ?? kickoff;
      if (current.checked_at) return { slug, result: "skipped", why: "checked" };
      await writeKickoffFile(grill.dir, { ...current, checked_at: turn.at });

      const fresh = await listGrills(config).then((l) => l.grills.find((g) => g.slug === slug) ?? grill);
      const content = noticeText(fresh.artifacts);
      let notice: Extract<ScanOutcome, { result: "checked" }>["notice"];
      try {
        const { event_id } = await relay.run<{ event_id: string }>("messages send", [
          "--channel", kickoff.channel_id, "--reply-to", kickoff.root_event_id, "--content", content,
        ]);
        notice = { ok: true, eventId: event_id };
      } catch (err) {
        notice = { ok: false, detail: (err as Error).message };
      }
      return { slug, result: "checked", checkedAt: turn.at, missing: missingArtifacts(fresh), notice };
    });
  } catch (err) {
    if (err instanceof SlugLocked) return { slug, result: "skipped", why: "locked" };
    throw err;
  }
}

export async function scan(deps: ScanDeps = {}): Promise<ScanOutcome[]> {
  const config = deps.config ?? (await loadConfig());
  const relay = deps.relay ?? createRelay({ config, allow: SCAN_COMMANDS });
  const { grills } = await listGrills(config);
  const outcomes: ScanOutcome[] = [];
  for (const grill of grills) {
    if (!grill.kickoff) continue;
    try {
      outcomes.push(await scanOne(grill, config, relay));
    } catch (err) {
      const detail = err instanceof RelayUnavailable ? `${err.reason}: ${err.message}` : (err as Error).message;
      outcomes.push({ slug: grill.slug, result: "error", detail });
      // Without an identity or a binary every grill fails the same way.
      if (err instanceof RelayUnavailable && err.reason !== "cli-error") break;
    }
  }
  return outcomes;
}

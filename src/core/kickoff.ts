import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig, type Config } from "./config.ts";
import { isValidSlug, plansDirOf } from "./grills.ts";
import { isMode, readKickoffFile, withSlugLock, writeAtomic, writeKickoffFile, type GrillMode, type Kickoff } from "./kickoff-file.ts";
import { forbiddenRootOf, isPlane, realpathLenient, type Plane } from "./plane.ts";
import { createRelay, KICKOFF_COMMANDS, type Relay } from "./relay.ts";

/**
 * `t360 kickoff`: open a grill. Migrates the skill's `kickoff.sh` (private
 * channel, members, kickoff message, `kickoff.json`) and adds what the ADR
 * asks for: the plane is explicit (D4), the brief is written here, and the
 * record is written atomically under the slug lock (D5, D6).
 */
export type KickoffInput = {
  slug: string;
  mode: GrillMode;
  plane: Plane;
  description: string;
  /** Brief text and where it came from: a file path (resolved into `brief_source`) or "inline". */
  brief: { text: string; source: string };
  /** Extra members besides the agent and the owner. */
  with?: string[];
};

export type KickoffDeps = {
  config?: Config;
  relay?: Relay;
  /** Pause after adding members so the agent's harness sees the channel (default 2 s; 0 in tests). */
  settleMs?: number;
  now?: () => number;
};

export type KickoffErrorCode = "usage" | "plane" | "exists" | "config" | "relay";

export class KickoffError extends Error {
  readonly code: KickoffErrorCode;
  /** Channel created before the failure, if any, so the user can clean up. */
  readonly channelId?: string;
  constructor(code: KickoffErrorCode, message: string, channelId?: string) {
    super(message);
    this.name = "KickoffError";
    this.code = code;
    this.channelId = channelId;
  }
}

/** Buzz channel names are short; the skill capped slugs at 23 characters. */
export const MAX_SLUG_LENGTH = 23;
const PUBKEY_RE = /^[0-9a-f]{64}$/;

/** Read a brief from a file, giving the resolved path as its source. */
export async function briefFromFile(file: string): Promise<KickoffInput["brief"]> {
  const source = await realpathLenient(file);
  return { text: await readFile(source, "utf8"), source };
}

/** The plane a brief file implies, or null when the source is inline. */
export async function planeOfBrief(source: string, config: Config): Promise<{ plane: Plane; root: string | null } | null> {
  if (source === "inline") return null;
  const root = await forbiddenRootOf(source, config);
  return { plane: root ? "work" : "personal", root };
}

export function validateKickoffInput(input: KickoffInput): void {
  if (!isValidSlug(input.slug) || input.slug.length > MAX_SLUG_LENGTH) {
    throw new KickoffError("usage", `slug inválido "${input.slug}": kebab-case, máximo ${MAX_SLUG_LENGTH} caracteres`);
  }
  if (!isMode(input.mode)) throw new KickoffError("usage", `modo inválido "${input.mode}": rf | oq | dec | plan | doc`);
  if (!isPlane(input.plane)) throw new KickoffError("usage", `plano inválido "${input.plane}": personal | work`);
  if (!input.description.trim()) throw new KickoffError("usage", "falta la descripción del grill");
  if (!input.brief.text.trim()) throw new KickoffError("usage", "el brief está vacío");
  for (const pk of input.with ?? []) {
    if (!PUBKEY_RE.test(pk)) throw new KickoffError("usage", `pubkey inválida "${pk}": 64 caracteres hex`);
  }
}

export async function kickoff(input: KickoffInput, deps: KickoffDeps = {}): Promise<Kickoff> {
  validateKickoffInput(input);
  const config = deps.config ?? (await loadConfig());
  const relay = deps.relay ?? createRelay({ config, allow: KICKOFF_COMMANDS });
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));

  if (!config.agentPubkey || !config.ownerPubkey) {
    throw new KickoffError("config", `faltan agent.pubkey u owner.pubkey en ${config.path ?? "la configuración"}`);
  }
  // A brief that lives under a forbidden root is work-plane whatever the user
  // says; the opposite (personal path, plane=work) is a legitimate call.
  const implied = await planeOfBrief(input.brief.source, config);
  if (implied?.plane === "work" && input.plane === "personal") {
    throw new KickoffError(
      "plane",
      `el brief viene de ${input.brief.source}, bajo la raíz prohibida ${implied.root}: su plano es work, no personal`,
    );
  }

  const dir = path.join(plansDirOf(config), input.slug);
  const briefRel = path.posix.join("PLANS", input.slug, "brief.md");

  return withSlugLock(dir, async () => {
    if (await readKickoffFile(dir)) throw new KickoffError("exists", `${input.slug} ya tiene kickoff.json en ${dir}`);
    await writeAtomic(path.join(dir, "brief.md"), input.brief.text.endsWith("\n") ? input.brief.text : `${input.brief.text}\n`);

    // Taken before the channel exists, so no message in it can predate it.
    const startedAt = now();
    let channelId: string | undefined;
    try {
      ({ channel_id: channelId } = await relay.run<{ channel_id: string }>("channels create", [
        "--name", input.slug, "--type", "stream", "--visibility", "private", "--description", input.description,
      ]));
      const members = [...new Set([config.agentPubkey!, config.ownerPubkey!, ...(input.with ?? [])])];
      for (const pk of members) {
        await relay.run("channels add-member", ["--channel", channelId, "--pubkey", pk], { raw: true });
      }
      await relay
        .run("channels topic", ["--channel", channelId, "--topic", `grill ${input.mode}: ${input.description}`], { raw: true })
        .catch(() => undefined);
      if ((deps.settleMs ?? 2000) > 0) await new Promise((r) => setTimeout(r, deps.settleMs ?? 2000));

      const { event_id } = await relay.run<{ event_id: string }>("messages send", [
        "--channel", channelId, "--mention", config.agentPubkey!,
        "--content", `@${config.agentName} /grill-me ${input.mode} ${briefRel}`,
      ]);

      const rec: Kickoff = {
        channel_id: channelId,
        root_event_id: event_id,
        slug: input.slug,
        mode: input.mode,
        brief: briefRel,
        brief_source: input.brief.source,
        plane: input.plane,
        started_at: startedAt,
      };
      await writeKickoffFile(dir, rec);
      return rec;
    } catch (err) {
      if (err instanceof KickoffError) throw err;
      const where = channelId ? ` (canal ${channelId} ya creado; sin kickoff.json)` : "";
      throw new KickoffError("relay", `${(err as Error).message}${where}`, channelId);
    }
  });
}

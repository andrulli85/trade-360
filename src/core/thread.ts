import { loadConfig, type Config } from "./config.ts";
import { formatEpochSeconds, formatRelativeSeconds } from "./format.ts";
import { defaultRelay, RelayUnavailable, type BuzzMessage, type Relay, type RelayReason } from "./relay.ts";
import type { Grill } from "./grills.ts";

/** Who wrote a message, as far as the config's pubkeys can tell. */
export type Role = "agent" | "owner" | "terminal" | "other";

export type ThreadMessage = {
  id: string;
  pubkey: string;
  author: string;
  role: Role;
  content: string;
  createdAt: number;
  isRoot: boolean;
  isCheck: boolean;
};

/** Whose move it is, derived from the last message in the thread. */
export type Turn =
  | { kind: "closed"; at: number }
  | { kind: "owner"; since: number; question: string }
  | { kind: "agent"; since: number }
  | { kind: "idle"; since: number }
  | { kind: "empty" };

export type ThreadFailure = "no-kickoff" | RelayReason;

export type Thread =
  | { ok: true; messages: ThreadMessage[]; turn: Turn; fetchedAt: number }
  | { ok: false; reason: ThreadFailure; detail: string };

function replyRoot(m: BuzzMessage): string | null {
  const e = m.tags.find((t) => t[0] === "e" && (t[3] === "reply" || t[3] === "root"));
  return e?.[1] ?? null;
}

function questionOf(content: string): string {
  // The grill agent marks questions with ❓ and bold ids (**Q1**); keep the first
  // question paragraph as the summary. Fall back to the first line.
  const paras = content.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const q = paras.find((p) => p.startsWith("❓")) ?? paras[0] ?? "";
  return q.replace(/\*\*/g, "").slice(0, 240);
}

export function turnFrom(messages: ThreadMessage[]): Turn {
  if (messages.length === 0) return { kind: "empty" };
  const check = [...messages].reverse().find((m) => m.isCheck && m.role === "owner");
  if (check) return { kind: "closed", at: check.createdAt };
  const last = messages[messages.length - 1];
  if (last.role === "agent") {
    return { kind: "owner", since: last.createdAt, question: questionOf(last.content) };
  }
  if (last.role === "owner" || last.role === "other") return { kind: "agent", since: last.createdAt };
  return { kind: "idle", since: last.createdAt };
}

/** The turn in words: what the panel's card and `t360 status` both print. */
export type TurnText = { tone: "closed" | "owner" | "agent" | "idle"; title: string; meta?: string; body?: string };

export function describeTurn(turn: Turn, agentName: string, nowMs = Date.now()): TurnText {
  switch (turn.kind) {
    case "closed":
      return { tone: "closed", title: "Cerrado con ✅", meta: formatEpochSeconds(turn.at) };
    case "owner":
      return {
        tone: "owner",
        title: "Te toca responder",
        meta: `${agentName} preguntó ${formatRelativeSeconds(turn.since, nowMs)}`,
        body: turn.question,
      };
    case "agent":
      return {
        tone: "agent",
        title: `Turno de ${agentName}`,
        meta: `última respuesta humana ${formatRelativeSeconds(turn.since, nowMs)}`,
      };
    case "idle":
      return { tone: "idle", title: "Sin actividad humana ni del agente", meta: formatRelativeSeconds(turn.since, nowMs) };
    case "empty":
      return { tone: "idle", title: "El hilo todavía no tiene mensajes" };
  }
}

/** Turn raw relay messages into the thread of one kickoff, oldest first, authors resolved. */
export async function threadMessages(
  raw: BuzzMessage[],
  rootEventId: string,
  config: Pick<Config, "agentPubkey" | "ownerPubkey">,
  resolveUser: Relay["getUser"],
): Promise<ThreadMessage[]> {
  const inThread = raw
    .filter((m) => m.id === rootEventId || replyRoot(m) === rootEventId)
    .sort((a, b) => a.created_at - b.created_at);

  const pubkeys = [...new Set(inThread.map((m) => m.pubkey))];
  const names = new Map(
    await Promise.all(
      pubkeys.map(async (pk) => {
        const u = await resolveUser(pk);
        return [pk, u?.display_name || u?.name || `${pk.slice(0, 8)}…`] as const;
      }),
    ),
  );

  // The kickoff is always posted by the terminal identity; anything else from
  // that same key is the terminal too.
  const terminalPk = inThread.find((m) => m.id === rootEventId)?.pubkey ?? null;
  const roleOf = (pk: string, isRoot: boolean): Role => {
    if (pk === terminalPk) return "terminal";
    if (pk === config.agentPubkey) return "agent";
    if (pk === config.ownerPubkey) return "owner";
    if (isRoot) return "terminal";
    return "other";
  };

  return inThread.map((m) => {
    const isRoot = m.id === rootEventId;
    return {
      id: m.id,
      pubkey: m.pubkey,
      author: names.get(m.pubkey) ?? m.pubkey,
      role: roleOf(m.pubkey, isRoot),
      content: m.content,
      createdAt: m.created_at,
      isRoot,
      isCheck: m.content.trim() === "✅",
    };
  });
}

export type ThreadDeps = { config?: Config; relay?: Relay };

/**
 * The grill thread: the kickoff message plus every reply to it, oldest first,
 * with authors resolved and the current turn worked out. Never writes.
 */
export async function getThread(grill: Grill, deps: ThreadDeps = {}): Promise<Thread> {
  if (!grill.kickoff) return { ok: false, reason: "no-kickoff", detail: "Esta carpeta no tiene kickoff.json." };
  const { channel_id, root_event_id, started_at } = grill.kickoff;
  const config = deps.config ?? (await loadConfig());
  const relay = deps.relay ?? defaultRelay();

  let raw: BuzzMessage[];
  try {
    raw = await relay.getMessages(channel_id, { since: started_at - 1 });
  } catch (err) {
    if (err instanceof RelayUnavailable) return { ok: false, reason: err.reason, detail: err.message };
    throw err;
  }

  const messages = await threadMessages(raw, root_event_id, config, (pk) => relay.getUser(pk));
  return { ok: true, messages, turn: turnFrom(messages), fetchedAt: Math.floor(Date.now() / 1000) };
}

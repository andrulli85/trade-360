import "server-only";
import { loadConfig } from "./config";
import { BuzzUnavailable, getMessages, getUser, type BuzzMessage } from "./buzz";
import type { Grill } from "./grills";

/** Who wrote a message, as far as the panel can tell from the config's pubkeys. */
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

export type Thread =
  | { ok: true; messages: ThreadMessage[]; turn: Turn; fetchedAt: number }
  | { ok: false; reason: "no-kickoff" | "no-wrapper" | "cli-error"; detail: string };

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

function turnFrom(messages: ThreadMessage[]): Turn {
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

/**
 * The grill thread: the kickoff message plus every reply to it, oldest first,
 * with authors resolved and the current turn worked out. Never writes.
 */
export async function getThread(grill: Grill): Promise<Thread> {
  if (!grill.kickoff) return { ok: false, reason: "no-kickoff", detail: "Esta carpeta no tiene kickoff.json." };
  const { channel_id, root_event_id, started_at } = grill.kickoff;
  const config = await loadConfig();

  let raw: BuzzMessage[];
  try {
    raw = await getMessages(channel_id, { since: started_at - 1 });
  } catch (err) {
    if (err instanceof BuzzUnavailable) return { ok: false, reason: err.reason, detail: err.message };
    throw err;
  }

  const inThread = raw
    .filter((m) => m.id === root_event_id || replyRoot(m) === root_event_id)
    .sort((a, b) => a.created_at - b.created_at);

  const pubkeys = [...new Set(inThread.map((m) => m.pubkey))];
  const names = new Map(
    await Promise.all(
      pubkeys.map(async (pk) => {
        const u = await getUser(pk);
        return [pk, u?.display_name || u?.name || `${pk.slice(0, 8)}…`] as const;
      }),
    ),
  );

  const roleOf = (pk: string, isRoot: boolean): Role => {
    if (pk === config.agentPubkey) return "agent";
    if (pk === config.ownerPubkey) return "owner";
    // The kickoff is always posted by the terminal identity; anything else from
    // that same key is the terminal too.
    if (isRoot) return "terminal";
    return "other";
  };
  const terminalPk = inThread.find((m) => m.id === root_event_id)?.pubkey ?? null;

  const messages: ThreadMessage[] = inThread.map((m) => {
    const isRoot = m.id === root_event_id;
    const role = m.pubkey === terminalPk ? "terminal" : roleOf(m.pubkey, isRoot);
    return {
      id: m.id,
      pubkey: m.pubkey,
      author: names.get(m.pubkey) ?? m.pubkey,
      role,
      content: m.content,
      createdAt: m.created_at,
      isRoot,
      isCheck: m.content.trim() === "✅",
    };
  });

  return { ok: true, messages, turn: turnFrom(messages), fetchedAt: Math.floor(Date.now() / 1000) };
}

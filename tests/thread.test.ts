import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { getGrill } from "../src/core/grills.ts";
import { createRelay } from "../src/core/relay.ts";
import { describeTurn, getThread, turnFrom, type ThreadMessage } from "../src/core/thread.ts";
import { AGENT, kickoffJson, makeSandbox, msg, OWNER, rootMsg, TERMINAL, useEnv, type Sandbox } from "./helpers.ts";

let sb: Sandbox;
let restore: () => void;
before(async () => {
  sb = await makeSandbox();
  restore = useEnv(sb.env);
  await sb.writeGrill("demo", { "brief.md": "# b", "kickoff.json": kickoffJson() });
  await sb.writeGrill("notas", { "handoff.md": "# h" });
  await sb.setUsers([
    { pubkey: OWNER, display_name: "Andy" },
    { pubkey: AGENT, name: "Claude" },
  ]);
});
after(async () => {
  restore();
  await sb.cleanup();
});

const tm = (over: Partial<ThreadMessage> & { role: ThreadMessage["role"] }): ThreadMessage => ({
  id: "x",
  pubkey: "p",
  author: "a",
  content: "",
  createdAt: 1,
  isRoot: false,
  isCheck: false,
  ...over,
});

test("turnFrom: ✅ del owner cierra aunque haya mensajes después", () => {
  const t = turnFrom([
    tm({ role: "terminal", isRoot: true }),
    tm({ role: "owner", isCheck: true, createdAt: 50 }),
    tm({ role: "agent", content: "gracias", createdAt: 60 }),
  ]);
  assert.deepEqual(t, { kind: "closed", at: 50 });
});

test("turnFrom: ✅ de otro pubkey no cierra; último del agente → te toca, con la pregunta ❓", () => {
  const t = turnFrom([
    tm({ role: "other", isCheck: true, createdAt: 2 }),
    tm({
      role: "agent",
      createdAt: 3,
      content: "Contexto.\n\n❓ **Q1** ¿Cuál es el **plano**?\n\n(Responde con @Claude)",
    }),
  ]);
  assert.deepEqual(t, { kind: "owner", since: 3, question: "❓ Q1 ¿Cuál es el plano?" });
});

test("turnFrom: humano al final → turno del agente; solo terminal → idle; vacío", () => {
  assert.deepEqual(turnFrom([tm({ role: "owner", createdAt: 4 })]), { kind: "agent", since: 4 });
  assert.deepEqual(turnFrom([tm({ role: "terminal", createdAt: 1 })]), { kind: "idle", since: 1 });
  assert.deepEqual(turnFrom([]), { kind: "empty" });
});

test("describeTurn: el texto que comparten la tarjeta del panel y el CLI", () => {
  const now = 10_000 * 1000;
  assert.deepEqual(describeTurn({ kind: "owner", since: 10_000 - 3 * 3600, question: "❓ Q1" }, "Claude", now), {
    tone: "owner",
    title: "Te toca responder",
    meta: "Claude preguntó hace 3 horas",
    body: "❓ Q1",
  });
  assert.equal(describeTurn({ kind: "agent", since: 10_000 - 120 }, "Claude", now).title, "Turno de Claude");
  assert.equal(describeTurn({ kind: "closed", at: 1 }, "Claude", now).title, "Cerrado con ✅");
  assert.equal(describeTurn({ kind: "empty" }, "Claude", now).tone, "idle");
});

test("getThread: filtra al hilo del kickoff, resuelve autores y roles, deriva el turno", async () => {
  await sb.setMessages([
    rootMsg(),
    msg({ pubkey: OWNER, content: "fuera del hilo", created_at: 1001, tags: [["e", "z".repeat(64), "", "reply"]] }),
    msg({ pubkey: AGENT, content: "❓ **Q1** ¿Qué plano?", created_at: 1002 }),
    msg({ pubkey: OWNER, content: "personal", created_at: 1003 }),
    msg({ pubkey: TERMINAL, content: "nota de la terminal", created_at: 1004 }),
    msg({ pubkey: "e".repeat(64), content: "invitado", created_at: 1005 }),
    msg({ pubkey: OWNER, content: "antes del kickoff", created_at: 900 }),
  ]);
  const grill = (await getGrill("demo"))!;
  const thread = await getThread(grill, { relay: createRelay() });
  assert.ok(thread.ok);
  assert.deepEqual(
    thread.messages.map((m) => [m.author, m.role, m.isRoot]),
    [
      ["cccccccc…", "terminal", true],
      ["Claude", "agent", false],
      ["Andy", "owner", false],
      ["cccccccc…", "terminal", false],
      ["eeeeeeee…", "other", false],
    ],
  );
  assert.deepEqual(thread.turn, { kind: "agent", since: 1005 });
  const [first] = await sb.calls();
  assert.ok(first.argv.includes("--since") && first.argv.includes("999"), "lee desde started_at - 1");
});

test("getThread: cierre con ✅ y fallo del relay como resultado, no excepción", async () => {
  await sb.setMessages([rootMsg(), msg({ pubkey: AGENT, content: "❓ fin?", created_at: 1002 }), msg({ pubkey: OWNER, content: " ✅ ", created_at: 1003 })]);
  const grill = (await getGrill("demo"))!;
  const closed = await getThread(grill, { relay: createRelay() });
  assert.ok(closed.ok);
  assert.deepEqual(closed.turn, { kind: "closed", at: 1003 });
  assert.equal(closed.messages[2].isCheck, true);

  await sb.setFailure({ error: "relay", message: "down" });
  try {
    const failed = await getThread(grill, { relay: createRelay() });
    assert.deepEqual(failed, { ok: false, reason: "cli-error", detail: "relay: down" });
  } finally {
    await sb.setFailure(null);
  }

  const notes = (await getGrill("notas"))!;
  const noKickoff = await getThread(notes);
  assert.equal(noKickoff.ok, false);
  assert.equal(!noKickoff.ok && noKickoff.reason, "no-kickoff");
});

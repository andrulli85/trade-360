import assert from "node:assert/strict";
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { loadConfig } from "../src/core/config.ts";
import { readKickoffFile } from "../src/core/kickoff-file.ts";
import { createRelay, SCAN_COMMANDS } from "../src/core/relay.ts";
import { noticeText, scan } from "../src/core/scan.ts";
import { AGENT, CHANNEL, kickoffJson, makeSandbox, msg, OWNER, ROOT, rootMsg, sentEventId, useEnv, type Sandbox } from "./helpers.ts";

let sb: Sandbox;
let restore: () => void;
before(async () => {
  sb = await makeSandbox();
  restore = useEnv(sb.env);
  await sb.setUsers([]);
});
after(async () => {
  restore();
  await sb.cleanup();
});

const deps = async () => {
  const config = await loadConfig();
  return { config, relay: createRelay({ config, allow: SCAN_COMMANDS }) };
};
const outcomeOf = async (slug: string) => (await scan(await deps())).find((o) => o.slug === slug);
const v2 = (slug: string, over: Record<string, unknown> = {}) => kickoffJson({ slug, plane: "personal", ...over });

test("scan: sin ✅ espera; ✅ de otro pubkey, fuera del hilo o antes del cutoff no cuenta", async () => {
  await sb.writeGrill("open", { "brief.md": "b", "kickoff.json": v2("open") });
  await sb.setMessages([
    rootMsg(),
    msg({ pubkey: AGENT, content: "❓ Q1", created_at: 1002 }),
    msg({ pubkey: "e".repeat(64), content: "✅", created_at: 1003 }),
    msg({ pubkey: OWNER, content: "✅", created_at: 1004, tags: [] }),
    msg({ pubkey: OWNER, content: "✅", created_at: 900 }),
    msg({ pubkey: OWNER, content: "✅ casi", created_at: 1005 }),
  ]);
  assert.deepEqual(await outcomeOf("open"), { slug: "open", result: "waiting" });
  assert.equal((await readKickoffFile(path.join(sb.plansDir, "open")))?.checked_at, undefined);
  assert.equal((await sb.calls()).filter((c) => c.argv[1] === "send").length, 0);
});

test("scan: ✅ del owner en el hilo → checked_at con su epoch, aviso con lo que falta, idempotente", async () => {
  await sb.setMessages([rootMsg(), msg({ pubkey: AGENT, content: "❓ Q1", created_at: 1002 }), msg({ pubkey: OWNER, content: " ✅ ", created_at: 1010 })]);
  const first = await outcomeOf("open");
  assert.deepEqual(first, {
    slug: "open",
    result: "checked",
    checkedAt: 1010,
    missing: ["ledger.md", "verdict.md"],
    notice: { ok: true, eventId: sentEventId(0) },
  });
  const rec = await readKickoffFile(path.join(sb.plansDir, "open"));
  assert.equal(rec?.checked_at, 1010);
  assert.equal(rec?.plane, "personal", "el resto del registro se conserva");
  assert.deepEqual((await readdir(path.join(sb.plansDir, "open"))).sort(), ["brief.md", "kickoff.json"], "sin candado ni temporales");

  const send = (await sb.calls()).filter((c) => c.argv[1] === "send").pop()!;
  assert.deepEqual(send.argv.slice(0, 6), ["messages", "send", "--channel", CHANNEL, "--reply-to", ROOT]);
  assert.equal(send.argv[7], "✅ recibido. Artefactos: brief ✔ · ledger ✘ · verdict ✘ · kickoff ✔. Falta ledger.md, verdict.md; aterrizo con t360 collect cuando estén los cuatro.");

  // Second pass: no relay read, no second notice.
  const reads = (await sb.calls()).length;
  assert.deepEqual(await outcomeOf("open"), { slug: "open", result: "skipped", why: "checked" });
  assert.equal((await sb.calls()).length, reads);
});

test("scan: legacy (sin plane), aterrizado y candado ocupado se omiten sin leer el relay", async () => {
  await sb.writeGrill("legacy", { "brief.md": "b", "kickoff.json": kickoffJson({ slug: "legacy" }) });
  await sb.writeGrill("landed", { "brief.md": "b", "kickoff.json": v2("landed", { landed_at: 5, commit: "abc", landed_repo: "/r" }) });
  await sb.writeGrill("busy", { "brief.md": "b", "kickoff.json": v2("busy") });
  await writeFile(path.join(sb.plansDir, "busy", ".lock"), "pid 1\n");
  await sb.writeGrill("notes-only", { "handoff.md": "h" });
  const reads = (await sb.calls()).length;
  const outcomes = await scan(await deps());
  const by = Object.fromEntries(outcomes.map((o) => [o.slug, o]));
  assert.deepEqual(by.legacy, { slug: "legacy", result: "skipped", why: "legacy" });
  assert.deepEqual(by.landed, { slug: "landed", result: "skipped", why: "landed" });
  assert.deepEqual(by.busy, { slug: "busy", result: "skipped", why: "locked" });
  assert.equal(by["notes-only"], undefined);
  assert.equal((await readKickoffFile(path.join(sb.plansDir, "busy")))?.checked_at, undefined);
  assert.equal((await sb.calls()).length - reads, 1, "solo busy leyó el relay (para encontrar el ✅ antes del candado)");
});

test("scan: con los cuatro artefactos el aviso dice listo; si el aviso falla, checked_at queda y se informa", async () => {
  await sb.writeGrill("full", { "brief.md": "b", "ledger.md": "l", "verdict.md": "v", "kickoff.json": v2("full") });
  assert.equal(noticeText({ brief: true, ledger: true, verdict: true, kickoff: true }), "✅ recibido. Artefactos: brief ✔ · ledger ✔ · verdict ✔ · kickoff ✔. Listo para aterrizar con t360 collect.");
  await sb.setFailure({ error: "relay", message: "down", only: "messages send" });
  try {
    const o = await outcomeOf("full");
    assert.ok(o?.result === "checked" && !o.notice.ok && /relay: down/.test(o.notice.detail) && o.missing.length === 0);
  } finally {
    await sb.setFailure(null);
  }
  assert.equal((await readKickoffFile(path.join(sb.plansDir, "full")))?.checked_at, 1010);
});

test("scan: relay sin identidad → un error y se corta la pasada", async () => {
  const d = await deps();
  const config = { ...d.config, keychain: null };
  const outcomes = await scan({ config, relay: createRelay({ config, allow: SCAN_COMMANDS }) });
  const errors = outcomes.filter((o) => o.result === "error");
  assert.equal(errors.length, 1);
  assert.match((errors[0] as { detail: string }).detail, /^no-identity/);
});

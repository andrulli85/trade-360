import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { loadConfig } from "../src/core/config.ts";
import { readKickoffFile } from "../src/core/kickoff-file.ts";
import { briefFromFile, kickoff, KickoffError, type KickoffInput } from "../src/core/kickoff.ts";
import { createRelay, KICKOFF_COMMANDS } from "../src/core/relay.ts";
import { AGENT, makeSandbox, NEW_CHANNEL, OWNER, sentEventId, useEnv, type Sandbox } from "./helpers.ts";

let sb: Sandbox;
let restore: () => void;
before(async () => {
  sb = await makeSandbox();
  restore = useEnv(sb.env);
});
after(async () => {
  restore();
  await sb.cleanup();
});

const input = (over: Partial<KickoffInput> = {}): KickoffInput => ({
  slug: "demo",
  mode: "dec",
  plane: "personal",
  description: "¿Dónde vive la lógica?",
  brief: { text: "# Brief\n\nHistoria.", source: "inline" },
  ...over,
});

const deps = async () => {
  const config = await loadConfig();
  return { config, relay: createRelay({ config, allow: KICKOFF_COMMANDS }), settleMs: 0, now: () => 1_700_000_000 };
};

test("kickoff: canal privado, miembros, kickoff con mención y kickoff.json con plane", async () => {
  const extra = "9".repeat(64);
  const rec = await kickoff(input({ with: [extra, OWNER] }), await deps());
  assert.deepEqual(rec, {
    channel_id: NEW_CHANNEL,
    root_event_id: sentEventId(0),
    slug: "demo",
    mode: "dec",
    brief: "PLANS/demo/brief.md",
    brief_source: "inline",
    plane: "personal",
    started_at: 1_700_000_000,
  });
  const dir = path.join(sb.plansDir, "demo");
  assert.deepEqual(await readKickoffFile(dir), rec);
  assert.equal(await readFile(path.join(dir, "brief.md"), "utf8"), "# Brief\n\nHistoria.\n");
  assert.deepEqual((await readdir(dir)).sort(), ["brief.md", "kickoff.json"], "sin candado ni temporales");

  const calls = (await sb.calls()).map((c) => c.argv);
  assert.deepEqual(calls, [
    ["channels", "create", "--name", "demo", "--type", "stream", "--visibility", "private", "--description", "¿Dónde vive la lógica?"],
    ["channels", "add-member", "--channel", NEW_CHANNEL, "--pubkey", AGENT],
    ["channels", "add-member", "--channel", NEW_CHANNEL, "--pubkey", OWNER],
    ["channels", "add-member", "--channel", NEW_CHANNEL, "--pubkey", extra],
    ["channels", "topic", "--channel", NEW_CHANNEL, "--topic", "grill dec: ¿Dónde vive la lógica?"],
    ["messages", "send", "--channel", NEW_CHANNEL, "--mention", AGENT, "--content", "@Claude /grill-me dec PLANS/demo/brief.md"],
  ]);
});

test("kickoff: un slug ya abierto no se reabre ni toca el relay", async () => {
  const before = (await sb.calls()).length;
  await assert.rejects(kickoff(input(), await deps()), (e: unknown) => e instanceof KickoffError && e.code === "exists");
  assert.equal((await sb.calls()).length, before);
});

test("kickoff: validación de slug, modo, plano, pubkeys y brief vacío", async () => {
  const d = await deps();
  const code = (i: KickoffInput) => kickoff(i, d).then(() => "ok", (e: KickoffError) => e.code);
  assert.equal(await code(input({ slug: "Mayus" })), "usage");
  assert.equal(await code(input({ slug: "a".repeat(24) })), "usage");
  assert.equal(await code(input({ slug: "x", mode: "xx" as never })), "usage");
  assert.equal(await code(input({ slug: "x", plane: "corp" as never })), "usage");
  assert.equal(await code(input({ slug: "x", with: ["nope"] })), "usage");
  assert.equal(await code(input({ slug: "x", brief: { text: "  \n", source: "inline" } })), "usage");
  assert.equal(await code(input({ slug: "x", description: " " })), "usage");
});

test("kickoff: un brief bajo una raíz prohibida no puede abrirse como personal, sí como work", async () => {
  const workBrief = path.join(sb.home, "work", "story.md");
  await mkdir(path.dirname(workBrief), { recursive: true });
  await writeFile(workBrief, "# Corp story\n");
  const brief = await briefFromFile(workBrief);
  assert.equal(brief.source, await (await import("../src/core/plane.ts")).realpathLenient(workBrief));

  await assert.rejects(
    kickoff(input({ slug: "corp", brief }), await deps()),
    (e: unknown) => e instanceof KickoffError && e.code === "plane" && /raíz prohibida/.test(e.message),
  );
  const rec = await kickoff(input({ slug: "corp", brief, plane: "work" }), await deps());
  assert.equal(rec.plane, "work");
  assert.equal(rec.brief_source, brief.source);
  assert.equal(await readFile(path.join(sb.plansDir, "corp", "brief.md"), "utf8"), "# Corp story\n");
});

test("kickoff: sin pubkeys en la config no se crea nada", async () => {
  const d = await deps();
  await assert.rejects(
    kickoff(input({ slug: "x" }), { ...d, config: { ...d.config, ownerPubkey: null } }),
    (e: unknown) => e instanceof KickoffError && e.code === "config",
  );
});

test("kickoff: si el relay falla tras crear el canal, no hay kickoff.json y el error nombra el canal", async () => {
  await sb.setFailure({ error: "relay", message: "send failed", only: "messages send" });
  try {
    await assert.rejects(
      kickoff(input({ slug: "half" }), await deps()),
      (e: unknown) => e instanceof KickoffError && e.code === "relay" && e.channelId === NEW_CHANNEL && /send failed/.test(e.message),
    );
  } finally {
    await sb.setFailure(null);
  }
  assert.equal(await readKickoffFile(path.join(sb.plansDir, "half")), null);
  assert.deepEqual(await readdir(path.join(sb.plansDir, "half")), ["brief.md"]);
});

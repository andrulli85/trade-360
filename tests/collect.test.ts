import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { loadConfig } from "../src/core/config.ts";
import { collect, CollectError } from "../src/core/collect.ts";
import { readKickoffFile } from "../src/core/kickoff-file.ts";
import { COLLECT_COMMANDS, createRelay } from "../src/core/relay.ts";
import { CHANNEL, kickoffJson, makeSandbox, ROOT, sentEventId, useEnv, type Sandbox } from "./helpers.ts";

const execFileAsync = promisify(execFile);

let sb: Sandbox;
let restore: () => void;
const FOUR = { "brief.md": "# b\n", "ledger.md": "# l\n", "verdict.md": "# v\n" };

before(async () => {
  sb = await makeSandbox();
  restore = useEnv(sb.env);
});
after(async () => {
  restore();
  await sb.cleanup();
});

const deps = async () => {
  const config = await loadConfig();
  return { config, relay: createRelay({ config, allow: COLLECT_COMMANDS }), now: () => 1_700_000_500 };
};
const codeOf = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof CollectError ? e.code : `other:${(e as Error).message}`));
const git = (repo: string, ...args: string[]) =>
  execFileAsync("git", ["-C", repo, ...args], { env: { ...process.env, ...sb.env } }).then((r) => r.stdout.trim());

test("collect: copia los cuatro, commitea, anota landed_* y publica el cierre", async () => {
  const repo = await sb.makeRepo("personal/repo");
  await sb.writeGrill("done", { ...FOUR, "kickoff.json": kickoffJson({ slug: "done", plane: "personal" }) });
  const sendsBefore = (await sb.calls()).filter((c) => c.argv[1] === "send").length;

  const r = await collect({ slug: "done", repo }, await deps());
  const dest = path.join(repo, "docs", "grill", "done");
  assert.equal(r.dest, dest);
  assert.deepEqual(r.files, ["brief.md", "ledger.md", "verdict.md", "kickoff.json"].map((f) => path.join(dest, f)));
  for (const [f, text] of Object.entries(FOUR)) assert.equal(await readFile(path.join(dest, f), "utf8"), text);
  assert.equal(await readFile(path.join(dest, "kickoff.json"), "utf8"), kickoffJson({ slug: "done", plane: "personal" }));

  assert.equal(await git(repo, "log", "-1", "--format=%s"), "docs(grill): done verdict");
  assert.equal(await git(repo, "rev-parse", "HEAD"), r.commit);
  assert.equal(await git(repo, "status", "--porcelain"), "", "árbol limpio: nada fuera del commit");
  assert.equal(await git(repo, "log", "--oneline", "origin/main..HEAD").catch(() => "no-remote"), "no-remote", "sin push");

  const rec = await readKickoffFile(path.join(sb.plansDir, "done"));
  assert.equal(rec?.landed_repo, repo);
  assert.equal(rec?.commit, r.commit);
  assert.equal(rec?.landed_at, 1_700_000_500);
  assert.deepEqual(r.kickoff, rec);

  assert.deepEqual(r.closing, { ok: true, eventId: sentEventId(sendsBefore) });
  const send = (await sb.calls()).filter((c) => c.argv[1] === "send").pop()!;
  assert.deepEqual(send.argv.slice(0, 6), ["messages", "send", "--channel", CHANNEL, "--reply-to", ROOT]);
  assert.match(send.argv[7], new RegExp(`^Aterrizado en ${repo}/docs/grill/done/ · commit ${r.commit.slice(0, 7)}$`));

  assert.equal(await codeOf(collect({ slug: "done", repo }, await deps())), "landed", "no aterriza dos veces");
});

test("collect: todo-o-nada — con un artefacto ausente no copia ni commitea", async () => {
  const repo = await sb.makeRepo("personal/repo2");
  await sb.writeGrill("partial", { "brief.md": "# b", "ledger.md": "# l", "kickoff.json": kickoffJson({ slug: "partial", plane: "personal" }) });
  await assert.rejects(collect({ slug: "partial", repo }, await deps()), (e: unknown) => e instanceof CollectError && e.code === "missing" && /faltan verdict\.md/.test(e.message));
  assert.equal(await git(repo, "log", "--oneline").then((s) => s.split("\n").length), 1);
  assert.equal(await codeOf(collect({ slug: "nope", repo }, await deps())), "not-found");
  assert.equal(await codeOf(collect({ slug: "../x", repo }, await deps())), "usage");
  await sb.writeGrill("full", { ...FOUR, "kickoff.json": kickoffJson({ slug: "full", plane: "personal" }) });
  assert.equal(await codeOf(collect({ slug: "full", repo: path.join(sb.home, "personal") }, await deps())), "usage", "no es un repo git");
});

test("collect: frontera de planos — plane=work, brief bajo ~/work (pre-v2), repo o destino bajo raíz prohibida, symlink", async () => {
  const repo = await sb.makeRepo("personal/repo3");
  const d = await deps();

  await sb.writeGrill("corp", { ...FOUR, "kickoff.json": kickoffJson({ slug: "corp", plane: "work" }) });
  await assert.rejects(collect({ slug: "corp", repo }, d), (e: unknown) => e instanceof CollectError && e.code === "plane" && /plano de trabajo/.test(e.message) && /nunca desde aquí/.test(e.message));

  // Opened by the old scripts: no `plane`, but a brief_source under a forbidden root.
  const legacyWork = path.join(sb.home, "work", "story.md");
  await sb.writeGrill("legacy-work", { ...FOUR, "kickoff.json": kickoffJson({ slug: "legacy-work", brief_source: legacyWork }) });
  assert.equal(await codeOf(collect({ slug: "legacy-work", repo }, d)), "plane");
  const legacyOk = await sb.writeGrill("legacy-ok", { ...FOUR, "kickoff.json": kickoffJson({ slug: "legacy-ok", brief_source: path.join(sb.home, "personal", "story.md") }) });
  assert.ok(legacyOk);

  await sb.writeGrill("ok", { ...FOUR, "kickoff.json": kickoffJson({ slug: "ok", plane: "personal" }) });
  const workRepo = await sb.makeRepo("work/repo");
  assert.equal(await codeOf(collect({ slug: "ok", repo: workRepo }, d)), "plane");
  // A personal-looking repo path that resolves into the work tree.
  await symlink(workRepo, path.join(sb.home, "personal", "alias"));
  assert.equal(await codeOf(collect({ slug: "ok", repo: path.join(sb.home, "personal", "alias") }, d)), "plane");
  // Destination that is a symlink out of the repo.
  await mkdir(path.join(repo, "docs", "grill"), { recursive: true });
  await symlink(path.join(sb.home, "elsewhere"), path.join(repo, "docs", "grill", "ok"));
  assert.equal(await codeOf(collect({ slug: "ok", repo }, d)), "plane");
  await rm(path.join(repo, "docs", "grill", "ok"));
  // Destination that already exists.
  await mkdir(path.join(repo, "docs", "grill", "ok"));
  assert.equal(await codeOf(collect({ slug: "ok", repo }, d)), "exists");
  await rm(path.join(repo, "docs", "grill", "ok"), { recursive: true });

  assert.equal(await git(repo, "log", "--oneline").then((s) => s.split("\n").length), 1, "ningún rechazo commitea");
  assert.equal((await readKickoffFile(path.join(sb.plansDir, "ok")))?.landed_at, undefined);

  // The legitimate one still lands.
  assert.equal(await codeOf(collect({ slug: "legacy-ok", repo }, d)), "ok");
  assert.equal(await codeOf(collect({ slug: "ok", repo }, d)), "ok");
});

test("collect: si el cierre no se puede publicar, el aterrizaje y el commit se conservan y se informa", async () => {
  const repo = await sb.makeRepo("personal/repo4");
  await sb.writeGrill("quiet", { ...FOUR, "kickoff.json": kickoffJson({ slug: "quiet", plane: "personal" }) });
  await sb.setFailure({ error: "relay", message: "down", only: "messages send" });
  try {
    const r = await collect({ slug: "quiet", repo }, await deps());
    assert.equal(r.closing.ok, false);
    assert.ok(!r.closing.ok && /relay: down/.test(r.closing.detail) && r.closing.content.startsWith("Aterrizado en "));
    assert.equal(await git(repo, "log", "-1", "--format=%s"), "docs(grill): quiet verdict");
    assert.equal((await readKickoffFile(path.join(sb.plansDir, "quiet")))?.commit, r.commit);
  } finally {
    await sb.setFailure(null);
  }
  await writeFile(path.join(repo, "unrelated.txt"), "x");
});

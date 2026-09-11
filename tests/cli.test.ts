import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { loadConfig } from "../src/core/config.ts";
import { listGrills } from "../src/core/grills.ts";
import { createRelay } from "../src/core/relay.ts";
import { describeTurn, getThread } from "../src/core/thread.ts";
import { getGrill } from "../src/core/grills.ts";
import { AGENT, kickoffJson, makeSandbox, msg, OWNER, rootMsg, useEnv, type Sandbox } from "./helpers.ts";

const execFileAsync = promisify(execFile);
const MAIN = path.resolve(import.meta.dirname, "..", "src", "cli", "main.ts");

let sb: Sandbox;
let restore: () => void;
before(async () => {
  sb = await makeSandbox({ config: "env" });
  restore = useEnv(sb.env);
  await sb.writeGrill("demo", { "brief.md": "# b", "kickoff.json": kickoffJson() });
  await sb.writeGrill("hecho", { "brief.md": "# b", "verdict.md": "# v", "kickoff.json": kickoffJson({ slug: "hecho" }) });
  await sb.writeGrill("notas", { "handoff.md": "# h" });
  await sb.setUsers([{ pubkey: OWNER, display_name: "Andy" }, { pubkey: AGENT, name: "Claude" }]);
  await sb.setMessages([rootMsg(), msg({ pubkey: AGENT, content: "❓ **Q1** ¿plano?", created_at: 1002 })]);
});
after(async () => {
  restore();
  await sb.cleanup();
});

async function t360(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [MAIN, ...args], {
      env: { ...process.env, ...sb.env },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

test("t360 status --json devuelve lo mismo que listGrills() del panel", async () => {
  const { code, stdout } = await t360("status", "--json");
  assert.equal(code, 0);
  const out = JSON.parse(stdout);
  const panel = await listGrills();
  assert.deepEqual(out.grills, JSON.parse(JSON.stringify(panel.grills)));
  assert.equal(out.plansDir, panel.plansDir);
  assert.equal(out.config.source, "env-file");
  assert.equal(out.config.path, sb.configPath);
  assert.equal(JSON.stringify(out).includes("nsec"), false, "las cuentas del llavero no salen por status");
  const calls = await sb.calls();
  assert.equal(calls.length, 0, "la lista es de disco: no toca el relay");
});

test("t360 status: tabla legible con los mismos estados que el panel", async () => {
  const { code, stdout } = await t360("status");
  assert.equal(code, 0);
  assert.match(stdout, /1 abiertos · 1 cerrados · 1 carpetas de notas/);
  assert.match(stdout, /^demo\s+Abierto\s+dec\s+b··k/m);
  assert.match(stdout, /^hecho\s+Cerrado ✅\s+dec\s+b·vk/m);
  assert.match(stdout, /^notas\s+Notas\s+—/m);
});

test("t360 status <slug> --json coincide con getThread() del panel", async () => {
  const { code, stdout } = await t360("status", "demo", "--json");
  assert.equal(code, 0);
  const out = JSON.parse(stdout);
  const grill = (await getGrill("demo"))!;
  const thread = await getThread(grill, { relay: createRelay() });
  assert.ok(thread.ok && out.thread.ok);
  assert.deepEqual(out.grill, JSON.parse(JSON.stringify(grill)));
  assert.deepEqual(out.thread.messages, thread.messages);
  assert.deepEqual(out.thread.turn, thread.turn);
});

test("t360 status <slug>: la tarjeta de turno usa el mismo texto que el panel", async () => {
  const { code, stdout } = await t360("status", "demo");
  assert.equal(code, 0);
  const config = await loadConfig();
  const thread = await getThread((await getGrill("demo"))!, { relay: createRelay() });
  assert.ok(thread.ok);
  const text = describeTurn(thread.turn, config.agentName);
  assert.equal(text.title, "Te toca responder");
  assert.ok(stdout.includes(`${text.title} — ${text.meta}`), stdout);
  assert.ok(stdout.includes("  ❓ Q1 ¿plano?"), stdout);
  assert.match(stdout, /Artefactos\s+brief ✔\s+ledger ✘\s+verdict ✘\s+kickoff ✔/);
});

test("t360 status <slug>: relay caído se informa sin romper; carpeta de notas no consulta el relay", async () => {
  await sb.setFailure({ error: "relay", message: "down" });
  try {
    const r = await t360("status", "demo");
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Hilo de Buzz no disponible: relay: down/);
  } finally {
    await sb.setFailure(null);
  }
  const before = (await sb.calls()).length;
  const n = await t360("status", "notas", "--json");
  assert.equal(n.code, 0);
  assert.deepEqual(JSON.parse(n.stdout).thread, { ok: false, reason: "no-kickoff", detail: "Esta carpeta no tiene kickoff.json." });
  assert.equal((await sb.calls()).length, before);
});

test("códigos de salida: uso, desconocido, no encontrado, ayuda", async () => {
  assert.equal((await t360()).code, 2);
  assert.equal((await t360("frobnicate")).code, 2);
  assert.equal((await t360("status", "a", "b")).code, 2);
  assert.equal((await t360("status", "--bogus")).code, 2);
  const nf = await t360("status", "no-existe");
  assert.equal(nf.code, 3);
  assert.match(nf.stderr, /no existe no-existe/);
  assert.equal((await t360("status", "../x")).code, 3);
  const help = await t360("--help");
  assert.equal(help.code, 0);
  assert.match(help.stdout, /t360 status \[slug\] \[--json\]/);
  assert.match((await t360("--version")).stdout, /^t360 \d/);
});

/* ---------- F2: kickoff + collect end to end (proj-7-export-cal replayed) ---------- */

const BRIEF = `# proj-7-export-cal\n\nExportar el calendario del proyecto 7 a iCal.\n\n## Abierto\n\n- ¿Zona horaria?\n`;

async function t360Stdin(input: string, ...args: string[]) {
  const { spawn } = await import("node:child_process");
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [MAIN, ...args], { env: { ...process.env, ...sb.env, T360_SETTLE_MS: "0" } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(input);
  });
}

test("reproducir proj-7-export-cal: kickoff por stdin, agente escribe, collect aterriza los mismos cuatro archivos", async () => {
  const { readFile, writeFile } = await import("node:fs/promises");
  const k = await t360Stdin(BRIEF, "kickoff", "proj-7-export-cal", "--mode", "rf", "--plane", "personal", "--stdin", "--description", "Export calendar", "--json");
  assert.equal(k.code, 0, k.stderr);
  const rec = JSON.parse(k.stdout);
  // Same keys as the kickoff.json the skill wrote for the real grill, plus brief_source and plane.
  assert.deepEqual(Object.keys(rec).sort(), ["brief", "brief_source", "channel_id", "mode", "plane", "root_event_id", "slug", "started_at"]);
  assert.equal(rec.brief, "PLANS/proj-7-export-cal/brief.md");
  assert.equal(rec.mode, "rf");
  assert.equal(rec.plane, "personal");
  assert.equal(rec.brief_source, "inline");
  assert.ok(Number.isInteger(rec.started_at));
  const dir = path.join(sb.plansDir, "proj-7-export-cal");
  assert.equal(await readFile(path.join(dir, "brief.md"), "utf8"), BRIEF);

  // It shows up in status as open, and the thread's turn comes from the fake relay.
  const st = await t360("status", "--json");
  const g = JSON.parse(st.stdout).grills.find((x: { slug: string }) => x.slug === "proj-7-export-cal");
  assert.equal(g.status, "open");
  assert.equal(g.kickoff.plane, "personal");

  // Not landable yet: the agent has not written ledger/verdict.
  const repo = await sb.makeRepo("personal/claude-voice");
  const early = await t360("collect", "proj-7-export-cal", "--repo", repo);
  assert.equal(early.code, 4);
  assert.match(early.stderr, /faltan ledger\.md, verdict\.md/);

  // The agent (grill-me) writes its two artifacts; the owner posts ✅.
  await writeFile(path.join(dir, "ledger.md"), "# Ledger\n\n- Q1 → UTC\n");
  await writeFile(path.join(dir, "verdict.md"), "# Verdict\n\nStatus: **FINAL**\n");

  const c = await t360("collect", "proj-7-export-cal", "--repo", repo, "--json");
  assert.equal(c.code, 0, c.stderr);
  const result = JSON.parse(c.stdout);
  const dest = path.join(repo, "docs", "grill", "proj-7-export-cal");
  for (const f of ["brief.md", "ledger.md", "verdict.md", "kickoff.json"]) {
    assert.equal(await readFile(path.join(dest, f), "utf8"), await readFile(path.join(dir, f), "utf8").then((t) => (f === "kickoff.json" ? JSON.stringify(rec, null, 2) + "\n" : t)), f);
  }
  assert.equal(result.closing.ok, true);
  const landed = JSON.parse(await readFile(path.join(dir, "kickoff.json"), "utf8"));
  assert.equal(landed.landed_repo, repo);
  assert.equal(landed.commit, result.commit);
  assert.ok(landed.landed_at >= rec.started_at);

  const again = await t360("collect", "proj-7-export-cal", "--repo", repo);
  assert.equal(again.code, 5);
  assert.match(again.stderr, /ya aterrizó/);
});

test("t360 kickoff: --brief bajo ~/work con --plane personal sale con 3; sin --plane sugiere el plano por ruta", async () => {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const brief = path.join(sb.home, "work", "corp", "story.md");
  await mkdir(path.dirname(brief), { recursive: true });
  await writeFile(brief, "# corp\n");
  const r = await t360("kickoff", "corp-story", "--mode", "dec", "--plane", "personal", "--brief", brief, "--description", "x");
  assert.equal(r.code, 3);
  assert.match(r.stderr, /raíz prohibida/);
  const noPlane = await t360("kickoff", "corp-story", "--mode", "dec", "--brief", brief, "--description", "x");
  assert.equal(noPlane.code, 2);
  assert.match(noPlane.stderr, /falta --plane.*sugiere work/);
  const bad = await t360("kickoff", "corp-story", "--mode", "dec", "--plane", "work", "--brief", brief, "--stdin", "--description", "x");
  assert.equal(bad.code, 2, "--brief y --stdin son excluyentes");
});

test("t360 collect: plane=work sale con 3 y candado ocupado con 6", async () => {
  const { writeFile } = await import("node:fs/promises");
  await sb.writeGrill("corp-done", { "brief.md": "b", "ledger.md": "l", "verdict.md": "v", "kickoff.json": kickoffJson({ slug: "corp-done", plane: "work" }) });
  const repo = await sb.makeRepo("personal/other");
  const r = await t360("collect", "corp-done", "--repo", repo);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /plano de trabajo/);

  await sb.writeGrill("locked", { "brief.md": "b", "ledger.md": "l", "verdict.md": "v", "kickoff.json": kickoffJson({ slug: "locked", plane: "personal" }) });
  await writeFile(path.join(sb.plansDir, "locked", ".lock"), "pid 1 stale\n");
  const l = await t360("collect", "locked", "--repo", repo);
  assert.equal(l.code, 6);
  assert.match(l.stderr, /candado/);
});

/* ---------- F3: scan ---------- */

test("t360 scan: silencioso mientras espera, una línea al ver el ✅, --verbose y --json", async () => {
  const { readFile } = await import("node:fs/promises");
  await sb.writeGrill("watched", { "brief.md": "b", "kickoff.json": kickoffJson({ slug: "watched", plane: "personal" }) });
  await sb.setMessages([rootMsg(), msg({ pubkey: AGENT, content: "❓ Q1", created_at: 1002 })]);
  const quiet = await t360("scan");
  assert.equal(quiet.code, 0);
  assert.equal(quiet.stdout, "", "nada que contar: nada en el log del LaunchAgent");
  const verbose = await t360("scan", "--verbose");
  assert.match(verbose.stdout, /watched: esperando ✅/);
  assert.match(verbose.stdout, /notas: |demo: /);

  await sb.setMessages([rootMsg(), msg({ pubkey: AGENT, content: "❓ Q1", created_at: 1002 }), msg({ pubkey: OWNER, content: "✅", created_at: 1020 })]);
  const hit = await t360("scan");
  assert.equal(hit.code, 0);
  assert.match(hit.stdout, /^\S+ watched: ✅ recibido \(.*\); faltan ledger\.md, verdict\.md$/m);
  assert.doesNotMatch(hit.stdout, /esperando|omitido/, "sin --verbose solo se cuentan eventos");
  const rec = JSON.parse(await readFile(path.join(sb.plansDir, "watched", "kickoff.json"), "utf8"));
  assert.equal(rec.checked_at, 1020);

  const json = await t360("scan", "--json");
  const w = JSON.parse(json.stdout).find((o: { slug: string }) => o.slug === "watched");
  assert.deepEqual(w, { slug: "watched", result: "skipped", why: "checked" });

  const st = await t360("status", "watched");
  assert.match(st.stdout, /✅ recibido .* · pendiente de aterrizar \(t360 collect watched --repo …\)/);
});

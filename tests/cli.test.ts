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

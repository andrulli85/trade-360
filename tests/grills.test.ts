import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { loadConfig } from "../src/core/config.ts";
import { getGrill, listGrills, readGrillFile } from "../src/core/grills.ts";
import { kickoffJson, makeSandbox, useEnv, type Sandbox } from "./helpers.ts";

let sb: Sandbox;
let restore: () => void;
before(async () => {
  sb = await makeSandbox();
  restore = useEnv(sb.env);
  await sb.writeGrill("abierto", { "brief.md": "# b", "kickoff.json": kickoffJson({ slug: "abierto" }) });
  await sb.writeGrill("cerrado", {
    "brief.md": "# b",
    "ledger.md": "# l",
    "verdict.md": "# v",
    "kickoff.json": kickoffJson({ slug: "cerrado", mode: "plan" }),
    "extra-notes.md": "notas",
    "data.json": "{}",
  });
  await sb.writeGrill("notas", { "handoff.md": "# h" });
  await sb.writeGrill("roto", { "kickoff.json": "{not json" });
});
after(async () => {
  restore();
  await sb.cleanup();
});

test("listGrills: estado, modo, artefactos y extras desde disco", async () => {
  const { plansDir, grills } = await listGrills();
  assert.equal(plansDir, sb.plansDir);
  const by = Object.fromEntries(grills.map((g) => [g.slug, g]));
  assert.deepEqual(Object.keys(by).sort(), ["abierto", "cerrado", "notas", "roto"]);

  assert.equal(by.abierto.status, "open");
  assert.equal(by.abierto.mode, "dec");
  assert.deepEqual(by.abierto.artifacts, { brief: true, ledger: false, verdict: false, kickoff: true });

  assert.equal(by.cerrado.status, "closed");
  assert.equal(by.cerrado.mode, "plan");
  assert.deepEqual(by.cerrado.extraFiles, ["extra-notes.md"], "solo .md fuera de los cuatro artefactos");

  assert.equal(by.notas.status, "notes");
  assert.equal(by.notas.kickoff, null);

  assert.equal(by.roto.status, "notes", "kickoff.json ilegible cuenta como carpeta de notas");
  assert.equal(by.roto.artifacts.kickoff, true);
  assert.equal(by.roto.kickoff, null);
});

test("listGrills acepta la config explícita y ordena por actualización", async () => {
  const config = await loadConfig();
  const { grills } = await listGrills(config);
  for (let i = 1; i < grills.length; i++) assert.ok(grills[i - 1].updatedAt >= grills[i].updatedAt);
});

test("getGrill: slug inválido nunca se convierte en ruta", async () => {
  assert.equal(await getGrill("../etc"), null);
  assert.equal(await getGrill("Mayus"), null);
  assert.equal(await getGrill("-guion"), null);
  assert.equal(await getGrill("no-existe"), null);
  const g = await getGrill("cerrado");
  assert.equal(g?.dir, `${sb.plansDir}/cerrado`);
});

test("readGrillFile solo lee artefactos y extras conocidos", async () => {
  const g = (await getGrill("cerrado"))!;
  assert.equal(await readGrillFile(g, "verdict.md"), "# v");
  assert.equal(await readGrillFile(g, "extra-notes.md"), "notas");
  assert.equal(await readGrillFile(g, "data.json"), null, "no es markdown ni artefacto");
  assert.equal(await readGrillFile(g, "../abierto/brief.md"), null);
  const open = (await getGrill("abierto"))!;
  assert.equal(await readGrillFile(open, "verdict.md"), null, "artefacto permitido pero ausente");
});

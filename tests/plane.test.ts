import assert from "node:assert/strict";
import { mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { loadConfig } from "../src/core/config.ts";
import { forbiddenRootOf, isUnder, planeOfPath, realpathLenient } from "../src/core/plane.ts";
import { readKickoffFile, SlugLocked, withSlugLock, writeAtomic } from "../src/core/kickoff-file.ts";
import { makeSandbox, useEnv, type Sandbox } from "./helpers.ts";

let sb: Sandbox;
let restore: () => void;
before(async () => {
  sb = await makeSandbox();
  restore = useEnv(sb.env);
  await mkdir(path.join(sb.home, "work", "proj"), { recursive: true });
  await mkdir(path.join(sb.home, "personal"), { recursive: true });
  // A personal-looking path that resolves into the work tree.
  await symlink(path.join(sb.home, "work", "proj"), path.join(sb.home, "personal", "link-to-work"));
});
after(async () => {
  restore();
  await sb.cleanup();
});

test("realpathLenient resuelve el prefijo existente y conserva la cola inexistente", async () => {
  const p = await realpathLenient(path.join(sb.home, "personal", "link-to-work", "nope", "x.md"));
  assert.equal(p, path.join(await realpathLenient(path.join(sb.home, "work", "proj")), "nope", "x.md"));
});

test("isUnder sigue symlinks y no confunde prefijos de nombre", async () => {
  const work = path.join(sb.home, "work");
  assert.equal(await isUnder(path.join(sb.home, "work", "proj", "a"), work), true);
  assert.equal(await isUnder(path.join(sb.home, "personal", "link-to-work", "a"), work), true);
  assert.equal(await isUnder(path.join(sb.home, "workshop", "a"), work), false);
  assert.equal(await isUnder(work, work), true);
});

test("forbiddenRootOf / planeOfPath usan landing.forbidden_roots de la config (con ~ expandido)", async () => {
  const config = await loadConfig();
  assert.equal(await forbiddenRootOf(path.join(sb.home, "work", "x"), config), path.join(sb.home, "work"));
  assert.equal(await forbiddenRootOf("/srv/corp/repo", config), "/srv/corp");
  assert.equal(await forbiddenRootOf(path.join(sb.home, "personal", "repo"), config), null);
  assert.equal(await planeOfPath(path.join(sb.home, "personal", "link-to-work"), config), "work");
});

test("writeAtomic no deja temporales y withSlugLock rechaza al segundo", async () => {
  const dir = path.join(sb.plansDir, "lock-demo");
  await writeAtomic(path.join(dir, "kickoff.json"), JSON.stringify({ slug: "lock-demo" }));
  assert.deepEqual(await readKickoffFile(dir), { slug: "lock-demo" });
  const { readdir } = await import("node:fs/promises");
  assert.deepEqual(await readdir(dir), ["kickoff.json"]);

  await withSlugLock(dir, async () => {
    assert.ok((await readdir(dir)).includes(".lock"));
    await assert.rejects(withSlugLock(dir, async () => "inner"), (e: unknown) => e instanceof SlugLocked && /pid \d+/.test(e.message));
  });
  assert.deepEqual(await readdir(dir), ["kickoff.json"], "el candado se libera al salir");
  await assert.rejects(withSlugLock(dir, async () => { throw new Error("boom"); }), /boom/);
  assert.deepEqual(await readdir(dir), ["kickoff.json"], "también cuando fn falla");
});

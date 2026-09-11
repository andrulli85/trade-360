import assert from "node:assert/strict";
import { chmod, lstat, mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { loadConfig } from "../src/core/config.ts";
import { AGENT_LABEL, agentPaths, installAgent, LaunchdError, renderPlist, uninstallAgent } from "../src/core/launchd.ts";
import { makeSandbox, useEnv, type Sandbox } from "./helpers.ts";

let sb: Sandbox;
let restore: () => void;
before(async () => {
  sb = await makeSandbox();
  restore = useEnv(sb.env);
  const fake = path.join(sb.binDir, "launchctl");
  await writeFile(
    fake,
    `#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.T360_FAKE_DIR + "/launchctl.jsonl", JSON.stringify(process.argv.slice(2)) + "\\n");\nif (process.argv[2] === "bootout" && process.env.T360_FAKE_BOOTOUT_FAILS) { process.stderr.write("Boot-out failed: 3: No such process\\n"); process.exit(3); }\n`,
  );
  await chmod(fake, 0o755);
});
after(async () => {
  restore();
  await sb.cleanup();
});

const launchctlCalls = async () =>
  (await readFile(path.join(sb.fixtures, "launchctl.jsonl"), "utf8").catch(() => "")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as string[]);

test("renderPlist: node absoluto, entrada, scan, cada 15 s, entorno sin secretos", () => {
  const plist = renderPlist({ node: "/opt/node/bin/node", entry: "/repo/dist/cli/main.js", pathDirs: ["/x/bin"], env: { T360_CONFIG: "/c/t.toml" } });
  assert.match(plist, /<string>com\.andrulli\.t360<\/string>/);
  assert.match(plist, /<string>\/opt\/node\/bin\/node<\/string>\n\s+<string>\/repo\/dist\/cli\/main\.js<\/string>\n\s+<string>scan<\/string>/);
  assert.match(plist, /<key>StartInterval<\/key>\n\s+<integer>15<\/integer>/);
  assert.match(plist, /<key>PATH<\/key>\n\s+<string>\/x\/bin:\/opt\/node\/bin:\/usr\/local\/bin:\/usr\/bin:\/bin<\/string>/);
  assert.match(plist, new RegExp(`<key>HOME</key>\\n\\s+<string>${sb.home}</string>`));
  assert.match(plist, /<key>T360_CONFIG<\/key>\n\s+<string>\/c\/t\.toml<\/string>/);
  assert.match(plist, new RegExp(`<string>${sb.home}/Library/Logs/t360\\.log</string>`));
  assert.doesNotMatch(plist, /BUZZ_PRIVATE_KEY|BUZZ_AUTH_TAG|nsec|secret/);
});

test("installAgent: escribe el plist atómicamente, añade el dir de buzz al PATH, bootout/bootstrap/enable", async () => {
  process.env.T360_FAKE_BOOTOUT_FAILS = "1"; // first install: nothing to boot out, must not abort
  try {
    const { plist, content } = await installAgent(await loadConfig(), { node: "/opt/node/bin/node", entry: "/repo/src/cli/main.ts" });
    assert.equal(plist, agentPaths().plist);
    assert.equal(await readFile(plist, "utf8"), content);
    assert.deepEqual(await readdir(path.dirname(plist)), [`${AGENT_LABEL}.plist`], "sin temporales");
    assert.match(content, new RegExp(`<string>${sb.binDir}:${sb.home}/.local/bin:/opt/homebrew/bin:/opt/node/bin:`));
    assert.match(content, new RegExp(`<key>T360_CONFIG</key>\\n\\s+<string>${sb.env.T360_CONFIG}</string>`));
    const uid = process.getuid!();
    assert.deepEqual(await launchctlCalls(), [
      ["bootout", `gui/${uid}`, plist],
      ["bootstrap", `gui/${uid}`, plist],
      ["enable", `gui/${uid}/${AGENT_LABEL}`],
    ]);
  } finally {
    delete process.env.T360_FAKE_BOOTOUT_FAILS;
  }
});

test("uninstallAgent: bootout y borra; segunda vez informa que no estaba", async () => {
  const before = (await launchctlCalls()).length;
  const r = await uninstallAgent();
  assert.equal(r.existed, true);
  assert.equal(await lstat(r.plist).catch(() => null), null);
  assert.deepEqual((await launchctlCalls()).slice(before), [["bootout", `gui/${process.getuid!()}`, r.plist]]);
  const again = await uninstallAgent();
  assert.equal(again.existed, false);
  assert.equal((await launchctlCalls()).length, before + 1);
});

test("un plist que es symlink no se reemplaza ni se borra", async () => {
  const { plist } = agentPaths();
  await mkdir(path.dirname(plist), { recursive: true });
  await writeFile(path.join(sb.home, "elsewhere.plist"), "x");
  await symlink(path.join(sb.home, "elsewhere.plist"), plist);
  await assert.rejects(installAgent(await loadConfig(), { node: "/n", entry: "/e" }), (e: unknown) => e instanceof LaunchdError && /symlink/.test(e.message));
  await assert.rejects(uninstallAgent(), LaunchdError);
  assert.ok((await lstat(plist)).isSymbolicLink());
});

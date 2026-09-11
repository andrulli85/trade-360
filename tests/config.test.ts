import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { configPaths, fromToml, loadConfig, parseEnvFile } from "../src/core/config.ts";
import { AGENT, makeSandbox, OWNER, useEnv, type Sandbox } from "./helpers.ts";

let sb: Sandbox;
let restore: () => void;
before(async () => {
  sb = await makeSandbox({ config: "none" });
  restore = useEnv(sb.env);
});
after(async () => {
  restore();
  await sb.cleanup();
});

test("sin archivos: valores por defecto bajo $HOME", async () => {
  const c = await loadConfig();
  assert.equal(c.source, "defaults");
  assert.equal(c.path, null);
  assert.equal(c.agentHome, path.join(sb.home, ".buzz"));
  assert.equal(c.agentName, "Claude");
  assert.equal(c.keychain, null);
  assert.equal(c.buzzBin, "buzz");
  assert.deepEqual(c.landing, { forbiddenRoots: [path.join(sb.home, "work")], repos: [] });
});

test("buzz-kickoff.env como fallback: mismas claves que el skill, comillas y $HOME expandidos", async () => {
  await writeFile(
    configPaths().env,
    [
      "# comentario",
      "BUZZ_BIN=/opt/buzz",
      'BUZZ_RELAY_URL="wss://relay.test"',
      "KEYCHAIN_SERVICE=svc",
      "KEYCHAIN_NSEC_ACCOUNT=nsec",
      "KEYCHAIN_AUTH_ACCOUNT=auth",
      `AGENT_PUBKEY=${AGENT}`,
      "AGENT_NAME='Bot'",
      `OWNER_PUBKEY=${OWNER}`,
      "AGENT_HOME=$HOME/agent",
      "GARBAGE LINE",
    ].join("\n"),
  );
  const c = await loadConfig();
  assert.equal(c.source, "env-file");
  assert.equal(c.path, configPaths().env);
  assert.equal(c.agentHome, path.join(sb.home, "agent"));
  assert.equal(c.agentName, "Bot");
  assert.equal(c.relayUrl, "wss://relay.test");
  assert.equal(c.buzzBin, "/opt/buzz");
  assert.deepEqual(c.keychain, { service: "svc", nsecAccount: "nsec", authAccount: "auth" });
  assert.equal(c.agentPubkey, AGENT);
  assert.equal(c.ownerPubkey, OWNER);
});

test("env incompleto: sin las tres claves del llavero no hay identidad", () => {
  const env = parseEnvFile("KEYCHAIN_SERVICE=svc\nKEYCHAIN_NSEC_ACCOUNT=nsec\n");
  assert.equal(env.KEYCHAIN_AUTH_ACCOUNT, undefined);
});

test("config.toml gana sobre el .env cuando ambos existen", async () => {
  await writeFile(
    configPaths().toml,
    `[agent]\nhome = "~/toml-home"\nname = "Tomlo"\n[relay]\nurl = "wss://toml.test"\nbuzz_bin = "~/bin/buzz"\n[landing]\nforbidden_roots = ["~/work", "/srv"]\nrepos = ["~/p/one"]\n`,
  );
  const c = await loadConfig();
  assert.equal(c.source, "toml");
  assert.equal(c.path, configPaths().toml);
  assert.equal(c.agentHome, path.join(sb.home, "toml-home"));
  assert.equal(c.agentName, "Tomlo");
  assert.equal(c.relayUrl, "wss://toml.test");
  assert.equal(c.buzzBin, path.join(sb.home, "bin", "buzz"));
  assert.equal(c.keychain, null, "sin bloque [keychain] no hay identidad");
  assert.deepEqual(c.landing, { forbiddenRoots: [path.join(sb.home, "work"), "/srv"], repos: [path.join(sb.home, "p", "one")] });
  await rm(configPaths().toml);
});

test("toml mal formado falla en vez de caer en silencio al .env", async () => {
  await writeFile(configPaths().toml, "[agent\nhome = ");
  await assert.rejects(loadConfig());
  await rm(configPaths().toml);
});

test("fromToml: bloque keychain completo y claves ignoradas", () => {
  const c = fromToml(
    `[keychain]\nservice = "s"\nnsec_account = "n"\nauth_account = "a"\n[extra]\nfoo = 1\n[agent]\npubkey = "${AGENT}"\n`,
    "/x/config.toml",
  );
  assert.deepEqual(c.keychain, { service: "s", nsecAccount: "n", authAccount: "a" });
  assert.equal(c.agentPubkey, AGENT);
  assert.equal(c.ownerPubkey, null);
  assert.equal(c.path, "/x/config.toml");
});

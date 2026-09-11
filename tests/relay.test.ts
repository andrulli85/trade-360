import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { loadConfig } from "../src/core/config.ts";
import { createRelay, READ_ONLY_COMMANDS, RelayUnavailable } from "../src/core/relay.ts";
import { AGENT, CHANNEL, makeSandbox, msg, OWNER, useEnv, type Sandbox } from "./helpers.ts";

let sb: Sandbox;
let restore: () => void;
before(async () => {
  sb = await makeSandbox();
  restore = useEnv(sb.env);
  await sb.setMessages([msg({ pubkey: OWNER, content: "hola", created_at: 5 }), msg({ pubkey: AGENT, content: "❓", created_at: 9 })]);
  await sb.setUsers([{ pubkey: OWNER, display_name: "Andy" }]);
});
after(async () => {
  restore();
  await sb.cleanup();
});

test("ejecuta buzz con la identidad del llavero en el entorno del hijo", async () => {
  const relay = createRelay();
  const messages = await relay.getMessages(CHANNEL, { since: 6, limit: 10 });
  assert.deepEqual(messages.map((m) => m.content), ["❓"]);

  const [call] = await sb.calls();
  assert.deepEqual(call.argv, ["messages", "get", "--channel", CHANNEL, "--limit", "10", "--since", "6"]);
  assert.equal(call.env.BUZZ_PRIVATE_KEY, "secret:t360-test:nsec");
  assert.equal(call.env.BUZZ_AUTH_TAG, "secret:t360-test:auth");
  assert.equal(call.env.BUZZ_RELAY_URL, "wss://relay.test");

  // Both items are read in parallel, so the log order is not fixed.
  const sec = (await sb.securityCalls()).map((a) => a.join(" ")).sort();
  assert.deepEqual(sec, [
    "find-generic-password -s t360-test -a auth -w",
    "find-generic-password -s t360-test -a nsec -w",
  ]);
  assert.equal(process.env.BUZZ_PRIVATE_KEY, undefined, "la clave no se filtra al proceso padre");
});

test("getUser cachea por relay y devuelve null para desconocidos", async () => {
  const relay = createRelay();
  const before = (await sb.calls()).length;
  assert.equal((await relay.getUser(OWNER))?.display_name, "Andy");
  assert.equal(await relay.getUser(OWNER), (await relay.getUser(OWNER)));
  assert.equal(await relay.getUser(AGENT), null);
  await relay.getUser(AGENT);
  assert.equal((await sb.calls()).length - before, 2, "una llamada por pubkey distinta");
});

test("la lista blanca por defecto es de solo lectura y se amplía por llamador", async () => {
  assert.deepEqual([...READ_ONLY_COMMANDS].sort(), ["channels get", "messages get", "users get"]);
  const ro = createRelay();
  await assert.rejects(ro.run("messages send", ["--channel", CHANNEL]), /no está en la lista/);
  const before = (await sb.calls()).length;
  const rw = createRelay({ allow: [...READ_ONLY_COMMANDS, "channels get"] });
  const ch = await rw.getChannel(CHANNEL);
  assert.equal(ch.channel_id, CHANNEL);
  assert.equal((await sb.calls()).length - before, 1);
});

test("error de buzz-cli: JSON de stderr → mensaje legible, reason cli-error", async () => {
  await sb.setFailure({ error: "relay", message: "connection refused" });
  try {
    await assert.rejects(createRelay().getMessages(CHANNEL), (err: unknown) => {
      assert.ok(err instanceof RelayUnavailable);
      assert.equal(err.reason, "cli-error");
      assert.equal(err.message, "relay: connection refused");
      return true;
    });
  } finally {
    await sb.setFailure(null);
  }
});

test("sin bloque [keychain] no se toca ni el llavero ni buzz", async () => {
  const config = { ...(await loadConfig()), keychain: null };
  const before = (await sb.securityCalls()).length;
  await assert.rejects(createRelay({ config }).getMessages(CHANNEL), (err: unknown) => {
    assert.ok(err instanceof RelayUnavailable);
    assert.equal(err.reason, "no-identity");
    return true;
  });
  assert.equal((await sb.securityCalls()).length, before);
});

test("llavero sin el item → reason keychain; binario ausente → no-bin", async () => {
  const base = await loadConfig();
  await assert.rejects(
    createRelay({ config: { ...base, keychain: { ...base.keychain!, service: "locked" } } }).getMessages(CHANNEL),
    (err: unknown) => err instanceof RelayUnavailable && err.reason === "keychain" && /could not be found/.test(err.message),
  );
  await assert.rejects(
    createRelay({ config: { ...base, buzzBin: `${sb.binDir}/missing` } }).getMessages(CHANNEL),
    (err: unknown) => err instanceof RelayUnavailable && err.reason === "no-bin",
  );
});

test("el proveedor de secretos es sustituible (sin security en PATH)", async () => {
  const relay = createRelay({ secrets: async () => ({ privateKey: "pk", authTag: "tag" }) });
  await relay.getMessages(CHANNEL);
  const calls = await sb.calls();
  assert.equal(calls[calls.length - 1].env.BUZZ_PRIVATE_KEY, "pk");
});

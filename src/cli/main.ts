#!/usr/bin/env node
import { parseArgs, type ParseArgsConfig } from "node:util";
import { loadConfig, type Config } from "../core/config.ts";
import { collect, CollectError, type CollectErrorCode } from "../core/collect.ts";
import { briefFromFile, kickoff, KickoffError, planeOfBrief, type KickoffErrorCode } from "../core/kickoff.ts";
import { isMode, type GrillMode } from "../core/kickoff-file.ts";
import { isPlane, type Plane } from "../core/plane.ts";
import { formatEpochSeconds } from "../core/format.ts";
import { AGENT_LABEL, agentPaths, currentEntry, installAgent, LaunchdError, SCAN_INTERVAL_SECONDS, uninstallAgent } from "../core/launchd.ts";
import { scan } from "../core/scan.ts";
import { NotFound, renderList, renderOne, statusList, statusOne } from "./status.ts";

const USAGE = `t360 — trade-360 desde la terminal

Uso:
  t360 status [slug] [--json]
      grills en PLANS/ (con slug: turno e hilo del relay)
  t360 kickoff <slug> --mode <rf|oq|dec|plan|doc> --plane <personal|work>
      (--brief <path> | --stdin) --description "…" [--with <pubkey>]... [--json]
      abre el canal privado, publica el kickoff y escribe PLANS/<slug>/{brief.md,kickoff.json}
  t360 collect <slug> --repo <path> [--json]
      copia los cuatro artefactos a <repo>/docs/grill/<slug>/, commitea
      "docs(grill): <slug> verdict", anota landed_* en kickoff.json y publica el cierre. No hace push.
  t360 scan [--json] [--verbose]
      una pasada por los grills abiertos: al ver el ✅ del owner anota checked_at en kickoff.json
      y avisa en el hilo qué artefactos faltan. Nunca aterriza. Silencioso si no pasa nada.
  t360 install-agent | uninstall-agent
      LaunchAgent com.andrulli.t360 que ejecuta "t360 scan" cada 15 s (log en ~/Library/Logs/t360.log)
  t360 --help | --version

Códigos de salida: 0 ok · 1 error · 2 uso · 3 no encontrado o frontera de planos ·
4 artefacto faltante · 5 destino ya existe · 6 candado ocupado. scan: 1 si algún grill falló.

Configuración: ~/.config/t360/config.toml (T360_CONFIG) o, si no existe,
~/.config/buzz-kickoff.env (BUZZ_KICKOFF_CONFIG).`;

const VERSION = "0.1.0";

const out = (s: string) => process.stdout.write(`${s}\n`);
const err = (s: string) => process.stderr.write(`${s}\n`);

function parse<T extends ParseArgsConfig["options"]>(argv: string[], options: T) {
  return parseArgs({ args: argv, options: { json: { type: "boolean" }, ...options }, allowPositionals: true });
}

/** Exit codes: 0 ok · 1 error · 2 usage · 3 not found / plane · 4 missing · 5 exists · 6 locked. */
export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    out(USAGE);
    return command ? 0 : 2;
  }
  if (command === "--version" || command === "-V") {
    out(`t360 ${VERSION}`);
    return 0;
  }
  try {
    switch (command) {
      case "status":
        return await status(rest);
      case "kickoff":
        return await kickoffCmd(rest);
      case "collect":
        return await collectCmd(rest);
      case "scan":
        return await scanCmd(rest);
      case "install-agent":
        return await installAgentCmd();
      case "uninstall-agent":
        return await uninstallAgentCmd();
      default:
        err(`t360: subcomando desconocido "${command}"\n${USAGE}`);
        return 2;
    }
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
      err(`t360 ${command}: ${e.message}\n${USAGE}`);
      return 2;
    }
    if ((e as Error).name === "SlugLocked") {
      err(`t360 ${command}: ${(e as Error).message}`);
      return 6;
    }
    throw e;
  }
}

async function status(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, {});
  if (positionals.length > 1) {
    err("t360 status: se esperaba como mucho un slug");
    return 2;
  }
  const config = await loadConfig();
  if (positionals.length === 0) {
    const list = await statusList(config);
    out(values.json ? JSON.stringify(list, null, 2) : renderList(list));
    return 0;
  }
  try {
    const one = await statusOne(positionals[0], { config });
    out(values.json ? JSON.stringify(one, null, 2) : renderOne(one, config.agentName));
    return 0;
  } catch (e) {
    if (e instanceof NotFound) {
      err(`t360 status: ${e.message}`);
      return 3;
    }
    throw e;
  }
}

const KICKOFF_EXIT: Record<KickoffErrorCode, number> = { usage: 2, plane: 3, exists: 5, config: 1, relay: 1 };

async function kickoffCmd(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, {
    mode: { type: "string" },
    plane: { type: "string" },
    brief: { type: "string" },
    stdin: { type: "boolean" },
    description: { type: "string" },
    with: { type: "string", multiple: true },
  });
  const [slug] = positionals;
  if (!slug || positionals.length > 1 || !values.mode || !values.description || (!values.brief && !values.stdin) || (values.brief && values.stdin)) {
    err("t360 kickoff: uso: t360 kickoff <slug> --mode <m> --plane <p> (--brief <path> | --stdin) --description \"…\"");
    return 2;
  }
  const config = await loadConfig();
  const brief = values.stdin ? { text: await readStdin(), source: "inline" } : await briefFromFile(values.brief!);
  const plane = await resolvePlane(values.plane, brief.source, config);
  if (!plane) return 2;
  if (!isMode(values.mode)) {
    err(`t360 kickoff: modo inválido "${values.mode}": rf | oq | dec | plan | doc`);
    return 2;
  }
  try {
    const rec = await kickoff(
      { slug, mode: values.mode as GrillMode, plane, description: values.description, brief, with: values.with ?? [] },
      { config, settleMs: process.env.T360_SETTLE_MS !== undefined ? Number(process.env.T360_SETTLE_MS) : undefined },
    );
    if (values.json) out(JSON.stringify(rec, null, 2));
    else {
      out(`Grill ${rec.slug} abierto (${rec.mode}, plano ${rec.plane})`);
      out(`Canal      ${rec.channel_id}`);
      out(`Hilo raíz  ${rec.root_event_id}`);
      out(`Brief      ${config.agentHome}/${rec.brief} (origen: ${rec.brief_source})`);
      out(`Registro   ${config.agentHome}/PLANS/${rec.slug}/kickoff.json`);
      out(`Cierre: el owner escribe un mensaje con ✅ en el hilo; las respuestas empiezan por @${config.agentName}.`);
    }
    return 0;
  } catch (e) {
    if (e instanceof KickoffError) {
      err(`t360 kickoff: ${e.message}`);
      return KICKOFF_EXIT[e.code];
    }
    throw e;
  }
}

/**
 * `--plane` is mandatory (ADR D4); when the brief comes from a file the path
 * preselects it and a contradiction with a forbidden root is an error.
 */
async function resolvePlane(given: string | undefined, source: string, config: Config): Promise<Plane | null> {
  const implied = await planeOfBrief(source, config);
  if (!given) {
    err(
      `t360 kickoff: falta --plane <personal|work>` +
        (implied ? ` (la ruta del brief sugiere ${implied.plane}${implied.root ? `, bajo ${implied.root}` : ""})` : ""),
    );
    return null;
  }
  if (!isPlane(given)) {
    err(`t360 kickoff: plano inválido "${given}": personal | work`);
    return null;
  }
  return given;
}

const COLLECT_EXIT: Record<CollectErrorCode, number> = { usage: 2, "not-found": 3, plane: 3, missing: 4, exists: 5, landed: 5, git: 1 };

async function collectCmd(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, { repo: { type: "string" } });
  const [slug] = positionals;
  if (!slug || positionals.length > 1 || !values.repo) {
    err("t360 collect: uso: t360 collect <slug> --repo <path>");
    return 2;
  }
  try {
    const r = await collect({ slug, repo: values.repo }, { config: await loadConfig() });
    if (values.json) out(JSON.stringify(r, null, 2));
    else {
      for (const f of r.files) out(f);
      out(`Commit ${r.commit.slice(0, 7)} en ${r.repo} (sin push)`);
      if (r.closing.ok) out(`Cierre publicado en el hilo (${r.closing.eventId.slice(0, 8)}…)`);
    }
    if (!r.closing.ok) {
      err(`t360 collect: aterrizado y commiteado, pero no se pudo publicar el cierre en el hilo: ${r.closing.detail}`);
      err(`t360 collect: publícalo a mano: ${r.closing.content}`);
    }
    return 0;
  } catch (e) {
    if (e instanceof CollectError) {
      err(`t360 collect: ${e.message}`);
      return COLLECT_EXIT[e.code];
    }
    throw e;
  }
}

async function scanCmd(argv: string[]): Promise<number> {
  const { values } = parse(argv, { verbose: { type: "boolean" } });
  const outcomes = await scan({ config: await loadConfig() });
  if (values.json) {
    out(JSON.stringify(outcomes, null, 2));
  } else {
    const stamp = new Date().toISOString();
    for (const o of outcomes) {
      if (o.result === "checked") {
        out(`${stamp} ${o.slug}: ✅ recibido (${formatEpochSeconds(o.checkedAt)})${o.missing.length ? `; faltan ${o.missing.join(", ")}` : "; los cuatro artefactos están"}`);
        if (!o.notice.ok) err(`${stamp} ${o.slug}: checked_at anotado, pero no se pudo avisar en el hilo: ${o.notice.detail}`);
      } else if (o.result === "error") {
        err(`${stamp} ${o.slug}: error: ${o.detail}`);
      } else if (values.verbose) {
        out(`${stamp} ${o.slug}: ${o.result === "waiting" ? "esperando ✅" : `omitido (${o.why})`}`);
      }
    }
  }
  return outcomes.some((o) => o.result === "error") ? 1 : 0;
}

async function installAgentCmd(): Promise<number> {
  try {
    const { plist } = await installAgent(await loadConfig(), await currentEntry());
    out(`Instalado ${AGENT_LABEL}: t360 scan cada ${SCAN_INTERVAL_SECONDS} s`);
    out(`Plist  ${plist}`);
    out(`Log    ${agentPaths().log}`);
    return 0;
  } catch (e) {
    if (e instanceof LaunchdError) {
      err(`t360 install-agent: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

async function uninstallAgentCmd(): Promise<number> {
  try {
    const { plist, existed } = await uninstallAgent();
    out(existed ? `Desinstalado ${AGENT_LABEL} (${plist})` : `${AGENT_LABEL} no estaba instalado (${plist})`);
    return 0;
  } catch (e) {
    if (e instanceof LaunchdError) {
      err(`t360 uninstall-agent: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    err(`t360: ${(e as Error).message}`);
    process.exit(1);
  },
);

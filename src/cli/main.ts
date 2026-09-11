#!/usr/bin/env node
import { parseArgs } from "node:util";
import { loadConfig } from "../core/config.ts";
import { NotFound, renderList, renderOne, statusList, statusOne } from "./status.ts";

const USAGE = `t360 — trade-360 desde la terminal

Uso:
  t360 status [slug] [--json]   grills en PLANS/ (con slug: turno e hilo del relay)
  t360 --help | --version

Configuración: ~/.config/t360/config.toml (T360_CONFIG) o, si no existe,
~/.config/buzz-kickoff.env (BUZZ_KICKOFF_CONFIG).`;

const VERSION = "0.1.0";

const OPTIONS = {
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "V" },
} as const;

/** Exit codes: 0 ok · 1 error · 2 usage · 3 not found. */
export async function main(argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (err) {
    process.stderr.write(`t360: ${(err as Error).message}\n${USAGE}\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.version) {
    process.stdout.write(`t360 ${VERSION}\n`);
    return 0;
  }
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    process.stdout.write(`${USAGE}\n`);
    return values.help ? 0 : 2;
  }

  switch (command) {
    case "status":
      return status(rest, Boolean(values.json));
    default:
      process.stderr.write(`t360: subcomando desconocido "${command}"\n${USAGE}\n`);
      return 2;
  }
}

async function status(args: string[], json: boolean): Promise<number> {
  if (args.length > 1) {
    process.stderr.write(`t360 status: se esperaba como mucho un slug\n`);
    return 2;
  }
  const config = await loadConfig();
  if (args.length === 0) {
    const list = await statusList(config);
    process.stdout.write(json ? `${JSON.stringify(list, null, 2)}\n` : `${renderList(list)}\n`);
    return 0;
  }
  try {
    const one = await statusOne(args[0], { config });
    process.stdout.write(json ? `${JSON.stringify(one, null, 2)}\n` : `${renderOne(one, config.agentName)}\n`);
    return 0;
  } catch (err) {
    if (err instanceof NotFound) {
      process.stderr.write(`t360 status: ${err.message}\n`);
      return 3;
    }
    throw err;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`t360: ${(err as Error).message}\n`);
    process.exit(1);
  },
);

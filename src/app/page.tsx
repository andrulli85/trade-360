import Link from "next/link";
import { CONFIG_FILE_PATH, loadConfig } from "@/lib/config";
import { listGrills, MODE_LABEL } from "@/lib/grills";
import { formatEpochMs, formatEpochSeconds, shortId } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";

// Everything here is read from the local disk on each request.
export const dynamic = "force-dynamic";

export default async function GrillsPage() {
  const [config, { plansDir, grills }] = await Promise.all([loadConfig(), listGrills()]);
  const open = grills.filter((g) => g.status === "open").length;
  const closed = grills.filter((g) => g.status === "closed").length;

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Grills</h1>
          <p className="mt-1 text-sm text-muted">
            {open} abiertos · {closed} cerrados · {grills.length - open - closed} carpetas de notas
          </p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted">
          <dt>Agente</dt>
          <dd className="font-mono text-foreground">{config.agentName}</dd>
          <dt>Relay</dt>
          <dd className="font-mono text-foreground">{config.relayUrl ?? "—"}</dd>
          <dt>PLANS</dt>
          <dd className="font-mono text-foreground">{plansDir}</dd>
        </dl>
      </section>

      {config.source === "defaults" && (
        <p className="rounded border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          No se encontró <code className="font-mono">{CONFIG_FILE_PATH}</code>; se usan los valores por
          defecto (<code className="font-mono">~/.buzz</code>, agente <code className="font-mono">Claude</code>).
          Es el mismo archivo que usa el skill <code className="font-mono">buzz-kickoff</code>.
        </p>
      )}

      {grills.length === 0 ? (
        <p className="rounded border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
          No hay carpetas en <code className="font-mono">{plansDir}</code>. Abre un grill con{" "}
          <code className="font-mono">/buzz-kickoff &lt;historia&gt; &lt;modo&gt;</code> desde Conductor.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Grill</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2 font-medium">Modo</th>
                <th className="px-4 py-2 font-medium">Artefactos</th>
                <th className="px-4 py-2 font-medium">Canal</th>
                <th className="px-4 py-2 font-medium">Inicio</th>
                <th className="px-4 py-2 font-medium">Actualizado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {grills.map((g) => (
                <tr key={g.slug} className="hover:bg-surface/60">
                  <td className="px-4 py-2">
                    <Link href={`/grills/${g.slug}`} className="font-medium hover:text-accent">
                      {g.slug}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={g.status} />
                  </td>
                  <td className="px-4 py-2 text-muted">
                    {g.mode ? (
                      <span title={MODE_LABEL[g.mode]} className="font-mono">
                        {g.mode}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-muted">
                    {(["brief", "ledger", "verdict", "kickoff"] as const).map((a) => (
                      <span key={a} className={g.artifacts[a] ? "text-foreground" : "opacity-40"}>
                        {a[0]}
                      </span>
                    ))}
                    {g.extraFiles.length > 0 && <span className="ml-2">+{g.extraFiles.length}</span>}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-muted">
                    {g.kickoff ? shortId(g.kickoff.channel_id) : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted">
                    {g.kickoff ? formatEpochSeconds(g.kickoff.started_at) : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted">{formatEpochMs(g.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">
        Artefactos: <span className="font-mono">b</span>rief · <span className="font-mono">l</span>edger ·{" "}
        <span className="font-mono">v</span>erdict · <span className="font-mono">k</span>ickoff. Solo lectura:
        este panel nunca escribe en Buzz ni en <span className="font-mono">PLANS/</span>.
      </p>
    </div>
  );
}

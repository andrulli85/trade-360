import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { loadConfig } from "@/lib/config";
import { ARTIFACT_FILE, getGrill, MODE_LABEL, readGrillFile } from "@/lib/grills";
import { formatEpochSeconds } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { Markdown } from "@/components/markdown";
import { PanelSkeleton, ThreadTab, TurnPanel } from "./thread-panel";

export const dynamic = "force-dynamic";

const THREAD_TAB = "thread";

const ARTIFACT_TABS = [
  { file: ARTIFACT_FILE.verdict, key: "verdict", label: "Veredicto" },
  { file: ARTIFACT_FILE.ledger, key: "ledger", label: "Ledger" },
  { file: ARTIFACT_FILE.brief, key: "brief", label: "Brief" },
] as const;

export default async function GrillPage({ params, searchParams }: PageProps<"/grills/[slug]">) {
  const { slug } = await params;
  const [grill, config] = await Promise.all([getGrill(slug), loadConfig()]);
  if (!grill) notFound();

  const tabs = [
    ...(grill.kickoff ? [{ file: THREAD_TAB, label: "Hilo" }] : []),
    ...ARTIFACT_TABS.filter((t) => grill.artifacts[t.key]).map(({ file, label }) => ({ file, label })),
    ...grill.extraFiles.map((f) => ({ file: f, label: f.replace(/\.md$/, "") })),
  ];
  // Open grills land on the live thread; closed ones on the verdict.
  const defaultTab = grill.status === "open" ? THREAD_TAB : tabs.find((t) => t.file !== THREAD_TAB)?.file;
  const requested = (await searchParams).file;
  const wanted = Array.isArray(requested) ? requested[0] : requested;
  const selected = tabs.find((t) => t.file === wanted) ?? tabs.find((t) => t.file === defaultTab) ?? tabs[0];
  const content =
    selected && selected.file !== THREAD_TAB ? await readGrillFile(grill, selected.file) : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-xs text-muted hover:text-foreground">
          ← Grills
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{grill.slug}</h1>
          <StatusBadge status={grill.status} />
          {grill.mode && (
            <span className="text-sm text-muted">
              {MODE_LABEL[grill.mode]} (<span className="font-mono">{grill.mode}</span>)
            </span>
          )}
        </div>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted">
          <dt>Carpeta</dt>
          <dd className="font-mono break-all text-foreground">{grill.dir}</dd>
          {grill.kickoff && (
            <>
              <dt>Canal</dt>
              <dd className="font-mono break-all text-foreground">{grill.kickoff.channel_id}</dd>
              <dt>Hilo raíz</dt>
              <dd className="font-mono break-all text-foreground">{grill.kickoff.root_event_id}</dd>
              <dt>Inicio</dt>
              <dd className="text-foreground">{formatEpochSeconds(grill.kickoff.started_at)}</dd>
              {grill.kickoff.plane && (
                <>
                  <dt>Plano</dt>
                  <dd className="text-foreground">{grill.kickoff.plane}</dd>
                </>
              )}
              {grill.kickoff.landed_at && (
                <>
                  <dt>Aterrizado</dt>
                  <dd className="font-mono break-all text-foreground">
                    {grill.kickoff.landed_repo}/docs/grill/{grill.slug}/ · {grill.kickoff.commit?.slice(0, 7)} ·{" "}
                    {formatEpochSeconds(grill.kickoff.landed_at)}
                  </dd>
                </>
              )}
            </>
          )}
        </dl>
      </div>

      {grill.kickoff && (
        <Suspense fallback={<PanelSkeleton />}>
          <TurnPanel grill={grill} agentName={config.agentName} />
        </Suspense>
      )}

      {tabs.length === 0 ? (
        <p className="text-sm text-muted">Esta carpeta no tiene archivos markdown.</p>
      ) : (
        <>
          <nav className="flex gap-1 border-b border-border text-sm">
            {tabs.map((t) => (
              <Link
                key={t.file}
                href={`/grills/${grill.slug}?file=${encodeURIComponent(t.file)}`}
                className={`-mb-px border-b-2 px-3 py-2 ${
                  t.file === selected?.file
                    ? "border-accent text-foreground"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          {selected?.file === THREAD_TAB ? (
            <Suspense fallback={<PanelSkeleton lines={4} />}>
              <ThreadTab grill={grill} />
            </Suspense>
          ) : content !== null ? (
            <Markdown source={content} />
          ) : (
            <p className="text-sm text-muted">No se pudo leer {selected?.file}.</p>
          )}
        </>
      )}
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ARTIFACT_FILE, getGrill, MODE_LABEL, readGrillFile } from "@/lib/grills";
import { formatEpochSeconds } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { Markdown } from "@/components/markdown";

export const dynamic = "force-dynamic";

const TABS = [
  { file: ARTIFACT_FILE.verdict, label: "Veredicto" },
  { file: ARTIFACT_FILE.ledger, label: "Ledger" },
  { file: ARTIFACT_FILE.brief, label: "Brief" },
] as const;

export default async function GrillPage({
  params,
  searchParams,
}: PageProps<"/grills/[slug]">) {
  const { slug } = await params;
  const grill = await getGrill(slug);
  if (!grill) notFound();

  const available = [
    ...TABS.filter((t) => grill.artifacts[t.file.replace(".md", "") as "verdict" | "ledger" | "brief"]),
    ...grill.extraFiles.map((f) => ({ file: f, label: f.replace(/\.md$/, "") })),
  ];
  const requested = (await searchParams).file;
  const selected =
    available.find((t) => t.file === (Array.isArray(requested) ? requested[0] : requested)) ??
    available[0];
  const content = selected ? await readGrillFile(grill, selected.file) : null;

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
            </>
          )}
        </dl>
      </div>

      {available.length === 0 ? (
        <p className="text-sm text-muted">Esta carpeta no tiene archivos markdown.</p>
      ) : (
        <>
          <nav className="flex gap-1 border-b border-border text-sm">
            {available.map((t) => (
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
          {content !== null ? (
            <Markdown source={content} />
          ) : (
            <p className="text-sm text-muted">No se pudo leer {selected?.file}.</p>
          )}
        </>
      )}
    </div>
  );
}

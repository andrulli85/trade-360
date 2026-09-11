import type { Turn } from "@/lib/thread";
import { formatEpochSeconds, formatRelativeSeconds } from "@/lib/format";

/** One line that answers "whose move is it?" for an open grill. */
export function TurnCard({ turn, agentName }: { turn: Turn; agentName: string }) {
  switch (turn.kind) {
    case "closed":
      return (
        <Card tone="closed" title="Cerrado con ✅" meta={formatEpochSeconds(turn.at)} />
      );
    case "owner":
      return (
        <Card
          tone="owner"
          title="Te toca responder"
          meta={`${agentName} preguntó ${formatRelativeSeconds(turn.since)}`}
          body={turn.question}
        />
      );
    case "agent":
      return (
        <Card
          tone="agent"
          title={`Turno de ${agentName}`}
          meta={`última respuesta humana ${formatRelativeSeconds(turn.since)}`}
        />
      );
    case "idle":
      return <Card tone="idle" title="Sin actividad humana ni del agente" meta={formatRelativeSeconds(turn.since)} />;
    case "empty":
      return <Card tone="idle" title="El hilo todavía no tiene mensajes" />;
  }
}

const TONE = {
  closed: "border-sky-500/30 bg-sky-500/10",
  owner: "border-amber-500/40 bg-amber-500/10",
  agent: "border-emerald-500/30 bg-emerald-500/10",
  idle: "border-border bg-surface",
} as const;

function Card({
  tone,
  title,
  meta,
  body,
}: {
  tone: keyof typeof TONE;
  title: string;
  meta?: string;
  body?: string;
}) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${TONE[tone]}`}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-medium">{title}</span>
        {meta && <span className="text-xs text-muted">{meta}</span>}
      </div>
      {body && <p className="mt-1 text-sm text-muted">{body}</p>}
    </div>
  );
}

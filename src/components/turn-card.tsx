import { describeTurn, type Turn } from "@/lib/thread";

const TONE = {
  closed: "border-sky-500/30 bg-sky-500/10",
  owner: "border-amber-500/40 bg-amber-500/10",
  agent: "border-emerald-500/30 bg-emerald-500/10",
  idle: "border-border bg-surface",
} as const;

/** One line that answers "whose move is it?" for an open grill. */
export function TurnCard({ turn, agentName }: { turn: Turn; agentName: string }) {
  const { tone, title, meta, body } = describeTurn(turn, agentName);
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

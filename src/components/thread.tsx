import type { ThreadMessage } from "@/lib/thread";
import { formatEpochSeconds } from "@/lib/format";
import { Markdown } from "./markdown";

const ROLE_STYLE: Record<ThreadMessage["role"], string> = {
  agent: "text-emerald-300",
  owner: "text-amber-300",
  terminal: "text-sky-300",
  other: "text-foreground",
};

export function Thread({ messages }: { messages: ThreadMessage[] }) {
  return (
    <ol className="space-y-4">
      {messages.map((m) => (
        <li
          key={m.id}
          className={`rounded-lg border px-4 py-3 ${
            m.isCheck ? "border-sky-500/40 bg-sky-500/10" : "border-border bg-surface/60"
          }`}
        >
          <div className="mb-1 flex flex-wrap items-baseline gap-x-3 text-xs">
            <span className={`font-medium ${ROLE_STYLE[m.role]}`}>{m.author}</span>
            <span className="text-muted">{formatEpochSeconds(m.createdAt)}</span>
            {m.isRoot && <span className="text-muted">kickoff</span>}
          </div>
          <div className="text-sm">
            <Markdown source={m.content} />
          </div>
        </li>
      ))}
    </ol>
  );
}

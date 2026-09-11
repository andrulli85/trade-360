import { cache } from "react";
import type { Grill } from "@/lib/grills";
import { getThread, type ThreadFailure } from "@/lib/thread";
import { formatEpochSeconds } from "@/lib/format";
import { TurnCard } from "@/components/turn-card";
import { Thread } from "@/components/thread";

// One relay read per request, shared by the card and the tab.
const cachedThread = cache((grill: Grill) => getThread(grill));

const HINT: Partial<Record<ThreadFailure, string>> = {
  "no-identity": "Añade el bloque [keychain] a ~/.config/t360/config.toml (o KEYCHAIN_* en buzz-kickoff.env).",
  "no-bin": "Define [relay] buzz_bin en ~/.config/t360/config.toml (o BUZZ_BIN en buzz-kickoff.env).",
};

function Unavailable({ reason, detail }: { reason: ThreadFailure; detail: string }) {
  return (
    <p className="rounded border border-border bg-surface px-4 py-3 text-sm text-muted">
      Hilo de Buzz no disponible: <span className="font-mono">{detail}</span>
      {HINT[reason] && <span className="block pt-1">{HINT[reason]}</span>}
    </p>
  );
}

export async function TurnPanel({ grill, agentName }: { grill: Grill; agentName: string }) {
  const thread = await cachedThread(grill);
  if (!thread.ok) return thread.reason === "no-kickoff" ? null : <Unavailable {...thread} />;
  return <TurnCard turn={thread.turn} agentName={agentName} />;
}

export async function ThreadTab({ grill }: { grill: Grill }) {
  const thread = await cachedThread(grill);
  if (!thread.ok) return <Unavailable {...thread} />;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        {thread.messages.length} mensajes · leído del relay {formatEpochSeconds(thread.fetchedAt)} · solo lectura
      </p>
      {thread.messages.length === 0 ? (
        <p className="text-sm text-muted">Sin mensajes en el hilo.</p>
      ) : (
        <Thread messages={thread.messages} />
      )}
    </div>
  );
}

export function PanelSkeleton({ lines = 1 }: { lines?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg border border-border bg-surface" />
      ))}
    </div>
  );
}

import { STATUS_LABEL, type GrillStatus } from "@/lib/grills";

const STYLE: Record<GrillStatus, string> = {
  open: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  closed: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  notes: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

export function StatusBadge({ status }: { status: GrillStatus }) {
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

import type { GrillStatus } from "@/lib/grills";

const STYLE: Record<GrillStatus, { label: string; className: string }> = {
  open: { label: "Abierto", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  closed: { label: "Cerrado ✅", className: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  notes: { label: "Notas", className: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
};

export function StatusBadge({ status }: { status: GrillStatus }) {
  const { label, className } = STYLE[status];
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

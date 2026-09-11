const dateFmt = new Intl.DateTimeFormat("es-CL", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatEpochSeconds(s: number): string {
  return dateFmt.format(new Date(s * 1000));
}

export function formatEpochMs(ms: number): string {
  return dateFmt.format(new Date(ms));
}

export function shortId(id: string, n = 8): string {
  return id.length > n ? `${id.slice(0, n)}…` : id;
}

const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

/** "hace 3 h", "hace 2 días", relative to now, for an epoch in seconds. */
export function formatRelativeSeconds(s: number, nowMs = Date.now()): string {
  const diff = s - Math.floor(nowMs / 1000);
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(diff, "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

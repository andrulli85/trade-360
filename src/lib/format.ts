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

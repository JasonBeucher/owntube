const PALETTE = [
  "linear-gradient(135deg, #ff3355, #ff6633)",
  "linear-gradient(135deg, #5533ff, #a855f7)",
  "linear-gradient(135deg, #22c55e, #3355ff)",
  "linear-gradient(135deg, #eab308, #ff6633)",
  "linear-gradient(135deg, #0ea5e9, #8b5cf6)",
] as const;

export function gradientForChannelId(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) % PALETTE.length;
  }
  return PALETTE[h] ?? PALETTE[0];
}

export function initialsFromLabel(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    const w = parts[0] ?? "";
    return w.slice(0, 2).toUpperCase();
  }
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return `${a}${b}`.toUpperCase();
}

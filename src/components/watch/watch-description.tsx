import Link from "next/link";

type WatchDescriptionProps = {
  videoId: string;
  description?: string | null;
};

type Part =
  | { kind: "text"; value: string }
  | { kind: "url"; value: string }
  | { kind: "time"; value: string; seconds: number };

const URL_RE = /https?:\/\/[^\s<>"')]+/gi;
const TIME_RE = /\b(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)\b/g;

function parseTimeToSeconds(raw: string): number | null {
  const bits = raw.split(":");
  if (bits.length === 2) {
    const m = Number.parseInt(bits[0] ?? "", 10);
    const s = Number.parseInt(bits[1] ?? "", 10);
    if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
    if (m < 0 || s < 0 || s >= 60) return null;
    return m * 60 + s;
  }
  if (bits.length === 3) {
    const h = Number.parseInt(bits[0] ?? "", 10);
    const m = Number.parseInt(bits[1] ?? "", 10);
    const s = Number.parseInt(bits[2] ?? "", 10);
    if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) {
      return null;
    }
    if (h < 0 || m < 0 || m >= 60 || s < 0 || s >= 60) return null;
    return h * 3600 + m * 60 + s;
  }
  return null;
}

function splitTimestamps(text: string): Part[] {
  const out: Part[] = [];
  let last = 0;
  TIME_RE.lastIndex = 0;
  for (const m of text.matchAll(TIME_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: "text", value: text.slice(last, idx) });
    const raw = m[0] ?? "";
    const seconds = parseTimeToSeconds(raw);
    if (seconds == null) out.push({ kind: "text", value: raw });
    else out.push({ kind: "time", value: raw, seconds });
    last = idx + raw.length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
}

function splitDescriptionLine(line: string): Part[] {
  const out: Part[] = [];
  let last = 0;
  URL_RE.lastIndex = 0;
  for (const m of line.matchAll(URL_RE)) {
    const idx = m.index ?? 0;
    const url = m[0] ?? "";
    if (idx > last) out.push(...splitTimestamps(line.slice(last, idx)));
    out.push({ kind: "url", value: url });
    last = idx + url.length;
  }
  if (last < line.length) out.push(...splitTimestamps(line.slice(last)));
  return out;
}

export function WatchDescription({ videoId, description }: WatchDescriptionProps) {
  if (!description?.trim()) {
    return (
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        No description available.
      </p>
    );
  }

  const lines = description.split(/\r?\n/);
  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <div className="space-y-2 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
        {lines.map((line, lineIdx) => {
          if (line.length === 0) return <div key={`blank-${lineIdx}`} className="h-2" />;
          const parts = splitDescriptionLine(line);
          return (
            <p key={`line-${lineIdx}`}>
              {parts.map((part, partIdx) => {
                if (part.kind === "text") {
                  return (
                    <span key={`${lineIdx}-text-${partIdx}`}>{part.value}</span>
                  );
                }
                if (part.kind === "url") {
                  return (
                    <a
                      key={`${lineIdx}-url-${partIdx}`}
                      href={part.value}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-[hsl(var(--primary))] underline decoration-[hsl(var(--primary)_/_0.5)] underline-offset-2 hover:text-[hsl(var(--foreground))]"
                    >
                      {part.value}
                    </a>
                  );
                }
                return (
                  <Link
                    key={`${lineIdx}-time-${partIdx}`}
                    href={`/watch/${encodeURIComponent(videoId)}?t=${part.seconds}`}
                    className="font-medium text-[hsl(var(--foreground))] underline decoration-[hsl(var(--primary)_/_0.45)] underline-offset-2 hover:text-[hsl(var(--primary))]"
                  >
                    {part.value}
                  </Link>
                );
              })}
            </p>
          );
        })}
      </div>
    </div>
  );
}

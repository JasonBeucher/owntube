function primaryLanguageSubtag(raw: string): string {
  const cleaned = raw.trim().replace(/^\./, "");
  if (!cleaned || cleaned.toLowerCase() === "und") return "";
  return (cleaned.split(/[-_.]/)[0] ?? cleaned).toLowerCase();
}

function intlLanguageName(
  subtag: string,
  locales?: Intl.LocalesArgument,
): string | undefined {
  try {
    const name = new Intl.DisplayNames(locales, {
      type: "language",
    }).of(subtag);
    return name ?? undefined;
  } catch {
    return undefined;
  }
}

function languageFromGoogleVideoUrl(url: string | undefined | null): string {
  if (!url) return "";
  const m = url.match(/[?&]lang=([a-z]{2})(-[A-Za-z]{2})?/i);
  if (!m?.[1]) return "";
  return (m[2] ? `${m[1]}${m[2]}` : m[1]).toLowerCase();
}

/** Best-effort BCP-ish code from HLS / internal track ids (e.g. `...-fr`, `..._en`). */
function inferLanguageFromTrackId(id: string | undefined | null): string {
  if (!id?.trim()) return "";
  const low = id.toLowerCase();
  const matches = [
    ...low.matchAll(/[-_/]([a-z]{2})(-[a-z]{2})?(?=[-_/.]|$)/g),
  ];
  const last = matches.at(-1);
  if (!last?.[1]) return "";
  return last[2] ? `${last[1]}${last[2]}` : last[1];
}

function humanizeAudioKind(kind: string | undefined | null): string | undefined {
  const k = kind?.trim().toLowerCase();
  if (!k || k === "main") return undefined;
  const map: Record<string, string> = {
    alternative: "Alternative",
    commentary: "Commentary",
    dub: "Dub",
    translation: "Translation",
    descriptions: "Descriptions",
    "main-desc": "Main + descriptions",
  };
  return map[k] ?? `(${k})`;
}

function coalesceLanguageHints(
  ...parts: (string | undefined | null)[]
): string {
  for (const p of parts) {
    const t = typeof p === "string" ? p.trim().replace(/^\./, "") : "";
    if (t && t.toLowerCase() !== "und") return t;
  }
  return "";
}

/**
 * Human-readable label for an audio stream (display name first, then language tag).
 */
export function audioMenuLabel(opts: {
  displayName?: string | null;
  language?: string | null;
  qualityFallback?: string | null;
  index: number;
}): string {
  const display = opts.displayName?.trim();
  if (display) return display;

  const raw = coalesceLanguageHints(opts.language);
  const primary = primaryLanguageSubtag(raw);
  if (primary) {
    const name = intlLanguageName(primary);
    if (name) return name;
    return raw.split(/[.]/)[0]?.toUpperCase() ?? primary.toUpperCase();
  }

  const q = opts.qualityFallback?.trim();
  if (q) return q;
  return `Track ${opts.index + 1}`;
}

/**
 * Audio menu row: show the **language** (from BCP-47 / Invidious `language`) via
 * {@link Intl.DisplayNames}; add upstream `displayName` in parentheses only when
 * it is not redundant (e.g. "English (Original)").
 */
export function languageFirstAudioMenuLabel(opts: {
  displayName?: string | null;
  language?: string | null;
  qualityFallback?: string | null;
  /** HLS / internal id; may contain a language suffix. */
  trackId?: string | null;
  kind?: string | null;
  /** Progressive URL (e.g. `lang=` on googlevideo). */
  streamUrl?: string | null;
  index: number;
}): string {
  const raw = coalesceLanguageHints(
    opts.language,
    inferLanguageFromTrackId(opts.trackId),
    languageFromGoogleVideoUrl(opts.streamUrl),
  );
  const primary = primaryLanguageSubtag(raw);
  if (primary) {
    const localized =
      intlLanguageName(primary) ??
      raw.split(/[.]/)[0]?.toUpperCase() ??
      primary.toUpperCase();
    const display = opts.displayName?.trim();
    if (display) {
      if (
        display.localeCompare(localized, undefined, {
          sensitivity: "base",
        }) === 0
      ) {
        return localized;
      }
      const enLabel = intlLanguageName(primary, "en");
      if (
        enLabel &&
        display.localeCompare(enLabel, undefined, { sensitivity: "base" }) ===
          0
      ) {
        return localized;
      }
      return `${localized} (${display})`;
    }
    return localized;
  }

  const kindLabel = humanizeAudioKind(opts.kind);
  if (kindLabel) return kindLabel;

  return audioMenuLabel({
    displayName: opts.displayName,
    language: null,
    qualityFallback: opts.qualityFallback,
    index: opts.index,
  });
}

const LOWER_TIER_THUMB = /^(hq720|hqdefault|mqdefault|sddefault|default)\.(jpe?g|webp)$/i;

/** True when the still name is below maxres (Piped lists often ship hq720). */
export function isLowerTierVideoThumbnailFilename(filename: string): boolean {
  const base = filename.split("?")[0]?.trim() ?? "";
  return LOWER_TIER_THUMB.test(base);
}

/**
 * Prefer maxres for feed/search cards. Keeps Piped proxy origin + signed query
 * params when upgrading `/vi/.../hq720.jpg` → `maxresdefault.jpg`.
 */
export function preferHighResVideoThumbnailUrl(
  url: string | undefined,
  videoId?: string,
): string | undefined {
  if (!url) {
    if (!videoId) return undefined;
    return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/maxresdefault.jpg`;
  }
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/");
    const fn = parts[parts.length - 1] ?? "";
    if (!fn || !isLowerTierVideoThumbnailFilename(fn)) return url;
    const isWebp =
      fn.toLowerCase().endsWith(".webp") || u.pathname.includes("/bp/");
    parts[parts.length - 1] = isWebp ? "maxresdefault.webp" : "maxresdefault.jpg";
    u.pathname = parts.join("/");
    return u.toString();
  } catch {
    return url;
  }
}

/** Client `<img onError>` step down when maxres is missing for a video. */
export function nextFallbackVideoThumbnailUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const fn = (u.pathname.split("/").pop() ?? "").toLowerCase();
    const next =
      fn === "maxresdefault.webp" || fn === "maxresdefault.jpg"
        ? "hqdefault.jpg"
        : fn === "hq720.jpg" || fn === "hq720.webp"
          ? "hqdefault.jpg"
          : fn === "hqdefault.jpg" || fn === "hqdefault.webp"
            ? "mqdefault.jpg"
            : undefined;
    if (!next) return undefined;
    u.pathname = u.pathname.replace(/\/[^/]+$/, `/${next}`);
    return u.toString();
  } catch {
    return undefined;
  }
}

export function applyVideoThumbnailImgError(el: HTMLImageElement): void {
  if (el.dataset.fallbackApplied === "1") return;
  const next = nextFallbackVideoThumbnailUrl(el.src);
  if (!next || next === el.src) return;
  el.dataset.fallbackApplied = "1";
  el.src = next;
}

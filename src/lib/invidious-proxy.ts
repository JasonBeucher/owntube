import {
  hostnameFromRequestHostHeader,
  rewriteStreamUrlForRequestHost,
} from "@/lib/invidious-playback-url";
import type { PlayableVariant } from "@/lib/pick-playback";
import type { VideoDetail } from "@/server/services/proxy.types";

function invidiousBaseUrl(): string {
  return process.env.INVIDIOUS_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
}

export function isInvidiousProxyAvailable(): boolean {
  return invidiousBaseUrl().length > 0;
}

/**
 * hls.js fetches the manifest and segments in the browser. Cross-origin
 * requests to the Invidious port often fail (no CORS). We route everything
 * through OwnTube: `/invidious/...` (same origin). Folder must not start
 * with `_` — Next.js treats `_name` as a private (non-routed) segment.
 */
export function toInvidiousProxyUrl(
  absoluteUrl: string,
  appOrigin: string,
): string {
  const u = new URL(absoluteUrl);
  return new URL(
    `/invidious${u.pathname}${u.search}${u.hash}`,
    appOrigin,
  ).toString();
}

export function getAppOriginFromRequestHeaders(
  h: {
    get(name: string): string | null;
  },
  fallback: string = "http://localhost:3000",
): string {
  const host =
    h.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    h.get("host")?.trim() ||
    "";
  if (!host) return fallback;
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const p =
    proto === "https" || proto === "http"
      ? proto
      : h.get("x-forwarded-ssl") === "on"
        ? "https"
        : "http";
  return `${p}://${host}`;
}

/**
 * Piped URLs skip this proxy. Invidious media uses several path prefixes;
 * newer HLS lives under `/api/manifest/...` (not only `/api/v1/...`).
 */
export function shouldUseInvidiousProxyForUrl(
  detail: VideoDetail,
  mediaUrl: string,
): boolean {
  if (!isInvidiousProxyAvailable()) return false;
  if (detail.sourceUsed === "piped") return false;
  if (!mediaUrl) return false;
  try {
    const path = new URL(mediaUrl).pathname;
    if (
      path.startsWith("/api/v1/") ||
      path.startsWith("/api/manifest/") ||
      path.startsWith("/vi/")
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * m3u8 can list absolute segment URLs. Replace known Invidious base URLs
 * with our `/invidious` same-origin base.
 */
/** Hostnames that must be fetched same-origin (YouTube HLS / segments). */
export function isYoutubeFamilyHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "www.youtube.com" || h === "youtube.com" || h === "m.youtube.com") {
    return true;
  }
  if (h === "googlevideo.com" || h.endsWith(".googlevideo.com")) {
    return true;
  }
  return false;
}

function isOwnTubeYtHopUrl(absoluteUrl: string, appOrigin: string): boolean {
  try {
    const u = new URL(absoluteUrl);
    const app = new URL(appOrigin);
    return u.origin === app.origin && u.pathname === "/yt-hls";
  } catch {
    return false;
  }
}

/**
 * Invidious sometimes embeds absolute YouTube / googlevideo URLs in HLS
 * playlists. Browsers cannot read those from our origin (no CORS). Rewrite
 * every such URL to `/yt-hls?url=…` so playback stays same-origin.
 */
export function rewriteYouTubeUrlsInM3u8(
  body: string,
  appOrigin: string,
): string {
  const abs = /https?:\/\/[^\s"'#]+/g;
  return body.replace(abs, (match) => {
    if (isOwnTubeYtHopUrl(match, appOrigin)) return match;
    try {
      const u = new URL(match);
      if (!isYoutubeFamilyHostname(u.hostname)) return match;
      return `${appOrigin}/yt-hls?url=${encodeURIComponent(match)}`;
    } catch {
      return match;
    }
  });
}

export function rewriteM3u8ForOwnTubeProxy(
  body: string,
  appOrigin: string,
  requestHost: string,
  invidiousBase: string,
): string {
  const base = invidiousBase?.trim() ?? "";
  if (!base) return body;
  const u = new URL(base);
  const proxyRoot = `${appOrigin}/invidious`;
  const out: string[] = [u.origin];
  if (u.port) {
    if (u.protocol === "http:") {
      out.push(`http://127.0.0.1:${u.port}`);
      out.push(`http://localhost:${u.port}`);
      const hn = hostnameFromRequestHostHeader(requestHost);
      if (hn) out.push(`http://${hn}:${u.port}`);
    } else {
      out.push(`https://127.0.0.1:${u.port}`);
      out.push(`https://localhost:${u.port}`);
      const hn = hostnameFromRequestHostHeader(requestHost);
      if (hn) out.push(`https://${hn}:${u.port}`);
    }
  }
  const order = Array.from(new Set(out)).sort((a, b) => b.length - a.length);
  let t = body;
  for (const o of order) {
    t = t.split(o).join(proxyRoot);
  }
  return t;
}

/** Invidious base rewrite plus YouTube/googlevideo hop (for hls.js). */
export function rewriteM3u8AllProxies(
  body: string,
  appOrigin: string,
  requestHost: string,
  invidiousBase?: string,
): string {
  const inv = (invidiousBase ?? invidiousBaseUrl()).trim();
  let t = rewriteM3u8ForOwnTubeProxy(body, appOrigin, requestHost, inv);
  t = rewriteYouTubeUrlsInM3u8(t, appOrigin);
  return t;
}

export function toYouTubeHopProxyUrl(
  absoluteUrl: string,
  appOrigin: string,
): string {
  return `${appOrigin}/yt-hls?url=${encodeURIComponent(absoluteUrl)}`;
}

function shouldUseYouTubeHopProxyForUrl(mediaUrl: string): boolean {
  if (!mediaUrl) return false;
  try {
    const u = new URL(mediaUrl);
    if (u.pathname === "/yt-hls") return false;
    return isYoutubeFamilyHostname(u.hostname);
  } catch {
    return false;
  }
}

export function toProxiedOrDirectPlayback(
  rawPlayback: string,
  appOrigin: string,
  requestHost: string,
  detail: VideoDetail,
): string {
  if (!rawPlayback) return rawPlayback;
  if (shouldUseInvidiousProxyForUrl(detail, rawPlayback)) {
    return toInvidiousProxyUrl(rawPlayback, appOrigin);
  }
  if (shouldUseYouTubeHopProxyForUrl(rawPlayback)) {
    return toYouTubeHopProxyUrl(rawPlayback, appOrigin);
  }
  if (requestHost) {
    return rewriteStreamUrlForRequestHost(rawPlayback, requestHost);
  }
  return rawPlayback;
}

export function toProxiedOrDirectPoster(
  rawPoster: string | undefined,
  appOrigin: string,
  requestHost: string,
  detail: VideoDetail,
): string | undefined {
  if (!rawPoster) return undefined;
  if (shouldUseInvidiousProxyForUrl(detail, rawPoster)) {
    return toInvidiousProxyUrl(rawPoster, appOrigin);
  }
  if (requestHost) {
    return rewriteStreamUrlForRequestHost(rawPoster, requestHost);
  }
  return rawPoster;
}

export type ProxiedPlayableVariant =
  | { t: "muxed"; label: string; src: string }
  | {
      t: "split";
      label: string;
      video: string;
      audio: string;
      audioTracks: { label: string; src: string }[];
    };

export function toProxiedOrDirectVariants(
  variants: PlayableVariant[],
  appOrigin: string,
  requestHost: string,
  detail: VideoDetail,
): ProxiedPlayableVariant[] {
  return variants.map((v) => {
    if (v.t === "split") {
      const audioTracks = v.audioOptions.map((o) => ({
        label: o.label,
        src: toProxiedOrDirectPlayback(o.url, appOrigin, requestHost, detail),
      }));
      return {
        t: "split",
        label: v.label,
        video: toProxiedOrDirectPlayback(
          v.videoUrl,
          appOrigin,
          requestHost,
          detail,
        ),
        audio: toProxiedOrDirectPlayback(
          v.audioUrl,
          appOrigin,
          requestHost,
          detail,
        ),
        audioTracks,
      };
    }
    return {
      t: "muxed",
      label: v.label,
      src: toProxiedOrDirectPlayback(v.url, appOrigin, requestHost, detail),
    };
  });
}

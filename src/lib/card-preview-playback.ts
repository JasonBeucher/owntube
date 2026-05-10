import {
  type ProxiedPlayableVariant,
  toProxiedOrDirectPlayback,
  toProxiedOrDirectVariants,
} from "@/lib/invidious-proxy";
import { buildWatchPlayback } from "@/lib/pick-playback";
import type { VideoDetail } from "@/server/services/proxy.types";

export type CardPreviewPlayback =
  | { kind: "muxed"; src: string }
  | { kind: "split"; videoSrc: string; audioSrc: string }
  | { kind: "hls"; src: string };

/**
 * Target max height for hover preview (best-first variant list). 360p keeps a
 * muxed itag in reach so one URL carries video+audio together when upstream
 * exposes it; HLS unchanged.
 */
const PREVIEW_MAX_HEIGHT_PX = 360;

function heightFromQualityLabel(label: string): number | null {
  const m = label.match(/(\d{2,4})\s*p/i);
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Prefer muxed (one URL = video+audio in sync) when possible, then any rung
 * ≤360p, then lowest muxed, then lowest overall.
 */
function pickPreviewProxiedVariant(
  variants: ProxiedPlayableVariant[],
): ProxiedPlayableVariant | null {
  if (variants.length === 0) return null;

  for (const v of variants) {
    const h = heightFromQualityLabel(v.label);
    if (h !== null && h <= PREVIEW_MAX_HEIGHT_PX && v.t === "muxed") {
      return v;
    }
  }
  for (const v of variants) {
    const h = heightFromQualityLabel(v.label);
    if (h !== null && h <= PREVIEW_MAX_HEIGHT_PX) return v;
  }
  for (let i = variants.length - 1; i >= 0; i--) {
    const v = variants[i];
    if (v && v.t === "muxed") return v;
  }
  return variants[variants.length - 1] ?? variants[0] ?? null;
}

/**
 * Resolves playback URLs for in-card hover preview. Progressive: prefer muxed
 * ≤360p (single URL); otherwise split under cap, then lowest muxed, then lowest
 * rung. HLS: full adaptive manifest.
 */
export function cardPreviewPlaybackFromDetail(
  detail: VideoDetail,
  appOrigin: string,
  requestHost: string,
): CardPreviewPlayback | null {
  const raw = buildWatchPlayback(detail);
  if (raw.kind === "none") return null;
  if (raw.kind === "hls") {
    const src = toProxiedOrDirectPlayback(
      raw.url,
      appOrigin,
      requestHost,
      detail,
    );
    return { kind: "hls", src };
  }
  const variants = toProxiedOrDirectVariants(
    raw.variants,
    appOrigin,
    requestHost,
    detail,
  );
  const pick = pickPreviewProxiedVariant(variants);
  if (!pick) return null;
  if (pick.t === "muxed") return { kind: "muxed", src: pick.src };
  return {
    kind: "split",
    videoSrc: pick.video,
    audioSrc: pick.audio,
  };
}

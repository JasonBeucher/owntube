import { languageFirstAudioMenuLabel } from "@/lib/audio-track-label";
import type { VideoDetail } from "@/server/services/proxy.types";

type VideoStreamSource = VideoDetail["videoSources"][number];

/**
 * `video/*` with a codecs="…" clause that lists only audio codecs (bad rows).
 */
function mimeVideoTypeButAudioOnlyCodecs(mime: string | undefined): boolean {
  if (!mime?.trim()) return false;
  if (!mime.toLowerCase().startsWith("video/")) return false;
  const m = mime.match(/codecs\s*=\s*"([^"]+)"/i);
  if (!m?.[1]) return false;
  const c = m[1].toLowerCase().replace(/\s/g, "");
  if (/avc1|avc3|av01|vp8|vp9|vp09|hev1|hvc1|dvh1|theora/.test(c)) return false;
  return /mp4a|opus|vorbis|flac/.test(c);
}

/**
 * Rows we can offer as a &lt;video&gt; source: drop pure audio MIME, height 0,
 * and mis-tagged video/* streams whose codecs are audio-only.
 */
function sourceLooksLikeVideoPane(s: VideoStreamSource): boolean {
  const mt = s.mimeType?.toLowerCase() ?? "";
  if (mt.startsWith("audio/")) return false;
  if (
    typeof s.height === "number" &&
    Number.isFinite(s.height) &&
    s.height <= 0
  ) {
    return false;
  }
  if (mimeVideoTypeButAudioOnlyCodecs(s.mimeType)) return false;
  return true;
}

function isDashPath(url: string): boolean {
  const l = url.toLowerCase();
  return (
    l.includes("/manifest/dash/") ||
    l.includes("/api/manifest/dash") ||
    l.includes(".mpd")
  );
}

function isHlsPath(url: string): boolean {
  const l = url.toLowerCase();
  return l.includes(".m3u8") || l.includes("/manifest/hls/");
}

/** Higher = better; used to sort (best first). */
function scoreQualityLabel(quality: string | undefined, index: number): number {
  if (!quality) return index;
  const m = quality.match(/(\d{2,4})\s*p/i);
  if (m) {
    return Number.parseInt(m[1] ?? "0", 10) * 1_000_000;
  }
  if (/^(tiny|144p|small)/i.test(quality)) return 1;
  if (/^(light|low|240p|360p|medium|480p)/i.test(quality)) return 2;
  if (/^(hd720|large|hd|720p)/i.test(quality)) return 3;
  if (/^(hd1080|hd1080|1080p|fhd)/i.test(quality)) return 4;
  if (/^(1440p|hd1440|qhd)/i.test(quality)) return 5;
  if (/^(2160p|4k|hd2160|uhd|4320p)/i.test(quality)) return 6;
  return 0;
}

function labelForStream(
  quality: string | undefined,
  mimeType: string | undefined,
  index: number,
): string {
  if (quality?.trim()) return quality.trim();
  if (mimeType?.includes("audio")) return `Audio ${index + 1}`;
  return `Format ${index + 1}`;
}

/** Suffix like `2.8 Mbps · 30 fps` for menu rows (empty if unknown). */
function formatBitrateFpsParts(meta?: {
  bitrate?: number;
  fps?: number;
}): string {
  if (!meta) return "";
  const parts: string[] = [];
  const br = meta.bitrate;
  if (typeof br === "number" && Number.isFinite(br) && br > 0) {
    if (br >= 1_000_000) {
      const mbps = br / 1_000_000;
      parts.push(`${mbps >= 10 ? mbps.toFixed(0) : mbps.toFixed(1)} Mbps`);
    } else {
      parts.push(`${Math.max(1, Math.round(br / 1000))} kbps`);
    }
  }
  const fps = meta.fps;
  if (
    typeof fps === "number" &&
    Number.isFinite(fps) &&
    fps > 0 &&
    fps <= 240
  ) {
    parts.push(
      Number.isInteger(fps) ? `${fps} fps` : `${fps.toFixed(2)} fps`,
    );
  }
  return parts.join(" · ");
}

function scoreMuxed(quality: string | undefined, index: number) {
  return scoreQualityLabel(quality, index);
}

export type MuxedVariant = {
  t: "muxed";
  url: string;
  label: string;
  /** Used only before dedupe (source bitrate, bps); stripped from output. */
  rankBitrate?: number;
};
export type SplitVariant = {
  t: "split";
  videoUrl: string;
  audioUrl: string;
  label: string;
  audioOptions: { url: string; label: string }[];
  rankBitrate?: number;
};
export type PlayableVariant = MuxedVariant | SplitVariant;

type PlayableWithRank = PlayableVariant & { rankBitrate?: number };

function rankBitrateOf(v: PlayableWithRank): number {
  const br = v.rankBitrate;
  return typeof br === "number" && Number.isFinite(br) ? br : 0;
}

function omitRankBitrate(v: PlayableWithRank): PlayableVariant {
  if (v.t === "muxed") {
    const { rankBitrate: _r, ...rest } = v;
    return rest as MuxedVariant;
  }
  const { rankBitrate: _r, ...rest } = v;
  return rest as SplitVariant;
}

/** First label segment (e.g. 1440p60, 720p) — one menu row per distinct quality label. */
function qualityMenuRungKey(v: PlayableVariant): string {
  const head = v.label.split(/\s*·\s*/)[0]?.trim().toLowerCase() ?? "";
  return head || v.label.trim().toLowerCase();
}

/** One variant per rung (e.g. one 1440p60); `sorted` must prefer higher bitrate first within a rung. */
function dedupeOneVariantPerQualityRung(sorted: PlayableWithRank[]): PlayableVariant[] {
  const seen = new Set<string>();
  const out: PlayableVariant[] = [];
  for (const v of sorted) {
    const k = qualityMenuRungKey(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(omitRankBitrate(v));
  }
  return out;
}

/**
 * Dedupes identical URLs; disambiguates duplicate labels (rare after per-rung dedupe).
 */
function buildFullQualitySelectorList(sorted: PlayableVariant[]): PlayableVariant[] {
  if (sorted.length === 0) return [];
  const seen = new Set<string>();
  const out: PlayableVariant[] = [];
  const labelUses = new Map<string, number>();

  for (const v of sorted) {
    const key = v.t === "muxed" ? `m:${v.url}` : `s:${v.videoUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const baseLabel = v.label;
    const n = (labelUses.get(baseLabel) ?? 0) + 1;
    labelUses.set(baseLabel, n);
    const label = n === 1 ? baseLabel : `${baseLabel} (${n})`;

    out.push(v.t === "muxed" ? { ...v, label } : { ...v, label });
  }
  return out;
}

/** One split row per video-only stream (same audio menu on each). */
function buildAllSplitVariants(
  detail: VideoDetail,
  keep: (s: VideoStreamSource) => boolean,
): SplitVariant[] {
  const videoCandidates = detail.videoSources
    .map((s, i) => ({ s, i }))
    .filter(
      ({ s }) =>
        keep(s) &&
        s.url &&
        s.videoOnly &&
        !isDashPath(s.url) &&
        !isHlsPath(s.url),
    );
  const audios = (detail.audioSources ?? []).filter((a) => a.url);
  if (videoCandidates.length === 0 || audios.length === 0) return [];

  const audiosScored = audios
    .map((a, i) => ({ a, i, score: scoreQualityLabel(a.quality, i) }))
    .sort((a, b) => b.score - a.score);
  const audioOptions = audiosScored.map(({ a: src, i }) => {
    const name = languageFirstAudioMenuLabel({
      displayName: src.audioTrackDisplayName,
      language: src.language,
      qualityFallback: labelForStream(src.quality, src.mimeType, i),
      streamUrl: src.url,
      index: i,
    });
    const extra = formatBitrateFpsParts({
      bitrate: src.bitrate,
      fps: src.fps,
    });
    return {
      url: src.url!,
      label: extra ? `${name} · ${extra}` : name,
    };
  });
  const defaultAudio = audiosScored[0]?.a;
  if (!defaultAudio?.url) return [];

  videoCandidates.sort(
    (a, b) =>
      scoreQualityLabel(b.s.quality, b.i) - scoreQualityLabel(a.s.quality, a.i),
  );

  return videoCandidates.map(({ s, i }) => ({
    t: "split" as const,
    videoUrl: s.url!,
    audioUrl: defaultAudio.url,
    label: labelForStream(s.quality, s.mimeType, i),
    audioOptions,
    rankBitrate: s.bitrate,
  }));
}

/**
 * Vidstack 0.6 supports HLS (hls.js) and progressive video, but has no
 * DASH/MPD provider. We must not feed Invidious `dashUrl` to the player.
 * Split (video + audio) uses native <video> + <audio> sync for adaptive-only.
 */
export type WatchPlayback =
  | { kind: "hls"; url: string; onlyDashOrUnsupported: false }
  | {
      kind: "progressive";
      variants: PlayableVariant[];
      onlyDashOrUnsupported: false;
    }
  | { kind: "none"; onlyDashOrUnsupported: boolean };

function collectMuxed(
  detail: VideoDetail,
  keep: (s: VideoStreamSource) => boolean,
): MuxedVariant[] {
  const scored = detail.videoSources
    .map((s, i) => {
      const u = s.url;
      if (!u || isDashPath(u) || isHlsPath(u)) return null;
      if (s.videoOnly) return null;
      if (!keep(s)) return null;
      const mt = s.mimeType?.toLowerCase() ?? "";
      if (mt.startsWith("audio/") && !mt.includes("video")) return null;
      return {
        s,
        i,
        score: scoreMuxed(s.quality, i),
        label: labelForStream(s.quality, s.mimeType, i),
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((r) => ({
    t: "muxed" as const,
    url: r.s.url,
    label: r.label,
    rankBitrate: r.s.bitrate,
  }));
}

function scorePlayable(v: PlayableVariant): number {
  return scoreQualityLabel(v.label, 0);
}

/** Resolution rung used to hide muxed when an adaptive split exists at that rung. */
function splitResolutionScores(splits: SplitVariant[]): Set<number> {
  const out = new Set<number>();
  for (const s of splits) {
    out.add(scorePlayable(s));
  }
  return out;
}

/**
 * Combined MP4 (often legacy itag 18) can be audio-only / black while split at
 * the same label height works. If any split exists for that rung, drop muxed.
 */
function dropMuxedWhenSplitMatchesResolution(
  muxed: MuxedVariant[],
  splits: SplitVariant[],
): MuxedVariant[] {
  if (splits.length === 0) return muxed;
  const splitScores = splitResolutionScores(splits);
  return muxed.filter((m) => !splitScores.has(scorePlayable(m)));
}

function sortPlayable(a: PlayableWithRank, b: PlayableWithRank): number {
  const sa = scorePlayable(a);
  const sb = scorePlayable(b);
  if (sb !== sa) return sb - sa;
  // Same resolution: prefer split (muxed can be broken at that height).
  if (a.t !== b.t) return a.t === "split" ? -1 : 1;
  const bra = rankBitrateOf(a);
  const brb = rankBitrateOf(b);
  if (brb !== bra) return brb - bra;
  return 0;
}

export function buildWatchPlayback(detail: VideoDetail): WatchPlayback {
  if (detail.hlsUrl) {
    return { kind: "hls", url: detail.hlsUrl, onlyDashOrUnsupported: false };
  }

  const buildMerged = (keep: (s: VideoStreamSource) => boolean) => {
    let muxed = collectMuxed(detail, keep);
    const splits = buildAllSplitVariants(detail, keep);
    muxed = dropMuxedWhenSplitMatchesResolution(muxed, splits);
    const ranked: PlayableWithRank[] = [...muxed, ...splits];
    ranked.sort(sortPlayable);
    return dedupeOneVariantPerQualityRung(ranked);
  };

  // Drop sources that are clearly audio-only / no video plane; if that
  // removes everything, fall back to the unfiltered list (rare bad metadata).
  let merged = buildMerged(sourceLooksLikeVideoPane);
  if (merged.length === 0) {
    merged = buildMerged(() => true);
  }

  if (merged.length > 0) {
    return {
      kind: "progressive",
      variants: buildFullQualitySelectorList(merged),
      onlyDashOrUnsupported: false,
    };
  }

  for (const s of detail.videoSources) {
    const u = s.url;
    if (u && isHlsPath(u)) {
      return { kind: "hls", url: u, onlyDashOrUnsupported: false };
    }
  }

  if (detail.dashUrl) {
    return { kind: "none", onlyDashOrUnsupported: true };
  }

  return { kind: "none", onlyDashOrUnsupported: false };
}

/** @deprecated for tests — same as "first src" of buildWatchPlayback */
export function pickPlaybackForVidstack(detail: VideoDetail): {
  src: string;
  onlyDashOrUnsupported: boolean;
} {
  const w = buildWatchPlayback(detail);
  if (w.kind === "hls") return { src: w.url, onlyDashOrUnsupported: false };
  if (w.kind === "progressive" && w.variants[0]) {
    const v0 = w.variants[0];
    if (v0.t === "muxed") return { src: v0.url, onlyDashOrUnsupported: false };
    return { src: v0.videoUrl, onlyDashOrUnsupported: false };
  }
  if (w.kind === "none" && w.onlyDashOrUnsupported) {
    return { src: "", onlyDashOrUnsupported: true };
  }
  return { src: "", onlyDashOrUnsupported: false };
}

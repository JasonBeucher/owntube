import type { VideoDetail } from "@web/server/services/proxy.types";

/**
 * One selectable stream. `split` means an adaptive video-only track that has
 * to be played alongside a separate audio track, kept in sync by the caller.
 */
export type PlaybackOption = {
  id: string;
  label: string;
  videoUrl: string;
} & (
  | { kind: "auto" | "muxed"; audioUrl?: never }
  | { kind: "split"; audioUrl: string }
);

/**
 * Playable streams for a video, best first. Prefers HLS auto quality, then
 * muxed progressive MP4, then adaptive video-only rows paired with an audio
 * track. Shared by the watch screen and the shorts pager.
 */
export function buildPlaybackOptions(detail: VideoDetail): PlaybackOption[] {
  const options: PlaybackOption[] = [];
  const seen = new Set<string>();

  const addOption = (option: PlaybackOption) => {
    const key =
      option.kind === "split"
        ? `${option.label}|${option.videoUrl}|${option.audioUrl}`
        : `${option.label}|${option.videoUrl}`;
    if (seen.has(key)) return;
    seen.add(key);
    options.push(option);
  };

  if (detail.hlsUrl) {
    addOption({
      id: "auto-hls",
      label: "Auto",
      videoUrl: detail.hlsUrl,
      kind: "auto",
    });
  }

  detail.videoSources
    .filter((source) => sourceLooksMuxed(source))
    .map((source, index) => ({ source, index }))
    .sort(
      (a, b) =>
        qualityScore(b.source.quality, b.source.height, b.index, b.source.fps) -
        qualityScore(a.source.quality, a.source.height, a.index, a.source.fps),
    )
    .forEach(({ source, index }) => {
      addOption({
        id: `muxed-${index}`,
        label: qualityLabel(source.quality, source.height),
        videoUrl: source.url,
        kind: "muxed",
      });
    });

  const audioSource = selectAudioSource(detail.audioSources);
  if (audioSource) {
    const usedSplitLabels = new Set<string>();
    detail.videoSources
      .filter((source) => sourceLooksSplitVideo(source))
      .map((source, index) => ({ source, index }))
      .sort((a, b) => {
        const byQuality =
          qualityScore(
            b.source.quality,
            b.source.height,
            b.index,
            b.source.fps,
          ) -
          qualityScore(
            a.source.quality,
            a.source.height,
            a.index,
            a.source.fps,
          );
        if (byQuality !== 0) return byQuality;
        const byCodec = codecScore(b.source) - codecScore(a.source);
        if (byCodec !== 0) return byCodec;
        return (b.source.bitrate ?? 0) - (a.source.bitrate ?? 0);
      })
      .forEach(({ source, index }) => {
        const label = qualityLabel(source.quality, source.height);
        if (usedSplitLabels.has(label)) return;
        usedSplitLabels.add(label);
        addOption({
          id: `split-${index}`,
          label,
          videoUrl: source.url,
          audioUrl: audioSource.url,
          kind: "split",
        });
      });
  }

  return options;
}

function qualityLabel(quality: string | undefined, height: number | undefined) {
  const cleanQuality = quality?.trim();
  if (cleanQuality) return cleanQuality;
  if (typeof height === "number" && height > 0) return `${height}p`;
  return "MP4";
}

function qualityScore(
  quality: string | undefined,
  height: number | undefined,
  index: number,
  fps?: number,
) {
  const qualityHeight = quality?.match(/(\d{2,4})\s*p/i)?.[1];
  const fpsBonus = typeof fps === "number" && Number.isFinite(fps) ? fps : 0;
  if (qualityHeight)
    return Number.parseInt(qualityHeight, 10) * 1000 + fpsBonus;
  if (typeof height === "number" && height > 0) return height * 1000 + fpsBonus;
  return 1 - index / 1000;
}

function sourceLooksMuxed(source: VideoDetail["videoSources"][number]) {
  if (source.videoOnly === true) return false;
  if (isManifestPath(source.url)) return false;
  const mimeType = source.mimeType?.toLowerCase() ?? "";
  if (mimeType.startsWith("audio/")) return false;
  if (mimeVideoTypeWithoutAudioCodecs(source.mimeType)) return false;
  return true;
}

function sourceLooksSplitVideo(source: VideoDetail["videoSources"][number]) {
  if (source.videoOnly !== true) return false;
  if (isManifestPath(source.url)) return false;
  const mimeType = source.mimeType?.toLowerCase() ?? "";
  if (mimeType.startsWith("audio/")) return false;
  if (mimeVideoTypeButAudioOnlyCodecs(source.mimeType)) return false;
  return true;
}

function selectAudioSource(audioSources: VideoDetail["audioSources"]) {
  return audioSources
    .filter((source) => source.url && !source.videoOnly)
    .sort((a, b) => audioScore(b) - audioScore(a))[0];
}

function audioScore(source: VideoDetail["audioSources"][number]) {
  const blob = `${source.mimeType ?? ""} ${source.url}`.toLowerCase();
  const codecScore = /mp4a|audio\/mp4/.test(blob)
    ? 100
    : /opus|audio\/webm/.test(blob)
      ? 70
      : 40;
  return codecScore + (source.bitrate ?? 0) / 1_000_000;
}

function codecScore(source: VideoDetail["videoSources"][number]) {
  const blob = `${source.mimeType ?? ""} ${source.url}`.toLowerCase();
  if (/avc1|avc3|h264/.test(blob)) return 100;
  if (/video\/mp4/.test(blob) && !/av01|av1|vp9|webm/.test(blob)) return 80;
  if (/vp9|video\/webm/.test(blob)) return 50;
  if (/av01|av1/.test(blob)) return 10;
  return 40;
}

function isManifestPath(url: string) {
  const normalized = url.toLowerCase();
  return (
    normalized.includes(".m3u8") ||
    normalized.includes(".mpd") ||
    normalized.includes("/manifest/hls/") ||
    normalized.includes("/manifest/dash/")
  );
}

function mimeVideoTypeButAudioOnlyCodecs(mimeType: string | undefined) {
  if (!mimeType?.trim()) return false;
  if (!mimeType.toLowerCase().startsWith("video/")) return false;
  const match = mimeType.match(/codecs\s*=\s*"([^"]+)"/i);
  if (!match?.[1]) return false;
  const codecs = match[1].toLowerCase().replace(/\s/g, "");
  if (/avc1|avc3|av01|vp8|vp9|vp09|hev1|hvc1|dvh1|theora/.test(codecs)) {
    return false;
  }
  return /mp4a|opus|vorbis|flac/.test(codecs);
}

function mimeVideoTypeWithoutAudioCodecs(mimeType: string | undefined) {
  if (!mimeType?.trim()) return false;
  if (!mimeType.toLowerCase().startsWith("video/")) return false;
  const match = mimeType.match(/codecs\s*=\s*"([^"]+)"/i);
  if (!match?.[1]) return false;
  const codecs = match[1].toLowerCase().replace(/\s/g, "");
  const hasVideo = /avc1|avc3|av01|vp8|vp9|vp09|hev1|hvc1|dvh1|theora/.test(
    codecs,
  );
  const hasAudio = /mp4a|opus|vorbis|flac|ac-3|ec-3/.test(codecs);
  return hasVideo && !hasAudio;
}

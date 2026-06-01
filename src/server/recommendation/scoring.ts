import type { UserSignals } from "@/server/recommendation/signals";
import type { TfidfModel } from "@/server/recommendation/tfidf";
import type { UnifiedVideo } from "@/server/services/proxy.types";

/**
 * Scoring weights. Centralized for tuning. `recentChannelBoost` was lowered from
 * 0.22 so that, combined with the title gain below, content relevance is no
 * longer dwarfed by "last channel watched".
 */
const W_TITLE = 0.42;
const W_CHANNEL = 0.14;
const W_POP = 0.08;
const W_FRESH = 0.16;
const W_SHARE = 0.12;
const W_CATALOG = 0.14;
const W_RECENT_CH = 0.14;
/** Subtracted when a candidate title resembles the user's disliked titles. */
const W_DISLIKE = 0.2;
const FORMAT_BIAS_SHORT = -0.055;
const FORMAT_BIAS_LONG = 0.06;

/**
 * Raw TF-IDF cosine of short titles is small (~0.02–0.18), which left the
 * heavily-weighted title term contributing almost nothing. This maps a
 * "clearly on-topic" cosine (~`TAG_REFERENCE`) to the full title weight while
 * keeping noise low. Saturates at 1.
 */
const TAG_REFERENCE = 0.18;
function applyTitleGain(tagCosine: number): number {
  if (tagCosine <= 0) return 0;
  return Math.min(1, tagCosine / TAG_REFERENCE);
}

/** Extra signals computed while building the candidate pool (e.g. per-channel page overlap). */
export type RecommendationScoreContext = {
  /**
   * For each channel, share of that channel's latest returned uploads the user
   * has already watched (0–1). High values mean strong interest in that channel.
   */
  recentCoverageByChannel: Map<string, number>;
};

/** Maps an age in hours to the freshness score buckets (shared by both inputs). */
function freshnessFromAgeHours(approxHours: number): number {
  if (approxHours <= 2) return 1.14;
  if (approxHours <= 12) return 1.06;
  if (approxHours <= 48) return 0.97;
  if (approxHours <= 24 * 7) return 0.86;
  if (approxHours <= 24 * 30) return 0.7;
  if (approxHours <= 24 * 90) return 0.5;
  return 0.34;
}

/**
 * Freshness score. Prefers the numeric `publishedAt` (unix seconds, when the
 * upstream provided it) since it is locale-independent; falls back to parsing
 * the human `publishedText` ("N unit ago") only when the timestamp is absent.
 */
export function publicationFreshnessScore(
  published?: string,
  publishedAt?: number,
): number {
  if (typeof publishedAt === "number" && Number.isFinite(publishedAt)) {
    const nowSec = Math.floor(Date.now() / 1000);
    const approxHours = Math.max(0, (nowSec - publishedAt) / 3600);
    return freshnessFromAgeHours(approxHours);
  }
  if (!published) return 0.32;
  const p = published.toLowerCase().trim();
  if (
    p.includes("just now") ||
    p.includes("moments ago") ||
    p.includes("second ago") ||
    p.includes("seconds ago")
  ) {
    return 1.16;
  }
  const m = p.match(
    /(\d+)\s*(second|minute|hour|day|week|month)s?\s*(ago|before)?/,
  );
  if (m) {
    const n = Math.min(999, Math.max(0, Number.parseInt(m[1]!, 10)));
    const unit = m[2];
    let approxHours = 0;
    if (unit === "second") approxHours = n / 3600;
    else if (unit === "minute") approxHours = n / 60;
    else if (unit === "hour") approxHours = n;
    else if (unit === "day") approxHours = n * 24;
    else if (unit === "week") approxHours = n * 24 * 7;
    else approxHours = n * 24 * 30;
    return freshnessFromAgeHours(approxHours);
  }
  if (p.includes("minute") || p.includes("hour")) return 1.05;
  if (p.includes("day")) return 0.78;
  if (p.includes("week")) return 0.6;
  if (p.includes("month")) return 0.44;
  return 0.3;
}

/** Heuristic short-form / vertical — duration and title markers from upstreams. */
export function isLikelyShortVideo(video: UnifiedVideo): boolean {
  const d = video.durationSeconds;
  if (typeof d === "number" && d > 0 && d <= 60) return true;
  const t = video.title.toLowerCase();
  return t.includes("#shorts");
}

const WATCH_REPEAT_TAU_SEC = 6 * 24 * 3600;

/**
 * Penalty for recommending a video the user already watched; strongest right
 * after the play, then decays (surface again after several days).
 */
export function watchedRepeatPenalty(
  videoId: string,
  lastSeenByVideo: Map<string, number>,
  nowSec: number,
): number {
  const last = lastSeenByVideo.get(videoId);
  if (last === undefined) return 0;
  const ageSec = Math.max(0, nowSec - last);
  const maxPen = 0.92;
  return maxPen * Math.exp(-ageSec / WATCH_REPEAT_TAU_SEC);
}

/**
 * Drops obvious junk from the trending-heavy pool when we have enough history:
 * keep items that match topics you watch, channels you watch, or channels
 * present in your recent watch window or from like/save interactions (caller
 * should pass the merged channel-id set).
 */
export function keepCandidateForPersonalizedFeed(
  video: UnifiedVideo,
  signals: UserSignals,
  tasteModel: TfidfModel,
  interestChannelIds: ReadonlySet<string>,
): boolean {
  if (signals.totalWatches < 14) return true;
  const maxCh = Math.max(1, ...signals.channelWeights.values());
  const ch = video.channelId
    ? (signals.channelWeights.get(video.channelId) ?? 0) / maxCh
    : 0;
  const tag = tasteModel.similarity(video.title);
  if (video.channelId && interestChannelIds.has(video.channelId)) {
    return true;
  }
  /** Stronger gate as history grows — pure regional trending with no topic/channel match drops out. */
  if (signals.totalWatches >= 22) {
    return tag >= 0.062 || ch >= 0.042;
  }
  if (signals.totalWatches >= 16) {
    return tag >= 0.048 || ch >= 0.034;
  }
  return tag >= 0.04 || ch >= 0.03;
}

/** Gate regional shorts_discovery rows — always on for discovery source, softer when history is thin. */
export function keepShortsDiscoveryCandidate(
  video: UnifiedVideo,
  signals: UserSignals,
  tasteModel: TfidfModel,
  interestChannelIds: ReadonlySet<string>,
): boolean {
  if (video.channelId && interestChannelIds.has(video.channelId)) {
    return true;
  }
  const tag = tasteModel.similarity(video.title);
  if (signals.totalWatches < 14) {
    return (
      tag >= 0.028 ||
      (video.channelId != null && signals.channelWeights.has(video.channelId))
    );
  }
  return keepCandidateForPersonalizedFeed(
    video,
    signals,
    tasteModel,
    interestChannelIds,
  );
}

/** Down-rank generic regional discovery that does not match taste. */
export function shortsDiscoveryScorePenalty(
  video: UnifiedVideo,
  signals: UserSignals,
  tasteModel: TfidfModel,
  candidateSource: string | undefined,
  interestChannelIds: ReadonlySet<string>,
): number {
  if (candidateSource !== "shorts_discovery") return 0;
  if (video.channelId && interestChannelIds.has(video.channelId)) return 0;
  const tag = tasteModel.similarity(video.title);
  if (tag >= 0.05) return 0;
  const ch = video.channelId
    ? (signals.channelWeights.get(video.channelId) ?? 0) /
      Math.max(1, ...signals.channelWeights.values())
    : 0;
  if (ch >= 0.04) return 0;
  return 0.35;
}

/** Weighted pieces of `scoreCandidate`; they sum to the base score (within float noise). */
export type RecommendationScoreBreakdown = {
  components: {
    titleSimilarity: number;
    channelAffinity: number;
    popularity: number;
    freshness: number;
    /** Negative contribution (re-watch penalty). */
    repeatPenalty: number;
    /** Negative contribution (title resembles disliked titles). */
    dislikePenalty: number;
    formatBias: number;
    explore: number;
    shareFromChannel: number;
    catalogCoverage: number;
    recentChannelBoost: number;
  };
  inputs: {
    /** Raw TF-IDF cosine before the title gain is applied. */
    titleSimilarity: number;
    channelAffinityNorm: number;
    popularityNorm: number;
    publicationFreshness: number;
    repeatPenaltyRaw: number;
    dislikeSimilarityRaw: number;
    isShort: boolean;
    exploreRaw: number;
    distinctVideosOnChannel: number;
    distinctShareFromChannel: number;
    recentPageCoverageOnChannel: number;
    recentChannelBoostRaw: number;
  };
};

export type RecommendationScoreDetail = {
  score: number;
  breakdown: RecommendationScoreBreakdown;
};

/**
 * Same hybrid score as `scoreCandidate`, plus per-term breakdown for logging / analysis.
 */
export function scoreCandidateDetail(
  video: UnifiedVideo,
  signals: UserSignals,
  tasteModel: TfidfModel,
  maxChannelCount: number,
  scoreContext?: RecommendationScoreContext,
  dislikeModel?: TfidfModel,
): RecommendationScoreDetail {
  const ctx = scoreContext ?? { recentCoverageByChannel: new Map() };
  const nowSec = Math.floor(Date.now() / 1000);
  const ch = video.channelId
    ? (signals.channelWeights.get(video.channelId) ?? 0) / maxChannelCount
    : 0;
  const views = video.viewCount ?? 0;
  const pop = Math.min(1, Math.log10(1 + views) / 7);
  const fresh = publicationFreshnessScore(
    video.publishedText,
    video.publishedAt,
  );
  const tagRaw = tasteModel.similarity(video.title);
  const tag = applyTitleGain(tagRaw);
  const dislikeSim = dislikeModel ? dislikeModel.similarity(video.title) : 0;
  const watchedPen = watchedRepeatPenalty(
    video.videoId,
    signals.watchedVideoLastSeen,
    nowSec,
  );
  const short = isLikelyShortVideo(video);
  const formatBias = short ? FORMAT_BIAS_SHORT : FORMAT_BIAS_LONG;
  const explore =
    signals.totalWatches >= 16 ? Math.random() * 0.04 : Math.random() * 0.1;
  const distinctFromCh =
    video.channelId != null
      ? (signals.distinctWatchesByChannel.get(video.channelId) ?? 0)
      : 0;
  const shareFromChannel =
    signals.totalDistinctVideosWatched > 0
      ? distinctFromCh / signals.totalDistinctVideosWatched
      : 0;
  const catalogCoverage = video.channelId
    ? (ctx.recentCoverageByChannel.get(video.channelId) ?? 0)
    : 0;
  const lastWatchOnChannel =
    video.channelId != null
      ? (signals.channelLastWatchedAt.get(video.channelId) ?? 0)
      : 0;
  const recentChannelBoostRaw =
    lastWatchOnChannel > 0
      ? Math.exp(-(nowSec - lastWatchOnChannel) / (5 * 24 * 3600))
      : 0;
  const wTitle = W_TITLE * tag;
  const wChannel = W_CHANNEL * ch;
  const wPop = W_POP * pop;
  const wFresh = W_FRESH * fresh;
  const wRepeat = -watchedPen;
  const wDislike = -W_DISLIKE * dislikeSim;
  const wShare = W_SHARE * Math.min(1, shareFromChannel);
  const wCatalog = W_CATALOG * Math.min(1, catalogCoverage);
  const wRecentCh = W_RECENT_CH * recentChannelBoostRaw;
  const score =
    wTitle +
    wChannel +
    wPop +
    wFresh +
    wRepeat +
    wDislike +
    formatBias +
    explore +
    wShare +
    wCatalog +
    wRecentCh;
  return {
    score,
    breakdown: {
      components: {
        titleSimilarity: wTitle,
        channelAffinity: wChannel,
        popularity: wPop,
        freshness: wFresh,
        repeatPenalty: wRepeat,
        dislikePenalty: wDislike,
        formatBias,
        explore,
        shareFromChannel: wShare,
        catalogCoverage: wCatalog,
        recentChannelBoost: wRecentCh,
      },
      inputs: {
        titleSimilarity: tagRaw,
        channelAffinityNorm: ch,
        popularityNorm: pop,
        publicationFreshness: fresh,
        repeatPenaltyRaw: watchedPen,
        dislikeSimilarityRaw: dislikeSim,
        isShort: short,
        exploreRaw: explore,
        distinctVideosOnChannel: distinctFromCh,
        distinctShareFromChannel: shareFromChannel,
        recentPageCoverageOnChannel: catalogCoverage,
        recentChannelBoostRaw,
      },
    },
  };
}

/**
 * Hybrid score (content-based, no collaborative filtering).
 * Weights loosely follow base.md; category signal is folded into channel affinity.
 */
export function scoreCandidate(
  video: UnifiedVideo,
  signals: UserSignals,
  tasteModel: TfidfModel,
  maxChannelCount: number,
  scoreContext?: RecommendationScoreContext,
  dislikeModel?: TfidfModel,
): number {
  return scoreCandidateDetail(
    video,
    signals,
    tasteModel,
    maxChannelCount,
    scoreContext,
    dislikeModel,
  ).score;
}

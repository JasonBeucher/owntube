import { and, desc, eq } from "drizzle-orm";
import { logger } from "@/lib/logger";
import type { AppDb } from "@/server/db/client";
import { subscriptions, watchHistory } from "@/server/db/schema";
import { useColdStartBlend } from "@/server/recommendation/coldstart";
import {
  appendRecommendationDebugLog,
  recommendationDebugEnabled,
  recommendationDebugLogFilePath,
} from "@/server/recommendation/debug-file-log";
import { maximalMarginalRelevance } from "@/server/recommendation/diversity";
import {
  keepCandidateForPersonalizedFeed,
  type RecommendationScoreContext,
  scoreCandidateDetail,
} from "@/server/recommendation/scoring";
import { collectUserSignals } from "@/server/recommendation/signals";
import type { ScoredVideo } from "@/server/recommendation/types";
import {
  fetchChannelPage,
  fetchTrendingVideos,
  type ProxySourceOverrides,
} from "@/server/services/proxy";
import type { UnifiedVideo } from "@/server/services/proxy.types";

export type RecommendationResult = {
  videos: UnifiedVideo[];
  coldStart: boolean;
  hasMore: boolean;
};

const MIN_WATCH_ROWS_FOR_HISTORY_POOL = 3;
const MAX_HISTORY_CHANNEL_FETCHES = 32;
const VIDEOS_PER_HISTORY_CHANNEL = 12;
/** If the history-only pool is smaller than this (after dedupe), blend trending in. */
const MIN_UNIQUE_CANDIDATES_HISTORY_ONLY = 14;

type TaggedVideo = { video: UnifiedVideo; source: string };
type RecommendationPoolCacheEntry = {
  expiresAt: number;
  coldStart: boolean;
  diversified: ScoredVideo[];
};

const RECOMMENDATION_POOL_CACHE_TTL_MS = 90_000;
const CHANNEL_FETCH_CONCURRENCY = 6;
const recommendationPoolCache = new Map<string, RecommendationPoolCacheEntry>();
const recommendationPoolInFlight = new Map<
  string,
  Promise<RecommendationPoolCacheEntry>
>();

function deterministicUnitInterval(seed: string): number {
  // FNV-1a 32-bit hash for stable pseudo-random ordering.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Convert to [0, 1).
  return (h >>> 0) / 0x1_0000_0000;
}

function deterministicColdStartJitter(userId: number, videoId: string): number {
  const u = deterministicUnitInterval(`${userId}:${videoId}`);
  return (u - 0.5) * 0.08;
}

function recommendationPoolCacheKey(
  userId: number,
  opts: {
    pageSize: number;
    region?: string;
    overrides?: ProxySourceOverrides;
  },
): string {
  const region = opts.region ?? "US";
  const piped = opts.overrides?.pipedBaseUrl?.trim() ?? "";
  const invidious = opts.overrides?.invidiousBaseUrl?.trim() ?? "";
  return `${userId}|${region}|${opts.pageSize}|${piped}|${invidious}`;
}

function sliceRecommendationPool(
  entry: RecommendationPoolCacheEntry,
  page: number,
  pageSize: number,
): RecommendationResult {
  const start = (page - 1) * pageSize;
  const pageRows = entry.diversified.slice(start, start + pageSize);
  const hasMore = start + pageRows.length < entry.diversified.length;
  const videos: UnifiedVideo[] = pageRows.map((row) => {
    const {
      rawScore: _r,
      preMmrRawScore: _p,
      scoreBreakdown: _b,
      candidateSource: _c,
      coldStartJitter: _j,
      ...video
    } = row;
    return video;
  });
  return {
    videos,
    coldStart: entry.coldStart,
    hasMore,
  };
}

function clipTitle(title: string, max = 80): string {
  const t = title.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export async function getRecommendations(
  db: AppDb,
  userId: number,
  opts: {
    page: number;
    pageSize: number;
    region?: string;
    overrides?: ProxySourceOverrides;
  },
): Promise<RecommendationResult> {
  const cacheKey = recommendationPoolCacheKey(userId, opts);
  const now = Date.now();
  const cached = recommendationPoolCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return sliceRecommendationPool(cached, opts.page, opts.pageSize);
  }

  const inFlight = recommendationPoolInFlight.get(cacheKey);
  if (inFlight) {
    const pool = await inFlight;
    if (pool.expiresAt > Date.now()) {
      return sliceRecommendationPool(pool, opts.page, opts.pageSize);
    }
  }

  const task = (async (): Promise<RecommendationPoolCacheEntry> => {
  const watchedRows = db
    .select({ videoId: watchHistory.videoId })
    .from(watchHistory)
    .where(and(eq(watchHistory.userId, userId), eq(watchHistory.isDeleted, 0)))
    .limit(10_000)
    .all();
  const watchedEver = new Set(watchedRows.map((r) => r.videoId));

  const signals = collectUserSignals(db, userId);
  const region = opts.region ?? "US";
  const coldStart = useColdStartBlend(signals.totalWatches);

  const taggedCandidates: TaggedVideo[] = [];
  const recentCoverageByChannel = new Map<string, number>();

  const canBuildFromHistory =
    signals.totalWatches >= MIN_WATCH_ROWS_FOR_HISTORY_POOL &&
    signals.channelsOrderedByRecentWatch.length > 0;

  if (canBuildFromHistory) {
    const historyChannels = signals.channelsOrderedByRecentWatch.slice(
      0,
      MAX_HISTORY_CHANNEL_FETCHES,
    );
    for (let i = 0; i < historyChannels.length; i += CHANNEL_FETCH_CONCURRENCY) {
      const batch = historyChannels.slice(i, i + CHANNEL_FETCH_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (channelId) => {
          const ch = await fetchChannelPage(db, { channelId }, opts.overrides);
          return {
            channelId,
            page: ch.videos.slice(0, VIDEOS_PER_HISTORY_CHANNEL),
          };
        }),
      );
      for (const item of settled) {
        if (item.status !== "fulfilled") continue;
        const { channelId, page } = item.value;
        for (const v of page) {
          taggedCandidates.push({
            video: v,
            source: `history_channel:${channelId}`,
          });
        }
        const pageIds = page
          .map((v) => v.videoId)
          .filter((id) => id.length > 0);
        if (pageIds.length > 0) {
          let hit = 0;
          for (const id of pageIds) {
            if (signals.watchedVideoIds.has(id)) hit += 1;
          }
          recentCoverageByChannel.set(channelId, hit / pageIds.length);
        }
      }
    }
  }

  const dedupePreview = new Map<string, UnifiedVideo>();
  for (const { video: v } of taggedCandidates) {
    if (!dedupePreview.has(v.videoId)) dedupePreview.set(v.videoId, v);
  }
  const historyOnlyUnique = dedupePreview.size;

  const needTrendingBlend =
    coldStart ||
    !canBuildFromHistory ||
    historyOnlyUnique < MIN_UNIQUE_CANDIDATES_HISTORY_ONLY;

  if (needTrendingBlend) {
    const trending = await fetchTrendingVideos(
      db,
      { region, limit: 45 },
      opts.overrides,
    );
    for (const v of trending.videos) {
      taggedCandidates.push({ video: v, source: "trending" });
    }
  }

  if (coldStart || !canBuildFromHistory) {
    const subs = db
      .select({
        channelId: subscriptions.channelId,
        subscribedAt: subscriptions.subscribedAt,
      })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .orderBy(desc(subscriptions.subscribedAt))
      .limit(80)
      .all();

    const sortedSubs = [...subs].sort((a, b) => {
      const wa = signals.channelWeights.get(a.channelId) ?? 0;
      const wb = signals.channelWeights.get(b.channelId) ?? 0;
      if (wb !== wa) return wb - wa;
      return b.subscribedAt - a.subscribedAt;
    });

    const subsWithWatchActivity = sortedSubs.filter((s) => {
      const w = signals.channelWeights.get(s.channelId) ?? 0;
      const d = signals.distinctWatchesByChannel.get(s.channelId) ?? 0;
      return w > 0 || d > 0;
    });

    const maxChannelFetches = 24;
    const channels = subsWithWatchActivity.slice(0, maxChannelFetches);
    for (let i = 0; i < channels.length; i += CHANNEL_FETCH_CONCURRENCY) {
      const batch = channels.slice(i, i + CHANNEL_FETCH_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (s) => {
          const ch = await fetchChannelPage(
            db,
            { channelId: s.channelId },
            opts.overrides,
          );
          return { channelId: s.channelId, page: ch.videos.slice(0, 10) };
        }),
      );
      for (const item of settled) {
        if (item.status !== "fulfilled") continue;
        const { channelId, page } = item.value;
        for (const v of page) {
          taggedCandidates.push({
            video: v,
            source: `subscription:${channelId}`,
          });
        }
        const pageIds = page
          .map((v) => v.videoId)
          .filter((id) => id.length > 0);
        if (pageIds.length > 0) {
          let hit = 0;
          for (const id of pageIds) {
            if (signals.watchedVideoIds.has(id)) hit += 1;
          }
          recentCoverageByChannel.set(channelId, hit / pageIds.length);
        }
      }
    }
  }

  const scoreContext: RecommendationScoreContext = {
    recentCoverageByChannel,
  };

  const byId = new Map<string, UnifiedVideo>();
  const sourceByVideoId = new Map<string, string>();
  for (const { video: v, source } of taggedCandidates) {
    if (!byId.has(v.videoId)) {
      byId.set(v.videoId, v);
      sourceByVideoId.set(v.videoId, source);
    }
  }
  const unique = [...byId.values()].filter((v) => !watchedEver.has(v.videoId));
  const corpusTitles = unique.map((v) => v.title).slice(0, 200);
  const maxCh = Math.max(1, ...signals.channelWeights.values());

  let scored: ScoredVideo[] = unique.map((v) => {
    const detail = scoreCandidateDetail(
      v,
      signals,
      corpusTitles,
      maxCh,
      scoreContext,
    );
    return {
      ...v,
      rawScore: detail.score,
      scoreBreakdown: detail.breakdown,
      candidateSource: sourceByVideoId.get(v.videoId),
    };
  });

  if (coldStart) {
    scored = scored
      .map((s) => {
        const jitter = deterministicColdStartJitter(userId, s.videoId);
        return {
          ...s,
          rawScore: s.rawScore + jitter,
          coldStartJitter: jitter,
        };
      })
      .sort((a, b) => b.rawScore - a.rawScore);
  } else {
    scored.sort((a, b) => b.rawScore - a.rawScore);
  }

  if (!coldStart) {
    const filtered = scored.filter((row) =>
      keepCandidateForPersonalizedFeed(
        row,
        signals,
        corpusTitles,
        signals.historyChannelIds,
      ),
    );
    if (filtered.length >= Math.max(opts.pageSize * 2, 16)) {
      scored = filtered;
    }
  }

  const poolSize = Math.min(240, scored.length);
  const diversified = maximalMarginalRelevance(
    scored.slice(0, poolSize),
    poolSize,
  );
  const start = (opts.page - 1) * opts.pageSize;
  const pageRows = diversified.slice(start, start + opts.pageSize);

  if (recommendationDebugEnabled()) {
    const interest = signals.historyChannelIds;
    const items = pageRows.map((row, i) => {
      const passedTopicGate =
        coldStart ||
        keepCandidateForPersonalizedFeed(row, signals, corpusTitles, interest);
      return {
        feedRank: start + i,
        mmrPoolIndex: diversified.indexOf(row),
        videoId: row.videoId,
        title: clipTitle(row.title),
        channelId: row.channelId ?? null,
        candidateSource: row.candidateSource ?? null,
        rankScore: row.preMmrRawScore ?? row.rawScore,
        mmrNormalizedRelevance: row.rawScore,
        coldStartJitter: row.coldStartJitter ?? 0,
        passedTopicGate,
        score: row.scoreBreakdown?.components ?? null,
        inputs: row.scoreBreakdown?.inputs ?? null,
      };
    });
    const payload = {
      msg: "recommendation.debug_page",
      userId,
      page: opts.page,
      pageSize: opts.pageSize,
      region,
      coldStart,
      needTrendingBlend,
      canBuildFromHistory,
      historyOnlyUnique,
      poolSize,
      totalCandidatesUnique: unique.length,
      totalWatches: signals.totalWatches,
      logFile: recommendationDebugLogFilePath(),
      items,
    };
    logger.info("recommendation.debug_page", payload);
    await appendRecommendationDebugLog(payload);
  }

  return {
    expiresAt: Date.now() + RECOMMENDATION_POOL_CACHE_TTL_MS,
    diversified,
    coldStart,
  };
  })();
  recommendationPoolInFlight.set(cacheKey, task);
  try {
    const pool = await task;
    recommendationPoolCache.set(cacheKey, pool);
    return sliceRecommendationPool(pool, opts.page, opts.pageSize);
  } finally {
    recommendationPoolInFlight.delete(cacheKey);
  }
}

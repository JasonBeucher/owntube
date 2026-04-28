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
    for (const channelId of signals.channelsOrderedByRecentWatch.slice(
      0,
      MAX_HISTORY_CHANNEL_FETCHES,
    )) {
      try {
        const ch = await fetchChannelPage(db, { channelId }, opts.overrides);
        const page = ch.videos.slice(0, VIDEOS_PER_HISTORY_CHANNEL);
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
      } catch {
        // Channel fetch failed; continue.
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
    for (const s of subsWithWatchActivity.slice(0, maxChannelFetches)) {
      try {
        const ch = await fetchChannelPage(
          db,
          { channelId: s.channelId },
          opts.overrides,
        );
        const page = ch.videos.slice(0, 10);
        for (const v of page) {
          taggedCandidates.push({
            video: v,
            source: `subscription:${s.channelId}`,
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
          recentCoverageByChannel.set(s.channelId, hit / pageIds.length);
        }
      } catch {
        // Channel fetch failed; continue.
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
        const jitter = (Math.random() - 0.5) * 0.08;
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
  const hasMore = start + pageRows.length < diversified.length;
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
    videos,
    coldStart,
    hasMore,
  };
}

import { desc, eq } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { subscriptions } from "@/server/db/schema";
import { useColdStartBlend } from "@/server/recommendation/coldstart";
import type { UserSignals } from "@/server/recommendation/signals";
import {
  fetchChannelPage,
  fetchTrendingVideos,
  type ProxySourceOverrides,
} from "@/server/services/proxy";
import type { UnifiedVideo } from "@/server/services/proxy.types";

const MIN_WATCH_ROWS_FOR_HISTORY_POOL = 3;
const MAX_HISTORY_CHANNEL_FETCHES = 32;
const VIDEOS_PER_HISTORY_CHANNEL = 12;
const MIN_UNIQUE_CANDIDATES_HISTORY_ONLY = 14;
const CHANNEL_FETCH_CONCURRENCY = 6;

export type TaggedVideoCandidate = { video: UnifiedVideo; source: string };

function withChannelAvatarFallback(
  video: UnifiedVideo,
  channelAvatarUrl: string | undefined,
): UnifiedVideo {
  if (video.channelAvatarUrl || !channelAvatarUrl) return video;
  return { ...video, channelAvatarUrl };
}

/**
 * Fetches recent uploads from history channels, subscriptions (cold start), and
 * blends regional trending — same sources as the home recommendation pool.
 */
export async function collectTaggedVideoCandidates(
  db: AppDb,
  userId: number,
  args: {
    region: string;
    overrides?: ProxySourceOverrides;
    signals: UserSignals;
  },
): Promise<{
  tagged: TaggedVideoCandidate[];
  recentCoverageByChannel: Map<string, number>;
  coldStart: boolean;
  needTrendingBlend: boolean;
  canBuildFromHistory: boolean;
  historyOnlyUnique: number;
  trendingWarning?: string;
}> {
  const { region, overrides, signals } = args;
  const coldStart = useColdStartBlend(signals.totalWatches);
  const taggedCandidates: TaggedVideoCandidate[] = [];
  const recentCoverageByChannel = new Map<string, number>();

  const canBuildFromHistory =
    signals.totalWatches >= MIN_WATCH_ROWS_FOR_HISTORY_POOL &&
    signals.channelsOrderedByRecentWatch.length > 0;

  if (canBuildFromHistory) {
    const historyChannels = signals.channelsOrderedByRecentWatch.slice(
      0,
      MAX_HISTORY_CHANNEL_FETCHES,
    );
    for (
      let i = 0;
      i < historyChannels.length;
      i += CHANNEL_FETCH_CONCURRENCY
    ) {
      const batch = historyChannels.slice(i, i + CHANNEL_FETCH_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (channelId) => {
          const ch = await fetchChannelPage(db, { channelId }, overrides);
          return {
            channelId,
            channelAvatarUrl: ch.avatarUrl ?? undefined,
            page: ch.videos.slice(0, VIDEOS_PER_HISTORY_CHANNEL),
          };
        }),
      );
      for (const item of settled) {
        if (item.status !== "fulfilled") continue;
        const { channelId, channelAvatarUrl, page } = item.value;
        for (const v of page) {
          taggedCandidates.push({
            video: withChannelAvatarFallback(v, channelAvatarUrl),
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

  let trendingWarning: string | undefined;
  if (needTrendingBlend) {
    const trending = await fetchTrendingVideos(
      db,
      { region, limit: 45 },
      overrides,
    );
    trendingWarning = trending.warning;
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
            overrides,
          );
          return {
            channelId: s.channelId,
            channelAvatarUrl: ch.avatarUrl ?? undefined,
            page: ch.videos.slice(0, 10),
          };
        }),
      );
      for (const item of settled) {
        if (item.status !== "fulfilled") continue;
        const { channelId, channelAvatarUrl, page } = item.value;
        for (const v of page) {
          taggedCandidates.push({
            video: withChannelAvatarFallback(v, channelAvatarUrl),
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

  return {
    tagged: taggedCandidates,
    recentCoverageByChannel,
    coldStart,
    needTrendingBlend,
    canBuildFromHistory,
    historyOnlyUnique,
    trendingWarning,
  };
}

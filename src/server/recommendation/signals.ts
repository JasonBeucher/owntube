import { and, desc, eq, gt } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { interactions, watchHistory } from "@/server/db/schema";

export type UserSignals = {
  channelWeights: Map<string, number>;
  totalWatches: number;
  watchedVideoIds: Set<string>;
  /** Latest `started_at` per video (unix seconds), for decaying repeat penalties. */
  watchedVideoLastSeen: Map<string, number>;
  /** Distinct videos watched per channel (same 90d window as `channelWeights`). */
  distinctWatchesByChannel: Map<string, number>;
  /** Distinct `video_id` count in that window (one video belongs to one channel). */
  totalDistinctVideosWatched: number;
  /** Max `started_at` (unix s) per channel in the window — for recency-biased scoring. */
  channelLastWatchedAt: Map<string, number>;
  /** Channel ids from history, ordered by most recent watch on that channel (desc). */
  channelsOrderedByRecentWatch: string[];
  /** All channel ids that appear in the watch window (for filters / bypass). */
  historyChannelIds: Set<string>;
  /** Videos the user liked (excluding those also disliked). */
  likedVideoIds: Set<string>;
  /** Videos the user disliked — excluded from recommendations. */
  dislikedVideoIds: Set<string>;
  /** Saved videos (excluding disliked), for taste corpus / affinity. */
  savedVideoIds: Set<string>;
  /**
   * Channels from like/save interactions (with `channel_id` set), for topic gate
   * and channel affinity (also folded into `channelWeights`).
   */
  interactionInterestChannelIds: Set<string>;
};

const WINDOW_SEC = 90 * 24 * 3600;
/** Recent plays weigh more: `exp(-age / tau)` is near 1 right after a watch, then decays. */
const CHANNEL_RECENCY_TAU_SEC = 6 * 24 * 3600;

/** Likes/saves boost channel affinity with a slower decay than single watches. */
const INTERACTION_CHANNEL_TAU_SEC = 45 * 24 * 3600;
const LIKE_CHANNEL_WEIGHT = 0.52;
const SAVE_CHANNEL_WEIGHT = 0.34;

export function collectUserSignals(db: AppDb, userId: number): UserSignals {
  const nowSec = Math.floor(Date.now() / 1000);
  const since = nowSec - WINDOW_SEC;
  const rows = db
    .select({
      videoId: watchHistory.videoId,
      channelId: watchHistory.channelId,
      startedAt: watchHistory.startedAt,
    })
    .from(watchHistory)
    .where(
      and(
        eq(watchHistory.userId, userId),
        eq(watchHistory.isDeleted, 0),
        gt(watchHistory.startedAt, since),
      ),
    )
    .orderBy(desc(watchHistory.startedAt))
    .limit(300)
    .all();

  const channelWeights = new Map<string, number>();
  const channelLastWatchedAt = new Map<string, number>();
  const watchedVideoIds = new Set<string>();
  const watchedVideoLastSeen = new Map<string, number>();
  const distinctSetsByChannel = new Map<string, Set<string>>();
  for (const r of rows) {
    watchedVideoIds.add(r.videoId);
    const ageSec = Math.max(0, nowSec - r.startedAt);
    const channelContrib = Math.exp(-ageSec / CHANNEL_RECENCY_TAU_SEC);
    channelWeights.set(
      r.channelId,
      (channelWeights.get(r.channelId) ?? 0) + channelContrib,
    );
    const prevLw = channelLastWatchedAt.get(r.channelId) ?? 0;
    channelLastWatchedAt.set(r.channelId, Math.max(prevLw, r.startedAt));
    const prev = watchedVideoLastSeen.get(r.videoId) ?? 0;
    watchedVideoLastSeen.set(r.videoId, Math.max(prev, r.startedAt));
    let set = distinctSetsByChannel.get(r.channelId);
    if (!set) {
      set = new Set();
      distinctSetsByChannel.set(r.channelId, set);
    }
    set.add(r.videoId);
  }

  const distinctWatchesByChannel = new Map<string, number>();
  for (const [ch, ids] of distinctSetsByChannel) {
    distinctWatchesByChannel.set(ch, ids.size);
  }

  const historyChannelIds = new Set(channelLastWatchedAt.keys());

  const likedVideoIds = new Set<string>();
  const dislikedVideoIds = new Set<string>();
  const savedVideoIds = new Set<string>();
  const interactionInterestChannelIds = new Set<string>();

  const interactionRows = db
    .select({
      videoId: interactions.videoId,
      channelId: interactions.channelId,
      type: interactions.type,
      createdAt: interactions.createdAt,
    })
    .from(interactions)
    .where(eq(interactions.userId, userId))
    .orderBy(desc(interactions.createdAt))
    .limit(4000)
    .all();

  for (const r of interactionRows) {
    if (r.type === "dislike") {
      dislikedVideoIds.add(r.videoId);
    }
  }

  for (const r of interactionRows) {
    if (r.type === "like") {
      if (!dislikedVideoIds.has(r.videoId)) likedVideoIds.add(r.videoId);
    } else if (r.type === "save") {
      if (!dislikedVideoIds.has(r.videoId)) savedVideoIds.add(r.videoId);
    }
  }

  for (const r of interactionRows) {
    if (r.type !== "like" && r.type !== "save") continue;
    if (!r.channelId || dislikedVideoIds.has(r.videoId)) continue;
    interactionInterestChannelIds.add(r.channelId);
    const ageSec = Math.max(0, nowSec - r.createdAt);
    const base = r.type === "like" ? LIKE_CHANNEL_WEIGHT : SAVE_CHANNEL_WEIGHT;
    const contrib = base * Math.exp(-ageSec / INTERACTION_CHANNEL_TAU_SEC);
    channelWeights.set(
      r.channelId,
      (channelWeights.get(r.channelId) ?? 0) + contrib,
    );
    const prevLw = channelLastWatchedAt.get(r.channelId) ?? 0;
    channelLastWatchedAt.set(r.channelId, Math.max(prevLw, r.createdAt));
  }

  const channelsOrderedByRecentWatch = [...channelLastWatchedAt.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  return {
    channelWeights,
    totalWatches: rows.length,
    watchedVideoIds,
    watchedVideoLastSeen,
    distinctWatchesByChannel,
    totalDistinctVideosWatched: watchedVideoIds.size,
    channelLastWatchedAt,
    channelsOrderedByRecentWatch,
    historyChannelIds,
    likedVideoIds,
    dislikedVideoIds,
    savedVideoIds,
    interactionInterestChannelIds,
  };
}

import { and, desc, eq, gt } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { watchHistory } from "@/server/db/schema";

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
};

const WINDOW_SEC = 90 * 24 * 3600;
/** Recent plays weigh more: `exp(-age / tau)` is near 1 right after a watch, then decays. */
const CHANNEL_RECENCY_TAU_SEC = 6 * 24 * 3600;

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

  const channelsOrderedByRecentWatch = [...channelLastWatchedAt.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  const historyChannelIds = new Set(channelLastWatchedAt.keys());

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
  };
}

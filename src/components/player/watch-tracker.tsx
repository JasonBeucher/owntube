"use client";

import { useEffect, useRef } from "react";
import { trpc } from "@/trpc/react";

type WatchTrackerProps = {
  videoId: string;
  channelId?: string;
  durationSeconds?: number;
  /** Use session elapsed time instead of VOD duration (live streams). */
  isLive?: boolean;
  /** Recorded from the Shorts feed — excluded from the long-form recommendation signal. */
  isShort?: boolean;
  /** Called after the final watch event is persisted (e.g. leave slide / unmount). */
  onWatched?: (videoId: string) => void;
};

export function WatchTracker({
  videoId,
  channelId = "unknown",
  durationSeconds = 0,
  isLive = false,
  isShort = false,
  onWatched,
}: WatchTrackerProps) {
  const { mutate } = trpc.history.upsertEvent.useMutation();
  /** tRPC’s mutation return object is not referentially stable; do not list it in effect deps. */
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;
  const onWatchedRef = useRef(onWatched);
  onWatchedRef.current = onWatched;
  const sessionStartRef = useRef(Date.now());

  useEffect(() => {
    sessionStartRef.current = Date.now();
    const m = mutateRef.current;
    const watchedSeconds = () => {
      if (isLive) {
        return Math.max(
          0,
          Math.floor((Date.now() - sessionStartRef.current) / 1000),
        );
      }
      return durationSeconds;
    };
    const partialWatched = () => {
      if (isLive) {
        return Math.max(10, watchedSeconds());
      }
      return Math.max(10, Math.floor(durationSeconds / 4));
    };

    m({
      videoId,
      channelId,
      durationWatched: 0,
      completed: false,
      isShort,
    });
    const interval = window.setInterval(() => {
      m({
        videoId,
        channelId,
        durationWatched: partialWatched(),
        completed: false,
        isShort,
      });
    }, 20_000);
    return () => {
      window.clearInterval(interval);
      m(
        {
          videoId,
          channelId,
          durationWatched: watchedSeconds(),
          completed: true,
          isShort,
        },
        {
          onSuccess: () => onWatchedRef.current?.(videoId),
        },
      );
    };
  }, [channelId, durationSeconds, isLive, isShort, videoId]);

  return null;
}

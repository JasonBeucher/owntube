"use client";

import { useEffect, useRef } from "react";
import { trpc } from "@/trpc/react";

type WatchTrackerProps = {
  videoId: string;
  channelId?: string;
  durationSeconds?: number;
  /** Called after the final watch event is persisted (e.g. leave slide / unmount). */
  onWatched?: (videoId: string) => void;
};

export function WatchTracker({
  videoId,
  channelId = "unknown",
  durationSeconds = 0,
  onWatched,
}: WatchTrackerProps) {
  const { mutate } = trpc.history.upsertEvent.useMutation();
  /** tRPC’s mutation return object is not referentially stable; do not list it in effect deps. */
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;
  const onWatchedRef = useRef(onWatched);
  onWatchedRef.current = onWatched;

  useEffect(() => {
    const m = mutateRef.current;
    m({
      videoId,
      channelId,
      durationWatched: 0,
      completed: false,
    });
    const interval = window.setInterval(() => {
      m({
        videoId,
        channelId,
        durationWatched: Math.max(10, Math.floor(durationSeconds / 4)),
        completed: false,
      });
    }, 20_000);
    return () => {
      window.clearInterval(interval);
      m(
        {
          videoId,
          channelId,
          durationWatched: durationSeconds,
          completed: true,
        },
        {
          onSuccess: () => onWatchedRef.current?.(videoId),
        },
      );
    };
  }, [channelId, durationSeconds, videoId]);

  return null;
}

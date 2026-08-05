import type { UnifiedVideo } from "@web/server/services/proxy.types";
import { useEffect, useRef, useState } from "react";
import { trpcClient } from "@/lib/trpc";

export type ResumeEntry = {
  positionSeconds: number;
  videoDurationSeconds: number;
  completed: boolean;
};

export type ResumeMap = ReadonlyMap<string, ResumeEntry>;

/** `history.resumePositions` caps the batch; stay under it. */
const MAX_IDS_PER_REQUEST = 200;

/**
 * Resume offsets for the videos currently on screen, so cards can draw a
 * progress bar. Only ever asks for ids it hasn't seen yet — feeds append pages
 * as the user scrolls, and re-querying the whole accumulated list every time
 * would hammer the server for rows it already has.
 */
export function useResumeProgress(videos: UnifiedVideo[]): ResumeMap {
  const [progress, setProgress] = useState<ReadonlyMap<string, ResumeEntry>>(
    new Map(),
  );
  const requestedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const pending: string[] = [];
    for (const video of videos) {
      if (requestedRef.current.has(video.videoId)) continue;
      requestedRef.current.add(video.videoId);
      pending.push(video.videoId);
      if (pending.length >= MAX_IDS_PER_REQUEST) break;
    }
    if (pending.length === 0) return;

    let cancelled = false;
    trpcClient.history.resumePositions
      .query({ videoIds: pending })
      .then((rows) => {
        if (cancelled || rows.length === 0) return;
        setProgress((previous) => {
          const next = new Map(previous);
          for (const row of rows) {
            next.set(row.videoId, {
              positionSeconds: row.positionSeconds,
              videoDurationSeconds: row.videoDurationSeconds,
              completed: row.completed,
            });
          }
          return next;
        });
      })
      // Signed-out or offline: cards simply render without progress.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [videos]);

  return progress;
}

/** 0..1 watched fraction, or null when there's nothing meaningful to draw. */
export function resumeFraction(entry: ResumeEntry | undefined): number | null {
  if (!entry) return null;
  if (entry.completed) return 1;
  if (entry.videoDurationSeconds <= 0 || entry.positionSeconds <= 0)
    return null;
  const fraction = entry.positionSeconds / entry.videoDurationSeconds;
  if (fraction < 0.01) return null;
  return Math.min(1, fraction);
}

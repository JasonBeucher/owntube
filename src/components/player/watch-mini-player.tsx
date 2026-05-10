"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { VideoPlayer } from "@/components/player/video-player";
import { Button } from "@/components/ui/button";
import {
  readWatchMiniEnabled,
  readWatchMiniState,
  writeWatchMiniState,
} from "@/lib/watch-mini-player-state";

type WatchMiniPlayerProps = {
  isLoggedIn: boolean;
};

export function WatchMiniPlayer({ isLoggedIn }: WatchMiniPlayerProps) {
  const pathname = usePathname();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState(() => readWatchMiniState());
  const [enabled, setEnabled] = useState(() => readWatchMiniEnabled(true));
  const hidden = !isLoggedIn || !enabled || pathname.startsWith("/watch/");

  useEffect(() => {
    const load = () => {
      setState(readWatchMiniState());
      setEnabled(readWatchMiniEnabled(true));
    };
    load();
    window.addEventListener("storage", load);
    window.addEventListener("ot:watch-mini-updated", load as EventListener);
    return () => {
      window.removeEventListener("storage", load);
      window.removeEventListener(
        "ot:watch-mini-updated",
        load as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    if (!state || hidden) return;
    const v = wrapRef.current?.querySelector(
      "video",
    ) as HTMLVideoElement | null;
    if (!v) return;
    const onTime = () => {
      if (!state) return;
      writeWatchMiniState(
        {
          ...state,
          currentTime: v.currentTime,
        },
        false,
      );
    };
    const onEnded = () => writeWatchMiniState(null);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("ended", onEnded);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("ended", onEnded);
    };
  }, [state, hidden]);

  if (!state || hidden) return null;

  const watchHref = `/watch/${encodeURIComponent(state.videoId)}?t=${Math.floor(state.currentTime || 0)}`;

  return (
    <aside className="fixed bottom-3 right-3 z-50 w-[min(420px,94vw)] overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-black shadow-2xl">
      <div ref={wrapRef} className="relative w-full">
        <VideoPlayer
          key={state.videoId}
          videoId={state.videoId}
          payload={state.payload}
          title={state.title}
          poster={state.poster}
          startAtSeconds={Math.floor(state.currentTime || 0)}
          miniMode
        />
      </div>
      <div className="flex items-center justify-between gap-2 bg-[hsl(var(--card))] px-2.5 py-2">
        <p className="line-clamp-1 text-xs text-[hsl(var(--foreground))]">
          {state.title}
        </p>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={watchHref}>Reopen</Link>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => writeWatchMiniState(null)}
          >
            Close
          </Button>
        </div>
      </div>
    </aside>
  );
}

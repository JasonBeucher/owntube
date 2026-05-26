"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { HomeHero } from "@/components/home/home-hero";
import { VideoGrid } from "@/components/videos/video-grid";
import type { UnifiedVideo } from "@/server/services/proxy.types";
import { trpc } from "@/trpc/react";

const PAGE_SIZE = 24;
/** Personalized pool (~15) + trending tail (~9) — hard stop for runaway fetches. */
const MAX_FEED_PAGES = 32;
const LOAD_MORE_SKELETON_COUNT = 9;
const LOAD_MORE_SKELETON_KEYS = [
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
] as const;

type HomeFeedClientProps = {
  region: string;
  isAuthed: boolean;
};

function dedupeVideos(videos: UnifiedVideo[]): UnifiedVideo[] {
  const seen = new Set<string>();
  const out: UnifiedVideo[] = [];
  for (const v of videos) {
    if (seen.has(v.videoId)) continue;
    seen.add(v.videoId);
    out.push(v);
  }
  return out;
}

export function HomeFeedClient({ region, isAuthed }: HomeFeedClientProps) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const sentinelWasVisibleRef = useRef(false);
  const queryRef = useRef<ReturnType<typeof trpc.feed.home.useInfiniteQuery> | null>(
    null,
  );

  const feed = trpc.feed.home.useInfiniteQuery(
    { region, pageSize: PAGE_SIZE },
    {
      initialCursor: 0,
      getNextPageParam: (lastPage, allPages) => {
        if (!lastPage.hasMore || lastPage.videos.length === 0) {
          return undefined;
        }
        const merged = dedupeVideos(allPages.flatMap((p) => p.videos));
        const prevCount =
          allPages.length > 1
            ? dedupeVideos(
                allPages.slice(0, -1).flatMap((p) => p.videos),
              ).length
            : 0;
        if (merged.length <= prevCount) return undefined;
        if (allPages.length >= MAX_FEED_PAGES) return undefined;
        return merged.length;
      },
      placeholderData: (prev) => prev,
    },
  );
  queryRef.current = feed;

  const merged = useMemo(
    () => dedupeVideos(feed.data?.pages.flatMap((p) => p.videos) ?? []),
    [feed.data?.pages],
  );

  const lastPage = feed.data?.pages[feed.data.pages.length - 1];

  const tryLoadMore = useCallback(() => {
    const q = queryRef.current;
    if (!q?.hasNextPage || q.isFetchingNextPage || loadMoreInFlightRef.current) {
      return;
    }
    loadMoreInFlightRef.current = true;
    void q.fetchNextPage().finally(() => {
      loadMoreInFlightRef.current = false;
    });
  }, []);

  useEffect(() => {
    if (!feed.hasNextPage) return;
    const el = sentinelRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries[0]?.isIntersecting ?? false;
        const wasVisible = sentinelWasVisibleRef.current;
        sentinelWasVisibleRef.current = visible;
        if (visible && !wasVisible) tryLoadMore();
      },
      { root: null, rootMargin: "320px 0px", threshold: 0 },
    );
    obs.observe(el);
    return () => {
      obs.disconnect();
      sentinelWasVisibleRef.current = false;
    };
  }, [feed.hasNextPage, tryLoadMore]);

  const subtitle = useMemo(() => {
    if (!lastPage) return "";
    if (lastPage.kind === "personalized") {
      return lastPage.coldStart
        ? "Personalized feed — we are still learning what you like."
        : "Based on the channels you watched recently (trending only fills a small share).";
    }
    const cat = lastPage.category;
    const catLabel = cat ?? "general";
    return `Trending ${lastPage.region} · ${catLabel}. ${
      isAuthed
        ? 'The "For You" tab contains recommendations.'
        : "Sign in for a personalized feed."
    }`;
  }, [lastPage, isAuthed]);

  const [first, ...gridVideos] = merged;
  const isInitialLoading = feed.isPending && merged.length === 0;
  const isLoadingMore = feed.isFetchingNextPage;

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {subtitle || "Preparing your feed..."}
        </p>
      </div>

      {isInitialLoading ? (
        <div className="space-y-6" aria-hidden>
          <div className="relative mb-2 aspect-[21/8] max-h-[min(52vw,420px)] min-h-[200px] w-full overflow-hidden rounded-[20px] border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] max-sm:aspect-[4/3] max-sm:max-h-none">
            <div className="absolute inset-0 animate-pulse bg-[hsl(var(--muted)_/_0.5)]" />
            <div className="absolute inset-x-0 bottom-0 space-y-3 p-6 sm:px-9 sm:pb-8">
              <div className="h-4 w-36 animate-pulse rounded-full bg-white/20" />
              <div className="h-7 w-4/5 animate-pulse rounded bg-white/20" />
              <div className="h-7 w-2/3 animate-pulse rounded bg-white/15" />
            </div>
          </div>
          <ul className="ot-video-grid ot-video-grid--large">
            {LOAD_MORE_SKELETON_KEYS.slice(0, 6).map((k) => (
              <li key={`initial-skeleton-${k}`} className="space-y-3">
                <div className="aspect-video w-full animate-pulse rounded-[14px] bg-[hsl(var(--muted)_/_0.45)]" />
                <div className="flex gap-3">
                  <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-[hsl(var(--muted)_/_0.45)]" />
                  <div className="min-w-0 flex-1 space-y-2 pt-1">
                    <div className="h-3.5 w-11/12 animate-pulse rounded bg-[hsl(var(--muted)_/_0.45)]" />
                    <div className="h-3.5 w-4/6 animate-pulse rounded bg-[hsl(var(--muted)_/_0.45)]" />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {feed.isError ? (
        <p className="text-sm text-red-600">
          {feed.error.message ?? "Could not load the feed."}
        </p>
      ) : null}

      {first ? <HomeHero video={first} /> : null}

      {gridVideos.length > 0 ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 className="text-xl font-bold tracking-tight">
              {lastPage?.kind === "personalized" ? "For You" : "Trending"}
            </h2>
            <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
              {merged.length} video{merged.length === 1 ? "" : "s"}
            </span>
          </div>
          <VideoGrid videos={gridVideos} size="large" />
        </>
      ) : first ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Scroll to load more rows.
        </p>
      ) : !isInitialLoading ? (
        <p className="rounded-[14px] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-14 text-center text-sm text-[hsl(var(--muted-foreground))]">
          No videos for now.
        </p>
      ) : null}

      {feed.hasNextPage ? (
        <div ref={sentinelRef} className="h-4 w-full shrink-0" aria-hidden />
      ) : null}

      {isLoadingMore ? (
        <ul className="ot-video-grid ot-video-grid--large" aria-hidden>
          {LOAD_MORE_SKELETON_KEYS.slice(0, LOAD_MORE_SKELETON_COUNT).map(
            (k) => (
              <li key={`skeleton-${k}`} className="space-y-3">
                <div className="aspect-video w-full animate-pulse rounded-[14px] bg-[hsl(var(--muted)_/_0.45)]" />
                <div className="flex gap-3">
                  <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-[hsl(var(--muted)_/_0.45)]" />
                  <div className="min-w-0 flex-1 space-y-2 pt-1">
                    <div className="h-3.5 w-11/12 animate-pulse rounded bg-[hsl(var(--muted)_/_0.45)]" />
                    <div className="h-3.5 w-4/6 animate-pulse rounded bg-[hsl(var(--muted)_/_0.45)]" />
                  </div>
                </div>
              </li>
            ),
          )}
        </ul>
      ) : null}

      {isLoadingMore ? (
        <p className="text-center text-xs text-[hsl(var(--muted-foreground))]">
          Loading more...
        </p>
      ) : null}
    </section>
  );
}

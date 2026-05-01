"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HomeHero } from "@/components/home/home-hero";
import { VideoGrid } from "@/components/videos/video-grid";
import type { UnifiedVideo } from "@/server/services/proxy.types";
import { trpc } from "@/trpc/react";

const PAGE_SIZE = 24;
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

function findVerticalScrollParent(el: HTMLElement | null): HTMLElement | null {
  let p = el?.parentElement ?? null;
  while (p) {
    const st = window.getComputedStyle(p);
    if (
      /(auto|scroll|overlay)/.test(st.overflowY) &&
      p.scrollHeight > p.clientHeight + 2
    ) {
      return p;
    }
    p = p.parentElement;
  }
  return document.querySelector(".ot-app-scroll");
}

export function HomeFeedClient({ region, isAuthed }: HomeFeedClientProps) {
  const [page, setPage] = useState(1);
  const [merged, setMerged] = useState<UnifiedVideo[]>([]);

  const feed = trpc.feed.home.useQuery(
    {
      region,
      page,
      pageSize: PAGE_SIZE,
    },
    {},
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when region changes
  useEffect(() => {
    setPage(1);
    setMerged([]);
    prevFetchingRef.current = null;
    isSentinelVisibleRef.current = false;
  }, [region]);

  useEffect(() => {
    if (!feed.isSuccess || !feed.data) return;
    const v = feed.data.videos;
    setMerged((prev) => {
      if (page === 1) return v;
      const seen = new Set(prev.map((x) => x.videoId));
      return [...prev, ...v.filter((x) => !seen.has(x.videoId))];
    });
  }, [feed.isSuccess, feed.data, page]);

  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const isSentinelVisibleRef = useRef(false);
  const prevFetchingRef = useRef<boolean | null>(null);

  const bumpPage = useCallback(() => {
    if (!feed.isSuccess || !feed.data || feed.isFetching) return;
    if (!feed.data.hasMore) return;
    setPage((p) => p + 1);
  }, [feed.isSuccess, feed.data, feed.isFetching]);

  const onIntersect = useCallback(
    (isIntersecting: boolean) => {
      isSentinelVisibleRef.current = isIntersecting;
      if (isIntersecting) bumpPage();
    },
    [bumpPage],
  );

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const root = findVerticalScrollParent(el);
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        onIntersect(visible);
      },
      {
        root,
        rootMargin: "480px",
        threshold: 0,
      },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [onIntersect, merged.length]);

  /** When a page just finished loading, continue if the sentinel is still visible. */
  useEffect(() => {
    const prev = prevFetchingRef.current;
    const cur = feed.isFetching;
    prevFetchingRef.current = cur;
    if (prev === null) return;
    if (
      prev &&
      !cur &&
      feed.isSuccess &&
      feed.data?.hasMore &&
      isSentinelVisibleRef.current
    ) {
      bumpPage();
    }
  }, [feed.isFetching, feed.isSuccess, feed.data?.hasMore, bumpPage]);

  /** Fallback scroll: some browsers do not retrigger the observer while the target stays visible. */
  useEffect(() => {
    const el = loadMoreRef.current;
    const root = el ? findVerticalScrollParent(el) : null;
    const onScrollOrResize = () => {
      const sentinel = loadMoreRef.current;
      if (!sentinel) return;
      const rect = sentinel.getBoundingClientRect();
      const viewportBottom =
        root instanceof HTMLElement
          ? root.getBoundingClientRect().bottom
          : window.innerHeight;
      const visibleSoon = rect.top <= viewportBottom + 480;
      isSentinelVisibleRef.current = visibleSoon;
      if (visibleSoon) bumpPage();
    };
    const scrollTarget: HTMLElement | Window = root ?? window;
    scrollTarget.addEventListener("scroll", onScrollOrResize, {
      passive: true,
    });
    window.addEventListener("resize", onScrollOrResize);
    onScrollOrResize();
    return () => {
      scrollTarget.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [bumpPage, merged.length]);

  const subtitle = useMemo(() => {
    if (!feed.data) return "";
    if (feed.data.kind === "personalized") {
      return feed.data.coldStart
        ? "Personalized feed — we are still learning what you like."
        : "Based on the channels you watched recently (trending only fills a small share).";
    }
    const cat = feed.data.category;
    const catLabel = cat ?? "general";
    return `Trending ${feed.data.region} · ${catLabel}. ${
      isAuthed
        ? 'The "For You" tab contains recommendations.'
        : "Sign in for a personalized feed."
    }`;
  }, [feed.data, isAuthed]);

  const [first, ...gridVideos] = merged;

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {subtitle || "Preparing your feed..."}
        </p>
      </div>

      {feed.isPending && merged.length === 0 ? (
        <div className="space-y-6" aria-hidden>
          <div className="relative mb-2 aspect-[21/8] max-h-[min(52vw,420px)] min-h-[200px] w-full overflow-hidden rounded-[20px] border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] max-sm:aspect-[4/3] max-sm:max-h-none">
            <div className="absolute inset-0 animate-pulse bg-[hsl(var(--muted)_/_0.5)]" />
            <div className="absolute inset-x-0 bottom-0 space-y-3 p-6 sm:px-9 sm:pb-8">
              <div className="h-4 w-36 animate-pulse rounded-full bg-white/20" />
              <div className="h-7 w-4/5 animate-pulse rounded bg-white/20" />
              <div className="h-7 w-2/3 animate-pulse rounded bg-white/15" />
            </div>
          </div>
          <ul className="grid grid-cols-1 gap-x-7 gap-y-8 lg:grid-cols-2 xl:grid-cols-[repeat(auto-fill,minmax(440px,1fr))]">
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
              {feed.data?.kind === "personalized" ? "For You" : "Trending"}
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
      ) : !feed.isPending ? (
        <p className="rounded-[14px] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-14 text-center text-sm text-[hsl(var(--muted-foreground))]">
          No videos for now.
        </p>
      ) : null}

      <div ref={loadMoreRef} className="h-4 w-full shrink-0" aria-hidden />

      {feed.isFetching && page > 1 ? (
        <ul
          className="grid grid-cols-1 gap-x-7 gap-y-8 lg:grid-cols-2 xl:grid-cols-[repeat(auto-fill,minmax(440px,1fr))]"
          aria-hidden
        >
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

      {feed.isFetching && page > 1 ? (
        <p className="text-center text-xs text-[hsl(var(--muted-foreground))]">
          Loading more...
        </p>
      ) : null}
    </section>
  );
}

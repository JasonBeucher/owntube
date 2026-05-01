import Link from "next/link";
import { ChannelAvatarCircle } from "@/components/videos/channel-avatar-circle";
import { VideoCard } from "@/components/videos/video-card";
import { getDb } from "@/server/db/client";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import { searchVideos } from "@/server/services/proxy";
import {
  type SearchVideosResult,
  searchVideosInputSchema,
} from "@/server/services/proxy.types";

type SearchResultsProps = {
  query: string;
};

export async function SearchResults({ query }: SearchResultsProps) {
  const input = searchVideosInputSchema.parse({
    q: query,
    limit: 20,
  });
  let result: SearchVideosResult;
  try {
    result = await searchVideos(getDb(), input);
  } catch (error) {
    if (error instanceof UpstreamUnavailableError) {
      return (
        <output
          className="block space-y-2 text-[hsl(var(--muted-foreground))]"
          aria-live="polite"
        >
          <span className="block font-medium text-[hsl(var(--foreground))]">
            Search is temporarily unavailable.
          </span>
          <span className="block whitespace-pre-wrap text-sm">
            {error.message}
          </span>
        </output>
      );
    }
    throw error;
  }

  if (result.videos.length === 0) {
    if ((result.channels?.length ?? 0) > 0) {
      return (
        <div className="space-y-4">
          <output
            className="block text-sm text-[hsl(var(--muted-foreground))]"
            aria-live="polite"
          >
            {result.channels?.length ?? 0} channel
            {(result.channels?.length ?? 0) === 1 ? "" : "s"} via{" "}
            <span className="font-medium text-[hsl(var(--foreground))]">
              {result.sourceUsed}
            </span>
          </output>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {result.channels?.map((c) => (
              <li key={c.channelId}>
                <Link
                  href={`/channel/${encodeURIComponent(c.channelId)}`}
                  className="block rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 transition hover:bg-[hsl(var(--muted)_/_0.35)]"
                >
                  <div className="flex items-center gap-3">
                    <ChannelAvatarCircle
                      imageUrl={c.avatarUrl}
                      label={c.name}
                      size="md"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[hsl(var(--foreground))]">
                        {c.name}
                      </p>
                      {c.subscriberCount ? (
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">
                          {c.subscriberCount.toLocaleString()} subscribers
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {c.description ? (
                    <p className="mt-3 line-clamp-2 text-xs text-[hsl(var(--muted-foreground))]">
                      {c.description}
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    return (
      <output
        className="block text-[hsl(var(--muted-foreground))]"
        aria-live="polite"
      >
        No videos found. Try another query or check your Piped / Invidious
        instance in settings (env).
      </output>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3">
        <output
          className="block text-sm text-[hsl(var(--muted-foreground))]"
          aria-live="polite"
        >
          {result.videos.length} video
          {result.videos.length === 1 ? "" : "s"}
          {(result.channels?.length ?? 0) > 0
            ? ` · ${result.channels?.length ?? 0} channel${(result.channels?.length ?? 0) === 1 ? "" : "s"}`
            : ""}
          {" · "}
          <span className="font-medium text-[hsl(var(--foreground))]">
            {result.sourceUsed}
          </span>
        </output>
      </div>
      {result.warning ? (
        <p className="text-sm text-amber-600">{result.warning}</p>
      ) : null}

      {(result.channels?.length ?? 0) > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Channels</h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {result.channels?.map((c) => (
              <li key={c.channelId}>
                <Link
                  href={`/channel/${encodeURIComponent(c.channelId)}`}
                  className="block rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 transition hover:bg-[hsl(var(--muted)_/_0.35)]"
                >
                  <div className="flex items-center gap-3">
                    <ChannelAvatarCircle
                      imageUrl={c.avatarUrl}
                      label={c.name}
                      size="md"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[hsl(var(--foreground))]">
                        {c.name}
                      </p>
                      {c.subscriberCount ? (
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">
                          {c.subscriberCount.toLocaleString()} subscribers
                        </p>
                      ) : null}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Videos</h2>
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
          {result.videos.map((v) => (
            <li key={v.videoId} className="h-full">
              <VideoCard
                href={`/watch/${encodeURIComponent(v.videoId)}`}
                title={v.title}
                channelName={v.channelName}
                channelHref={
                  v.channelId
                    ? `/channel/${encodeURIComponent(v.channelId)}`
                    : undefined
                }
                channelAvatarUrl={v.channelAvatarUrl}
                thumbnailUrl={v.thumbnailUrl}
                durationSeconds={v.durationSeconds}
                viewCount={v.viewCount}
                publishedText={v.publishedText}
                publishedAt={v.publishedAt}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

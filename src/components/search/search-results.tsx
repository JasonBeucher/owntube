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
    <div className="space-y-4">
      <output
        className="block text-sm text-[hsl(var(--muted-foreground))]"
        aria-live="polite"
      >
        {result.videos.length} result{result.videos.length === 1 ? "" : "s"} via{" "}
        <span className="font-medium text-[hsl(var(--foreground))]">
          {result.sourceUsed}
        </span>
      </output>
      {result.warning ? (
        <p className="text-sm text-amber-600">{result.warning}</p>
      ) : null}
      <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
        {result.videos.map((v) => (
          <li key={v.videoId} className="h-full">
            <VideoCard
              href={`/watch/${encodeURIComponent(v.videoId)}`}
              title={v.title}
              channelName={v.channelName}
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
    </div>
  );
}

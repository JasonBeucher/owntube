import { VideoCard } from "@/components/videos/video-card";
import type { UnifiedVideo } from "@/server/services/proxy.types";

type VideoGridProps = {
  videos: UnifiedVideo[];
  size?: "default" | "large";
};

export function VideoGrid({ videos, size = "default" }: VideoGridProps) {
  if (videos.length === 0) {
    return (
      <p className="rounded-[14px] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-14 text-center text-sm text-[hsl(var(--muted-foreground))]">
        No videos.
      </p>
    );
  }
  const gridClass =
    size === "large"
      ? "grid grid-cols-1 gap-x-7 gap-y-8 lg:grid-cols-2 xl:grid-cols-[repeat(auto-fill,minmax(440px,1fr))]"
      : "grid grid-cols-1 gap-x-[18px] gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]";
  return (
    <ul className={gridClass}>
      {videos.map((v) => (
        <li key={v.videoId}>
          <VideoCard
            href={`/watch/${v.videoId}`}
            title={v.title}
            channelName={v.channelName}
            channelHref={
              v.channelId ? `/channel/${encodeURIComponent(v.channelId)}` : undefined
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
  );
}

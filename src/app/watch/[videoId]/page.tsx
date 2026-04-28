import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import Link from "next/link";
import { InteractionButtons } from "@/components/player/interaction-buttons";
import { VideoPlayer } from "@/components/player/video-player";
import { WatchTracker } from "@/components/player/watch-tracker";
import { Button } from "@/components/ui/button";
import { VideoCardCompact } from "@/components/videos/video-card";
import {
  getAppOriginFromRequestHeaders,
  toProxiedOrDirectPlayback,
  toProxiedOrDirectPoster,
  toProxiedOrDirectVariants,
} from "@/lib/invidious-proxy";
import { buildWatchPlayback } from "@/lib/pick-playback";
import { auth } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { fetchRelatedVideos, fetchVideoDetail } from "@/server/services/proxy";
import { videoDetailInputSchema } from "@/server/services/proxy.types";
import { getUserProxyOverrides } from "@/server/settings/profile";

type WatchPageProps = {
  params: Promise<{ videoId: string }>;
};

export default async function WatchPage({ params }: WatchPageProps) {
  noStore();
  const { videoId } = await params;
  const input = videoDetailInputSchema.parse({ videoId });
  const db = getDb();
  const session = await auth();
  const userId = session?.user?.id ? Number.parseInt(session.user.id, 10) : NaN;
  const overrides = getUserProxyOverrides(
    db,
    Number.isFinite(userId) ? userId : null,
  );
  const h = await headers();
  const requestHost =
    h.get("x-forwarded-host")?.split(",")[0]?.trim() ?? h.get("host") ?? "";
  const appOrigin = getAppOriginFromRequestHeaders(h);
  const [detail, related] = await Promise.all([
    fetchVideoDetail(db, input, overrides, { bypassDetailCache: true }),
    fetchRelatedVideos(db, input, 20, overrides),
  ]);
  const isAuthed = Boolean(session?.user?.id);
  const rawPlayback = buildWatchPlayback(detail);
  const onlyDashOrUnsupported =
    rawPlayback.kind === "none" && rawPlayback.onlyDashOrUnsupported;
  const videoPayload =
    rawPlayback.kind === "hls"
      ? {
          mode: "hls" as const,
          src: toProxiedOrDirectPlayback(
            rawPlayback.url,
            appOrigin,
            requestHost,
            detail,
          ),
        }
      : rawPlayback.kind === "progressive"
        ? {
            mode: "progressive" as const,
            variants: toProxiedOrDirectVariants(
              rawPlayback.variants,
              appOrigin,
              requestHost,
              detail,
            ),
          }
        : null;
  const poster = toProxiedOrDirectPoster(
    detail.thumbnailUrl,
    appOrigin,
    requestHost,
    detail,
  );

  return (
    <main className="ot-page grid min-h-0 gap-8 lg:grid-cols-[2fr_1fr]">
      <section className="min-w-0 space-y-5">
        {videoPayload ? (
          <VideoPlayer
            key={detail.videoId}
            payload={videoPayload}
            title={detail.title}
            poster={poster}
          />
        ) : (
          <div className="rounded-xl border bg-[hsl(var(--muted))] p-6 text-sm text-[hsl(var(--muted-foreground))]">
            {onlyDashOrUnsupported ? (
              <span>
                DASH/MPD is not supported by this player (Invidious only
                returned an adaptive MPD and no HLS or combined MP4). Try
                another instance, enable or fix HLS on your Invidious, or check
                that format streams are not proxy-blocked.
              </span>
            ) : (
              "No playable stream is available for this video."
            )}
          </div>
        )}

        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold tracking-tight text-[hsl(var(--foreground))] sm:text-3xl">
            {detail.title}
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {detail.channelId ? (
              <Link
                href={`/channel/${encodeURIComponent(detail.channelId)}`}
                className="font-medium text-[hsl(var(--foreground))] hover:underline"
              >
                {detail.channelName ?? "Channel"}
              </Link>
            ) : (
              (detail.channelName ?? "Unknown channel")
            )}
            {detail.viewCount
              ? ` · ${detail.viewCount.toLocaleString()} views`
              : ""}
          </p>
          {detail.warning ? (
            <p className="text-sm text-amber-600">{detail.warning}</p>
          ) : null}
        </div>

        <InteractionButtons
          videoId={detail.videoId}
          channelId={detail.channelId}
          isAuthenticated={isAuthed}
        />
        {isAuthed ? (
          <WatchTracker
            videoId={detail.videoId}
            channelId={detail.channelId}
            durationSeconds={detail.durationSeconds}
          />
        ) : null}

        <div className="space-y-3">
          <h2 className="text-lg font-medium">Description</h2>
          <p className="whitespace-pre-wrap text-sm text-[hsl(var(--muted-foreground))]">
            {detail.description ?? "No description available."}
          </p>
        </div>

        <Button variant="outline" asChild>
          <Link href="/search">Back to search</Link>
        </Button>
      </section>

      <aside className="min-w-0 space-y-4">
        <h2 className="text-lg font-bold tracking-tight">Related videos</h2>
        {related.warning ? (
          <p className="text-sm text-amber-600">{related.warning}</p>
        ) : null}
        <ul className="space-y-3">
          {related.videos.map((video) => (
            <li key={video.videoId}>
              <VideoCardCompact
                href={`/watch/${encodeURIComponent(video.videoId)}`}
                title={video.title}
                channelName={video.channelName}
                channelAvatarUrl={video.channelAvatarUrl}
                thumbnailUrl={video.thumbnailUrl}
                durationSeconds={video.durationSeconds}
                publishedText={video.publishedText}
              />
            </li>
          ))}
        </ul>
      </aside>
    </main>
  );
}

import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import Link from "next/link";
import { ChannelSubscribeButton } from "@/components/channel/channel-subscribe-button";
import { InteractionButtons } from "@/components/player/interaction-buttons";
import { VideoPlayer } from "@/components/player/video-player";
import { WatchTracker } from "@/components/player/watch-tracker";
import { ChannelAvatarCircle } from "@/components/videos/channel-avatar-circle";
import { WatchDescription } from "@/components/watch/watch-description";
import { VideoCardCompact } from "@/components/videos/video-card";
import {
  getAppOriginFromRequestHeaders,
  toProxiedOrDirectPlayback,
  toProxiedOrDirectPoster,
  toProxiedOrDirectVariants,
} from "@/lib/invidious-proxy";
import { buildWatchPlayback } from "@/lib/pick-playback";
import { formatPublishedLabel, formatViews } from "@/lib/video-display";
import { parseChaptersFromDescription } from "@/lib/video-chapters";
import { auth } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { getRecommendations } from "@/server/recommendation/engine";
import {
  fetchTrendingVideos,
  fetchVideoDetail,
} from "@/server/services/proxy";
import { videoDetailInputSchema } from "@/server/services/proxy.types";
import {
  getUserProxyOverrides,
  getUserSettings,
  normalizeTrendingRegionStored,
} from "@/server/settings/profile";

type WatchPageProps = {
  params: Promise<{ videoId: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
};

export default async function WatchPage({ params, searchParams }: WatchPageProps) {
  noStore();
  const { videoId } = await params;
  const sp = await searchParams;
  const rawT = typeof sp.t === "string" ? sp.t.trim() : "";
  const startAtSeconds = /^\d+$/.test(rawT)
    ? Number.parseInt(rawT, 10)
    : undefined;
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
  const isAuthed = Boolean(session?.user?.id);
  const feedRegion =
    Number.isFinite(userId) && userId > 0
      ? normalizeTrendingRegionStored(getUserSettings(db, userId).trendingRegion)
      : "US";
  const [detail, feedVideosRaw] = await Promise.all([
    fetchVideoDetail(db, input, overrides, { bypassDetailCache: true }),
    isAuthed
      ? getRecommendations(db, userId, {
          page: 1,
          pageSize: 28,
          region: feedRegion,
          overrides,
        }).then((rec) => rec.videos)
      : fetchTrendingVideos(
          db,
          { region: feedRegion, limit: 28 },
          overrides,
        ).then((r) => r.videos),
  ]);
  const feedVideos = feedVideosRaw
    .filter((video) => video.videoId !== videoId)
    .slice(0, 20);
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
  const chapters = parseChaptersFromDescription(
    detail.description,
    detail.durationSeconds,
  );
  const publishedLabel = formatPublishedLabel(detail.publishedText);
  const viewsLabel = formatViews(detail.viewCount);
  const channelLabel = detail.channelName ?? "Unknown channel";

  return (
    <main className="ot-page grid min-h-0 gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(320px,1fr)]">
      <section className="min-w-0 space-y-5">
        {videoPayload ? (
          <VideoPlayer
            key={detail.videoId}
            payload={videoPayload}
            title={detail.title}
            poster={poster}
            chapters={chapters}
            startAtSeconds={startAtSeconds}
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

        <div className="space-y-3">
          <h1 className="text-2xl font-extrabold tracking-tight text-[hsl(var(--foreground))] sm:text-3xl">
            {detail.title}
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {viewsLabel ?? null}
            {viewsLabel && publishedLabel ? " · " : null}
            {publishedLabel ?? null}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border))] pb-4">
            <div className="flex min-w-0 items-center gap-3">
              {detail.channelId ? (
                <Link href={`/channel/${encodeURIComponent(detail.channelId)}`}>
                  <ChannelAvatarCircle
                    imageUrl={detail.channelAvatarUrl}
                    label={channelLabel}
                    size="md"
                  />
                </Link>
              ) : (
                <ChannelAvatarCircle
                  imageUrl={detail.channelAvatarUrl}
                  label={channelLabel}
                  size="md"
                />
              )}
              <div className="min-w-0">
                {detail.channelId ? (
                  <Link
                    href={`/channel/${encodeURIComponent(detail.channelId)}`}
                    className="line-clamp-1 text-sm font-semibold text-[hsl(var(--foreground))] hover:underline"
                  >
                    {channelLabel}
                  </Link>
                ) : (
                  <p className="line-clamp-1 text-sm font-semibold text-[hsl(var(--foreground))]">
                    {channelLabel}
                  </p>
                )}
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {publishedLabel ? `Published ${publishedLabel}` : "Channel"}
                </p>
              </div>
            </div>
            {detail.channelId ? (
              <ChannelSubscribeButton
                channelId={detail.channelId}
                isAuthed={isAuthed}
              />
            ) : null}
          </div>
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
          <WatchDescription videoId={detail.videoId} description={detail.description} />
        </div>
      </section>

      <aside className="min-w-0 space-y-4">
        <h2 className="text-lg font-bold tracking-tight">From your feed</h2>
        <ul className="space-y-3">
          {feedVideos.map((video) => (
            <li key={video.videoId}>
              <VideoCardCompact
                href={`/watch/${encodeURIComponent(video.videoId)}`}
                title={video.title}
                channelName={video.channelName}
                channelHref={
                  video.channelId
                    ? `/channel/${encodeURIComponent(video.channelId)}`
                    : undefined
                }
                channelAvatarUrl={video.channelAvatarUrl}
                thumbnailUrl={video.thumbnailUrl}
                durationSeconds={video.durationSeconds}
                publishedText={video.publishedText}
                showChannelAvatar={false}
                size="large"
              />
            </li>
          ))}
        </ul>
      </aside>
    </main>
  );
}

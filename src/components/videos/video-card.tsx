import Link from "next/link";
import { AddToQueueButton } from "@/components/player/add-to-queue-button";
import { ChannelAvatarCircle } from "@/components/videos/channel-avatar-circle";
import { VideoCardActionsMenu } from "@/components/videos/video-card-actions-menu";
import { VideoCardMarkWatchedButton } from "@/components/videos/video-card-mark-watched-button";
import { VideoCardThumbnailImg } from "@/components/videos/video-card-thumbnail-img";
import { VideoCardThumbnailInteractive } from "@/components/videos/video-card-thumbnail-interactive";
import {
  formatDuration,
  formatPublishedAbsoluteLabel,
  formatPublishedDebugTitle,
  formatPublishedLabel,
  formatViews,
} from "@/lib/video-display";

type VideoCardProps = {
  href: string;
  /** When set, thumbnail hover (1s) plays an inline preview with mute control. */
  videoId?: string;
  title: string;
  channelId?: string;
  channelName?: string;
  channelHref?: string;
  channelAvatarUrl?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  viewCount?: number;
  /** Relative or textual publish date from upstream (`publishedText`). */
  publishedText?: string;
  /** Unix seconds when available (preferred for accurate relative display). */
  publishedAt?: number;
};

export function VideoCard({
  href,
  videoId,
  title,
  channelId,
  channelName,
  channelHref,
  channelAvatarUrl,
  thumbnailUrl,
  durationSeconds,
  viewCount,
  publishedText,
  publishedAt,
}: VideoCardProps) {
  const durationLabel = formatDuration(durationSeconds);
  const viewsLabel = formatViews(viewCount);
  const publishedLabel = formatPublishedLabel(publishedText, publishedAt);
  const publishedAbsoluteLabel = formatPublishedAbsoluteLabel(publishedAt);
  const publishedDebugTitle = formatPublishedDebugTitle(
    publishedText,
    publishedAt,
  );
  const channel = channelName ?? "Unknown channel";

  const thumbShell =
    "relative aspect-video w-full overflow-hidden rounded-[14px] bg-[hsl(var(--muted))] shadow-none transition duration-300 group-hover:-translate-y-0.5 group-hover:shadow-[0_20px_40px_rgba(0,0,0,0.45)]";
  const thumbImg =
    "h-full w-full object-cover transition duration-500 ease-out group-hover:scale-[1.04]";

  return (
    <article className="group flex h-full flex-col gap-3 text-left text-[hsl(var(--foreground))]">
      {videoId ? (
        <div className="relative">
          <VideoCardThumbnailInteractive
            href={href}
            videoId={videoId}
            thumbnailUrl={thumbnailUrl}
            durationLabel={durationLabel}
            thumbClassName={thumbShell}
            imgClassName={thumbImg}
          />
          <VideoCardMarkWatchedButton
            videoId={videoId}
            channelId={channelId}
            className="absolute left-2 top-2 z-20 flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100"
          />
        </div>
      ) : (
        <Link href={href} className="block">
          <div className={thumbShell}>
            {thumbnailUrl ? (
              <VideoCardThumbnailImg
                url={thumbnailUrl}
                videoId={videoId}
                className={thumbImg}
              />
            ) : null}
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              aria-hidden
            >
              <svg
                width="56"
                height="56"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="scale-90 text-white drop-shadow-lg transition duration-300 group-hover:scale-100"
              >
                <title>Play</title>
                <polygon points="6 4 20 12 6 20 6 4" />
              </svg>
            </div>
            {durationLabel ? (
              <span className="absolute bottom-2 right-2 rounded-md border border-white/10 bg-black/85 px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-white backdrop-blur-sm">
                {durationLabel}
              </span>
            ) : null}
            <VideoCardMarkWatchedButton
              videoId={videoId}
              channelId={channelId}
              className="absolute left-2 top-2 z-20 flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100"
            />
          </div>
        </Link>
      )}
      <div className="flex gap-3">
        {channelHref ? (
          <Link href={channelHref} className="mt-0.5 shrink-0">
            <ChannelAvatarCircle
              imageUrl={channelAvatarUrl}
              label={channel}
              size="md"
            />
          </Link>
        ) : (
          <ChannelAvatarCircle
            imageUrl={channelAvatarUrl}
            label={channel}
            size="md"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-start gap-0.5">
            <Link href={href} className="min-w-0 flex-1">
              <h2 className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight text-[hsl(var(--foreground))] transition group-hover:text-[hsl(var(--primary))]">
                {title}
              </h2>
            </Link>
            {videoId ? (
              <VideoCardActionsMenu
                videoId={videoId}
                channelId={channelId}
                channelName={channelName}
              />
            ) : null}
          </div>
          <p className="line-clamp-1 text-[13px] text-[hsl(var(--muted-foreground))]">
            {channelHref ? (
              <Link
                href={channelHref}
                className="hover:text-[hsl(var(--foreground))] hover:underline"
              >
                {channel}
              </Link>
            ) : (
              channel
            )}
            {viewsLabel ? (
              <>
                <span className="mx-1.5 text-[hsl(var(--muted-foreground))]/60">
                  ·
                </span>
                {viewsLabel}
              </>
            ) : null}
            {publishedLabel ? (
              <>
                <span className="mx-1.5 text-[hsl(var(--muted-foreground))]/60">
                  ·
                </span>
                <span
                  className="tabular-nums"
                  title={
                    publishedDebugTitle ?? publishedAbsoluteLabel ?? undefined
                  }
                >
                  {publishedLabel}
                </span>
              </>
            ) : null}
          </p>
        </div>
      </div>
    </article>
  );
}

type VideoCardShortProps = {
  href: string;
  videoId?: string;
  title: string;
  channelId?: string;
  channelName?: string;
  channelHref?: string;
  channelAvatarUrl?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  viewCount?: number;
  publishedText?: string;
  publishedAt?: number;
  /** Show channel name under the title (e.g. search). Off on channel pages. */
  showChannelMeta?: boolean;
};

export function VideoCardShort({
  href,
  videoId,
  title,
  channelId,
  channelName,
  channelHref,
  thumbnailUrl,
  durationSeconds,
  viewCount,
  publishedText,
  publishedAt,
  showChannelMeta = false,
}: VideoCardShortProps) {
  const durationLabel = formatDuration(durationSeconds);
  const viewsLabel = formatViews(viewCount);
  const publishedLabel = formatPublishedLabel(publishedText, publishedAt);
  const publishedAbsoluteLabel = formatPublishedAbsoluteLabel(publishedAt);
  const publishedDebugTitle = formatPublishedDebugTitle(
    publishedText,
    publishedAt,
  );
  const channel = channelName ?? "Unknown channel";

  return (
    <article className="group flex flex-col gap-2 text-left text-[hsl(var(--foreground))]">
      <div className="relative mx-auto w-full max-w-[210px]">
        <Link href={href} className="block">
          <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-[hsl(var(--muted))] shadow-none transition duration-300 group-hover:-translate-y-0.5 group-hover:shadow-[0_16px_32px_rgba(0,0,0,0.4)]">
            {thumbnailUrl ? (
              <VideoCardThumbnailImg
                url={thumbnailUrl}
                videoId={videoId}
                className="h-full w-full object-cover object-center transition duration-500 ease-out group-hover:scale-[1.03]"
              />
            ) : null}
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              aria-hidden
            >
              <svg
                width="44"
                height="44"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="text-white drop-shadow-lg"
              >
                <title>Play</title>
                <polygon points="6 4 20 12 6 20 6 4" />
              </svg>
            </div>
            {durationLabel ? (
              <span className="absolute bottom-1.5 right-1.5 rounded-md border border-white/10 bg-black/80 px-1.5 py-px font-mono text-[10px] font-semibold tabular-nums text-white backdrop-blur-sm">
                {durationLabel}
              </span>
            ) : null}
          </div>
        </Link>
        <VideoCardMarkWatchedButton
          videoId={videoId}
          channelId={channelId}
          className="absolute left-1.5 top-1.5 z-20 flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100"
        />
      </div>
      <div className="flex items-start gap-0.5 px-0.5">
        <div className="min-w-0 flex-1">
          <Link href={href}>
            <p className="line-clamp-2 text-[13px] font-semibold leading-snug tracking-tight transition group-hover:text-[hsl(var(--primary))]">
              {title}
            </p>
          </Link>
          {showChannelMeta ? (
            <p className="mt-0.5 line-clamp-1 text-[11px] text-[hsl(var(--muted-foreground))]">
              {channelHref ? (
                <Link
                  href={channelHref}
                  className="hover:text-[hsl(var(--foreground))] hover:underline"
                >
                  {channel}
                </Link>
              ) : (
                channel
              )}
            </p>
          ) : null}
          {viewsLabel || publishedLabel ? (
            <p className="mt-0.5 line-clamp-1 text-[11px] text-[hsl(var(--muted-foreground))]">
              {viewsLabel}
              {viewsLabel && publishedLabel ? (
                <span className="mx-1 text-[hsl(var(--muted-foreground))]/60">
                  ·
                </span>
              ) : null}
              {publishedLabel ? (
                <span
                  className="tabular-nums"
                  title={
                    publishedDebugTitle ?? publishedAbsoluteLabel ?? undefined
                  }
                >
                  {publishedLabel}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        {videoId ? (
          <VideoCardActionsMenu
            videoId={videoId}
            channelId={channelId}
            channelName={channelName}
            className="-mr-1 -mt-0.5"
          />
        ) : null}
      </div>
    </article>
  );
}

type VideoCardCompactProps = {
  href: string;
  videoId?: string;
  title: string;
  channelId?: string;
  channelName?: string;
  channelHref?: string;
  channelAvatarUrl?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  publishedText?: string;
  publishedAt?: number;
  showChannelAvatar?: boolean;
  size?: "default" | "large";
  showAddToQueue?: boolean;
};

export function VideoCardCompact({
  href,
  videoId,
  title,
  channelId,
  channelName,
  channelHref,
  channelAvatarUrl,
  thumbnailUrl,
  durationSeconds,
  publishedText,
  publishedAt,
  showChannelAvatar = true,
  size = "default",
  showAddToQueue = false,
}: VideoCardCompactProps) {
  const durationLabel = formatDuration(durationSeconds);
  const publishedLabel = formatPublishedLabel(publishedText, publishedAt);
  const publishedAbsoluteLabel = formatPublishedAbsoluteLabel(publishedAt);
  const publishedDebugTitle = formatPublishedDebugTitle(
    publishedText,
    publishedAt,
  );
  const channel = channelName ?? "Unknown channel";
  const thumbSizeClass =
    size === "large" ? "w-[9.5rem] sm:w-52" : "w-[7.25rem] sm:w-40";
  const titleClass =
    size === "large"
      ? "line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight transition group-hover:text-[hsl(var(--primary))]"
      : "line-clamp-2 text-sm font-semibold leading-snug tracking-tight transition group-hover:text-[hsl(var(--primary))]";
  const metaPadClass = showChannelAvatar ? "pl-8" : "pl-0";

  return (
    <article className="group rounded-xl p-2 transition hover:bg-[hsl(var(--muted)_/_0.45)]">
      <div className="flex gap-3 text-left">
        <Link href={href} className="block shrink-0">
          <div
            className={`relative aspect-video overflow-hidden rounded-xl bg-[hsl(var(--muted))] ${thumbSizeClass}`}
          >
            {thumbnailUrl ? (
              <VideoCardThumbnailImg
                url={thumbnailUrl}
                videoId={videoId}
                className="h-full w-full object-cover transition duration-500 ease-out group-hover:scale-105"
              />
            ) : null}
            {durationLabel ? (
              <span className="absolute bottom-1 right-1 rounded border border-white/10 bg-black/60 px-1 py-px font-mono text-[10px] tabular-nums text-white backdrop-blur-sm">
                {durationLabel}
              </span>
            ) : null}
            <VideoCardMarkWatchedButton
              videoId={videoId}
              channelId={channelId}
              className="absolute left-1.5 top-1.5 z-20 flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100"
            />
          </div>
        </Link>
        <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5 pr-1">
          <div className="flex items-start gap-0.5">
            {showChannelAvatar ? (
              channelHref ? (
                <Link href={channelHref} className="mt-0.5 shrink-0">
                  <ChannelAvatarCircle
                    imageUrl={channelAvatarUrl}
                    label={channel}
                    size="sm"
                  />
                </Link>
              ) : (
                <span className="mt-0.5 shrink-0">
                  <ChannelAvatarCircle
                    imageUrl={channelAvatarUrl}
                    label={channel}
                    size="sm"
                  />
                </span>
              )
            ) : null}
            <Link href={href} className="min-w-0 flex-1">
              <p className={titleClass}>{title}</p>
            </Link>
            {videoId ? (
              <VideoCardActionsMenu
                videoId={videoId}
                channelId={channelId}
                channelName={channelName}
                className="-mr-1 -mt-0.5 shrink-0"
              />
            ) : null}
          </div>
            <p
              className={`line-clamp-2 text-xs text-[hsl(var(--muted-foreground))] ${metaPadClass}`}
            >
              {channelHref ? (
                <Link
                  href={channelHref}
                  className="hover:text-[hsl(var(--foreground))] hover:underline"
                >
                  {channel}
                </Link>
              ) : (
                channel
              )}
              {publishedLabel ? (
                <>
                  <span className="mx-1 text-[hsl(var(--muted-foreground))]/60">
                    ·
                  </span>
                  <span
                    className="tabular-nums"
                    title={
                      publishedDebugTitle ?? publishedAbsoluteLabel ?? undefined
                    }
                  >
                    {publishedLabel}
                  </span>
                </>
              ) : null}
            </p>
            {showAddToQueue ? (
              <div className={metaPadClass}>
                <AddToQueueButton href={href} title={title} />
              </div>
            ) : null}
        </div>
      </div>
    </article>
  );
}

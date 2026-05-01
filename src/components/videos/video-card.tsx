import Link from "next/link";
import { ChannelAvatarCircle } from "@/components/videos/channel-avatar-circle";
import {
  formatDuration,
  formatPublishedAbsoluteLabel,
  formatPublishedDebugTitle,
  formatPublishedLabel,
  formatViews,
} from "@/lib/video-display";

type VideoCardProps = {
  href: string;
  title: string;
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
  title,
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

  return (
    <article className="group flex h-full flex-col gap-3 text-left text-[hsl(var(--foreground))]">
      <Link href={href} className="block">
        <div className="relative aspect-video w-full overflow-hidden rounded-[14px] bg-[hsl(var(--muted))] shadow-none transition duration-300 group-hover:-translate-y-0.5 group-hover:shadow-[0_20px_40px_rgba(0,0,0,0.45)]">
          {thumbnailUrl ? (
            // biome-ignore lint/performance/noImgElement: third-party instance thumbnails
            <img
              src={thumbnailUrl}
              alt=""
              className="h-full w-full object-cover transition duration-500 ease-out group-hover:scale-[1.04]"
              loading="lazy"
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
        </div>
      </Link>
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
          <Link href={href}>
            <h2 className="mb-1 line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight text-[hsl(var(--foreground))] transition group-hover:text-[hsl(var(--primary))]">
              {title}
            </h2>
          </Link>
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

type VideoCardCompactProps = {
  href: string;
  title: string;
  channelName?: string;
  channelHref?: string;
  channelAvatarUrl?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  publishedText?: string;
  publishedAt?: number;
  showChannelAvatar?: boolean;
  size?: "default" | "large";
};

export function VideoCardCompact({
  href,
  title,
  channelName,
  channelHref,
  channelAvatarUrl,
  thumbnailUrl,
  durationSeconds,
  publishedText,
  publishedAt,
  showChannelAvatar = true,
  size = "default",
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
        <Link href={href} className="block">
          <div
            className={`relative aspect-video shrink-0 overflow-hidden rounded-xl bg-[hsl(var(--muted))] ${thumbSizeClass}`}
          >
            {thumbnailUrl ? (
              // biome-ignore lint/performance/noImgElement: third-party instance thumbnails
              <img
                src={thumbnailUrl}
                alt=""
                className="h-full w-full object-cover transition duration-500 ease-out group-hover:scale-105"
                loading="lazy"
              />
            ) : null}
            {durationLabel ? (
              <span className="absolute bottom-1 right-1 rounded border border-white/10 bg-black/60 px-1 py-px font-mono text-[10px] tabular-nums text-white backdrop-blur-sm">
                {durationLabel}
              </span>
            ) : null}
          </div>
        </Link>
        <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5 pr-1">
          <div className="flex gap-2">
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
              <p className={titleClass}>
                {title}
              </p>
            </Link>
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
        </div>
      </div>
    </article>
  );
}

"use client";

import {
  applyVideoThumbnailImgError,
  preferHighResVideoThumbnailUrl,
} from "@/lib/video-thumbnail-url";

type VideoCardThumbnailImgProps = {
  url?: string;
  videoId?: string;
  className: string;
};

export function VideoCardThumbnailImg({
  url,
  videoId,
  className,
}: VideoCardThumbnailImgProps) {
  const src = preferHighResVideoThumbnailUrl(url, videoId);
  if (!src) return null;
  return (
    // biome-ignore lint/performance/noImgElement: third-party instance thumbnails
    <img
      src={src}
      alt=""
      className={className}
      loading="lazy"
      onError={(e) => applyVideoThumbnailImgError(e.currentTarget)}
    />
  );
}

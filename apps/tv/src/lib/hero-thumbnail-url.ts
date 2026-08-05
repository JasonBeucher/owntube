const HERO_THUMBNAIL_FILENAMES = [
  "maxresdefault.jpg",
  "hq720.jpg",
  "hqdefault.jpg",
] as const;

function youtubeThumbnailUrl(videoId: string, filename: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${filename}`;
}

/**
 * Card-sized thumbnail derived from the video id, for rows stored locally
 * (history, playlists, likes) that keep only ids and denormalized text.
 */
export function cardThumbnailUrl(videoId: string): string {
  return youtubeThumbnailUrl(videoId, "hqdefault.jpg");
}

function appendUniqueUrl(urls: string[], url: string | undefined): void {
  const normalizedUrl = url?.trim();
  if (!normalizedUrl || urls.includes(normalizedUrl)) return;
  urls.push(normalizedUrl);
}

export function getHeroThumbnailUrls(
  thumbnailUrl: string | undefined,
  videoId: string | undefined,
): string[] {
  const urls: string[] = [];
  const normalizedVideoId = videoId?.trim();

  if (normalizedVideoId) {
    for (const filename of HERO_THUMBNAIL_FILENAMES) {
      appendUniqueUrl(urls, youtubeThumbnailUrl(normalizedVideoId, filename));
    }
  }

  appendUniqueUrl(urls, thumbnailUrl);
  return urls;
}

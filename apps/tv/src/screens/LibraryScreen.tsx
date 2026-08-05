import type { UnifiedVideo } from "@web/server/services/proxy.types";
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { CarouselFeed, type Shelf } from "@/components/CarouselFeed";
import { cardThumbnailUrl } from "@/lib/hero-thumbnail-url";
import type { Nav } from "@/lib/navigation";
import { trpcClient } from "@/lib/trpc";
import { useInfiniteFeed } from "@/lib/use-infinite-feed";
import { useResumeProgress } from "@/lib/use-resume-progress";
import { colors, fontSize } from "@/theme";

/**
 * Saved, liked and playlist videos. Rows are built from denormalized rows
 * (title/channel are stored alongside the id), so no upstream fan-out is
 * needed — thumbnails come from the video id.
 */
export function LibraryScreen({ nav }: { nav: Nav }) {
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // A single "feed" drives the loading/error/empty chrome; the shelves
  // themselves are assembled from several independent queries.
  const feed = useInfiniteFeed<never>(
    () =>
      Promise.all([
        trpcClient.interactions.list.query({ type: "save" }),
        trpcClient.interactions.list.query({ type: "like" }),
        trpcClient.playlists.list.query(),
      ]).then(async ([saved, liked, playlists]) => {
        const playlistShelves = await Promise.all(
          playlists.slice(0, 8).map(async (playlist) => {
            const { items } = await trpcClient.playlists.items.query({
              playlistId: playlist.id,
            });
            return {
              key: `playlist-${playlist.id}`,
              title: playlist.name,
              subtitle: `${items.length} video${items.length === 1 ? "" : "s"}`,
              videos: items.map(toVideo),
            } satisfies Shelf;
          }),
        );

        const next: Shelf[] = [
          { key: "saved", title: "Saved", videos: saved.map(toVideo) },
          { key: "liked", title: "Liked", videos: liked.map(toVideo) },
          ...playlistShelves,
        ].filter((shelf) => shelf.videos.length > 0);

        if (mountedRef.current) setShelves(next);
        return {
          items: next.flatMap((shelf) => shelf.videos),
          next: undefined,
        };
      }),
    [],
  );

  const progressVideos = useMemo(
    () => shelves.flatMap((shelf) => shelf.videos),
    [shelves],
  );
  const progress = useResumeProgress(progressVideos);

  return (
    <CarouselFeed
      feed={feed}
      shelves={shelves}
      progress={progress}
      onSelect={(videoId) =>
        nav.openVideo(videoId, progress.get(videoId)?.positionSeconds)
      }
      header={<Text style={styles.heading}>Library</Text>}
      emptyText="Nothing saved yet - like or save a video to see it here."
    />
  );
}

type StoredVideo = {
  videoId: string;
  channelId?: string | null;
  videoTitle?: string | null;
  channelName?: string | null;
};

function toVideo(row: StoredVideo): UnifiedVideo {
  return {
    videoId: row.videoId,
    title: row.videoTitle ?? row.videoId,
    channelId: row.channelId ?? undefined,
    channelName: row.channelName ?? undefined,
    thumbnailUrl: cardThumbnailUrl(row.videoId),
  };
}

const styles = StyleSheet.create({
  heading: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: "700",
  },
});

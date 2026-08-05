import { useRef } from "react";
import { StyleSheet, Text } from "react-native";
import { CarouselFeed } from "@/components/CarouselFeed";
import { cardThumbnailUrl } from "@/lib/hero-thumbnail-url";
import type { Nav } from "@/lib/navigation";
import { trpcClient } from "@/lib/trpc";
import { useInfiniteFeed } from "@/lib/use-infinite-feed";
import { useResumeProgress } from "@/lib/use-resume-progress";
import { colors, fontSize } from "@/theme";

const PAGE_SIZE = 24;

/**
 * Watch history as stacked carousels. Selecting an entry resumes from the saved
 * playback offset (kept in a side map since the feed carries only videos).
 */
export function HistoryScreen({ nav }: { nav: Nav }) {
  const resumeRef = useRef<Map<string, number>>(new Map());

  const feed = useInfiniteFeed<number>(
    (page) =>
      trpcClient.history.list
        .query({ page: page ?? 1, pageSize: PAGE_SIZE })
        .then((rows) => {
          for (const row of rows) {
            resumeRef.current.set(row.videoId, row.positionSeconds);
          }
          return {
            items: rows.map((row) => ({
              videoId: row.videoId,
              title: row.videoTitle,
              thumbnailUrl: row.thumbnailUrl ?? cardThumbnailUrl(row.videoId),
              channelId: row.channelId,
              channelName: row.channelName,
              durationSeconds: row.videoDurationSeconds || undefined,
            })),
            next: rows.length === PAGE_SIZE ? (page ?? 1) + 1 : undefined,
          };
        }),
    [],
  );
  const progress = useResumeProgress(feed.videos);

  return (
    <CarouselFeed
      feed={feed}
      onSelect={(videoId) =>
        nav.openVideo(videoId, resumeRef.current.get(videoId))
      }
      progress={progress}
      header={<Text style={styles.heading}>History</Text>}
      emptyText="Nothing watched yet."
    />
  );
}

const styles = StyleSheet.create({
  heading: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: "700",
  },
});

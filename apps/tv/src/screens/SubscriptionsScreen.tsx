import { StyleSheet, Text } from "react-native";
import { CarouselFeed } from "@/components/CarouselFeed";
import type { Nav } from "@/lib/navigation";
import { trpcClient } from "@/lib/trpc";
import { useInfiniteFeed } from "@/lib/use-infinite-feed";
import { useResumeProgress } from "@/lib/use-resume-progress";
import { colors, fontSize } from "@/theme";

const PAGE_SIZE = 24;

/**
 * Latest uploads merged across followed channels. Uses the cursor-paginated
 * feed rather than `mergedFeed`, which fans out over *every* subscribed channel
 * before returning anything — first paint here costs one page, and each video
 * arrives with a `watched` flag so seen uploads can be dimmed.
 */
export function SubscriptionsScreen({ nav }: { nav: Nav }) {
  const feed = useInfiniteFeed<string>(
    (cursor) =>
      trpcClient.subscriptions.mergedFeedInfinite
        .query({ limit: PAGE_SIZE, cursor })
        .then((result) => ({
          items: result.videos,
          next: result.nextCursor ?? undefined,
        })),
    [],
  );
  const progress = useResumeProgress(feed.videos);

  return (
    <CarouselFeed
      feed={feed}
      onSelect={(videoId) =>
        nav.openVideo(videoId, progress.get(videoId)?.positionSeconds)
      }
      progress={progress}
      header={<Text style={styles.heading}>Subscriptions</Text>}
      emptyText="You're not subscribed to any channels yet."
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

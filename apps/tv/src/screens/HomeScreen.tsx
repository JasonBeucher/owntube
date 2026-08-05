import type { UnifiedVideo } from "@web/server/services/proxy.types";
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CarouselFeed, type Shelf } from "@/components/CarouselFeed";
import { HomeHero } from "@/components/HomeHero";
import { cardThumbnailUrl } from "@/lib/hero-thumbnail-url";
import type { Nav } from "@/lib/navigation";
import { trpcClient } from "@/lib/trpc";
import { useInfiniteFeed } from "@/lib/use-infinite-feed";
import { useResumeProgress } from "@/lib/use-resume-progress";
import { colors, fontSize, spacing } from "@/theme";

/** Skip barely-started and near-finished videos — neither is worth resuming. */
const RESUME_MIN_SECONDS = 30;
const RESUME_TAIL_SECONDS = 30;
const CONTINUE_SHELF_SIZE = 12;
const SUBSCRIPTIONS_SHELF_SIZE = 24;
/** Videos per generated shelf once the named ones run out. */
const TAIL_SHELF_SIZE = 12;

type SideShelves = {
  continueWatching: UnifiedVideo[];
  subscriptions: UnifiedVideo[];
};

/**
 * Personalized home feed as named shelves — Continue watching, new uploads from
 * subscriptions, then the recommendation pool. The extra shelves are composed
 * client-side from procedures that already exist and are cached server-side, so
 * this needs no dedicated feed endpoint; each lands independently rather than
 * blocking the screen on the slowest one.
 */
export function HomeScreen({ nav }: { nav: Nav }) {
  const mountedRef = useRef(true);
  const [personalized, setPersonalized] = useState(false);
  const [region, setRegion] = useState("");
  const [side, setSide] = useState<SideShelves>({
    continueWatching: [],
    subscriptions: [],
  });

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const feed = useInfiniteFeed<number>(
    (page) =>
      trpcClient.feed.home.query({ page: page ?? 1 }).then((result) => {
        if (page === undefined && mountedRef.current) {
          setPersonalized(
            result.kind === "personalized" && result.coldStart !== true,
          );
          setRegion(result.region);
        }
        return {
          items: result.videos,
          next: result.hasMore ? (page ?? 1) + 1 : undefined,
        };
      }),
    [],
  );

  useEffect(() => {
    trpcClient.history.list
      .query({ page: 1, pageSize: 40 })
      .then((rows) => {
        if (!mountedRef.current) return;
        const resumable = rows
          .filter(
            (row) =>
              !row.completed &&
              row.positionSeconds > RESUME_MIN_SECONDS &&
              (row.videoDurationSeconds === 0 ||
                row.positionSeconds <
                  row.videoDurationSeconds - RESUME_TAIL_SECONDS),
          )
          .slice(0, CONTINUE_SHELF_SIZE)
          .map(
            (row): UnifiedVideo => ({
              videoId: row.videoId,
              title: row.videoTitle,
              channelId: row.channelId,
              channelName: row.channelName,
              thumbnailUrl: row.thumbnailUrl ?? cardThumbnailUrl(row.videoId),
              durationSeconds: row.videoDurationSeconds || undefined,
            }),
          );
        setSide((previous) => ({ ...previous, continueWatching: resumable }));
      })
      .catch(() => {});

    trpcClient.subscriptions.mergedFeedInfinite
      .query({ limit: SUBSCRIPTIONS_SHELF_SIZE })
      .then((result) => {
        if (!mountedRef.current) return;
        setSide((previous) => ({
          ...previous,
          subscriptions: result.videos.filter((video) => !video.watched),
        }));
      })
      .catch(() => {});
  }, []);

  const heroVideo = feed.videos[0];
  // Memoized: a fresh slice each render would re-trigger every dependent hook.
  const poolVideos = useMemo(() => feed.videos.slice(1), [feed.videos]);

  const shelves = useMemo((): Shelf[] => {
    const rows: Shelf[] = [];
    if (side.continueWatching.length > 0) {
      rows.push({
        key: "continue",
        title: "Continue watching",
        videos: side.continueWatching,
      });
    }
    if (side.subscriptions.length > 0) {
      rows.push({
        key: "subscriptions",
        title: "New from your subscriptions",
        videos: side.subscriptions,
      });
    }
    for (let i = 0; i < poolVideos.length; i += TAIL_SHELF_SIZE) {
      const chunkIndex = i / TAIL_SHELF_SIZE;
      const first = chunkIndex === 0;
      rows.push({
        key: `pool-${chunkIndex}`,
        title: personalized
          ? first
            ? "For you"
            : "More for you"
          : first
            ? "Trending"
            : "More trending",
        subtitle: !first
          ? undefined
          : personalized
            ? "Based on the channels you watched recently."
            : region
              ? `Trending ${region}`
              : undefined,
        videos: poolVideos.slice(i, i + TAIL_SHELF_SIZE),
      });
    }
    return rows;
  }, [side, poolVideos, personalized, region]);

  const progressVideos = useMemo(
    () => shelves.flatMap((shelf) => shelf.videos),
    [shelves],
  );
  const progress = useResumeProgress(progressVideos);

  const header = heroVideo ? (
    <View style={styles.header}>
      <HomeHero
        video={heroVideo}
        label={personalized ? "Top pick for you" : "Trending now"}
        onPress={(videoId) => nav.openVideo(videoId)}
      />
    </View>
  ) : (
    <Text style={styles.heading}>Home</Text>
  );

  return (
    <CarouselFeed
      feed={feed}
      onSelect={(videoId) =>
        nav.openVideo(videoId, progress.get(videoId)?.positionSeconds)
      }
      header={header}
      shelves={shelves}
      progress={progress}
      preferFirstRowFocus={false}
      emptyText={
        heroVideo
          ? "Scroll to load more rows."
          : "No recommendations yet - watch a few videos to get started."
      }
    />
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.lg,
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  heading: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: "700",
  },
});

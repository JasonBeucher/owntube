import type { UnifiedVideo } from "@web/server/services/proxy.types";
import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { VideoRow } from "@/components/VideoRow";
import type { InfiniteFeed } from "@/lib/use-infinite-feed";
import type { ResumeMap } from "@/lib/use-resume-progress";
import { colors, fontSize, spacing } from "@/theme";

/** Videos per horizontal shelf; more pages append more shelves. */
const ROW_SIZE = 12;

/** A named shelf. Screens that have no meaningful grouping just pass videos. */
export type Shelf = {
  key: string;
  title?: string;
  subtitle?: string;
  videos: UnifiedVideo[];
};

type Props = {
  feed: InfiniteFeed;
  onSelect: (videoId: string) => void;
  header?: ReactNode;
  emptyText?: string;
  videos?: UnifiedVideo[];
  /** Named shelves; when omitted the flat video list is chunked into unnamed rows. */
  shelves?: Shelf[];
  preferFirstRowFocus?: boolean;
  progress?: ResumeMap;
};

/**
 * Stacked horizontal carousels (YouTube-TV style): shelves a user scrolls
 * through with D-pad right, and scrolling down past the last one pulls the next
 * page (`feed.loadMore`).
 */
export function CarouselFeed({
  feed,
  onSelect,
  header,
  emptyText,
  videos,
  shelves,
  preferFirstRowFocus = true,
  progress,
}: Props) {
  const listVideos = videos ?? feed.videos;
  const rows = useMemo(
    (): Shelf[] =>
      shelves ??
      chunk(listVideos, ROW_SIZE).map((rowVideos, index) => ({
        key: `shelf-${index}`,
        videos: rowVideos,
      })),
    [shelves, listVideos],
  );
  const isEmpty = shelves
    ? shelves.every((shelf) => shelf.videos.length === 0)
    : listVideos.length === 0;

  if (feed.status === "loading") {
    return (
      <View style={styles.centered}>
        {header}
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  if (feed.status === "error") {
    return (
      <View style={styles.centered}>
        {header}
        <Text style={styles.errorTitle}>Something went wrong</Text>
        <Text style={styles.muted}>{feed.message}</Text>
        <FocusButton
          label="Retry"
          variant="primary"
          onPress={feed.refetch}
          hasTVPreferredFocus
          style={styles.retryButton}
        />
      </View>
    );
  }

  if (isEmpty) {
    return (
      <View style={styles.emptyContainer}>
        {header ? <View style={styles.header}>{header}</View> : null}
        <Text style={styles.muted}>{emptyText ?? "Nothing here yet."}</Text>
        {feed.loadingMore ? (
          <ActivityIndicator size="small" color={colors.brand} />
        ) : null}
      </View>
    );
  }

  return (
    <FlatList
      data={rows.filter((shelf) => shelf.videos.length > 0)}
      keyExtractor={(shelf) => shelf.key}
      ListHeaderComponent={
        header ? <View style={styles.header}>{header}</View> : null
      }
      renderItem={({ item, index }) => (
        <VideoRow
          title={item.title}
          subtitle={item.subtitle}
          videos={item.videos}
          onSelect={onSelect}
          preferFirstFocus={preferFirstRowFocus && index === 0}
          progress={progress}
        />
      )}
      ItemSeparatorComponent={Gap}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
      onEndReached={feed.loadMore}
      onEndReachedThreshold={0.6}
      ListFooterComponent={
        feed.loadingMore ? (
          <ActivityIndicator
            style={styles.footer}
            size="small"
            color={colors.brand}
          />
        ) : null
      }
    />
  );
}

function Gap() {
  return <View style={{ height: spacing.xl }} />;
}

function chunk(videos: UnifiedVideo[], size: number): UnifiedVideo[][] {
  const rows: UnifiedVideo[][] = [];
  for (let i = 0; i < videos.length; i += size) {
    rows.push(videos.slice(i, i + size));
  }
  return rows;
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing.screen },
  header: { marginBottom: spacing.lg },
  footer: { paddingVertical: spacing.lg },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "flex-start",
    gap: spacing.md,
  },
  errorTitle: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
  retryButton: { minWidth: 180, marginTop: spacing.xs },
  muted: { color: colors.mutedForeground, fontSize: fontSize.md },
});

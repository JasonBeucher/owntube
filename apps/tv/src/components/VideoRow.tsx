import type { UnifiedVideo } from "@web/server/services/proxy.types";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { VIDEO_CARD_WIDTH, VideoCard } from "@/components/VideoCard";
import { type ResumeMap, resumeFraction } from "@/lib/use-resume-progress";
import { colors, fontSize, spacing } from "@/theme";

type Props = {
  title?: string;
  subtitle?: string;
  videos: UnifiedVideo[];
  onSelect: (videoId: string) => void;
  /** Focus the first card of this row when the content area first gains focus. */
  preferFirstFocus?: boolean;
  progress?: ResumeMap;
};

/**
 * A D-pad horizontally-scrollable row of video cards (optionally titled).
 * FlatList keeps long upstream feeds virtualized, and TV focus naturally scrolls
 * the row as the user moves right past the viewport edge.
 */
export function VideoRow({
  title,
  subtitle,
  videos,
  onSelect,
  preferFirstFocus,
  progress,
}: Props) {
  return (
    <View style={styles.row}>
      {title ? (
        <View style={styles.heading}>
          <Text style={styles.headingText}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      ) : null}
      <FlatList
        horizontal
        data={videos}
        keyExtractor={(video) => video.videoId}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={Separator}
        renderItem={({ item, index }) => {
          const entry = progress?.get(item.videoId);
          return (
            <VideoCard
              video={item}
              onPress={onSelect}
              hasTVPreferredFocus={preferFirstFocus && index === 0}
              progress={resumeFraction(entry)}
              watched={entry?.completed}
            />
          );
        }}
        getItemLayout={(_, index) => ({
          length: VIDEO_CARD_WIDTH + spacing.md,
          offset: (VIDEO_CARD_WIDTH + spacing.md) * index,
          index,
        })}
      />
    </View>
  );
}

function Separator() {
  return <View style={{ width: spacing.md }} />;
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, overflow: "visible" },
  listContent: {
    paddingVertical: 6,
    paddingHorizontal: 3,
  },
  heading: { gap: 2 },
  headingText: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
  subtitle: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
  },
});

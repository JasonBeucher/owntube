import type { UnifiedVideo } from "@web/server/services/proxy.types";
import { Image, StyleSheet, Text, View } from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { colors, fontSize, radius, spacing } from "@/theme";

type Props = {
  video: UnifiedVideo;
  secondsLeft: number;
  onPlayNow: () => void;
  onCancel: () => void;
};

/** Autoplay countdown shown when a video ends, cancellable from the remote. */
export function PlayerUpNext({
  video,
  secondsLeft,
  onPlayNow,
  onCancel,
}: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>Up next in {secondsLeft}s</Text>
      <View style={styles.row}>
        {video.thumbnailUrl ? (
          <Image
            source={{ uri: video.thumbnailUrl }}
            style={styles.thumb}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]} />
        )}
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={2}>
            {video.title}
          </Text>
          {video.channelName ? (
            <Text style={styles.channel} numberOfLines={1}>
              {video.channelName}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.actions}>
        <FocusButton
          label="Play now"
          variant="primary"
          onPress={onPlayNow}
          hasTVPreferredFocus
          style={styles.action}
        />
        <FocusButton label="Cancel" onPress={onCancel} style={styles.action} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: "flex-end",
    width: 520,
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.cardElevated,
  },
  label: {
    color: colors.brand,
    fontSize: fontSize.sm,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  row: { flexDirection: "row", gap: spacing.md },
  thumb: {
    width: 160,
    height: 90,
    borderRadius: radius.shell,
    backgroundColor: colors.muted,
  },
  thumbPlaceholder: { backgroundColor: colors.muted },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  title: {
    color: colors.foreground,
    fontSize: fontSize.md,
    fontWeight: "700",
  },
  channel: { color: colors.mutedForeground, fontSize: fontSize.sm },
  actions: { flexDirection: "row", gap: spacing.sm },
  action: { flex: 1 },
});

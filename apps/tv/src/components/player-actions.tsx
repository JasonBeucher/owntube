import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { trpcClient } from "@/lib/trpc";
import { colors, focus, fontSize, radius, spacing } from "@/theme";

type InteractionType = "like" | "dislike" | "save";

type Props = {
  videoId: string;
  channelId?: string;
  videoTitle?: string;
  channelName?: string;
};

/**
 * Like / dislike / save / subscribe from the player. All four were reachable
 * only from the web app before, which made the TV client read-only.
 */
export function PlayerActions({
  videoId,
  channelId,
  videoTitle,
  channelName,
}: Props) {
  const [state, setState] = useState({
    like: false,
    dislike: false,
    save: false,
  });
  const [subscribed, setSubscribed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    trpcClient.interactions.state
      .query({ videoId })
      .then((result) => {
        if (!cancelled) setState(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    trpcClient.subscriptions.status
      .query({ channelId })
      .then((result) => {
        if (!cancelled) setSubscribed(result.subscribed);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const toggle = useCallback(
    (type: InteractionType) => {
      const active = !state[type];
      // Optimistic: a TV remote gives no other feedback that the press landed.
      setState((previous) => ({
        ...previous,
        [type]: active,
        // Like and dislike are mutually exclusive, same as the web.
        ...(type === "like" && active ? { dislike: false } : {}),
        ...(type === "dislike" && active ? { like: false } : {}),
      }));
      trpcClient.interactions.set
        .mutate({
          videoId,
          channelId,
          type,
          active,
          videoTitle,
          channelName,
        })
        .catch(() => {});
    },
    [state, videoId, channelId, videoTitle, channelName],
  );

  const toggleSubscription = useCallback(() => {
    if (!channelId || subscribed === null) return;
    const next = !subscribed;
    setSubscribed(next);
    const call = next
      ? trpcClient.subscriptions.add.mutate({ channelId })
      : trpcClient.subscriptions.remove.mutate({ channelId });
    call.catch(() => setSubscribed(!next));
  }, [channelId, subscribed]);

  return (
    <View style={styles.row}>
      <ActionChip
        icon="thumbs-up"
        label={state.like ? "Liked" : "Like"}
        active={state.like}
        onPress={() => toggle("like")}
      />
      <ActionChip
        icon="thumbs-down"
        label={state.dislike ? "Disliked" : "Dislike"}
        active={state.dislike}
        onPress={() => toggle("dislike")}
      />
      <ActionChip
        icon="bookmark"
        label={state.save ? "Saved" : "Save"}
        active={state.save}
        onPress={() => toggle("save")}
      />
      {channelId ? (
        <ActionChip
          icon="user-plus"
          label={subscribed ? "Subscribed" : "Subscribe"}
          active={subscribed === true}
          onPress={toggleSubscription}
        />
      ) : null}
    </View>
  );
}

function ActionChip({
  icon,
  label,
  active,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const tint = focused
    ? colors.primaryForeground
    : active
      ? colors.brand
      : colors.foreground;

  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[
        styles.chip,
        active && styles.chipActive,
        focused && styles.chipFocused,
      ]}
    >
      <Feather name={icon} size={20} color={tint} />
      <Text style={[styles.chipText, { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.shell,
    backgroundColor: colors.surface,
    borderWidth: focus.borderWidth,
    borderColor: colors.surfaceBorder,
  },
  chipActive: {
    backgroundColor: colors.brandSoft,
    borderColor: colors.brand,
  },
  chipFocused: {
    backgroundColor: colors.brand,
    borderColor: colors.primaryForeground,
    transform: [{ scale: focus.scale }],
  },
  chipText: { fontSize: fontSize.md, fontWeight: "700" },
});

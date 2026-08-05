import { useCallback, useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { CarouselFeed } from "@/components/CarouselFeed";
import { FocusButton } from "@/components/FocusButton";
import { channelInitial, formatSubscribersLabel } from "@/lib/format";
import type { Nav } from "@/lib/navigation";
import { trpcClient } from "@/lib/trpc";
import { useInfiniteFeed } from "@/lib/use-infinite-feed";
import { useResumeProgress } from "@/lib/use-resume-progress";
import { colors, fontSize, radius, spacing } from "@/theme";

type ChannelMeta = {
  name?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  subscriberCount?: number;
};

type Tab = "videos" | "shorts";

/** A channel's videos as stacked carousels, reachable from the player. */
export function ChannelScreen({
  channelId,
  nav,
}: {
  channelId: string;
  nav: Nav;
}) {
  const [meta, setMeta] = useState<ChannelMeta>({});
  const [tab, setTab] = useState<Tab>("videos");
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [subscribePending, setSubscribePending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSubscribed(null);
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

  const toggleSubscription = useCallback(() => {
    if (subscribed === null || subscribePending) return;
    const next = !subscribed;
    setSubscribePending(true);
    const call = next
      ? trpcClient.subscriptions.add.mutate({ channelId })
      : trpcClient.subscriptions.remove.mutate({ channelId });
    call
      .then(() => setSubscribed(next))
      .catch(() => {})
      .finally(() => setSubscribePending(false));
  }, [channelId, subscribed, subscribePending]);

  const feed = useInfiniteFeed<string>(
    (continuation) =>
      trpcClient.channel.page
        .query({ channelId, tab, continuation })
        .then((page) => {
          // Channel metadata only comes back on the first (non-continuation) page.
          if (!continuation) {
            setMeta({
              name: page.name,
              avatarUrl: page.avatarUrl,
              bannerUrl: page.bannerUrl,
              subscriberCount: page.subscriberCount,
            });
          }
          return { items: page.videos, next: page.continuation ?? undefined };
        }),
    [channelId, tab],
  );
  const progress = useResumeProgress(feed.videos);

  const subscribersLabel = formatSubscribersLabel(meta.subscriberCount);
  const header = (
    <View style={styles.headerWrap}>
      {meta.bannerUrl ? (
        <Image
          source={{ uri: meta.bannerUrl }}
          style={styles.banner}
          resizeMode="cover"
        />
      ) : null}
      <View style={styles.header}>
        {meta.avatarUrl ? (
          <Image source={{ uri: meta.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>
              {channelInitial(meta.name)}
            </Text>
          </View>
        )}
        <View style={styles.identity}>
          <Text style={styles.name}>{meta.name ?? "Channel"}</Text>
          {subscribersLabel ? (
            <Text style={styles.subs}>{subscribersLabel}</Text>
          ) : null}
        </View>
        <FocusButton
          label={subscribed ? "Subscribed" : "Subscribe"}
          variant={subscribed ? "ghost" : "primary"}
          loading={subscribePending}
          disabled={subscribed === null}
          onPress={toggleSubscription}
          style={styles.subscribeButton}
        />
      </View>
      <View style={styles.tabs}>
        <FocusButton
          label="Videos"
          variant={tab === "videos" ? "primary" : "ghost"}
          onPress={() => setTab("videos")}
          style={styles.tabButton}
        />
        <FocusButton
          label="Shorts"
          variant={tab === "shorts" ? "primary" : "ghost"}
          onPress={() => setTab("shorts")}
          style={styles.tabButton}
        />
      </View>
    </View>
  );

  return (
    <CarouselFeed
      feed={feed}
      onSelect={(videoId) =>
        nav.openVideo(videoId, progress.get(videoId)?.positionSeconds)
      }
      progress={progress}
      header={header}
      emptyText={
        tab === "shorts"
          ? "This channel has no shorts."
          : "This channel has no videos."
      }
    />
  );
}

const styles = StyleSheet.create({
  headerWrap: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.cardElevated,
    overflow: "hidden",
  },
  banner: { width: "100%", height: 132, backgroundColor: colors.muted },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
  identity: { flex: 1, minWidth: 0 },
  subscribeButton: { minWidth: 210 },
  tabs: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  tabButton: { minWidth: 150 },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.muted,
  },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  avatarInitial: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: "800",
  },
  name: { color: colors.foreground, fontSize: fontSize.xl, fontWeight: "700" },
  subs: { color: colors.mutedForeground, fontSize: fontSize.md, marginTop: 4 },
});

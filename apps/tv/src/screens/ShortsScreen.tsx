import type { UnifiedVideo } from "@web/server/services/proxy.types";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  useTVEventHandler,
  View,
} from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { buildPlaybackOptions } from "@/lib/playback-options";
import { trpcClient } from "@/lib/trpc";
import { errorMessage } from "@/lib/use-query";
import { colors, fontSize, radius, spacing } from "@/theme";

const FEED_LIMIT = 20;
/** Fetch the next batch this many items before the end of the current one. */
const PREFETCH_MARGIN = 4;

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; videos: UnifiedVideo[] };

/**
 * Vertical shorts pager: D-pad up/down moves between clips, which play
 * full-screen and loop. Reuses the watch screen's stream selection so
 * adaptive-only shorts still play.
 */
export function ShortsScreen() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [index, setIndex] = useState(0);
  const seenRef = useRef<Set<string>>(new Set());
  const cursorRef = useRef<string | undefined>(undefined);
  const loadingMoreRef = useRef(false);

  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
  });

  const load = useCallback((append: boolean) => {
    if (append && loadingMoreRef.current) return;
    loadingMoreRef.current = append;
    trpcClient.shorts.feed
      .query({
        limit: FEED_LIMIT,
        purpose: "feed",
        cursor: append ? cursorRef.current : undefined,
        excludeVideoIds: append
          ? [...seenRef.current].slice(0, 200)
          : undefined,
      })
      .then((result) => {
        cursorRef.current = result.nextCursor ?? undefined;
        loadingMoreRef.current = false;
        setState((previous) => {
          const existing =
            append && previous.status === "ready" ? previous.videos : [];
          const known = new Set(existing.map((video) => video.videoId));
          return {
            status: "ready",
            videos: [
              ...existing,
              ...result.videos.filter((video) => !known.has(video.videoId)),
            ],
          };
        });
      })
      .catch((err: unknown) => {
        loadingMoreRef.current = false;
        if (!append) {
          setState({ status: "error", message: errorMessage(err) });
        }
      });
  }, []);

  useEffect(() => load(false), [load]);

  const videos = state.status === "ready" ? state.videos : [];
  const current = videos[index];

  // Load the current short and mark it seen so the server stops serving it.
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    trpcClient.video.detail
      .query({ videoId: current.videoId })
      .then((detail) => {
        if (cancelled) return;
        const option = buildPlaybackOptions(detail)[0];
        if (!option) return;
        player.replace(option.videoUrl);
        player.play();
      })
      .catch(() => {});

    if (!seenRef.current.has(current.videoId)) {
      seenRef.current.add(current.videoId);
      trpcClient.shorts.markSeen
        .mutate({
          videoId: current.videoId,
          channelId: current.channelId ?? "unknown",
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [current, player]);

  useEffect(() => {
    if (videos.length > 0 && index >= videos.length - PREFETCH_MARGIN) {
      load(true);
    }
  }, [index, videos.length, load]);

  useTVEventHandler((event) => {
    if (event.eventKeyAction === 1) return;
    if (event.eventType === "down") {
      setIndex((i) => Math.min(videos.length - 1, i + 1));
    }
    if (event.eventType === "up") {
      setIndex((i) => Math.max(0, i - 1));
    }
  });

  if (state.status === "loading") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  if (state.status === "error") {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Shorts unavailable</Text>
        <Text style={styles.muted}>{state.message}</Text>
        <FocusButton
          label="Retry"
          variant="primary"
          onPress={() => load(false)}
          hasTVPreferredFocus
          style={styles.retry}
        />
      </View>
    );
  }

  if (!current) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>No shorts right now.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.stage}>
        <VideoView
          style={StyleSheet.absoluteFill}
          player={player}
          contentFit="contain"
          nativeControls={false}
        />
      </View>
      <View style={styles.meta}>
        <Text style={styles.counter}>
          {index + 1} / {videos.length}
        </Text>
        <Text style={styles.title} numberOfLines={2}>
          {current.title}
        </Text>
        {current.channelName ? (
          <Text style={styles.channel} numberOfLines={1}>
            {current.channelName}
          </Text>
        ) : null}
        <Text style={styles.hint}>Up / Down to browse</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: "row", gap: spacing.lg },
  stage: {
    width: 420,
    borderRadius: radius.card,
    overflow: "hidden",
    backgroundColor: colors.videoBackground,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  meta: { flex: 1, justifyContent: "center", gap: spacing.sm },
  counter: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    fontWeight: "700",
  },
  title: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: "800",
  },
  channel: { color: colors.mutedForeground, fontSize: fontSize.md },
  hint: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    marginTop: spacing.lg,
  },
  centered: {
    flex: 1,
    alignItems: "flex-start",
    justifyContent: "center",
    gap: spacing.md,
  },
  errorTitle: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
  muted: { color: colors.mutedForeground, fontSize: fontSize.md },
  retry: { minWidth: 180 },
});

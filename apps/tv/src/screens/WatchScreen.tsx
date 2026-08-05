import type { SponsorBlockSegment } from "@web/lib/sponsorblock";
import type {
  UnifiedVideo,
  VideoDetail,
} from "@web/server/services/proxy.types";
import { useKeepAwake } from "expo-keep-awake";
import { useVideoPlayer, type VideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  useTVEventHandler,
  View,
} from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { IconButton } from "@/components/IconButton";
import { PlayerActions } from "@/components/player-actions";
import { PlayerComments } from "@/components/player-comments";
import { PlayerProgressBar } from "@/components/player-progress-bar";
import {
  PlayerQualityMenu,
  type PlayerQualityOption,
} from "@/components/player-quality-menu";
import { PlayerUpNext } from "@/components/player-up-next";
import { VideoRow } from "@/components/VideoRow";
import {
  buildPlaybackOptions,
  type PlaybackOption,
} from "@/lib/playback-options";
import { trpcClient } from "@/lib/trpc";
import { errorMessage } from "@/lib/use-query";
import { useWatchProgress } from "@/lib/use-watch-progress";
import { colors, focus, fontSize, radius, spacing } from "@/theme";

// expo-video 2.0 doesn't re-export SubtitleTrack from its entrypoint; derive it
// from the player rather than reaching into the package's build output.
type SubtitleTrack = VideoPlayer["availableSubtitleTracks"][number];

const SEEK_STEP_SECONDS = 10;
/** Held-down arrows jump further, so scrubbing a long video isn't a chore. */
const LONG_SEEK_STEP_SECONDS = 30;
const UP_NEXT_COUNTDOWN_SECONDS = 10;

// Skip-type categories auto-skipped on TV (filler excluded — too aggressive).
const SKIP_CATEGORIES = [
  "sponsor",
  "selfpromo",
  "intro",
  "outro",
  "interaction",
  "preview",
] as const;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      detail: VideoDetail;
      playbackOptions: PlaybackOption[];
      selectedOptionIndex: number;
    };

/**
 * Full watch screen: plays the stream via ExoPlayer, resumes from a saved
 * offset, auto-skips SponsorBlock segments, records watch progress to history,
 * and shows a related-videos rail + channel link when paused.
 *
 * Stream selection prefers HLS auto quality, then muxed progressive MP4 streams.
 * Adaptive-only HD rows are played as synchronized video-only + audio sources.
 */
export function WatchScreen({
  videoId,
  resumeSeconds,
  active = true,
  onOpenVideo,
  onOpenChannel,
  onBack,
}: {
  videoId: string;
  resumeSeconds?: number;
  /** False while a channel page is pushed over the player (still mounted). */
  active?: boolean;
  onOpenVideo: (videoId: string) => void;
  onOpenChannel: (channelId: string) => void;
  onBack: () => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [isPlaying, setIsPlaying] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [channelFocused, setChannelFocused] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  // Subtitles come from the stream itself: expo-video can only expose tracks
  // embedded in the source, which HLS (the default "Auto" option) carries.
  // Progressive/split streams have none, so the button hides for them.
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [subtitleIndex, setSubtitleIndex] = useState(0);
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read by the auto-hide timer to avoid hiding controls while paused.
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  // Either picker being open pins the overlay open.
  const menuOpenRef = useRef(false);
  menuOpenRef.current = qualityMenuOpen || subtitleMenuOpen;
  const controlsVisibleRef = useRef(controlsVisible);
  controlsVisibleRef.current = controlsVisible;

  // Latest values the timeUpdate listener and unmount cleanup read without
  // re-subscribing on every change.
  const currentTimeRef = useRef(0);
  const segmentsRef = useRef<SponsorBlockSegment[]>([]);
  const detailRef = useRef<VideoDetail | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const shouldPlayAfterReplaceRef = useRef(true);
  const selectedOptionRef = useRef<PlaybackOption | null>(null);

  // expo-video doesn't hold a wake lock, so without this the TV screensaver
  // kicks in partway through a film.
  useKeepAwake();

  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 1;
  });
  const audioPlayer = useVideoPlayer(null, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 1;
  });

  // Playback detail (blocking) + SponsorBlock/related (best-effort, parallel).
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    detailRef.current = null;
    currentTimeRef.current = 0;
    segmentsRef.current = [];
    pendingSeekRef.current = null;
    shouldPlayAfterReplaceRef.current = true;
    selectedOptionRef.current = null;
    setQualityMenuOpen(false);

    trpcClient.video.detail
      .query({ videoId })
      .then((detail) => {
        if (cancelled) return;
        detailRef.current = detail;
        const playbackOptions = buildPlaybackOptions(detail);
        if (playbackOptions.length === 0) {
          setState({
            status: "error",
            message: "This video has no playable stream available.",
          });
          return;
        }
        setState({
          status: "ready",
          detail,
          playbackOptions,
          selectedOptionIndex: 0,
        });

        trpcClient.sponsorblock.segments
          .query({
            videoId,
            categories: [...SKIP_CATEGORIES],
            durationSeconds: detail.durationSeconds,
          })
          .then((segments) => {
            if (!cancelled) segmentsRef.current = segments;
          })
          .catch(() => {});
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({ status: "error", message: errorMessage(err) });
      });

    return () => {
      cancelled = true;
    };
  }, [videoId]);

  const [related, setRelated] = useState<UnifiedVideo[]>([]);
  useEffect(() => {
    let cancelled = false;
    setRelated([]);
    trpcClient.video.related
      .query({ videoId })
      .then((result) => {
        if (!cancelled) setRelated(result.videos);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  // Load the stream and resume from the saved offset.
  useEffect(() => {
    if (state.status !== "ready") return;
    const selectedOption = state.playbackOptions[state.selectedOptionIndex];
    if (!selectedOption) return;

    selectedOptionRef.current = selectedOption;
    if (selectedOption.kind === "split") {
      player.muted = true;
      player.replace(selectedOption.videoUrl);
      audioPlayer.replace(selectedOption.audioUrl);
    } else {
      player.muted = false;
      player.replace(selectedOption.videoUrl);
      audioPlayer.pause();
      audioPlayer.replace(null);
    }
    const startSeconds = pendingSeekRef.current ?? resumeSeconds;
    pendingSeekRef.current = null;
    if (startSeconds && startSeconds > 5) {
      player.currentTime = startSeconds;
      if (selectedOption.kind === "split")
        audioPlayer.currentTime = startSeconds;
    }
    const shouldPlay = shouldPlayAfterReplaceRef.current;
    shouldPlayAfterReplaceRef.current = true;
    if (shouldPlay) {
      player.play();
      if (selectedOption.kind === "split") audioPlayer.play();
    } else {
      player.pause();
      audioPlayer.pause();
    }
    setIsPlaying(shouldPlay);
  }, [state, player, audioPlayer, resumeSeconds]);

  // SponsorBlock auto-skip: on each tick, jump past any segment we're inside.
  useEffect(() => {
    const sub = player.addListener("timeUpdate", ({ currentTime }) => {
      currentTimeRef.current = currentTime;
      setCurrentTime(currentTime);
      const hit = segmentsRef.current.find(
        (s) =>
          currentTime >= s.startSeconds && currentTime < s.endSeconds - 0.5,
      );
      const selectedOption = selectedOptionRef.current;
      if (hit) {
        player.currentTime = hit.endSeconds;
        if (selectedOption?.kind === "split") {
          audioPlayer.currentTime = hit.endSeconds;
        }
        return;
      }
      if (selectedOption?.kind === "split") {
        const audioDelta = Math.abs(audioPlayer.currentTime - currentTime);
        if (audioDelta > 0.75) audioPlayer.currentTime = currentTime;
        if (isPlayingRef.current && !audioPlayer.playing) audioPlayer.play();
      }
    });
    return () => sub.remove();
  }, [player, audioPlayer]);

  // The shell keeps the player mounted while a channel page sits on top of it
  // (so Back resumes instead of restarting) — pause so audio doesn't keep
  // running behind the other screen.
  useEffect(() => {
    if (active) return;
    player.pause();
    audioPlayer.pause();
    setIsPlaying(false);
  }, [active, player, audioPlayer]);

  useWatchProgress({
    detail: detailRef,
    position: currentTimeRef,
    playing: isPlayingRef,
  });

  const fallbackToStablePlayback = useCallback(() => {
    if (state.status !== "ready") return;
    const selectedOption = state.playbackOptions[state.selectedOptionIndex];
    if (selectedOption?.kind !== "split") return;
    const fallbackIndex = state.playbackOptions.findIndex(
      (option) => option.kind === "auto" || option.kind === "muxed",
    );
    if (fallbackIndex < 0 || fallbackIndex === state.selectedOptionIndex)
      return;
    pendingSeekRef.current = currentTimeRef.current;
    shouldPlayAfterReplaceRef.current = isPlayingRef.current;
    setState((previous) => {
      if (previous.status !== "ready") return previous;
      return { ...previous, selectedOptionIndex: fallbackIndex };
    });
  }, [state]);

  // Buffering spinner: surfaces slow upstream loads instead of a black screen.
  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status }) => {
      setIsBuffering(status === "loading");
      if (status === "readyToPlay") setDuration(player.duration);
      if (status === "error") fallbackToStablePlayback();
    });
    return () => sub.remove();
  }, [player, fallbackToStablePlayback]);

  useEffect(() => {
    const sub = audioPlayer.addListener("statusChange", ({ status }) => {
      if (status === "error") fallbackToStablePlayback();
    });
    return () => sub.remove();
  }, [audioPlayer, fallbackToStablePlayback]);

  // Show the overlay, then auto-hide after a few seconds of inactivity.
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (isPlayingRef.current && !menuOpenRef.current) {
        setControlsVisible(false);
      }
    }, 4000);
  }, []);

  const anyMenuOpen = qualityMenuOpen || subtitleMenuOpen;

  useEffect(() => {
    if (!anyMenuOpen) return;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setControlsVisible(true);
  }, [anyMenuOpen]);

  useEffect(() => {
    if (!anyMenuOpen) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setQualityMenuOpen(false);
      setSubtitleMenuOpen(false);
      revealControls();
      return true;
    });
    return () => sub.remove();
  }, [anyMenuOpen, revealControls]);

  // Any remote key re-shows the controls (fires regardless of focus target).
  // Autoplay: when a video ends, offer the first related video the user hasn't
  // already watched. Without this the screen just sits on a stopped player,
  // which is the least lean-back thing an app can do.
  const [upNextSeconds, setUpNextSeconds] = useState<number | null>(null);
  const upNext = related[0];

  useEffect(() => {
    const sub = player.addListener("playToEnd", () => {
      setIsPlaying(false);
      if (upNext) setUpNextSeconds(UP_NEXT_COUNTDOWN_SECONDS);
    });
    return () => sub.remove();
  }, [player, upNext]);

  useEffect(() => {
    if (upNextSeconds === null) return;
    if (upNextSeconds <= 0) {
      setUpNextSeconds(null);
      if (upNext) onOpenVideo(upNext.videoId);
      return;
    }
    const timer = setTimeout(() => setUpNextSeconds((s) => (s ?? 1) - 1), 1000);
    return () => clearTimeout(timer);
  }, [upNextSeconds, upNext, onOpenVideo]);

  // Cancel the countdown as soon as the user does anything else.
  const cancelUpNext = useCallback(() => setUpNextSeconds(null), []);

  useEffect(() => {
    const sub = player.addListener(
      "availableSubtitleTracksChange",
      ({ availableSubtitleTracks }) => {
        setSubtitleTracks(availableSubtitleTracks);
        setSubtitleIndex(0);
      },
    );
    return () => sub.remove();
  }, [player]);

  const selectSubtitle = (index: number) => {
    setSubtitleIndex(index);
    // Index 0 is the synthetic "Off" row.
    player.subtitleTrack =
      index === 0 ? null : (subtitleTracks[index - 1] ?? null);
    setSubtitleMenuOpen(false);
    revealControls();
  };

  // The key handler runs before togglePlayback/seekBy are declared below, and
  // must not re-register on every render — go through refs.
  const togglePlaybackRef = useRef(() => {});
  const seekByRef = useRef((_seconds: number) => {});

  useTVEventHandler((event) => {
    if (event.eventType === "focus" || event.eventType === "blur") return;
    // Key-up would double every action; only react to the press.
    if (event.eventKeyAction === 1) return;

    switch (event.eventType) {
      case "playPause":
        togglePlaybackRef.current();
        return;
      case "fastForward":
        seekByRef.current(SEEK_STEP_SECONDS);
        return;
      case "rewind":
        seekByRef.current(-SEEK_STEP_SECONDS);
        return;
      case "left":
      case "longLeft":
      case "right":
      case "longRight": {
        // Seek straight from playback instead of making the user first reveal
        // the controls and walk focus to the progress bar. Only while the
        // overlay is hidden: once it is up, left/right belongs to focus
        // navigation across the control row (the bar seeks when focused).
        if (controlsVisibleRef.current) break;
        const forward =
          event.eventType === "right" || event.eventType === "longRight";
        const step =
          event.eventType === "longLeft" || event.eventType === "longRight"
            ? LONG_SEEK_STEP_SECONDS
            : SEEK_STEP_SECONDS;
        seekByRef.current(forward ? step : -step);
        break;
      }
    }
    revealControls();
  });

  // While paused the overlay stays pinned; while playing it auto-hides.
  useEffect(() => {
    if (isPlaying) {
      revealControls();
    } else {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setControlsVisible(true);
    }
  }, [isPlaying, revealControls]);

  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    },
    [],
  );

  const togglePlayback = () => {
    setQualityMenuOpen(false);
    cancelUpNext();
    if (isPlaying) {
      player.pause();
      audioPlayer.pause();
      setIsPlaying(false);
    } else {
      player.play();
      if (selectedOptionRef.current?.kind === "split") audioPlayer.play();
      setCommentsOpen(false);
      setIsPlaying(true);
    }
  };

  const seekTo = useCallback(
    (seconds: number) => {
      const playbackDuration =
        duration || detailRef.current?.durationSeconds || seconds;
      const targetTime = Math.max(
        0,
        Math.min(playbackDuration > 0 ? playbackDuration : seconds, seconds),
      );
      player.currentTime = targetTime;
      if (selectedOptionRef.current?.kind === "split") {
        audioPlayer.currentTime = targetTime;
      }
      currentTimeRef.current = targetTime;
      setCurrentTime(targetTime);
      revealControls();
    },
    [audioPlayer, duration, player, revealControls],
  );

  const seekBy = (seconds: number) => {
    setQualityMenuOpen(false);
    cancelUpNext();
    seekTo(currentTimeRef.current + seconds);
  };

  togglePlaybackRef.current = togglePlayback;
  seekByRef.current = seekBy;

  const openQualityMenu = () => {
    if (state.status !== "ready" || state.playbackOptions.length <= 1) return;
    setSubtitleMenuOpen(false);
    setQualityMenuOpen((open) => !open);
    revealControls();
  };

  const selectQuality = (index: number) => {
    if (state.status !== "ready") return;
    if (index === state.selectedOptionIndex) {
      setQualityMenuOpen(false);
      revealControls();
      return;
    }
    pendingSeekRef.current = currentTimeRef.current;
    shouldPlayAfterReplaceRef.current = isPlayingRef.current;
    setState((previous) => {
      if (previous.status !== "ready") return previous;
      return {
        ...previous,
        selectedOptionIndex: index,
      };
    });
    setQualityMenuOpen(false);
    revealControls();
  };

  if (state.status === "loading") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.brand} />
        <Text style={styles.muted}>Loading...</Text>
      </View>
    );
  }

  if (state.status === "error") {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Playback unavailable</Text>
        <Text style={styles.muted}>{state.message}</Text>
        <FocusButton label="Back" onPress={onBack} hasTVPreferredFocus />
      </View>
    );
  }

  const { detail } = state;
  const selectedQuality =
    state.playbackOptions[state.selectedOptionIndex]?.label ?? "Auto";
  const qualityOptions: PlayerQualityOption[] = state.playbackOptions.map(
    (option) => ({
      id: option.id,
      label: option.label,
    }),
  );
  const effectiveDuration = duration || detail.durationSeconds || 0;
  const subtitleOptions: PlayerQualityOption[] = [
    { id: "off", label: "Off" },
    ...subtitleTracks.map((track) => ({
      id: track.id,
      label: track.label || track.language,
    })),
  ];

  return (
    <View style={styles.container}>
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        contentFit="contain"
        nativeControls={false}
      />
      {isBuffering ? (
        <View style={styles.bufferingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      ) : null}
      {/* Controls stay mounted (so a focused button always catches the next key
          to re-reveal them); visibility is just opacity. */}
      <View
        style={[StyleSheet.absoluteFill, { opacity: controlsVisible ? 1 : 0 }]}
        pointerEvents="box-none"
      >
        <View style={styles.bottomScrim} pointerEvents="none" />
        <View style={styles.overlay}>
          {upNextSeconds !== null && upNext ? (
            <PlayerUpNext
              video={upNext}
              secondsLeft={upNextSeconds}
              onPlayNow={() => {
                cancelUpNext();
                onOpenVideo(upNext.videoId);
              }}
              onCancel={cancelUpNext}
            />
          ) : null}

          {/* Related rail only when paused — keeps playback uncluttered. */}
          {!isPlaying && upNextSeconds === null && related.length > 0 ? (
            <VideoRow title="Up next" videos={related} onSelect={onOpenVideo} />
          ) : null}

          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={1}>
              {detail.title}
            </Text>
            {detail.channelId && detail.channelName ? (
              <Pressable
                onFocus={() => setChannelFocused(true)}
                onBlur={() => setChannelFocused(false)}
                onPress={() => onOpenChannel(detail.channelId as string)}
                style={[
                  styles.channelButton,
                  channelFocused && styles.channelButtonFocused,
                ]}
              >
                <Text
                  style={[
                    styles.channel,
                    channelFocused && styles.channelFocused,
                  ]}
                >
                  {detail.channelName}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {!isPlaying && commentsOpen ? (
            <PlayerComments videoId={detail.videoId} />
          ) : null}

          {!isPlaying ? (
            <PlayerActions
              videoId={detail.videoId}
              channelId={detail.channelId}
              videoTitle={detail.title}
              channelName={detail.channelName}
            />
          ) : null}

          <View style={styles.controlPanel}>
            <PlayerQualityMenu
              open={qualityMenuOpen}
              options={qualityOptions}
              selectedIndex={state.selectedOptionIndex}
              onSelect={selectQuality}
            />
            <PlayerQualityMenu
              open={subtitleMenuOpen}
              title="Subtitles"
              icon="message-square"
              options={subtitleOptions}
              selectedIndex={subtitleIndex}
              onSelect={selectSubtitle}
            />
            <PlayerProgressBar
              currentTime={currentTime}
              duration={effectiveDuration}
              onSeekTo={seekTo}
              chapters={detail.chapters}
            />
            <View style={styles.controlsRow}>
              <View style={styles.controls}>
                <IconButton icon="rotate-ccw" onPress={() => seekBy(-10)} />
                <IconButton
                  icon={isPlaying ? "pause" : "play"}
                  large
                  onPress={togglePlayback}
                  hasTVPreferredFocus
                />
                <IconButton icon="rotate-cw" onPress={() => seekBy(10)} />
              </View>
              <FocusButton
                label={commentsOpen ? "Hide comments" : "Comments"}
                onPress={() => {
                  setCommentsOpen((open) => !open);
                  revealControls();
                }}
                style={styles.qualityButton}
              />
              {subtitleTracks.length > 0 ? (
                <FocusButton
                  label={`Subtitles: ${subtitleOptions[subtitleIndex]?.label ?? "Off"}`}
                  onPress={() => {
                    setQualityMenuOpen(false);
                    setSubtitleMenuOpen((open) => !open);
                    revealControls();
                  }}
                  style={styles.qualityButton}
                />
              ) : null}
              <FocusButton
                label={`Quality: ${selectedQuality}`}
                onPress={openQualityMenu}
                disabled={state.playbackOptions.length <= 1}
                style={styles.qualityButton}
              />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.videoBackground },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    gap: spacing.md,
  },
  overlay: {
    position: "absolute",
    left: spacing.screen,
    right: spacing.screen,
    bottom: spacing.screen,
    gap: spacing.md,
  },
  bufferingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 340,
    backgroundColor: colors.overlay,
  },
  info: { gap: spacing.xs },
  controls: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  qualityButton: { minWidth: 190 },
  controlPanel: {
    position: "relative",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.hero,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.surface,
  },
  channelButton: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginLeft: -spacing.sm,
    borderRadius: radius.shell,
    borderWidth: focus.borderWidth,
    borderColor: "transparent",
  },
  channelButtonFocused: {
    borderColor: colors.ring,
    backgroundColor: colors.brandSoft,
  },
  channel: {
    color: colors.mutedForeground,
    fontSize: fontSize.md,
    fontWeight: "600",
    textShadowColor: colors.shadow,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  channelFocused: {
    color: colors.brand,
    textDecorationLine: "underline",
  },
  title: {
    color: colors.foreground,
    fontSize: fontSize.xxl,
    fontWeight: "800",
    lineHeight: 48,
    maxWidth: 1100,
    textShadowColor: colors.shadow,
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 12,
  },
  errorTitle: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: "700",
  },
  muted: { color: colors.mutedForeground, fontSize: fontSize.md },
});

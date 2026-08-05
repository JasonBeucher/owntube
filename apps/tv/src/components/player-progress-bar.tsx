import { useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useTVEventHandler,
  View,
} from "react-native";
import { formatTime } from "@/lib/format";
import { colors, focus, fontSize, monoFont, radius, spacing } from "@/theme";

const PROGRESS_SEEK_STEP_SECONDS = 10;

type PlayerProgressBarProps = {
  currentTime: number;
  duration: number;
  onSeekTo: (seconds: number) => void;
  /** Chapter starts, drawn as ticks so long videos are navigable at a glance. */
  chapters?: { startSeconds: number; title: string }[];
};

export function PlayerProgressBar({
  currentTime,
  duration,
  onSeekTo,
  chapters,
}: PlayerProgressBarProps) {
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);

  currentTimeRef.current = currentTime;
  durationRef.current = duration;

  const seekBy = (seconds: number) => {
    const seekDuration = durationRef.current;
    if (seekDuration <= 0) return;
    const nextTime = Math.min(
      seekDuration,
      Math.max(0, currentTimeRef.current + seconds),
    );
    onSeekTo(nextTime);
  };

  useTVEventHandler((event) => {
    if (!focusedRef.current || event.eventKeyAction === 1) return;
    if (event.eventType === "right" || event.eventType === "longRight") {
      seekBy(PROGRESS_SEEK_STEP_SECONDS);
    }
    if (event.eventType === "left" || event.eventType === "longLeft") {
      seekBy(-PROGRESS_SEEK_STEP_SECONDS);
    }
  });

  const progressPercent =
    duration > 0
      ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
      : 0;

  return (
    <Pressable
      onFocus={() => {
        focusedRef.current = true;
        setFocused(true);
      }}
      onBlur={() => {
        focusedRef.current = false;
        setFocused(false);
      }}
      onPress={() => seekBy(PROGRESS_SEEK_STEP_SECONDS)}
      style={[styles.container, focused && styles.containerFocused]}
    >
      <Text style={[styles.time, focused && styles.timeFocused]}>
        {formatTime(currentTime)}
      </Text>
      <View style={[styles.track, focused && styles.trackFocused]}>
        <View
          style={[
            styles.trackFill,
            {
              width: `${progressPercent}%`,
            },
          ]}
        >
          <View style={[styles.thumb, focused && styles.thumbFocused]} />
        </View>
        {duration > 0
          ? chapters
              ?.filter((chapter) => chapter.startSeconds > 0)
              .map((chapter) => (
                <View
                  key={`${chapter.startSeconds}-${chapter.title}`}
                  pointerEvents="none"
                  style={[
                    styles.chapterTick,
                    { left: `${(chapter.startSeconds / duration) * 100}%` },
                  ]}
                />
              ))
          : null}
      </View>
      <Text style={[styles.time, styles.duration]}>
        {formatTime(duration || 0)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.shell,
    borderWidth: focus.borderWidth,
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  containerFocused: {
    borderColor: colors.ring,
    backgroundColor: colors.brandSofter,
  },
  track: {
    flex: 1,
    height: 9,
    borderRadius: 999,
    backgroundColor: colors.surfaceStrong,
    overflow: "hidden",
  },
  trackFocused: {
    height: 12,
    backgroundColor: colors.surfaceBorder,
  },
  trackFill: {
    height: "100%",
    minWidth: 0,
    alignItems: "flex-end",
    justifyContent: "center",
    backgroundColor: colors.brand,
    borderRadius: 999,
  },
  chapterTick: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: colors.background,
    opacity: 0.85,
  },
  thumb: {
    width: 0,
    height: 0,
    borderRadius: 0,
    backgroundColor: colors.primaryForeground,
  },
  thumbFocused: {
    width: 18,
    height: 18,
    borderRadius: 9,
    marginRight: -9,
    shadowColor: colors.shadow,
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  time: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    fontFamily: monoFont,
    minWidth: 66,
  },
  timeFocused: {
    color: colors.foreground,
  },
  duration: {
    textAlign: "right",
  },
});

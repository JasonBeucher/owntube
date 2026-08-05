import { Feather } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { CarouselFeed } from "@/components/CarouselFeed";
import { FocusButton } from "@/components/FocusButton";
import { FocusableTextInput } from "@/components/focusable-text-input";
import type { Nav } from "@/lib/navigation";
import { addRecentSearch, loadRecentSearches } from "@/lib/recent-searches";
import { trpcClient } from "@/lib/trpc";
import { useInfiniteFeed } from "@/lib/use-infinite-feed";
import { useResumeProgress } from "@/lib/use-resume-progress";
import { colors, focus, fontSize, radius, spacing } from "@/theme";

/** Long enough that D-pad typing doesn't fire a request per keystroke. */
const SUGGESTION_DEBOUNCE_MS = 350;

/** Full-text search via the on-screen TV keyboard. */
export function SearchScreen({ nav }: { nav: Nav }) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    loadRecentSearches()
      .then(setRecent)
      .catch(() => {});
  }, []);

  // Typing on a remote is slow and painful; suggestions cut most of it out.
  useEffect(() => {
    const term = text.trim();
    if (term.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      trpcClient.search.suggestions
        .query({ q: term })
        .then((result) => {
          if (!cancelled) setSuggestions(result.suggestions);
        })
        .catch(() => {});
    }, SUGGESTION_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text]);

  const feed = useInfiniteFeed<string>(
    (continuation) =>
      query
        ? trpcClient.search.videos
            .query({ q: query, continuation })
            .then((r) => ({
              items: r.videos,
              next: r.continuation ?? undefined,
            }))
        : Promise.resolve({ items: [], next: undefined }),
    [query],
  );
  const progress = useResumeProgress(feed.videos);

  const runSearch = (term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    setText(trimmed);
    setQuery(trimmed);
    setSuggestions([]);
    addRecentSearch(trimmed)
      .then(setRecent)
      .catch(() => {});
  };

  const chips = suggestions.length > 0 ? suggestions : recent;
  const chipsLabel = suggestions.length > 0 ? "Suggestions" : "Recent";

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <Feather name="search" size={28} color={colors.mutedForeground} />
        <FocusableTextInput
          placeholder="Search"
          autoCapitalize="none"
          autoCorrect={false}
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => runSearch(textRef.current)}
          returnKeyType="search"
          hasTVPreferredFocus
          containerStyle={styles.searchInput}
        />
        <FocusButton
          label="Search"
          variant="primary"
          onPress={() => runSearch(textRef.current)}
          style={styles.searchButton}
        />
      </View>

      {chips.length > 0 ? (
        <View style={styles.chipsBlock}>
          <Text style={styles.chipsLabel}>{chipsLabel}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
          >
            {chips.map((chip) => (
              <SuggestionChip
                key={chip}
                label={chip}
                onPress={() => runSearch(chip)}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.results}>
        <CarouselFeed
          feed={feed}
          onSelect={(videoId) =>
            nav.openVideo(videoId, progress.get(videoId)?.positionSeconds)
          }
          progress={progress}
          emptyText={query ? "No results." : "Type a query and press Search."}
        />
      </View>
    </View>
  );
}

function SuggestionChip({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.chip, focused && styles.chipFocused]}
    >
      <Text
        style={[styles.chipText, focused && styles.chipTextFocused]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: spacing.md },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  searchInput: { flex: 1 },
  searchButton: { width: 156 },
  chipsBlock: { gap: spacing.xs },
  chipsLabel: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  chipsRow: { gap: spacing.sm, paddingVertical: 4, paddingHorizontal: 3 },
  chip: {
    maxWidth: 420,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.shell,
    backgroundColor: colors.surface,
    borderWidth: focus.borderWidth,
    borderColor: colors.surfaceBorder,
  },
  chipFocused: {
    backgroundColor: colors.brand,
    borderColor: colors.primaryForeground,
    transform: [{ scale: focus.scale }],
  },
  chipText: { color: colors.foreground, fontSize: fontSize.md },
  chipTextFocused: { color: colors.primaryForeground, fontWeight: "700" },
  results: { flex: 1 },
});

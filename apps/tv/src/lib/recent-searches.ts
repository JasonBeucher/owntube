import * as SecureStore from "expo-secure-store";

// Reuses expo-secure-store rather than pulling in AsyncStorage for one list of
// strings. Values are capped well under the platform's ~2KB limit.
const RECENT_SEARCHES_KEY = "owntube.recent-searches";
const MAX_RECENT = 8;
const MAX_TERM_LENGTH = 80;

export async function loadRecentSearches(): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(RECENT_SEARCHES_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

/** Most recent first, de-duplicated case-insensitively. Returns the new list. */
export async function addRecentSearch(term: string): Promise<string[]> {
  const trimmed = term.trim().slice(0, MAX_TERM_LENGTH);
  if (!trimmed) return loadRecentSearches();
  const existing = await loadRecentSearches();
  const next = [
    trimmed,
    ...existing.filter((item) => item.toLowerCase() !== trimmed.toLowerCase()),
  ].slice(0, MAX_RECENT);
  await SecureStore.setItemAsync(RECENT_SEARCHES_KEY, JSON.stringify(next));
  return next;
}

"use client";

export const WATCH_MINI_STATE_KEY = "ot:watch-mini-state";
export const WATCH_MINI_ENABLED_KEY = "ot:mini-player-enabled";

export type WatchMiniPayload =
  | { mode: "hls"; src: string }
  | {
      mode: "progressive";
      variants: (
        | { t: "muxed"; label: string; src: string }
        | {
            t: "split";
            label: string;
            video: string;
            audio: string;
            audioTracks: { label: string; src: string }[];
            defaultAudioIndex?: number;
          }
      )[];
    };

export type WatchMiniState = {
  videoId: string;
  title: string;
  poster?: string;
  payload: WatchMiniPayload;
  currentTime: number;
};

export function readWatchMiniState(): WatchMiniState | null {
  try {
    const raw = window.localStorage.getItem(WATCH_MINI_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    if (
      typeof obj.videoId !== "string" ||
      typeof obj.title !== "string" ||
      !obj.payload ||
      typeof obj.payload !== "object"
    ) {
      return null;
    }
    return {
      videoId: obj.videoId,
      title: obj.title,
      payload: obj.payload as WatchMiniPayload,
      currentTime:
        typeof obj.currentTime === "number" && Number.isFinite(obj.currentTime)
          ? Math.max(0, obj.currentTime)
          : 0,
      poster: typeof obj.poster === "string" ? obj.poster : undefined,
    };
  } catch {
    return null;
  }
}

export function writeWatchMiniState(
  state: WatchMiniState | null,
  notify = true,
): void {
  try {
    if (!state) window.localStorage.removeItem(WATCH_MINI_STATE_KEY);
    else window.localStorage.setItem(WATCH_MINI_STATE_KEY, JSON.stringify(state));
    if (notify) window.dispatchEvent(new CustomEvent("ot:watch-mini-updated"));
  } catch {}
}

export function readWatchMiniEnabled(defaultValue = true): boolean {
  try {
    const raw = window.localStorage.getItem(WATCH_MINI_ENABLED_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {}
  return defaultValue;
}

export function writeWatchMiniEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(WATCH_MINI_ENABLED_KEY, enabled ? "1" : "0");
    window.dispatchEvent(new CustomEvent("ot:watch-mini-updated"));
  } catch {}
}

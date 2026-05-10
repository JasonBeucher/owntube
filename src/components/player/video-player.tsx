"use client";

import {
  MediaOutlet,
  MediaPlayer,
  useMediaRemote,
  useMediaStore,
} from "@vidstack/react";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { MediaPlayerElement } from "vidstack";
import {
  audioTrackLanguageInfo,
  languageFirstAudioMenuLabel,
} from "@/lib/audio-track-label";
import { sourceFromUrl } from "@/lib/media-source-from-url";
import {
  readPlayerMediaPrefs,
  writePlayerMediaPrefs,
  writePlayerVolumeOnly,
} from "@/lib/player-media-prefs";
import { gainToUiVolume, uiVolumeToGain } from "@/lib/player-volume-gain";
import { cn } from "@/lib/utils";
import { useWatchCinema } from "@/components/watch/watch-cinema-context";
import { chapterIndexAt, type VideoChapter } from "@/lib/video-chapters";
import {
  readWatchMiniEnabled,
  writeWatchMiniState,
} from "@/lib/watch-mini-player-state";

type ProxiedVariant =
  | { t: "muxed"; label: string; src: string }
  | {
      t: "split";
      label: string;
      video: string;
      audio: string;
      audioTracks: { label: string; src: string }[];
      defaultAudioIndex?: number;
    };

export type VideoPlayerPayload =
  | { mode: "hls"; src: string }
  | { mode: "progressive"; variants: ProxiedVariant[] };

type VideoPlayerProps = {
  videoId: string;
  payload: VideoPlayerPayload;
  title: string;
  poster?: string;
  chapters?: VideoChapter[];
  startAtSeconds?: number;
  miniMode?: boolean;
};

type WatchQueueItem = { href: string; title: string };

const WATCH_QUEUE_STORAGE_KEY = "ot:watch-queue";

function readWatchQueue(): WatchQueueItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(WATCH_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is WatchQueueItem =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as { href?: unknown }).href === "string" &&
          typeof (item as { title?: unknown }).title === "string",
      )
      .slice(0, 100);
  } catch {
    return [];
  }
}

function writeWatchQueue(items: WatchQueueItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WATCH_QUEUE_STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent("ot:watch-queue-updated"));
  } catch {}
}

function shouldAutoRecoverPlaybackSource(src: string): boolean {
  return (
    src.includes("/yt-hls?url=") ||
    src.includes("/invidious/api/manifest/hls") ||
    src.includes("/invidious/api/v1/")
  );
}

const RECOVERY_ATTEMPT_WINDOW_MS = 5 * 60_000;
const MAX_RECOVERY_ATTEMPTS = 3;

function playbackResumeStorageKey(): string {
  if (typeof window === "undefined") return "ot:playback-resume:";
  return `ot:playback-resume:${window.location.pathname}`;
}

function tryOneShotPlaybackRecovery(recoveryKey: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const storageKey = `ot:playback-recover:${recoveryKey}`;
    const now = Date.now();
    const stateRaw = window.sessionStorage.getItem(storageKey);
    const [lastStr, countStr] = stateRaw ? stateRaw.split(":") : [];
    const last = lastStr ? Number.parseInt(lastStr, 10) : 0;
    const prevCount = countStr ? Number.parseInt(countStr, 10) : 0;
    const withinWindow =
      Number.isFinite(last) && now - last < RECOVERY_ATTEMPT_WINDOW_MS;
    const nextCount = withinWindow ? prevCount + 1 : 1;

    // Avoid infinite loops if upstream keeps failing continuously.
    if (nextCount > MAX_RECOVERY_ATTEMPTS) return false;
    window.sessionStorage.setItem(storageKey, `${now}:${nextCount}`);

    const media = document.querySelector("video");
    const currentTime =
      media && Number.isFinite(media.currentTime) ? media.currentTime : 0;
    if (currentTime > 0.5) {
      window.sessionStorage.setItem(
        playbackResumeStorageKey(),
        String(Math.floor(currentTime)),
      );
    }

    const nextUrl = new URL(window.location.href);
    if (currentTime > 0.5) {
      nextUrl.searchParams.set("t", String(Math.floor(currentTime)));
    }
    // Cache-bust app route + upstream URL generation path.
    nextUrl.searchParams.set("_pr", String(now));
    window.location.assign(nextUrl.toString());
    return true;
  } catch {
    return false;
  }
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

const PLAYER_FILL =
  "h-full w-full max-h-none max-w-none !rounded-none !border-0 !shadow-none !ring-0 [&_video]:h-full [&_video]:w-full [&_video]:object-contain" as const;

const CHAPTER_GAP_PX = 3 as const;

function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/* --------------------------------- Icons --------------------------------- */

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="img"
      aria-label="Play"
    >
      <title>Play</title>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function BigPlayOverlayIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="img"
      aria-label="Play"
    >
      <title>Play</title>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function PauseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="img"
      aria-label="Pause"
    >
      <title>Pause</title>
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );
}
function MuteIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="img"
      aria-label="Muted"
    >
      <title>Muted</title>
      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.17v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
    </svg>
  );
}
function VolHighIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="img"
      aria-label="Volume high"
    >
      <title>Volume high</title>
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
  );
}
function VolLowIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="img"
      aria-label="Volume low"
    >
      <title>Volume low</title>
      <path d="M7 9v6h4l5 5V4l-5 5H7zm9.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
    </svg>
  );
}
function FsEnterIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="img"
      aria-label="Enter fullscreen"
    >
      <title>Enter fullscreen</title>
      <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
    </svg>
  );
}
function FsExitIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="img"
      aria-label="Exit fullscreen"
    >
      <title>Exit fullscreen</title>
      <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
    </svg>
  );
}
function GearIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="img"
      aria-label="Settings"
    >
      <title>Settings</title>
      <path d="M19.14,12.94c.04-.31.06-.62.06-.94 0-.32-.02-.63-.06-.94l2.03-1.58a.49.49,0,0,0,.12-.61L19.36,5.42a.488.488,0,0,0-.59-.22l-2.39.96a7.06,7.06,0,0,0-1.62-.94l-.36-2.54a.488.488,0,0,0-.49-.42H10.09a.488.488,0,0,0-.49.42l-.36,2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.488.488,0,0,0-.59.22L2.71,8.87a.488.488,0,0,0,.12.61L4.86,11.06c-.04.31-.06.63-.06.94,0,.32.02.63.06.94L2.83,14.52a.49.49,0,0,0-.12.61l1.92,3.32a.488.488,0,0,0,.59.22l2.39-.96c.49.38,1.03.7,1.62.94l.36,2.54a.488.488,0,0,0,.49.42h3.84a.488.488,0,0,0,.49-.42l.36-2.54c.59-.24,1.13-.56,1.62-.94l2.39.96a.488.488,0,0,0,.59-.22l1.92-3.32a.488.488,0,0,0-.12-.61L19.14,12.94zM12,15.6A3.6,3.6,0,1,1,15.6,12,3.6,3.6,0,0,1,12,15.6Z" />
    </svg>
  );
}

function PipIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="img"
      aria-label="Picture in picture"
    >
      <title>Picture in picture</title>
      <path d="M19 7H5c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm0 10H5V9h14v8zm-8-7h7v5h-7z" />
    </svg>
  );
}

function NextIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="img"
      aria-label="Next video"
    >
      <title>Next video</title>
      <path d="M6 5v14l9-7-9-7zm10 0h2v14h-2z" />
    </svg>
  );
}

function CinemaIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="img"
      aria-label="Cinema mode"
    >
      <title>Cinema mode</title>
      <path d="M18 3v2h-2V3H8v2H6V3H4v18h2v-2h2v2h8v-2h2v2h2V3h-2zM8 17H6v-2h2v2zm0-4H6v-2h2v2zm0-4H6V7h2v2zm10 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V7h2v2z" />
    </svg>
  );
}

/* ------------------------------ Fullscreen ------------------------------ */

function useFullscreenShell(shellRef: React.RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const onChange = () => {
      const video = shellRef.current?.querySelector("video") as
        | (HTMLVideoElement & {
            webkitDisplayingFullscreen?: boolean;
          })
        | null;
      const standardActive = document.fullscreenElement === shellRef.current;
      const webkitActive = Boolean(video?.webkitDisplayingFullscreen);
      setActive(standardActive || webkitActive);
    };
    document.addEventListener("fullscreenchange", onChange);
    const video = shellRef.current?.querySelector("video");
    video?.addEventListener("webkitbeginfullscreen", onChange as EventListener);
    video?.addEventListener("webkitendfullscreen", onChange as EventListener);
    onChange();
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      video?.removeEventListener(
        "webkitbeginfullscreen",
        onChange as EventListener,
      );
      video?.removeEventListener(
        "webkitendfullscreen",
        onChange as EventListener,
      );
    };
  }, [shellRef]);
  const toggle = useCallback(async () => {
    const el = shellRef.current;
    if (!el) return;
    const video = el.querySelector("video") as
      | (HTMLVideoElement & {
          webkitEnterFullscreen?: () => void;
          webkitExitFullscreen?: () => void;
          webkitDisplayingFullscreen?: boolean;
        })
      | null;
    const doc = document as Document & {
      webkitExitFullscreen?: () => void;
    };
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (video?.webkitDisplayingFullscreen) {
        if (typeof video.webkitExitFullscreen === "function") {
          video.webkitExitFullscreen();
          return;
        }
        if (typeof doc.webkitExitFullscreen === "function") {
          doc.webkitExitFullscreen();
          return;
        }
      }
      if (typeof el.requestFullscreen === "function") {
        await el.requestFullscreen();
        return;
      }
      if (video && typeof video.webkitEnterFullscreen === "function") {
        // iOS Safari fallback: native video fullscreen API.
        video.webkitEnterFullscreen();
      }
    } catch {
      // Ignore unsupported/denied fullscreen.
    }
  }, [shellRef]);
  return { active, toggle };
}

/* ----------------------- Idle / hover reveal logic ----------------------- */

function useIdleVisible(paused: boolean, settingsOpen: boolean) {
  const [visible, setVisible] = useState(true);
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const ping = useCallback(() => {
    setVisible(true);
    clear();
    if (paused || settingsOpen) return;
    timer.current = window.setTimeout(() => setVisible(false), 2500);
  }, [paused, settingsOpen, clear]);

  useEffect(() => {
    ping();
    return clear;
  }, [ping, clear]);

  useEffect(() => {
    if (paused || settingsOpen) {
      setVisible(true);
      clear();
    }
  }, [paused, settingsOpen, clear]);

  return { visible, ping, hide: () => setVisible(false) };
}

/* ------------------------------- Adapter -------------------------------- */

type PlayerAdapter = {
  paused: boolean;
  waiting: boolean;
  canPlay: boolean;
  duration: number;
  currentTime: number;
  bufferedEnd: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  play(): void;
  pause(): void;
  togglePaused(): void;
  seek(t: number): void;
  seekPreview(t: number): void;
  setVolume(v: number): void;
  toggleMuted(): void;
  setPlaybackRate(r: number): void;
  canPictureInPicture: boolean;
  pictureInPicture: boolean;
  togglePictureInPicture(): void;
};

function useVidstackAdapter(
  playerRef: React.RefObject<MediaPlayerElement | null>,
): PlayerAdapter {
  const state = useMediaStore(playerRef as React.RefObject<EventTarget | null>);
  const remote = useMediaRemote(
    playerRef as React.RefObject<EventTarget | null>,
  );
  return {
    paused: state.paused,
    waiting: state.waiting,
    canPlay: state.canPlay,
    duration: Number.isFinite(state.duration) ? state.duration : 0,
    currentTime: state.currentTime,
    bufferedEnd: state.bufferedEnd ?? 0,
    volume: state.muted ? 0 : gainToUiVolume(state.volume),
    muted: state.muted,
    playbackRate: state.playbackRate,
    play: () => {
      // On mobile, user-triggered play should also clear accidental muted state
      // (sticky after autoplay-policy transitions/tab restores).
      if (state.muted && state.volume > 0.001) remote.unmute();
      remote.play();
    },
    pause: () => remote.pause(),
    togglePaused: () => {
      if (!state.paused) {
        remote.pause();
        return;
      }
      if (state.muted && state.volume > 0.001) remote.unmute();
      remote.play();
    },
    seek: (t) => remote.seek(t),
    seekPreview: (t) => remote.seeking(t),
    setVolume: (v) => {
      if (v > 0) {
        if (state.muted) remote.unmute();
        remote.changeVolume(uiVolumeToGain(v));
      } else {
        remote.mute();
      }
    },
    toggleMuted: () => (state.muted ? remote.unmute() : remote.mute()),
    setPlaybackRate: (r) => remote.changePlaybackRate(r),
    canPictureInPicture: state.canPictureInPicture,
    pictureInPicture: state.pictureInPicture,
    togglePictureInPicture: () => {
      if (!state.canPictureInPicture) return;
      if (state.pictureInPicture) remote.exitPictureInPicture();
      else remote.enterPictureInPicture();
    },
  };
}

function useNativeAdapter(opts: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  externalVolume: number;
  setExternalVolume: (n: number) => void;
}): PlayerAdapter {
  const { videoRef, audioRef, externalVolume, setExternalVolume } = opts;
  const [, force] = useState(0);
  const bump = useCallback(() => force((x) => x + 1), []);
  const [muted, setMuted] = useState(false);
  const [pictureInPicture, setPictureInPicture] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const events = [
      "play",
      "pause",
      "timeupdate",
      "durationchange",
      "loadedmetadata",
      "progress",
      "ratechange",
      "waiting",
      "playing",
      "canplay",
    ] as const;
    for (const e of events) v.addEventListener(e, bump);
    return () => {
      for (const e of events) v.removeEventListener(e, bump);
    };
  }, [videoRef, bump]);

  useEffect(() => {
    const a = audioRef.current;
    if (a) a.volume = muted ? 0 : uiVolumeToGain(externalVolume);
  }, [audioRef, externalVolume, muted]);

  useEffect(() => {
    const onPiPChange = () => {
      setPictureInPicture(Boolean(document.pictureInPictureElement));
    };
    document.addEventListener("enterpictureinpicture", onPiPChange);
    document.addEventListener("leavepictureinpicture", onPiPChange);
    onPiPChange();
    return () => {
      document.removeEventListener("enterpictureinpicture", onPiPChange);
      document.removeEventListener("leavepictureinpicture", onPiPChange);
    };
  }, []);

  const v = videoRef.current;
  const duration =
    v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
  const buffered = (() => {
    if (!v || v.buffered.length === 0) return 0;
    let max = 0;
    for (let i = 0; i < v.buffered.length; i++) {
      max = Math.max(max, v.buffered.end(i));
    }
    return max;
  })();

  return {
    paused: v?.paused ?? true,
    waiting:
      v?.readyState !== undefined && v.readyState < 3 && !(v?.paused ?? true),
    canPlay: (v?.readyState ?? 0) >= 2,
    duration,
    currentTime: v?.currentTime ?? 0,
    bufferedEnd: buffered,
    volume: externalVolume,
    muted,
    playbackRate: v?.playbackRate ?? 1,
    play: () => {
      // Start both elements in the same call stack so the user gesture also
      // unlocks the companion <audio> on browsers that gate autoplay per element.
      void videoRef.current?.play().catch(() => {});
      const a = audioRef.current;
      if (a) {
        try {
          a.muted = muted;
          a.volume = muted ? 0 : uiVolumeToGain(externalVolume);
        } catch {}
        void a.play().catch(() => {});
      }
    },
    pause: () => {
      videoRef.current?.pause();
      audioRef.current?.pause();
    },
    togglePaused: () => {
      const el = videoRef.current;
      if (!el) return;
      const a = audioRef.current;
      if (el.paused) {
        void el.play().catch(() => {});
        if (a) {
          try {
            a.muted = muted;
            a.volume = muted ? 0 : uiVolumeToGain(externalVolume);
          } catch {}
          void a.play().catch(() => {});
        }
      } else {
        el.pause();
        a?.pause();
      }
    },
    seek: (t) => {
      const v = videoRef.current;
      const a = audioRef.current;
      if (v) v.currentTime = t;
      if (a) {
        try {
          a.currentTime = t;
        } catch {}
      }
    },
    // Keep preview visual-only for native playback; final seek happens on release.
    seekPreview: () => {},
    setVolume: (n) => {
      setExternalVolume(n);
      const nextMuted = n === 0 ? true : n > 0 && muted ? false : muted;
      if (nextMuted !== muted) setMuted(nextMuted);
      // Apply immediately so the change happens within the user gesture; the
      // effect above also keeps things in sync as React state catches up.
      const a = audioRef.current;
      if (a) {
        a.muted = nextMuted;
        a.volume = nextMuted ? 0 : uiVolumeToGain(n);
        if (!nextMuted && videoRef.current && !videoRef.current.paused) {
          void a.play().catch(() => {});
        }
      }
    },
    toggleMuted: () => {
      const next = !muted;
      setMuted(next);
      const a = audioRef.current;
      if (a) {
        a.muted = next;
        a.volume = next ? 0 : uiVolumeToGain(externalVolume);
        if (!next && videoRef.current && !videoRef.current.paused) {
          void a.play().catch(() => {});
        }
      }
    },
    setPlaybackRate: (r) => {
      const v = videoRef.current;
      const a = audioRef.current;
      if (v) v.playbackRate = r;
      if (a) a.playbackRate = r;
    },
    canPictureInPicture:
      typeof document !== "undefined" &&
      "pictureInPictureEnabled" in document &&
      !videoRef.current?.disablePictureInPicture,
    pictureInPicture,
    togglePictureInPicture: () => {
      const el = videoRef.current;
      if (!el) return;
      if (document.pictureInPictureElement) {
        void document.exitPictureInPicture().catch(() => {});
      } else {
        void el.requestPictureInPicture().catch(() => {});
      }
    },
  };
}

/* ------------------------------ Quality info ----------------------------- */

type QualityModel =
  | {
      kind: "progressive";
      index: number;
      setIndex: (i: number, seekSeconds?: number) => void;
      items: { label: string }[];
    }
  | {
      kind: "hls-managed";
      auto: boolean;
      items: { label: string; selected: boolean; idx: number }[];
      canSet: boolean;
      remote: ReturnType<typeof useMediaRemote>;
    }
  | { kind: "none" };

type AudioModel =
  | {
      kind: "split-native";
      index: number;
      setIndex: (i: number) => void;
      items: { label: string }[];
    }
  | {
      kind: "hls-managed";
      items: { label: string; selected: boolean; idx: number }[];
      remote: ReturnType<typeof useMediaRemote>;
    }
  | { kind: "none" };

/** Normalize URL so the same stream behind different query ordering still dedupes. */
function normalizeAudioStreamUrlForCompare(src: string): string {
  const t = src.trim();
  if (!t) return "";
  try {
    const u = new URL(t);
    u.hash = "";
    const entries = [...u.searchParams.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    u.search = "";
    for (const [k, v] of entries) u.searchParams.append(k, v);
    return u.href;
  } catch {
    return t;
  }
}

/** Language picker only when ≥2 distinct stream URLs (after normalization). */
function hasMultipleDistinctAudioStreams(
  tracks: readonly { src: string }[],
): boolean {
  const urls = new Set<string>();
  for (const t of tracks) {
    const id = normalizeAudioStreamUrlForCompare(t.src ?? "");
    if (id) urls.add(id);
  }
  return urls.size >= 2;
}

const HLS_LADDER = [2160, 1080, 720, 480, 360] as const;

function snapHlsHeightToRung(h: number): (typeof HLS_LADDER)[number] | null {
  let best: (typeof HLS_LADDER)[number] | null = null;
  let bestD = Infinity;
  for (const rung of HLS_LADDER) {
    const d = Math.abs(h - rung);
    if (d < bestD) {
      bestD = d;
      best = rung;
    }
  }
  if (!best) return null;
  if (bestD <= Math.max(56, best * 0.22)) return best;
  return null;
}

function useHlsQualityModel(
  playerRef: React.RefObject<MediaPlayerElement | null>,
): QualityModel {
  const state = useMediaStore(playerRef as React.RefObject<EventTarget | null>);
  const remote = useMediaRemote(
    playerRef as React.RefObject<EventTarget | null>,
  );
  if (state.qualities.length === 0 || !state.canSetQuality) {
    return { kind: "none" };
  }
  const withIdx = state.qualities.map((q, idx) => ({ q, idx }));
  /** Exclut pistes sans hauteur utile (ex. audio seul). */
  const videoRenditions = withIdx.filter(({ q }) => q.height > 0);
  const bestByTier = new Map<
    (typeof HLS_LADDER)[number],
    { q: (typeof withIdx)[number]["q"]; idx: number }
  >();
  for (const { q, idx } of videoRenditions) {
    const tier = snapHlsHeightToRung(q.height);
    if (!tier) continue;
    const prev = bestByTier.get(tier);
    if (!prev || q.height > prev.q.height) bestByTier.set(tier, { q, idx });
  }
  const ladder: { label: string; selected: boolean; idx: number }[] = [];
  for (const tier of HLS_LADDER) {
    const hit = bestByTier.get(tier);
    if (hit) {
      ladder.push({
        label: `${tier}p`,
        selected: Boolean(hit.q.selected && !state.autoQuality),
        idx: hit.idx,
      });
    }
  }
  const resItems =
    ladder.length > 0
      ? ladder
      : videoRenditions.map(({ q, idx }) => ({
          label: q.height ? `${q.height}p` : `${q.width}×${q.height}`,
          selected: Boolean(q.selected && !state.autoQuality),
          idx,
        }));
  const items: { label: string; selected: boolean; idx: number }[] = [
    {
      label: "Meilleure",
      selected: state.autoQuality,
      idx: -1,
    },
    ...resItems,
  ];
  return {
    kind: "hls-managed",
    auto: state.autoQuality,
    canSet: state.canSetQuality,
    remote,
    items,
  };
}

/**
 * hls.js often exposes synthetic labels (`audio_0`, `track2`, `und`) that
 * survive `languageFirstAudioMenuLabel` because they look "non-empty" enough
 * to short-circuit the language inference. Treat these as junk so the picker
 * can fall back to a more useful string instead of showing them verbatim.
 */
function looksLikeGenericHlsAudioLabel(
  label: string | undefined | null,
): boolean {
  const t = label?.trim().toLowerCase() ?? "";
  if (!t) return true;
  if (t === "audio" || t === "track" || t === "und" || t === "default") {
    return true;
  }
  return /^(audio|track|stream|media)[\s_-]*\d+$/i.test(t);
}

function useHlsAudioModel(
  playerRef: React.RefObject<MediaPlayerElement | null>,
): AudioModel {
  const state = useMediaStore(playerRef as React.RefObject<EventTarget | null>);
  const remote = useMediaRemote(
    playerRef as React.RefObject<EventTarget | null>,
  );
  if (state.audioTracks.length < 2) return { kind: "none" };

  type Row = { label: string; selected: boolean; idx: number; key: string };
  const rows: Row[] = state.audioTracks.map((t, idx) => {
    const info = audioTrackLanguageInfo({
      displayName: t.label || undefined,
      language: t.language || undefined,
      trackId: t.id,
    });
    // When language inference fails, prefer the upstream label if it looks
    // like a real human string (`English Dub`, `Commentary`, `Original`)
    // rather than the synthetic `audio_0` strings hls.js often emits — those
    // we drop to give `languageFirstAudioMenuLabel` a chance to surface the
    // track kind, then fall through to a `Track N` numbered entry.
    const rawLabel = t.label?.trim();
    const labelIsUseful =
      Boolean(rawLabel) && !looksLikeGenericHlsAudioLabel(rawLabel);
    const label = labelIsUseful
      ? (info.name ?? rawLabel ?? `Track ${idx + 1}`)
      : languageFirstAudioMenuLabel({
          displayName: undefined,
          language: t.language || undefined,
          qualityFallback: null,
          trackId: t.id,
          kind: t.kind,
          index: idx,
        });
    return {
      idx,
      selected: t.selected,
      // Unknown-language rows must keep distinct keys so two synthetic dubs
      // with the same generic label are not collapsed into a single row.
      key: info.key ?? `__hls-unknown:${idx}`,
      label,
    };
  });

  // Collapse same-language HLS tracks into a single language picker row;
  // prefer whichever variant the player currently has selected so the menu
  // checkmark doesn't desync from playback.
  const byKey = new Map<string, Row>();
  for (const r of rows) {
    const prev = byKey.get(r.key);
    if (!prev) byKey.set(r.key, r);
    else if (r.selected && !prev.selected) byKey.set(r.key, r);
  }
  const itemsWithKey = Array.from(byKey.values()).sort((a, b) => a.idx - b.idx);
  if (itemsWithKey.length < 2) return { kind: "none" };
  // hls.js often exposes two renditions with no LANGUAGE metadata — both get
  // synthetic `__hls-unknown:*` keys. That is still a single logical stream for
  // the user; hide the fake "language" menu.
  const allSyntheticUnknown = itemsWithKey.every((r) =>
    r.key.startsWith("__hls-unknown:"),
  );
  if (allSyntheticUnknown) return { kind: "none" };

  return {
    kind: "hls-managed",
    remote,
    items: itemsWithKey.map(({ key: _key, ...rest }) => rest),
  };
}

/* ------------------------- Settings popover/menu ------------------------- */

type SettingsView = "root" | "speed" | "quality" | "audio";

function SettingsMenu({
  quality,
  audio,
  rate,
  setRate,
  onClose,
}: {
  quality: QualityModel;
  audio: AudioModel;
  rate: number;
  setRate: (r: number) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<SettingsView>("root");
  useEffect(() => {
    if (audio.kind === "none" && view === "audio") setView("root");
  }, [audio.kind, view]);
  return (
    <div
      className="absolute bottom-14 right-3 z-40 w-56 overflow-hidden rounded-lg border border-white/10 bg-zinc-950/95 text-sm shadow-xl backdrop-blur-md"
      onClick={(e: ReactMouseEvent) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="menu"
      tabIndex={-1}
    >
      {view === "root" ? (
        <ul className="py-1">
          <li>
            <button
              type="button"
              onClick={() => setView("speed")}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-zinc-100 hover:bg-white/10"
            >
              <span>Playback speed</span>
              <span className="text-xs text-zinc-400">
                {rate === 1 ? "Normal" : `${rate}×`}
              </span>
            </button>
          </li>
          {quality.kind !== "none" ? (
            <li>
              <button
                type="button"
                onClick={() => setView("quality")}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-zinc-100 hover:bg-white/10"
              >
                <span>Quality</span>
                <span className="text-xs text-zinc-400">
                  {quality.kind === "progressive"
                    ? (quality.items[quality.index]?.label ?? "")
                    : quality.kind === "hls-managed"
                      ? (quality.items.find((i) => i.selected)?.label ??
                        quality.items[0]?.label ??
                        "")
                      : ""}
                </span>
              </button>
            </li>
          ) : null}
          {audio.kind !== "none" ? (
            <li>
              <button
                type="button"
                onClick={() => setView("audio")}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-zinc-100 hover:bg-white/10"
              >
                <span>Language</span>
                <span className="text-xs text-zinc-400">
                  {audio.kind === "split-native"
                    ? (audio.items[audio.index]?.label ?? "")
                    : audio.kind === "hls-managed"
                      ? (audio.items.find((i) => i.selected)?.label ??
                        audio.items[0]?.label ??
                        "")
                      : ""}
                </span>
              </button>
            </li>
          ) : null}
          <li className="border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="w-full px-3 py-2 text-left text-xs text-zinc-400 hover:bg-white/10"
            >
              Close
            </button>
          </li>
        </ul>
      ) : null}
      {view === "speed" ? (
        <div>
          <div className="border-b border-white/10 px-3 py-2 text-xs uppercase tracking-wider text-zinc-400">
            <button
              type="button"
              onClick={() => setView("root")}
              className="hover:underline"
            >
              ‹ Speed
            </button>
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {PLAYBACK_RATES.map((r) => (
              <li key={r}>
                <button
                  type="button"
                  onClick={() => {
                    setRate(r);
                    setView("root");
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-2 hover:bg-white/10",
                    r === rate ? "text-[hsl(var(--primary))]" : "text-zinc-100",
                  )}
                >
                  <span>{r === 1 ? "Normal" : `${r}×`}</span>
                  {r === rate ? <span aria-hidden>✓</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {view === "quality" && quality.kind !== "none" ? (
        <div>
          <div className="border-b border-white/10 px-3 py-2 text-xs uppercase tracking-wider text-zinc-400">
            <button
              type="button"
              onClick={() => setView("root")}
              className="hover:underline"
            >
              ‹ Quality
            </button>
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {quality.kind === "progressive"
              ? quality.items.map((it, i) => (
                  <li key={`${it.label}-${i}`}>
                    <button
                      type="button"
                      onClick={() => {
                        quality.setIndex(i);
                        setView("root");
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-3 py-2 hover:bg-white/10",
                        i === quality.index
                          ? "text-[hsl(var(--primary))]"
                          : "text-zinc-100",
                      )}
                    >
                      <span>{it.label}</span>
                      {i === quality.index ? <span aria-hidden>✓</span> : null}
                    </button>
                  </li>
                ))
              : null}
            {quality.kind === "hls-managed" ? (
              <>
                {quality.items.map((it) => (
                  <li key={`${it.label}-${it.idx}`}>
                    <button
                      type="button"
                      onClick={() => {
                        quality.remote.changeQuality(it.idx);
                        setView("root");
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-3 py-2 hover:bg-white/10",
                        it.idx === -1
                          ? quality.auto
                            ? "text-[hsl(var(--primary))]"
                            : "text-zinc-100"
                          : !quality.auto && it.selected
                            ? "text-[hsl(var(--primary))]"
                            : "text-zinc-100",
                      )}
                    >
                      <span>{it.label}</span>
                      {it.idx === -1 ? (
                        quality.auto ? (
                          <span aria-hidden>✓</span>
                        ) : null
                      ) : !quality.auto && it.selected ? (
                        <span aria-hidden>✓</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </>
            ) : null}
          </ul>
        </div>
      ) : null}
      {view === "audio" && audio.kind !== "none" ? (
        <div>
          <div className="border-b border-white/10 px-3 py-2 text-xs uppercase tracking-wider text-zinc-400">
            <button
              type="button"
              onClick={() => setView("root")}
              className="hover:underline"
            >
              ‹ Language
            </button>
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {audio.kind === "split-native"
              ? audio.items.map((it, i) => (
                  <li key={`${it.label}-${i}`}>
                    <button
                      type="button"
                      onClick={() => {
                        audio.setIndex(i);
                        setView("root");
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-3 py-2 hover:bg-white/10",
                        i === audio.index
                          ? "text-[hsl(var(--primary))]"
                          : "text-zinc-100",
                      )}
                    >
                      <span>{it.label}</span>
                      {i === audio.index ? <span aria-hidden>✓</span> : null}
                    </button>
                  </li>
                ))
              : null}
            {audio.kind === "hls-managed"
              ? audio.items.map((it) => (
                  <li key={`${it.label}-${it.idx}`}>
                    <button
                      type="button"
                      onClick={() => {
                        audio.remote.changeAudioTrack(it.idx);
                        setView("root");
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-3 py-2 hover:bg-white/10",
                        it.selected
                          ? "text-[hsl(var(--primary))]"
                          : "text-zinc-100",
                      )}
                    >
                      <span>{it.label}</span>
                      {it.selected ? <span aria-hidden>✓</span> : null}
                    </button>
                  </li>
                ))
              : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

type ScrubPreviewConfig = { streamSrc: string; poster?: string };

function VolumeSlider({
  value,
  onChange,
  id,
}: {
  value: number;
  onChange: (v: number) => void;
  id?: string;
}) {
  const pct = Math.min(100, Math.max(0, value * 100));
  return (
    <div className="relative flex h-8 w-[6.5rem] shrink-0 items-center">
      <div
        className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-white/10 shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)] ring-1 ring-black/40"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute left-0 top-1/2 h-2 max-w-full -translate-y-1/2 rounded-l-full bg-white/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
        style={{ width: `${pct}%` }}
        aria-hidden
      />
      <input
        id={id}
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-[0.02]"
        aria-label="Volume"
      />
    </div>
  );
}

/* ------------------------------- Progress -------------------------------- */

function ProgressBar({
  current,
  duration,
  buffered,
  chapters,
  scrubPreview,
  onScrub,
  onScrubEnd,
}: {
  current: number;
  duration: number;
  buffered: number;
  chapters: VideoChapter[];
  scrubPreview?: ScrubPreviewConfig | null;
  onScrub: (t: number) => void;
  onScrubEnd: (t: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);

  const pct = (n: number) =>
    duration > 0 ? Math.min(100, Math.max(0, (n / duration) * 100)) : 0;

  const tFromPointer = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || duration <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const x = Math.min(rect.right, Math.max(rect.left, clientX));
      const ratio = (x - rect.left) / Math.max(rect.width, 1);
      return ratio * duration;
    },
    [duration],
  );

  const onPointerDown = (e: ReactPointerEvent) => {
    if (duration <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    const t = tFromPointer(e.clientX);
    onScrub(t);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const t = tFromPointer(e.clientX);
    setHover(t);
    if (draggingRef.current) onScrub(t);
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    const t = tFromPointer(e.clientX);
    onScrubEnd(t);
  };

  useEffect(() => {
    if (!dragging) return;
    const onWinPointerMove = (e: PointerEvent) => {
      const t = tFromPointer(e.clientX);
      setHover(t);
      if (draggingRef.current) onScrub(t);
    };
    const finish = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      const t = tFromPointer(e.clientX);
      onScrubEnd(t);
    };
    window.addEventListener("pointermove", onWinPointerMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", onWinPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [dragging, onScrub, onScrubEnd, tFromPointer]);

  const hasChapters = chapters.length > 1;
  const hoverChapterIndex = useMemo(
    () =>
      hover !== null && hasChapters ? chapterIndexAt(chapters, hover) : -1,
    [chapters, hover, hasChapters],
  );
  const hoverChapterTitle =
    hoverChapterIndex >= 0
      ? (chapters[hoverChapterIndex]?.title ?? null)
      : null;
  const hoverPositionRatio =
    hover !== null && duration > 0
      ? Math.min(1, Math.max(0, hover / duration))
      : 0.5;

  const previewRef = useRef<HTMLVideoElement | null>(null);
  const [previewVideoFailed, setPreviewVideoFailed] = useState(false);
  const previewFailedRef = useRef(false);
  const seekTimerRef = useRef<number | null>(null);

  useEffect(() => {
    previewFailedRef.current = false;
    setPreviewVideoFailed(false);
  }, [scrubPreview?.streamSrc]);

  useEffect(() => {
    if (seekTimerRef.current != null) {
      window.clearTimeout(seekTimerRef.current);
      seekTimerRef.current = null;
    }
    if (hover === null || !scrubPreview?.streamSrc || duration <= 0) return;
    seekTimerRef.current = window.setTimeout(() => {
      seekTimerRef.current = null;
      if (previewFailedRef.current) return;
      const v = previewRef.current;
      if (!v) return;
      const t = Math.max(0, Math.min(hover, duration - 0.05));
      if (Math.abs(v.currentTime - t) > 0.2) {
        try {
          v.currentTime = t;
        } catch {
          /* ignore */
        }
      }
    }, 80);
    return () => {
      if (seekTimerRef.current != null) {
        window.clearTimeout(seekTimerRef.current);
        seekTimerRef.current = null;
      }
    };
  }, [hover, duration, scrubPreview?.streamSrc]);

  const onPreviewVideoError = useCallback(() => {
    previewFailedRef.current = true;
    setPreviewVideoFailed(true);
  }, []);

  return (
    <div
      ref={trackRef}
      className="group/scrub relative flex min-h-10 cursor-pointer select-none items-center py-1.5 pointer-events-auto"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.max(duration, 1)}
      aria-valuenow={Math.min(current, Math.max(duration, 1))}
      tabIndex={0}
    >
      {hasChapters ? (
        chapters.map((chapter, index) => {
          const next = chapters[index + 1];
          const chapterEnd = next?.startSeconds ?? duration;
          const widthSeconds = Math.max(0, chapterEnd - chapter.startSeconds);
          const left = pct(chapter.startSeconds);
          const width = pct(widthSeconds);
          const isLast = index === chapters.length - 1;
          const isHovered = hoverChapterIndex === index;
          const localBuffered =
            widthSeconds > 0
              ? Math.min(
                  100,
                  Math.max(
                    0,
                    ((buffered - chapter.startSeconds) / widthSeconds) * 100,
                  ),
                )
              : 0;
          const localProgress =
            widthSeconds > 0
              ? Math.min(
                  100,
                  Math.max(
                    0,
                    ((current - chapter.startSeconds) / widthSeconds) * 100,
                  ),
                )
              : 0;
          return (
            <div
              key={`chapter-${chapter.startSeconds}-${index}`}
              className={cn(
                "pointer-events-none absolute top-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-white/25 transition-[height] duration-150",
                isHovered ? "h-2" : "h-1 group-hover/scrub:h-1.5",
              )}
              style={{
                left: `${left}%`,
                width: isLast
                  ? `${width}%`
                  : `calc(${width}% - ${CHAPTER_GAP_PX}px)`,
              }}
              aria-hidden
            >
              <div
                className="absolute inset-y-0 left-0 bg-white/40"
                style={{ width: `${localBuffered}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 bg-[hsl(var(--primary))]"
                style={{ width: `${localProgress}%` }}
              />
            </div>
          );
        })
      ) : (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/25 transition-[height] group-hover/scrub:h-1.5" />
          <div
            className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full"
            aria-hidden
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-white/40"
              style={{ width: `${pct(buffered)}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-[hsl(var(--primary))]"
              style={{ width: `${pct(current)}%` }}
            />
          </div>
        </>
      )}
      {hover !== null ? (
        <div
          className="pointer-events-none absolute bottom-full z-10 mb-1.5 -translate-x-1/2"
          style={{ left: `${pct(hover)}%` }}
        >
          <div
            className={cn(
              "flex flex-col items-center gap-1",
              hoverPositionRatio < 0.15
                ? "translate-x-[calc(50%-1.25rem)] items-start"
                : hoverPositionRatio > 0.85
                  ? "-translate-x-[calc(50%-1.25rem)] items-end"
                  : "",
            )}
          >
            {scrubPreview ? (
              <div className="relative aspect-video w-[7.5rem] shrink-0 overflow-hidden rounded-md bg-zinc-950 shadow-lg ring-1 ring-white/20">
                {scrubPreview.poster ? (
                  <img
                    src={scrubPreview.poster}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : null}
                {scrubPreview.streamSrc && !previewVideoFailed ? (
                  <video
                    key={scrubPreview.streamSrc}
                    ref={previewRef}
                    src={scrubPreview.streamSrc}
                    muted
                    playsInline
                    preload="metadata"
                    className="relative z-[1] h-full w-full object-cover"
                    aria-hidden
                    onError={onPreviewVideoError}
                  />
                ) : null}
              </div>
            ) : null}
            {hoverChapterTitle ? (
              <span className="max-w-[16rem] truncate rounded-md bg-black/85 px-2 py-0.5 text-[11px] font-medium text-white shadow ring-1 ring-white/10">
                {hoverChapterTitle}
              </span>
            ) : null}
            <span className="rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white shadow ring-1 ring-white/10">
              {formatClock(hover)}
            </span>
          </div>
        </div>
      ) : null}
      <div
        className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[hsl(var(--primary))] opacity-0 shadow ring-2 ring-black/40 transition-opacity group-hover/scrub:opacity-100"
        style={{ left: `${pct(current)}%` }}
        aria-hidden
      />
    </div>
  );
}

/* ------------------------------- Chrome --------------------------------- */

type ChromeProps = {
  adapter: PlayerAdapter;
  shellRef: React.RefObject<HTMLDivElement | null>;
  title: string;
  chapters: VideoChapter[];
  quality: QualityModel;
  audio: AudioModel;
  cinemaMode: boolean;
  onExitCinema: () => void;
  onToggleCinema: () => void;
  scrubPreview?: ScrubPreviewConfig | null;
  centerHint?: { kind: "play" | "pause"; tick: number } | null;
  nextUp?: { href: string; title: string } | null;
  queue?: { href: string; title: string }[];
  autoplayNext: boolean;
  onToggleAutoplayNext: () => void;
  onPlayNext: () => void;
  miniMode?: boolean;
};

function PlayerChrome({
  adapter,
  shellRef,
  title,
  chapters,
  quality,
  audio,
  cinemaMode,
  onExitCinema,
  onToggleCinema,
  scrubPreview,
  centerHint,
  nextUp,
  queue = [],
  autoplayNext,
  onToggleAutoplayNext,
  onPlayNext,
  miniMode = false,
}: ChromeProps) {
  const [hydrated, setHydrated] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { active: fsActive, toggle: toggleFs } = useFullscreenShell(shellRef);
  const { visible, ping, hide } = useIdleVisible(adapter.paused, settingsOpen);
  const [scrub, setScrub] = useState<number | null>(null);
  const [showVolPanel, setShowVolPanel] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [autoCenterHint, setAutoCenterHint] = useState<{
    kind: "play" | "pause";
    tick: number;
  } | null>(null);
  const prevPausedRef = useRef<boolean | null>(null);
  const miniAutoplayTriedRef = useRef(false);
  /** True while long-press 2× is active: hides chrome, shows a small ×2 hint. */
  const [hold2xUi, setHold2xUi] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!miniMode) return;
    if (miniAutoplayTriedRef.current) return;
    if (!adapter.canPlay) return;
    miniAutoplayTriedRef.current = true;
    if (!adapter.paused) return;
    adapter.play();
  }, [adapter, miniMode]);

  useEffect(() => {
    const prev = prevPausedRef.current;
    prevPausedRef.current = adapter.paused;
    if (prev == null || prev === adapter.paused) return;
    const next = {
      kind: adapter.paused ? ("pause" as const) : ("play" as const),
      tick: Date.now(),
    };
    setAutoCenterHint(next);
    const t = window.setTimeout(() => setAutoCenterHint(null), 1000);
    return () => window.clearTimeout(t);
  }, [adapter.paused]);

  const hold2xTimerRef = useRef<number | null>(null);
  const holding2xRef = useRef(false);
  const rateBeforeHoldRef = useRef(1);
  const suppressNextClickRef = useRef(false);

  /** ×2 UI can be held by pointer long-press and/or Space long-press — ref-counted. */
  const hold2xLeaseRef = useRef(0);
  const acquireHold2xLease = useCallback(() => {
    hold2xLeaseRef.current += 1;
    if (hold2xLeaseRef.current === 1) setHold2xUi(true);
  }, []);
  const releaseHold2xLease = useCallback(() => {
    hold2xLeaseRef.current = Math.max(0, hold2xLeaseRef.current - 1);
    if (hold2xLeaseRef.current === 0) setHold2xUi(false);
  }, []);

  const clearHold2xTimer = useCallback(() => {
    if (hold2xTimerRef.current != null) {
      window.clearTimeout(hold2xTimerRef.current);
      hold2xTimerRef.current = null;
    }
  }, []);

  const spacePhysDownRef = useRef(false);
  const spaceHoldTimerRef = useRef<number | null>(null);
  const spaceHold2xEngagedRef = useRef(false);
  const rateBeforeSpaceHoldRef = useRef(1);

  const clearSpaceHoldTimer = useCallback(() => {
    if (spaceHoldTimerRef.current != null) {
      window.clearTimeout(spaceHoldTimerRef.current);
      spaceHoldTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearHold2xTimer(), [clearHold2xTimer]);

  const onSurfacePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if ((e.target as HTMLElement).closest("[data-controls]")) return;
      if (settingsOpen) return;
      // Long-press ×2 only for real pointing devices (not keyboard/synthetic).
      if (
        e.pointerType !== "mouse" &&
        e.pointerType !== "pen" &&
        e.pointerType !== "touch"
      ) {
        return;
      }
      if (!e.isPrimary) return;
      rateBeforeHoldRef.current = adapter.playbackRate;
      clearHold2xTimer();
      hold2xTimerRef.current = window.setTimeout(() => {
        hold2xTimerRef.current = null;
        holding2xRef.current = true;
        adapter.setPlaybackRate(2);
        acquireHold2xLease();
      }, 220);
    },
    [adapter, acquireHold2xLease, settingsOpen, clearHold2xTimer],
  );

  const onSurfacePointerUp = useCallback(() => {
    clearHold2xTimer();
    if (holding2xRef.current) {
      holding2xRef.current = false;
      releaseHold2xLease();
      suppressNextClickRef.current = true;
      adapter.setPlaybackRate(rateBeforeHoldRef.current);
    }
  }, [adapter, clearHold2xTimer, releaseHold2xLease]);

  const onSurfacePointerLeave = useCallback(() => {
    clearHold2xTimer();
    if (holding2xRef.current) {
      holding2xRef.current = false;
      releaseHold2xLease();
      suppressNextClickRef.current = true;
      adapter.setPlaybackRate(rateBeforeHoldRef.current);
    }
  }, [adapter, clearHold2xTimer, releaseHold2xLease]);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const onMove = () => ping();
    const onLeave = () => {
      if (!adapter.paused && !settingsOpen) hide();
    };
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    el.addEventListener("touchstart", onMove, { passive: true });
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      el.removeEventListener("touchstart", onMove);
    };
  }, [shellRef, ping, hide, adapter.paused, settingsOpen]);

  useEffect(() => {
    if (fsActive && cinemaMode) onExitCinema();
  }, [fsActive, cinemaMode, onExitCinema]);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;

    const releaseSpaceHoldIfNeeded = () => {
      clearSpaceHoldTimer();
      if (!spacePhysDownRef.current) return;
      spacePhysDownRef.current = false;
      if (spaceHold2xEngagedRef.current) {
        spaceHold2xEngagedRef.current = false;
        adapter.setPlaybackRate(rateBeforeSpaceHoldRef.current);
        releaseHold2xLease();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      if (!spacePhysDownRef.current) return;
      if (
        e.target instanceof HTMLElement &&
        (e.target.tagName === "INPUT" ||
          e.target.tagName === "TEXTAREA" ||
          e.target.isContentEditable)
      ) {
        return;
      }
      if (!shellRef.current?.contains(document.activeElement) && !fsActive) {
        return;
      }
      e.preventDefault();
      spacePhysDownRef.current = false;
      clearSpaceHoldTimer();
      if (spaceHold2xEngagedRef.current) {
        spaceHold2xEngagedRef.current = false;
        adapter.setPlaybackRate(rateBeforeSpaceHoldRef.current);
        releaseHold2xLease();
      } else {
        adapter.togglePaused();
        ping();
      }
    };

    const onWinBlur = () => {
      clearSpaceHoldTimer();
      if (!spacePhysDownRef.current) return;
      spacePhysDownRef.current = false;
      if (spaceHold2xEngagedRef.current) {
        spaceHold2xEngagedRef.current = false;
        adapter.setPlaybackRate(rateBeforeSpaceHoldRef.current);
        releaseHold2xLease();
      }
    };

    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        (e.target.tagName === "INPUT" ||
          e.target.tagName === "TEXTAREA" ||
          e.target.isContentEditable)
      ) {
        return;
      }
      if (!shellRef.current?.contains(document.activeElement) && !fsActive) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "escape") {
        releaseSpaceHoldIfNeeded();
        if (settingsOpen) {
          e.preventDefault();
          setSettingsOpen(false);
          ping();
        } else if (cinemaMode) {
          e.preventDefault();
          onExitCinema();
          ping();
        }
        return;
      }
      if (key === " ") {
        e.preventDefault();
        if (e.repeat) return;
        clearHold2xTimer();
        rateBeforeSpaceHoldRef.current = adapter.playbackRate;
        spacePhysDownRef.current = true;
        spaceHold2xEngagedRef.current = false;
        clearSpaceHoldTimer();
        spaceHoldTimerRef.current = window.setTimeout(() => {
          spaceHoldTimerRef.current = null;
          spaceHold2xEngagedRef.current = true;
          adapter.setPlaybackRate(2);
          acquireHold2xLease();
        }, 220);
        return;
      }
      if (key === "k") {
        e.preventDefault();
        if (e.repeat) return;
        adapter.togglePaused();
        ping();
        return;
      }
      if (key === "arrowleft" || key === "j") {
        e.preventDefault();
        adapter.seek(Math.max(0, adapter.currentTime - (key === "j" ? 10 : 5)));
        ping();
      } else if (key === "arrowright" || key === "l") {
        e.preventDefault();
        adapter.seek(
          Math.min(
            adapter.duration || adapter.currentTime,
            adapter.currentTime + (key === "l" ? 10 : 5),
          ),
        );
        ping();
      } else if (key === "arrowup") {
        e.preventDefault();
        adapter.setVolume(
          Math.min(1, (adapter.muted ? 0 : adapter.volume) + 0.05),
        );
        ping();
      } else if (key === "arrowdown") {
        e.preventDefault();
        adapter.setVolume(
          Math.max(0, (adapter.muted ? 0 : adapter.volume) - 0.05),
        );
        ping();
      } else if (key === "m") {
        e.preventDefault();
        adapter.toggleMuted();
        ping();
      } else if (key === "f") {
        e.preventDefault();
        void toggleFs();
      } else if (key === "c") {
        e.preventDefault();
        onToggleCinema();
        ping();
      } else if (key === "i") {
        e.preventDefault();
        adapter.togglePictureInPicture();
      }
    };
    window.addEventListener("keydown", handler, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onWinBlur);
    return () => {
      window.removeEventListener("keydown", handler, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onWinBlur);
    };
  }, [
    acquireHold2xLease,
    adapter,
    cinemaMode,
    clearHold2xTimer,
    clearSpaceHoldTimer,
    fsActive,
    onExitCinema,
    onToggleCinema,
    ping,
    releaseHold2xLease,
    settingsOpen,
    shellRef,
    toggleFs,
  ]);

  const onSurfaceClick = (e: ReactMouseEvent) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if ((e.target as HTMLElement).closest("[data-controls]")) return;
    if (settingsOpen) {
      setSettingsOpen(false);
      return;
    }
    if (miniMode) return;
    adapter.togglePaused();
  };

  const level = adapter.muted ? 0 : adapter.volume;
  const levelUi = hydrated ? level : 1;
  const seekPos = scrub ?? adapter.currentTime;
  const chromeShown = visible && !hold2xUi;
  const currentChapterTitle =
    chapters.length > 1
      ? (chapters[chapterIndexAt(chapters, seekPos)]?.title ?? null)
      : null;

  return (
    <>
      {/* Click / dblclick surface (above outlet, below controls) */}
      <button
        type="button"
        aria-label={adapter.paused ? "Play" : "Pause"}
        onClick={onSurfaceClick}
        onPointerDown={onSurfacePointerDown}
        onPointerUp={onSurfacePointerUp}
        onPointerCancel={onSurfacePointerUp}
        onPointerLeave={onSurfacePointerLeave}
        onDoubleClick={() => void toggleFs()}
        className="absolute inset-0 z-10 cursor-pointer bg-transparent"
      />

      {/* Buffering spinner */}
      {adapter.waiting && !adapter.paused ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          {/* biome-ignore lint/a11y/useSemanticElements: visual spinner */}
          <div
            className="h-12 w-12 animate-spin rounded-full border-2 border-white/30 border-t-white"
            role="status"
            aria-label="Loading"
          />
        </div>
      ) : null}

      {/* Toggle hint icon (play/pause) */}
      {(centerHint ?? autoCenterHint) && !hold2xUi ? (
        <div
          key={(centerHint ?? autoCenterHint)?.tick}
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
        >
          <div className="flex h-16 w-16 animate-[hintFade_1000ms_ease-in-out_forwards] items-center justify-center rounded-full bg-black/55 text-white">
            {(centerHint ?? autoCenterHint)?.kind === "play" ? (
              <BigPlayOverlayIcon className="h-10 w-10" />
            ) : (
              <PauseIcon className="h-9 w-9" />
            )}
          </div>
        </div>
      ) : null}

      {hold2xUi ? (
        <div
          className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-md bg-black/45 px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums tracking-tight text-white/90 shadow-sm ring-1 ring-white/10"
          aria-live="polite"
        >
          ×2
        </div>
      ) : null}

      {/* Top gradient + title */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-30 px-4 pt-2 transition-opacity duration-200",
          chromeShown ? "opacity-100" : "opacity-0",
        )}
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0))",
          height: "5rem",
        }}
      >
        {!miniMode ? (
          <p className="line-clamp-1 text-sm font-medium text-white drop-shadow">
            {title}
          </p>
        ) : null}
      </div>

      {/* Bottom gradient + controls */}
      <div
        data-controls
        className={cn(
          "absolute inset-x-0 bottom-0 z-30 transition-opacity duration-200",
          chromeShown ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0))",
        }}
      >
        <div className="px-3 pb-2 pt-12 sm:px-4">
          <ProgressBar
            current={seekPos}
            duration={adapter.duration}
            buffered={adapter.bufferedEnd}
            chapters={chapters}
            scrubPreview={scrubPreview ?? null}
            onScrub={(t) => {
              setScrub(t);
              adapter.seekPreview(t);
            }}
            onScrubEnd={(t) => {
              setScrub(null);
              adapter.seek(t);
            }}
          />
          <div className="mt-1 flex items-center gap-1.5 text-white sm:gap-2">
            <button
              type="button"
              onClick={() => adapter.togglePaused()}
              className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/15"
              aria-label={adapter.paused ? "Play" : "Pause"}
            >
              {adapter.paused ? (
                <PlayIcon className="h-6 w-6 pl-0.5" />
              ) : (
                <PauseIcon className="h-6 w-6" />
              )}
            </button>

            <fieldset
              className="flex items-center border-0 p-0"
              onMouseEnter={() => setShowVolPanel(true)}
              onMouseLeave={() => setShowVolPanel(false)}
              onFocus={() => setShowVolPanel(true)}
              onBlur={() => setShowVolPanel(false)}
            >
              <legend className="sr-only">Volume</legend>
              <button
                type="button"
                onClick={() => adapter.toggleMuted()}
                className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/15"
                aria-label={adapter.muted ? "Unmute" : "Mute"}
              >
                {levelUi < 0.01 ? (
                  <MuteIcon className="h-6 w-6" />
                ) : levelUi < 0.5 ? (
                  <VolLowIcon className="h-6 w-6" />
                ) : (
                  <VolHighIcon className="h-6 w-6" />
                )}
              </button>
              <div
                className={cn(
                  "ml-0.5 overflow-hidden transition-[width,opacity] duration-200 ease-out",
                  showVolPanel ? "w-[6.75rem] opacity-100" : "w-0 opacity-0",
                )}
              >
                <VolumeSlider
                  value={levelUi}
                  onChange={(v) => adapter.setVolume(v)}
                />
              </div>
            </fieldset>

            <span className="ml-1 flex min-w-0 items-center gap-2 text-xs text-white/90">
              <span className="font-mono tabular-nums">
                {formatClock(seekPos)} / {formatClock(adapter.duration)}
              </span>
              {currentChapterTitle ? (
                <>
                  <span aria-hidden className="text-white/40">
                    ·
                  </span>
                  <span
                    className="line-clamp-1 max-w-[14rem] truncate text-white/90 sm:max-w-[22rem]"
                    title={currentChapterTitle}
                  >
                    {currentChapterTitle}
                  </span>
                </>
              ) : null}
            </span>

            <span className="ml-auto" />

            {miniMode ? (
              <span className="rounded bg-black/35 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/80">
                Mini
              </span>
            ) : null}

            {nextUp && !miniMode ? (
              <>
                <button
                  type="button"
                  onClick={onToggleAutoplayNext}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px] font-medium tracking-wide transition",
                    autoplayNext
                      ? "bg-[hsl(var(--primary))] text-white"
                      : "bg-white/10 text-white/90 hover:bg-white/15",
                  )}
                  aria-pressed={autoplayNext}
                  title="Autoplay next"
                >
                  Autoplay
                </button>
                <button
                  type="button"
                  onClick={onPlayNext}
                  className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/15"
                  aria-label="Play next video"
                  title={nextUp.title}
                >
                  <NextIcon className="h-5 w-5" />
                </button>
              </>
            ) : null}

            {queue.length > 0 && !miniMode ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setQueueOpen((v) => !v)}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px] font-medium tracking-wide transition",
                    queueOpen
                      ? "bg-white/20 text-white"
                      : "bg-white/10 text-white/90 hover:bg-white/15",
                  )}
                  aria-expanded={queueOpen}
                >
                  Queue ({queue.length})
                </button>
                {queueOpen ? (
                  <div className="absolute bottom-11 right-0 z-50 w-72 max-w-[80vw] rounded-lg border border-white/10 bg-zinc-950/95 p-2 shadow-xl backdrop-blur">
                    <p className="px-2 pb-1 text-[11px] uppercase tracking-wide text-zinc-400">
                      Up next
                    </p>
                    <ul className="max-h-64 overflow-auto">
                      {queue.map((item, idx) => (
                        <li key={`${item.href}-${idx}`}>
                          <Link
                            href={item.href}
                            className="line-clamp-2 block rounded-md px-2 py-1.5 text-xs text-zinc-100 hover:bg-white/10"
                            onClick={() => setQueueOpen(false)}
                          >
                            {idx + 1}. {item.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {!miniMode ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSettingsOpen((v) => !v)}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/15",
                    settingsOpen ? "bg-white/15" : "",
                  )}
                  aria-label="Settings"
                  aria-expanded={settingsOpen}
                >
                  <GearIcon className="h-5 w-5" />
                </button>
              </div>
            ) : null}

            {!miniMode ? (
              <button
                type="button"
                onClick={() => onToggleCinema()}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/15",
                  cinemaMode ? "bg-white/15 text-white" : "",
                )}
                aria-label={
                  cinemaMode ? "Exit cinema mode" : "Enter cinema mode"
                }
                aria-pressed={cinemaMode}
                title="Cinema (C)"
              >
                <CinemaIcon className="h-5 w-5" />
              </button>
            ) : null}

            {!miniMode ? (
              <button
                type="button"
                onClick={() => void toggleFs()}
                className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/15"
                aria-label={fsActive ? "Exit fullscreen" : "Enter fullscreen"}
              >
                {fsActive ? (
                  <FsExitIcon className="h-6 w-6" />
                ) : (
                  <FsEnterIcon className="h-6 w-6" />
                )}
              </button>
            ) : null}

            {adapter.canPictureInPicture ? (
              <button
                type="button"
                onClick={() => adapter.togglePictureInPicture()}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/15",
                  adapter.pictureInPicture ? "bg-white/15" : "",
                )}
                aria-label={
                  adapter.pictureInPicture
                    ? "Exit picture in picture"
                    : "Enter picture in picture"
                }
              >
                <PipIcon className="h-5 w-5" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {settingsOpen ? (
        <SettingsMenu
          quality={quality}
          audio={audio}
          rate={adapter.playbackRate}
          setRate={(r) => adapter.setPlaybackRate(r)}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      <style jsx>{`
        @keyframes hintFade {
          0% { opacity: 0; transform: scale(0.88); }
          12% { opacity: 1; transform: scale(1); }
          78% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.06); }
        }
      `}</style>
    </>
  );
}

/* ------------------------- Vidstack player block ------------------------- */

function VidstackBlock({
  src,
  title,
  poster,
  reactKey,
  payload,
  qualityIndex,
  setQualityIndex,
  progressive,
  chapters,
  startAtSeconds,
  cinemaMode,
  onExitCinema,
  onToggleCinema,
  onPlaybackError,
  onEnded,
  nextUp,
  queue,
  autoplayNext,
  onToggleAutoplayNext,
  onPlayNext,
  miniMode = false,
}: {
  src: string;
  title: string;
  poster?: string;
  reactKey: string;
  payload: VideoPlayerPayload;
  qualityIndex: number;
  setQualityIndex: (i: number, seekSeconds?: number) => void;
  progressive: ProxiedVariant[] | null;
  chapters: VideoChapter[];
  startAtSeconds?: number;
  cinemaMode: boolean;
  onExitCinema: () => void;
  onToggleCinema: () => void;
  onPlaybackError?: () => void;
  onEnded?: () => void;
  nextUp?: { href: string; title: string } | null;
  queue?: { href: string; title: string }[];
  autoplayNext: boolean;
  onToggleAutoplayNext: () => void;
  onPlayNext: () => void;
  miniMode?: boolean;
}) {
  const playerRef = useRef<MediaPlayerElement | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const adapter = useVidstackAdapter(playerRef);
  const remote = useMediaRemote(
    playerRef as React.RefObject<EventTarget | null>,
  );
  const persistStore = useMediaStore(
    playerRef as React.RefObject<EventTarget | null>,
  );
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hlsQuality = useHlsQualityModel(playerRef);
  const hlsAudio = useHlsAudioModel(playerRef);
  const initialSeekAppliedRef = useRef(false);
  const initialMediaPrefsAppliedRef = useRef(false);
  const emitPlaybackError = useCallback(() => {
    if (!onPlaybackError) return;
    // Vidstack can surface an error synchronously while mounting; defer recovery
    // to avoid triggering React updates during another component render.
    window.setTimeout(() => onPlaybackError(), 0);
  }, [onPlaybackError]);

  useEffect(() => {
    initialSeekAppliedRef.current = false;
  }, [reactKey, startAtSeconds]);

  useEffect(() => {
    if (initialSeekAppliedRef.current) return;
    if (!adapter.canPlay) return;
    if (
      typeof startAtSeconds !== "number" ||
      !Number.isFinite(startAtSeconds) ||
      startAtSeconds < 0
    ) {
      return;
    }
    adapter.seek(startAtSeconds);
    initialSeekAppliedRef.current = true;
  }, [adapter, startAtSeconds]);

  useEffect(() => {
    if (!persistStore.canPlay) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      writePlayerMediaPrefs({
        volume: gainToUiVolume(persistStore.volume),
        muted: persistStore.muted,
      });
    }, 200);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [persistStore.volume, persistStore.muted, persistStore.canPlay]);

  // Keep SSR/client first render deterministic; hydrate prefs after mount.
  const [mediaPrefs, setMediaPrefs] = useState({ volume: 1, muted: false });
  useEffect(() => {
    setMediaPrefs(readPlayerMediaPrefs());
  }, []);

  useEffect(() => {
    if (initialMediaPrefsAppliedRef.current) return;
    if (!persistStore.canPlay) return;
    const vol =
      typeof mediaPrefs.volume === "number" &&
      Number.isFinite(mediaPrefs.volume)
        ? Math.min(1, Math.max(0, mediaPrefs.volume))
        : 1;
    remote.changeVolume(uiVolumeToGain(vol));
    if (mediaPrefs.muted || vol <= 0.001) remote.mute();
    else remote.unmute();
    initialMediaPrefsAppliedRef.current = true;
  }, [mediaPrefs, persistStore.canPlay, remote]);

  const quality: QualityModel =
    payload.mode === "progressive" && progressive && progressive.length > 0
      ? {
          kind: "progressive",
          index: qualityIndex,
          setIndex: (i) => setQualityIndex(i, adapter.currentTime),
          items: progressive.map((p) => ({ label: p.label })),
        }
      : hlsQuality;

  return (
    <div
      ref={shellRef}
      tabIndex={-1}
      className={cn(
        "group/player relative overflow-hidden bg-black focus:outline-none",
        cinemaMode
          ? "aspect-video w-full max-h-[min(88vh,92dvh)] rounded-lg shadow-xl ring-1 ring-white/10"
          : "aspect-video w-full",
      )}
    >
      <MediaPlayer
        key={reactKey}
        ref={playerRef}
        title={title}
        src={sourceFromUrl(src)}
        poster={poster}
        controls={false}
        load="eager"
        preferNativeHLS={false}
        playsInline
        onError={emitPlaybackError}
        onEnded={onEnded}
        className={cn("absolute inset-0", PLAYER_FILL)}
      >
        <MediaOutlet />
      </MediaPlayer>
      <PlayerChrome
        adapter={adapter}
        shellRef={shellRef}
        title={title}
        chapters={chapters}
        quality={quality}
        audio={hlsAudio}
        cinemaMode={cinemaMode}
        onExitCinema={onExitCinema}
        onToggleCinema={onToggleCinema}
        scrubPreview={{ streamSrc: src, ...(poster ? { poster } : {}) }}
        nextUp={nextUp}
        queue={queue}
        autoplayNext={autoplayNext}
        onToggleAutoplayNext={onToggleAutoplayNext}
        onPlayNext={onPlayNext}
        miniMode={miniMode}
      />
    </div>
  );
}

/* --------------------------- Split player block -------------------------- */

function SplitBlock({
  video,
  audioTracks,
  defaultAudioIndex = 0,
  poster,
  title,
  volume,
  setVolume,
  payload,
  progressive,
  qualityIndex,
  setQualityIndex,
  chapters,
  startAtSeconds,
  cinemaMode,
  onExitCinema,
  onToggleCinema,
  onPlaybackError,
  onEnded,
  nextUp,
  queue,
  autoplayNext,
  onToggleAutoplayNext,
  onPlayNext,
  miniMode = false,
}: {
  video: string;
  audioTracks: { label: string; src: string }[];
  /** Initial / reset index for the language picker (original when known). */
  defaultAudioIndex?: number;
  poster?: string;
  title: string;
  volume: number;
  setVolume: (v: number) => void;
  payload: VideoPlayerPayload;
  progressive: ProxiedVariant[] | null;
  qualityIndex: number;
  setQualityIndex: (i: number, seekSeconds?: number) => void;
  chapters: VideoChapter[];
  startAtSeconds?: number;
  cinemaMode: boolean;
  onExitCinema: () => void;
  onToggleCinema: () => void;
  onPlaybackError?: () => void;
  onEnded?: () => void;
  nextUp?: { href: string; title: string } | null;
  queue?: { href: string; title: string }[];
  autoplayNext: boolean;
  onToggleAutoplayNext: () => void;
  onPlayNext: () => void;
  miniMode?: boolean;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const safeDefaultIdx = Math.min(
    Math.max(0, defaultAudioIndex),
    Math.max(0, audioTracks.length - 1),
  );
  const [splitAudioIdx, setSplitAudioIdx] = useState(safeDefaultIdx);
  const awaitingCompanionAudioRef = useRef(false);
  /** Skips one `pause` side-effect when we pause video ourselves to wait for audio. */
  const ignoreNextVideoPauseRef = useRef(false);
  const initialSeekAppliedRef = useRef(false);
  const emitPlaybackError = useCallback(() => {
    if (!onPlaybackError) return;
    window.setTimeout(() => onPlaybackError(), 0);
  }, [onPlaybackError]);

  useEffect(() => {
    setSplitAudioIdx(safeDefaultIdx);
  }, [video, audioTracks, safeDefaultIdx]);

  useEffect(() => {
    initialSeekAppliedRef.current = false;
  }, [video, startAtSeconds]);

  const activeAudioSrc =
    audioTracks[splitAudioIdx]?.src ?? audioTracks[0]?.src ?? "";

  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;

    const SYNC_TOLERANCE = 0.16;
    /** Rare hard snap — avoid tight timers that hammer `currentTime` (breaks decode). */
    const DRIFT_HARD = 0.45;
    /** Medium drift that should be corrected quickly while both tracks are playing. */
    const DRIFT_RECOVER = 0.28;

    const align = (force = false) => {
      const drift = Math.abs(a.currentTime - v.currentTime);
      if (force || drift > SYNC_TOLERANCE) {
        a.currentTime = v.currentTime;
      }
    };

    // Resume audio when video resumes after a real pause; only re-align time
    // if drift is large to avoid resetting (and "pop"-ing) on every event.
    let waitingPauseTimer: ReturnType<typeof setTimeout> | null = null;
    let driftRecoveryTimer: ReturnType<typeof setInterval> | null = null;
    const clearWaitingPauseTimer = () => {
      if (!waitingPauseTimer) return;
      clearTimeout(waitingPauseTimer);
      waitingPauseTimer = null;
    };
    const clearDriftRecoveryTimer = () => {
      if (!driftRecoveryTimer) return;
      clearInterval(driftRecoveryTimer);
      driftRecoveryTimer = null;
    };
    const primeDriftRecovery = () => {
      clearDriftRecoveryTimer();
      driftRecoveryTimer = setInterval(() => {
        if (v.paused) return;
        if (a.paused) {
          void a.play().catch(() => {});
          return;
        }
        const drift = Math.abs(a.currentTime - v.currentTime);
        if (drift > DRIFT_RECOVER) {
          a.currentTime = v.currentTime;
        }
      }, 350);
    };
    const onPlay = () => {
      clearWaitingPauseTimer();
      primeDriftRecovery();
      // Only gate when the audio element has no media yet (HAVE_NOTHING). Waiting
      // for HAVE_CURRENT_DATA breaks playback on some browsers / slow networks
      // because `currentTime` seeks never become safe while stalled.
      if (a.readyState === HTMLMediaElement.HAVE_NOTHING) {
        awaitingCompanionAudioRef.current = true;
        ignoreNextVideoPauseRef.current = true;
        v.pause();
        a.pause();
        let resumed = false;
        const resume = () => {
          if (resumed || !awaitingCompanionAudioRef.current) return;
          resumed = true;
          awaitingCompanionAudioRef.current = false;
          a.removeEventListener("loadedmetadata", resume);
          a.removeEventListener("canplay", resume);
          a.removeEventListener("canplaythrough", resume);
          align(true);
          void a.play().catch(() => {});
          void v.play().catch(() => {});
        };
        a.addEventListener("loadedmetadata", resume, { once: true });
        a.addEventListener("canplay", resume, { once: true });
        a.addEventListener("canplaythrough", resume, { once: true });
        return;
      }
      awaitingCompanionAudioRef.current = false;
      align(false);
      if (a.paused) void a.play().catch(() => {});
    };
    const onPlaying = () => {
      clearWaitingPauseTimer();
      primeDriftRecovery();
      align(false);
      if (a.paused) void a.play().catch(() => {});
    };
    // Pause audio only when the user pauses or the video ends.
    const pauseAudio = () => {
      clearWaitingPauseTimer();
      if (ignoreNextVideoPauseRef.current) {
        ignoreNextVideoPauseRef.current = false;
        return;
      }
      awaitingCompanionAudioRef.current = false;
      a.pause();
    };
    const onWaiting = () => {
      clearWaitingPauseTimer();
      // Let brief network jitter recover without immediately muting companion audio.
      waitingPauseTimer = setTimeout(() => {
        if (!v.paused) a.pause();
      }, 420);
    };
    const alignSeek = () => {
      clearWaitingPauseTimer();
      align(true);
    };
    const onRate = () => {
      a.playbackRate = v.playbackRate;
      align(true);
    };
    const onTime = () => {
      if (v.paused) return;
      const drift = Math.abs(a.currentTime - v.currentTime);
      if (drift > DRIFT_HARD) a.currentTime = v.currentTime;
    };
    const onAudioCanPlay = () => {
      if (!v.paused && a.paused) {
        align(false);
        void a.play().catch(() => {});
      }
    };
    const onTabResume = () => {
      // Some browsers suspend the hidden tab's <audio> element and it may not
      // resume automatically when returning. Re-prime split audio on resume.
      if (document.visibilityState === "hidden") return;
      if (v.paused) return;
      clearWaitingPauseTimer();
      a.playbackRate = v.playbackRate;
      align(true);
      void a.play().catch(() => {});
    };
    v.addEventListener("play", onPlay);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("pause", pauseAudio);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("seeking", alignSeek);
    v.addEventListener("seeked", alignSeek);
    v.addEventListener("ratechange", onRate);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("ended", pauseAudio);
    a.addEventListener("canplay", onAudioCanPlay);
    a.addEventListener("loadedmetadata", onAudioCanPlay);
    document.addEventListener("visibilitychange", onTabResume);
    window.addEventListener("focus", onTabResume);
    window.addEventListener("pageshow", onTabResume);

    // Track switch: the new `<audio>` element is paused; resume it inline so
    // the user does not have to toggle play/pause to hear the new track.
    a.playbackRate = v.playbackRate;
    if (!v.paused) {
      primeDriftRecovery();
      align(true);
      void a.play().catch(() => {});
    }
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("pause", pauseAudio);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("seeking", alignSeek);
      v.removeEventListener("seeked", alignSeek);
      v.removeEventListener("ratechange", onRate);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("ended", pauseAudio);
      a.removeEventListener("canplay", onAudioCanPlay);
      a.removeEventListener("loadedmetadata", onAudioCanPlay);
      document.removeEventListener("visibilitychange", onTabResume);
      window.removeEventListener("focus", onTabResume);
      window.removeEventListener("pageshow", onTabResume);
      clearWaitingPauseTimer();
      clearDriftRecoveryTimer();
    };
    // Re-bind when companion audio element is remounted (track change).
  }, [activeAudioSrc, video]);

  const adapter = useNativeAdapter({
    videoRef,
    audioRef,
    externalVolume: volume,
    setExternalVolume: setVolume,
  });

  useEffect(() => {
    if (initialSeekAppliedRef.current) return;
    if (!adapter.canPlay) return;
    if (
      typeof startAtSeconds !== "number" ||
      !Number.isFinite(startAtSeconds) ||
      startAtSeconds < 0
    ) {
      return;
    }
    adapter.seek(startAtSeconds);
    initialSeekAppliedRef.current = true;
  }, [adapter, startAtSeconds]);

  useEffect(() => {
    const a = audioRef.current;
    if (a) a.volume = adapter.muted ? 0 : uiVolumeToGain(volume);
  }, [activeAudioSrc, adapter.muted, volume]);

  // Resume companion audio when the audio source is swapped mid-playback (track
  // change). The main play/pause sync is handled by the listeners above; we
  // only need to prime the new <audio> here so users don't lose sound.
  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;
    if (v.paused) return;
    a.currentTime = v.currentTime;
    void a.play().catch(() => {});
  }, [activeAudioSrc]);

  const quality: QualityModel =
    payload.mode === "progressive" && progressive && progressive.length > 0
      ? {
          kind: "progressive",
          index: qualityIndex,
          setIndex: (i) => setQualityIndex(i, adapter.currentTime),
          items: progressive.map((p) => ({ label: p.label })),
        }
      : { kind: "none" };
  // `pick-playback` already collapses same-language audio variants into a
  // single language row (one URL per language, highest bitrate), so the
  // entries here can be rendered as-is — no quality re-formatting needed.
  const audioModel: AudioModel = hasMultipleDistinctAudioStreams(audioTracks)
    ? {
        kind: "split-native",
        index: splitAudioIdx,
        setIndex: setSplitAudioIdx,
        items: audioTracks.map((t, idx) => ({
          label:
            t.label?.trim() ||
            languageFirstAudioMenuLabel({
              displayName: null,
              language: null,
              qualityFallback: null,
              streamUrl: t.src,
              index: idx,
            }),
        })),
      }
    : { kind: "none" };

  return (
    <div
      ref={shellRef}
      tabIndex={-1}
      className={cn(
        "group/player relative overflow-hidden bg-black focus:outline-none",
        cinemaMode
          ? "aspect-video w-full max-h-[min(88vh,92dvh)] rounded-lg shadow-xl ring-1 ring-white/10"
          : "aspect-video w-full",
      )}
    >
      <video
        ref={videoRef}
        src={video}
        poster={poster}
        playsInline
        muted
        preload="metadata"
        onError={emitPlaybackError}
        onEnded={onEnded}
        className="absolute inset-0 h-full w-full object-contain"
      />
      {/* biome-ignore lint/a11y/useMediaCaption: companion audio, no VTT */}
      <audio
        ref={audioRef}
        key={activeAudioSrc}
        src={activeAudioSrc}
        preload="auto"
        onError={emitPlaybackError}
        className="hidden"
      />
      <PlayerChrome
        adapter={adapter}
        shellRef={shellRef}
        title={title}
        chapters={chapters}
        quality={quality}
        audio={audioModel}
        cinemaMode={cinemaMode}
        onExitCinema={onExitCinema}
        onToggleCinema={onToggleCinema}
        scrubPreview={{
          streamSrc: video,
          ...(poster ? { poster } : {}),
        }}
        nextUp={nextUp}
        queue={queue}
        autoplayNext={autoplayNext}
        onToggleAutoplayNext={onToggleAutoplayNext}
        onPlayNext={onPlayNext}
        miniMode={miniMode}
      />
    </div>
  );
}

/* ------------------------------- Top level ------------------------------- */

export function VideoPlayer({
  videoId,
  payload,
  title,
  poster,
  chapters = [],
  startAtSeconds,
  miniMode = false,
}: VideoPlayerProps) {
  const pathname = usePathname();
  const router = useRouter();
  const watchCinema = useWatchCinema();
  const [localCinema, setLocalCinema] = useState(false);
  const cinemaMode = watchCinema ? watchCinema.cinemaMode : localCinema;
  const setCinemaMode = watchCinema
    ? watchCinema.setCinemaMode
    : setLocalCinema;
  const exitCinema = useCallback(() => setCinemaMode(false), [setCinemaMode]);
  const toggleCinema = useCallback(
    () => setCinemaMode((v) => !v),
    [setCinemaMode],
  );

  const progressive = payload.mode === "progressive" ? payload.variants : null;
  const progressiveMobileSafe = progressive;
  const [qualityIndex, setQualityIndex] = useState(0);
  const [resumeSeekSeconds, setResumeSeekSeconds] = useState<
    number | undefined
  >(undefined);
  const [splitVolume, setSplitVolume] = useState(
    () => readPlayerMediaPrefs().volume,
  );
  const [queue, setQueue] = useState<WatchQueueItem[]>([]);
  const [autoplayNext, setAutoplayNext] = useState(true);
  const [nextCountdown, setNextCountdown] = useState<number | null>(null);
  const nextUp = queue[0] ?? null;

  useEffect(() => {
    const load = () => setQueue(readWatchQueue());
    load();
    window.addEventListener("storage", load);
    window.addEventListener("ot:watch-queue-updated", load as EventListener);
    return () => {
      window.removeEventListener("storage", load);
      window.removeEventListener(
        "ot:watch-queue-updated",
        load as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("ot:watch-autoplay-next");
      if (raw === "0") setAutoplayNext(false);
      if (raw === "1") setAutoplayNext(true);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "ot:watch-autoplay-next",
        autoplayNext ? "1" : "0",
      );
    } catch {}
  }, [autoplayNext]);

  useEffect(() => {
    if (nextCountdown == null) return;
    if (nextCountdown <= 0) {
      if (nextUp && autoplayNext) {
        writeWatchQueue(queue.slice(1));
        router.push(nextUp.href);
      }
      setNextCountdown(null);
      return;
    }
    const t = window.setTimeout(
      () => setNextCountdown((n) => (n ?? 1) - 1),
      1000,
    );
    return () => window.clearTimeout(t);
  }, [nextCountdown, nextUp, autoplayNext, router, queue]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof startAtSeconds === "number" && Number.isFinite(startAtSeconds)) {
      return;
    }
    try {
      const raw = window.sessionStorage.getItem(playbackResumeStorageKey());
      if (!raw) return;
      window.sessionStorage.removeItem(playbackResumeStorageKey());
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        setResumeSeekSeconds(parsed);
      }
    } catch {}
  }, [startAtSeconds]);

  const setQualityWithResume = useCallback(
    (i: number, seekSeconds?: number) => {
      const nextSeek =
        typeof seekSeconds === "number" && Number.isFinite(seekSeconds)
          ? Math.max(0, seekSeconds)
          : undefined;
      setResumeSeekSeconds(nextSeek);
      setQualityIndex(i);
    },
    [],
  );

  useEffect(() => {
    setQualityIndex(0);
    setResumeSeekSeconds(undefined);
  }, [payload]);

  useEffect(() => {
    if (!progressiveMobileSafe || progressiveMobileSafe.length === 0) return;
    if (qualityIndex < progressiveMobileSafe.length) return;
    setQualityIndex(0);
  }, [progressiveMobileSafe, qualityIndex]);

  useEffect(() => {
    const t = window.setTimeout(() => writePlayerVolumeOnly(splitVolume), 200);
    return () => window.clearTimeout(t);
  }, [splitVolume]);

  const active = useMemo(() => {
    if (payload.mode === "hls")
      return { kind: "hls" as const, src: payload.src };
    const v = progressiveMobileSafe?.[qualityIndex];
    if (v) return { kind: "variant" as const, v };
    return { kind: "empty" as const };
  }, [payload, progressiveMobileSafe, qualityIndex]);

  const effectiveStartAt =
    typeof resumeSeekSeconds === "number" ? resumeSeekSeconds : startAtSeconds;
  const miniPayload: VideoPlayerPayload | null =
    active.kind === "hls"
      ? { mode: "hls", src: active.src }
      : active.kind === "variant"
        ? active.v.t === "muxed"
          ? { mode: "progressive", variants: [active.v] }
          : {
              mode: "progressive",
              variants: [
                {
                  t: "split",
                  label: active.v.label,
                  video: active.v.video,
                  audio: active.v.audio,
                  audioTracks: active.v.audioTracks,
                  defaultAudioIndex: active.v.defaultAudioIndex,
                },
              ],
            }
        : null;

  const handleHlsPlaybackError = useCallback(() => {
    const candidates: string[] = [];
    if (active.kind === "hls" && active.src) {
      candidates.push(active.src);
    } else if (active.kind === "variant") {
      if (active.v.t === "muxed") {
        candidates.push(active.v.src);
      } else {
        candidates.push(active.v.video, active.v.audio);
      }
    }
    for (const src of candidates) {
      if (!src || !shouldAutoRecoverPlaybackSource(src)) continue;
      const recoveryKey = src.split("?")[0] ?? src;
      if (tryOneShotPlaybackRecovery(recoveryKey)) return;
    }
  }, [active]);

  const playNextNow = useCallback(() => {
    if (!nextUp) return;
    writeWatchQueue(queue.slice(1));
    router.push(nextUp.href);
  }, [nextUp, router, queue]);

  const handleVideoEnded = useCallback(() => {
    if (!nextUp || !autoplayNext) return;
    setNextCountdown(3);
  }, [nextUp, autoplayNext]);

  useEffect(() => {
    if (!pathname.startsWith("/watch/")) return;
    if (!readWatchMiniEnabled(true)) return;
    if (!miniPayload) return;

    const media = document.querySelector("video");
    const saveSnapshot = (target: HTMLVideoElement | null) => {
      const media = target;
      if (!media) return;
      const currentTime =
        Number.isFinite(media.currentTime) && media.currentTime > 0
          ? media.currentTime
          : 0;
      writeWatchMiniState({
        videoId,
        title,
        poster,
        payload: miniPayload,
        currentTime,
      });
    };

    // Keep mini-state warm while watching so navigation doesn't miss it.
    const onTimeUpdate = () => {
      if (!media || media.paused) return;
      saveSnapshot(media);
    };
    media?.addEventListener("timeupdate", onTimeUpdate);

    return () => {
      media?.removeEventListener("timeupdate", onTimeUpdate);
      saveSnapshot(media);
    };
  }, [pathname, miniPayload, poster, title, videoId]);

  if (active.kind === "empty") return null;
  if (active.kind === "hls" && !active.src) return null;
  if (active.kind === "variant" && !active.v) return null;

  return (
    <div
      className={cn(
        "relative w-full bg-black",
        cinemaMode
          ? "w-full max-w-full overflow-visible border-0 shadow-2xl ring-1 ring-white/15 sm:rounded-xl"
          : "overflow-hidden rounded-xl border border-[hsl(var(--border))] shadow-lg ring-1 ring-black/5",
      )}
    >
      <div className="relative w-full">
        {active.kind === "hls" ? (
          <VidstackBlock
            reactKey={active.src}
            src={active.src}
            title={title}
            poster={poster}
            payload={payload}
            progressive={progressiveMobileSafe}
            qualityIndex={qualityIndex}
            setQualityIndex={setQualityWithResume}
            chapters={chapters}
            startAtSeconds={effectiveStartAt}
            cinemaMode={cinemaMode}
            onExitCinema={exitCinema}
            onToggleCinema={toggleCinema}
            onPlaybackError={handleHlsPlaybackError}
            onEnded={handleVideoEnded}
            nextUp={nextUp}
            queue={queue}
            autoplayNext={autoplayNext}
            onToggleAutoplayNext={() => setAutoplayNext((v) => !v)}
            onPlayNext={playNextNow}
            miniMode={miniMode}
          />
        ) : null}
        {active.kind === "variant" && active.v.t === "muxed" ? (
          <VidstackBlock
            reactKey={active.v.src}
            src={active.v.src}
            title={title}
            poster={poster}
            payload={payload}
            progressive={progressiveMobileSafe}
            qualityIndex={qualityIndex}
            setQualityIndex={setQualityWithResume}
            chapters={chapters}
            startAtSeconds={effectiveStartAt}
            cinemaMode={cinemaMode}
            onExitCinema={exitCinema}
            onToggleCinema={toggleCinema}
            onPlaybackError={handleHlsPlaybackError}
            onEnded={handleVideoEnded}
            nextUp={nextUp}
            queue={queue}
            autoplayNext={autoplayNext}
            onToggleAutoplayNext={() => setAutoplayNext((v) => !v)}
            onPlayNext={playNextNow}
            miniMode={miniMode}
          />
        ) : null}
        {active.kind === "variant" && active.v.t === "split" ? (
          <SplitBlock
            key={active.v.video}
            video={active.v.video}
            audioTracks={active.v.audioTracks}
            defaultAudioIndex={active.v.defaultAudioIndex}
            poster={poster}
            title={title}
            volume={splitVolume}
            setVolume={setSplitVolume}
            payload={payload}
            progressive={progressiveMobileSafe}
            qualityIndex={qualityIndex}
            setQualityIndex={setQualityWithResume}
            chapters={chapters}
            startAtSeconds={effectiveStartAt}
            cinemaMode={cinemaMode}
            onExitCinema={exitCinema}
            onToggleCinema={toggleCinema}
            onPlaybackError={handleHlsPlaybackError}
            onEnded={handleVideoEnded}
            nextUp={nextUp}
            queue={queue}
            autoplayNext={autoplayNext}
            onToggleAutoplayNext={() => setAutoplayNext((v) => !v)}
            onPlayNext={playNextNow}
            miniMode={miniMode}
          />
        ) : null}
      </div>
      {nextCountdown != null && nextUp ? (
        <div className="absolute right-3 top-3 z-40 rounded-md bg-black/70 px-3 py-1.5 text-xs text-white shadow">
          Next in {nextCountdown}s: {nextUp.title}
        </div>
      ) : null}
    </div>
  );
}

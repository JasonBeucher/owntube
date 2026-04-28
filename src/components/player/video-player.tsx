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
import type { MediaPlayerElement } from "vidstack";
import { languageFirstAudioMenuLabel } from "@/lib/audio-track-label";
import { sourceFromUrl } from "@/lib/media-source-from-url";
import {
  readPlayerMediaPrefs,
  writePlayerMediaPrefs,
  writePlayerVolumeOnly,
} from "@/lib/player-media-prefs";
import { cn } from "@/lib/utils";

type ProxiedVariant =
  | { t: "muxed"; label: string; src: string }
  | {
      t: "split";
      label: string;
      video: string;
      audio: string;
      audioTracks: { label: string; src: string }[];
    };

export type VideoPlayerPayload =
  | { mode: "hls"; src: string }
  | { mode: "progressive"; variants: ProxiedVariant[] };

type VideoPlayerProps = {
  payload: VideoPlayerPayload;
  title: string;
  poster?: string;
};

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

const PLAYER_FILL =
  "h-full w-full max-h-none max-w-none !rounded-none !border-0 !shadow-none !ring-0 [&_video]:h-full [&_video]:w-full [&_video]:object-contain" as const;

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

/* ------------------------------ Fullscreen ------------------------------ */

function useFullscreenShell(shellRef: React.RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const onChange = () => {
      setActive(document.fullscreenElement === shellRef.current);
    };
    document.addEventListener("fullscreenchange", onChange);
    onChange();
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [shellRef]);
  const toggle = useCallback(async () => {
    const el = shellRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
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
    volume: state.volume,
    muted: state.muted,
    playbackRate: state.playbackRate,
    play: () => remote.play(),
    pause: () => remote.pause(),
    togglePaused: () => (state.paused ? remote.play() : remote.pause()),
    seek: (t) => remote.seek(t),
    seekPreview: (t) => remote.seeking(t),
    setVolume: (v) => {
      if (v > 0) {
        if (state.muted) remote.unmute();
        remote.changeVolume(v);
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
    if (a) a.volume = muted ? 0 : externalVolume;
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
      void videoRef.current?.play().catch(() => {});
    },
    pause: () => videoRef.current?.pause(),
    togglePaused: () => {
      const el = videoRef.current;
      if (!el) return;
      if (el.paused) void el.play().catch(() => {});
      else el.pause();
    },
    seek: (t) => {
      if (videoRef.current) videoRef.current.currentTime = t;
    },
    // Keep preview visual-only for native playback; final seek happens on release.
    seekPreview: () => {},
    setVolume: (n) => {
      setExternalVolume(n);
      if (n > 0 && muted) setMuted(false);
      if (n === 0) setMuted(true);
    },
    toggleMuted: () => setMuted((m) => !m),
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
      setIndex: (i: number) => void;
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

function useHlsAudioModel(
  playerRef: React.RefObject<MediaPlayerElement | null>,
): AudioModel {
  const state = useMediaStore(playerRef as React.RefObject<EventTarget | null>);
  const remote = useMediaRemote(
    playerRef as React.RefObject<EventTarget | null>,
  );
  if (state.audioTracks.length < 2) return { kind: "none" };
  return {
    kind: "hls-managed",
    remote,
    items: state.audioTracks.map((t, idx) => ({
      label: languageFirstAudioMenuLabel({
        displayName: t.label || undefined,
        language: t.language || undefined,
        qualityFallback: null,
        trackId: t.id,
        kind: t.kind,
        index: idx,
      }),
      selected: t.selected,
      idx,
    })),
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

/* ------------------------------- Progress -------------------------------- */

function ProgressBar({
  current,
  duration,
  buffered,
  onScrub,
  onScrubEnd,
}: {
  current: number;
  duration: number;
  buffered: number;
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
      {hover !== null ? (
        <div
          className="pointer-events-none absolute -top-1 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-medium text-white shadow sm:-top-7"
          style={{ left: `${pct(hover)}%` }}
        >
          {formatClock(hover)}
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
  quality: QualityModel;
  audio: AudioModel;
  centerHint?: { kind: "play" | "pause"; tick: number } | null;
};

function PlayerChrome({
  adapter,
  shellRef,
  title,
  quality,
  audio,
  centerHint,
}: ChromeProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { active: fsActive, toggle: toggleFs } = useFullscreenShell(shellRef);
  const { visible, ping, hide } = useIdleVisible(adapter.paused, settingsOpen);
  const [scrub, setScrub] = useState<number | null>(null);
  const [showVolPanel, setShowVolPanel] = useState(false);
  /** True while long-press 2× is active: hides chrome, shows a small ×2 hint. */
  const [hold2xUi, setHold2xUi] = useState(false);

  const hold2xTimerRef = useRef<number | null>(null);
  const holding2xRef = useRef(false);
  const rateBeforeHoldRef = useRef(1);
  const suppressNextClickRef = useRef(false);

  const clearHold2xTimer = useCallback(() => {
    if (hold2xTimerRef.current != null) {
      window.clearTimeout(hold2xTimerRef.current);
      hold2xTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearHold2xTimer(), [clearHold2xTimer]);

  const onSurfacePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if ((e.target as HTMLElement).closest("[data-controls]")) return;
      if (settingsOpen) return;
      rateBeforeHoldRef.current = adapter.playbackRate;
      clearHold2xTimer();
      hold2xTimerRef.current = window.setTimeout(() => {
        hold2xTimerRef.current = null;
        holding2xRef.current = true;
        adapter.setPlaybackRate(2);
        setHold2xUi(true);
      }, 220);
    },
    [adapter, settingsOpen, clearHold2xTimer],
  );

  const onSurfacePointerUp = useCallback(() => {
    clearHold2xTimer();
    if (holding2xRef.current) {
      holding2xRef.current = false;
      setHold2xUi(false);
      suppressNextClickRef.current = true;
      adapter.setPlaybackRate(rateBeforeHoldRef.current);
    }
  }, [adapter, clearHold2xTimer]);

  const onSurfacePointerLeave = useCallback(() => {
    clearHold2xTimer();
    if (holding2xRef.current) {
      holding2xRef.current = false;
      setHold2xUi(false);
      suppressNextClickRef.current = true;
      adapter.setPlaybackRate(rateBeforeHoldRef.current);
    }
  }, [adapter, clearHold2xTimer]);

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
    const el = shellRef.current;
    if (!el) return;
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
      if (key === " " || key === "k") {
        e.preventDefault();
        adapter.togglePaused();
        ping();
      } else if (key === "arrowleft" || key === "j") {
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
      } else if (key === "i") {
        e.preventDefault();
        adapter.togglePictureInPicture();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [adapter, fsActive, ping, shellRef, toggleFs]);

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
    adapter.togglePaused();
  };

  const level = adapter.muted ? 0 : adapter.volume;
  const seekPos = scrub ?? adapter.currentTime;
  const chromeShown = visible && !hold2xUi;

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

      {/* Center play indicator (only when paused & ready) */}
      {adapter.paused && adapter.canPlay && !hold2xUi ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full bg-black/50 text-white shadow-lg ring-1 ring-white/20"
            aria-hidden
          >
            <PlayIcon className="h-9 w-9 pl-1" />
          </div>
        </div>
      ) : null}

      {/* Center pulse on play/pause toggle */}
      {centerHint && !hold2xUi ? (
        <div
          key={centerHint.tick}
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
        >
          <div className="flex h-16 w-16 animate-[fadeOut_500ms_ease-out_forwards] items-center justify-center rounded-full bg-black/55 text-white">
            {centerHint.kind === "play" ? (
              <PlayIcon className="h-8 w-8 pl-1" />
            ) : (
              <PauseIcon className="h-8 w-8" />
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
        <p className="line-clamp-1 text-sm font-medium text-white drop-shadow">
          {title}
        </p>
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
                {level < 0.01 ? (
                  <MuteIcon className="h-6 w-6" />
                ) : level < 0.5 ? (
                  <VolLowIcon className="h-6 w-6" />
                ) : (
                  <VolHighIcon className="h-6 w-6" />
                )}
              </button>
              <div
                className={cn(
                  "ml-1 overflow-hidden transition-[width,opacity] duration-200",
                  showVolPanel ? "w-24 opacity-100" : "w-0 opacity-0",
                )}
              >
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={level}
                  onChange={(e) =>
                    adapter.setVolume(Number(e.currentTarget.value))
                  }
                  className="h-1 w-24 cursor-pointer accent-white"
                  aria-label="Volume slider"
                />
              </div>
            </fieldset>

            <span className="ml-1 font-mono text-xs tabular-nums text-white/90">
              {formatClock(seekPos)} / {formatClock(adapter.duration)}
            </span>

            <span className="ml-auto" />

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
        @keyframes fadeOut {
          0% { opacity: 1; transform: scale(0.9); }
          100% { opacity: 0; transform: scale(1.1); }
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
}: {
  src: string;
  title: string;
  poster?: string;
  reactKey: string;
  payload: VideoPlayerPayload;
  qualityIndex: number;
  setQualityIndex: (i: number) => void;
  progressive: ProxiedVariant[] | null;
}) {
  const playerRef = useRef<MediaPlayerElement | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const adapter = useVidstackAdapter(playerRef);
  const persistStore = useMediaStore(
    playerRef as React.RefObject<EventTarget | null>,
  );
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hlsQuality = useHlsQualityModel(playerRef);
  const hlsAudio = useHlsAudioModel(playerRef);

  useEffect(() => {
    if (!persistStore.canPlay) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      writePlayerMediaPrefs({
        volume: persistStore.volume,
        muted: persistStore.muted,
      });
    }, 200);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [persistStore.volume, persistStore.muted, persistStore.canPlay]);

  const mediaPrefs = readPlayerMediaPrefs();

  const quality: QualityModel =
    payload.mode === "progressive" && progressive && progressive.length > 0
      ? {
          kind: "progressive",
          index: qualityIndex,
          setIndex: setQualityIndex,
          items: progressive.map((p) => ({ label: p.label })),
        }
      : hlsQuality;

  return (
    <div
      ref={shellRef}
      tabIndex={-1}
      className="group/player relative aspect-video w-full overflow-hidden bg-black focus:outline-none"
    >
      <MediaPlayer
        key={reactKey}
        ref={playerRef}
        title={title}
        src={sourceFromUrl(src)}
        poster={poster}
        volume={mediaPrefs.volume}
        muted={mediaPrefs.muted}
        controls={false}
        load="eager"
        preferNativeHLS={false}
        playsInline
        className={cn("absolute inset-0", PLAYER_FILL)}
      >
        <MediaOutlet />
      </MediaPlayer>
      <PlayerChrome
        adapter={adapter}
        shellRef={shellRef}
        title={title}
        quality={quality}
        audio={hlsAudio}
      />
    </div>
  );
}

/* --------------------------- Split player block -------------------------- */

function SplitBlock({
  video,
  audioTracks,
  poster,
  title,
  volume,
  setVolume,
  payload,
  progressive,
  qualityIndex,
  setQualityIndex,
}: {
  video: string;
  audioTracks: { label: string; src: string }[];
  poster?: string;
  title: string;
  volume: number;
  setVolume: (v: number) => void;
  payload: VideoPlayerPayload;
  progressive: ProxiedVariant[] | null;
  qualityIndex: number;
  setQualityIndex: (i: number) => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [splitAudioIdx, setSplitAudioIdx] = useState(0);

  useEffect(() => {
    setSplitAudioIdx(0);
  }, [video, audioTracks]);

  const activeAudioSrc =
    audioTracks[splitAudioIdx]?.src ?? audioTracks[0]?.src ?? "";

  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;

    /** Keep decode position aligned; do not start audio until video can actually play (see `playing`). */
    const onPlay = () => {
      a.currentTime = v.currentTime;
    };
    const pauseAudio = () => a.pause();
    const alignAudio = () => {
      a.currentTime = v.currentTime;
    };
    /** Audio was starting on `play` while video still buffered → audio ran ahead; only start with real playback. */
    const onPlaying = () => {
      a.currentTime = v.currentTime;
      void a.play().catch(() => {});
    };
    const onWaiting = () => {
      a.pause();
    };
    const onRate = () => {
      a.playbackRate = v.playbackRate;
    };
    const onTime = () => {
      if (Math.abs(a.currentTime - v.currentTime) > 0.35) {
        a.currentTime = v.currentTime;
      }
    };
    v.addEventListener("play", onPlay);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("pause", pauseAudio);
    v.addEventListener("seeking", alignAudio);
    v.addEventListener("seeked", alignAudio);
    v.addEventListener("ratechange", onRate);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("ended", pauseAudio);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("pause", pauseAudio);
      v.removeEventListener("seeking", alignAudio);
      v.removeEventListener("seeked", alignAudio);
      v.removeEventListener("ratechange", onRate);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("ended", pauseAudio);
    };
    // Re-bind when companion audio element is remounted (track change).
  }, [activeAudioSrc, video]);

  const adapter = useNativeAdapter({
    videoRef,
    audioRef,
    externalVolume: volume,
    setExternalVolume: setVolume,
  });

  const quality: QualityModel =
    payload.mode === "progressive" && progressive && progressive.length > 0
      ? {
          kind: "progressive",
          index: qualityIndex,
          setIndex: setQualityIndex,
          items: progressive.map((p) => ({ label: p.label })),
        }
      : { kind: "none" };
  const audioModel: AudioModel =
    audioTracks.length > 1
      ? {
          kind: "split-native",
          index: splitAudioIdx,
          setIndex: setSplitAudioIdx,
          items: audioTracks.map((t) => ({ label: t.label })),
        }
      : { kind: "none" };

  return (
    <div
      ref={shellRef}
      tabIndex={-1}
      className="group/player relative aspect-video w-full overflow-hidden bg-black focus:outline-none"
    >
      <video
        ref={videoRef}
        src={video}
        poster={poster}
        playsInline
        muted
        preload="metadata"
        className="absolute inset-0 h-full w-full object-contain"
      />
      {/* biome-ignore lint/a11y/useMediaCaption: companion audio, no VTT */}
      <audio
        ref={audioRef}
        key={activeAudioSrc}
        src={activeAudioSrc}
        preload="auto"
        className="hidden"
      />
      <PlayerChrome
        adapter={adapter}
        shellRef={shellRef}
        title={title}
        quality={quality}
        audio={audioModel}
      />
    </div>
  );
}

/* ------------------------------- Top level ------------------------------- */

export function VideoPlayer({ payload, title, poster }: VideoPlayerProps) {
  const progressive = payload.mode === "progressive" ? payload.variants : null;
  const [qualityIndex, setQualityIndex] = useState(0);
  const [splitVolume, setSplitVolume] = useState(
    () => readPlayerMediaPrefs().volume,
  );

  useEffect(() => {
    setQualityIndex(0);
  }, [payload]);

  useEffect(() => {
    const t = window.setTimeout(() => writePlayerVolumeOnly(splitVolume), 200);
    return () => window.clearTimeout(t);
  }, [splitVolume]);

  const active = useMemo(() => {
    if (payload.mode === "hls")
      return { kind: "hls" as const, src: payload.src };
    const v = progressive?.[qualityIndex];
    if (v) return { kind: "variant" as const, v };
    return { kind: "empty" as const };
  }, [payload, progressive, qualityIndex]);

  if (active.kind === "empty") return null;
  if (active.kind === "hls" && !active.src) return null;
  if (active.kind === "variant" && !active.v) return null;

  return (
    <div className="w-full overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-black shadow-lg ring-1 ring-black/5">
      {active.kind === "hls" ? (
        <VidstackBlock
          reactKey={active.src}
          src={active.src}
          title={title}
          poster={poster}
          payload={payload}
          progressive={progressive}
          qualityIndex={qualityIndex}
          setQualityIndex={setQualityIndex}
        />
      ) : null}
      {active.kind === "variant" && active.v.t === "muxed" ? (
        <VidstackBlock
          reactKey={active.v.src}
          src={active.v.src}
          title={title}
          poster={poster}
          payload={payload}
          progressive={progressive}
          qualityIndex={qualityIndex}
          setQualityIndex={setQualityIndex}
        />
      ) : null}
      {active.kind === "variant" && active.v.t === "split" ? (
        <SplitBlock
          key={active.v.video}
          video={active.v.video}
          audioTracks={active.v.audioTracks}
          poster={poster}
          title={title}
          volume={splitVolume}
          setVolume={setSplitVolume}
          payload={payload}
          progressive={progressive}
          qualityIndex={qualityIndex}
          setQualityIndex={setQualityIndex}
        />
      ) : null}
    </div>
  );
}

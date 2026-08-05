export type CompanionAudioSyncThresholds = {
  syncTolerance: number;
  driftHard: number;
  recoveryIntervalMs: number;
};

/** Drift limits and recovery cadence for split `<video>` + `<audio>` playback. */
export function companionAudioSyncThresholds(
  playbackRate: number,
): CompanionAudioSyncThresholds {
  const rate = Math.min(4, Math.max(0.25, playbackRate));
  if (rate >= 2) {
    // Clock skew between the two elements grows faster at 2×; allow more slack
    // before intervening so corrections stay rare.
    return {
      syncTolerance: 0.22,
      driftHard: 0.65,
      recoveryIntervalMs: 500,
    };
  }
  return {
    syncTolerance: 0.16,
    driftHard: 0.45,
    recoveryIntervalMs: 350,
  };
}

const SOFT_NUDGE_FACTOR = 0.965;

/**
 * Keep companion audio aligned with the muted video track.
 *
 * `currentTime` snaps on a *playing* audio element are audible (click/stutter)
 * at any rate, so moderate drift is corrected with playbackRate nudges only.
 * Hard snaps are reserved for `force` (used at boundaries where the audio is
 * paused and the snap is inaudible) and runaway drift beyond `driftHard`.
 */
export function applyCompanionAudioSync(
  video: HTMLVideoElement,
  audio: HTMLAudioElement,
  opts: { force?: boolean } = {},
): void {
  const targetRate = video.playbackRate;
  const { syncTolerance, driftHard } = companionAudioSyncThresholds(targetRate);
  const drift = audio.currentTime - video.currentTime;
  const absDrift = Math.abs(drift);

  if (opts.force || absDrift > driftHard) {
    audio.currentTime = video.currentTime;
    audio.playbackRate = targetRate;
    return;
  }

  if (absDrift > syncTolerance) {
    const nudge = drift > 0 ? SOFT_NUDGE_FACTOR : 1 / SOFT_NUDGE_FACTOR;
    audio.playbackRate = Math.min(4, Math.max(0.25, targetRate * nudge));
    return;
  }

  audio.playbackRate = targetRate;
}

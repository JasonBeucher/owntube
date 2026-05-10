/**
 * HTMLMediaElement.volume is linear; human hearing is closer to logarithmic, so
 * low slider positions feel too loud. Map **UI** 0…1 (slider / prefs) to
 * element gain with a gentle power curve (quiet end stretched).
 */
const EXP = 1.55 as const;

export function uiVolumeToGain(ui: number): number {
  const x = Math.min(1, Math.max(0, ui));
  if (x <= 0) return 0;
  return Math.pow(x, EXP);
}

/** Inverse of {@link uiVolumeToGain} for Vidstack store ↔ slider display. */
export function gainToUiVolume(gain: number): number {
  const g = Math.min(1, Math.max(0, gain));
  if (g <= 0) return 0;
  return Math.pow(g, 1 / EXP);
}

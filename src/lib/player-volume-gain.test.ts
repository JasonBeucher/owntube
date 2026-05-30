import { describe, expect, it } from "vitest";
import {
  gainToUiVolume,
  playbackRateVolumeAttenuation,
  uiVolumeToGain,
} from "@/lib/player-volume-gain";

describe("player-volume-gain", () => {
  it("round-trips UI → gain → UI", () => {
    for (const ui of [0, 0.05, 0.25, 0.5, 0.75, 1]) {
      const g = uiVolumeToGain(ui);
      const back = gainToUiVolume(g);
      expect(back).toBeCloseTo(ui, 5);
    }
  });

  it("softens mid-range vs linear", () => {
    expect(uiVolumeToGain(0.5)).toBeLessThan(0.5);
    expect(uiVolumeToGain(1)).toBe(1);
  });

  it("attenuates gain only above 1×", () => {
    expect(playbackRateVolumeAttenuation(1)).toBe(1);
    expect(playbackRateVolumeAttenuation(0.75)).toBe(1);
    expect(playbackRateVolumeAttenuation(1.75)).toBeCloseTo(
      1 / Math.sqrt(1.75),
      5,
    );
    expect(playbackRateVolumeAttenuation(2)).toBeCloseTo(1 / (2 * 1.3), 5);
    expect(playbackRateVolumeAttenuation(4)).toBeCloseTo(1 / (4 * 1.3), 5);
  });
});

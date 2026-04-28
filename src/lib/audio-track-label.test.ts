import { describe, expect, it } from "vitest";
import { languageFirstAudioMenuLabel } from "@/lib/audio-track-label";

describe("languageFirstAudioMenuLabel", () => {
  it("adds displayName in parentheses when it differs from resolved language", () => {
    expect(
      languageFirstAudioMenuLabel({
        language: "en",
        displayName: "Original",
        qualityFallback: null,
        index: 0,
      }),
    ).toMatch(/Original/);
  });

  it("does not parenthesize English display when it matches the en autonym", () => {
    const s = languageFirstAudioMenuLabel({
      language: "en",
      displayName: "English",
      qualityFallback: null,
      index: 0,
    });
    expect(s).not.toContain("(");
  });

  it("reads lang= from googlevideo-style stream URL when metadata is missing", () => {
    const s = languageFirstAudioMenuLabel({
      language: null,
      displayName: null,
      qualityFallback: "medium",
      streamUrl:
        "https://rr1---sn.example.com/videoplayback?expire=1&lang=fr&itag=140",
      index: 0,
    });
    expect(s).not.toBe("medium");
    expect(s).not.toMatch(/^Track \d+$/);
  });

  it("falls back to displayName or quality when no language tag", () => {
    expect(
      languageFirstAudioMenuLabel({
        language: null,
        displayName: "Stereo",
        qualityFallback: "medium",
        index: 1,
      }),
    ).toBe("Stereo");
    expect(
      languageFirstAudioMenuLabel({
        language: undefined,
        displayName: null,
        qualityFallback: "high",
        index: 0,
      }),
    ).toBe("high");
  });
});

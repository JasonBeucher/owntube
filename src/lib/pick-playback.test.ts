import { describe, expect, it } from "vitest";
import {
  buildWatchPlayback,
  pickPlaybackForVidstack,
} from "@/lib/pick-playback";
import type { VideoDetail } from "@/server/services/proxy.types";

function base(over: Partial<VideoDetail>): VideoDetail {
  return {
    videoId: "x",
    title: "t",
    audioSources: [],
    videoSources: [],
    sourceUsed: "invidious",
    ...over,
  };
}

describe("buildWatchPlayback", () => {
  it("uses HLS when present", () => {
    const w = buildWatchPlayback(
      base({
        hlsUrl: "https://h.example/playlist.m3u8",
        videoSources: [{ url: "https://g.example/360.mp4", quality: "360p" }],
      }),
    );
    expect(w).toEqual({
      kind: "hls",
      url: "https://h.example/playlist.m3u8",
      onlyDashOrUnsupported: false,
    });
  });

  it("uses progressive list sorted with best first (muxed)", () => {
    const w = buildWatchPlayback(
      base({
        videoSources: [
          { url: "https://g.example/360.mp4", quality: "360p" },
          { url: "https://g.example/1080.mp4", quality: "1080p" },
          { url: "https://g.example/720.mp4", quality: "720p" },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants.map((v) => v.t)).toEqual(["muxed", "muxed", "muxed"]);
      expect(w.variants.map((v) => v.label)).toEqual(["1080p", "720p", "360p"]);
    }
  });

  it("drops muxed rows with audio MIME when a real video split exists", () => {
    const w = buildWatchPlayback(
      base({
        videoSources: [
          {
            url: "https://g.example/bad-audio.m4a",
            quality: "360p",
            videoOnly: false,
            mimeType: "audio/mp4",
          },
          {
            url: "https://g.example/1080v.mp4",
            quality: "1080p",
            videoOnly: true,
            mimeType: "video/mp4",
          },
        ],
        audioSources: [
          {
            url: "https://g.example/aud.m4a",
            quality: "medium",
            mimeType: "audio/mp4",
            language: "en",
            audioTrackDisplayName: "English",
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants).toHaveLength(1);
      expect(w.variants[0]?.t).toBe("split");
    }
  });

  it("drops height=0 muxed when another muxed stream exists", () => {
    const w = buildWatchPlayback(
      base({
        videoSources: [
          {
            url: "https://g.example/bad.mp4",
            quality: "360p",
            videoOnly: false,
            mimeType: "video/mp4",
            height: 0,
          },
          {
            url: "https://g.example/good.mp4",
            quality: "720p",
            videoOnly: false,
            mimeType: "video/mp4",
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants.map((v) => (v.t === "muxed" ? v.url : v.videoUrl))).toEqual(
        ["https://g.example/good.mp4"],
      );
    }
  });

  it('drops video/* rows whose codecs are audio-only when a normal muxed exists', () => {
    const w = buildWatchPlayback(
      base({
        videoSources: [
          {
            url: "https://g.example/fake.mp4",
            quality: "360p",
            videoOnly: false,
            mimeType: 'video/mp4; codecs="mp4a.40.2"',
          },
          {
            url: "https://g.example/ok.mp4",
            quality: "720p",
            videoOnly: false,
            mimeType: "video/mp4",
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants).toHaveLength(1);
      expect(w.variants[0]?.t).toBe("muxed");
      if (w.variants[0]?.t === "muxed") {
        expect(w.variants[0].url).toBe("https://g.example/ok.mp4");
      }
    }
  });

  it("falls back to unfiltered list if every stream would be dropped", () => {
    const w = buildWatchPlayback(
      base({
        videoSources: [
          {
            url: "https://g.example/only-bad.mp4",
            quality: "360p",
            videoOnly: false,
            mimeType: 'video/mp4; codecs="mp4a.40.2"',
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants).toHaveLength(1);
      expect(w.variants[0]?.t).toBe("muxed");
    }
  });

  it("uses short quality-only labels for muxed rows (no bitrate in menu)", () => {
    const w = buildWatchPlayback(
      base({
        videoSources: [
          {
            url: "https://g.example/720.mp4",
            quality: "720p",
            bitrate: 2_800_000,
            fps: 30,
          },
          { url: "https://g.example/360.mp4", quality: "360p" },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants.map((v) => v.label)).toEqual(["720p", "360p"]);
    }
  });

  it("DASH only yields none", () => {
    const w = buildWatchPlayback(
      base({
        dashUrl: "https://d.example/playlist",
        videoSources: [],
      }),
    );
    expect(w).toEqual({ kind: "none", onlyDashOrUnsupported: true });
  });

  it("uses quality-only split row label; audio submenu still shows bitrate when present", () => {
    const w = buildWatchPlayback(
      base({
        videoSources: [
          {
            url: "https://g.example/1080v.mp4",
            quality: "1080p",
            videoOnly: true,
            mimeType: "video/mp4",
            bitrate: 8_000_000,
          },
        ],
        audioSources: [
          {
            url: "https://g.example/aud.m4a",
            quality: "medium",
            mimeType: "audio/mp4",
            language: "en",
            audioTrackDisplayName: "English",
            bitrate: 128_000,
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants[0]?.label).toBe("1080p");
      if (w.variants[0]?.t === "split") {
        const al = w.variants[0].audioOptions[0]?.label ?? "";
        expect(al.endsWith(" · 128 kbps")).toBe(true);
        expect(al).not.toContain("(");
      }
    }
  });

  it("drops muxed when a split exists for the same resolution (e.g. 360p black mux)", () => {
    const w = buildWatchPlayback(
      base({
        videoSources: [
          {
            url: "https://g.example/360mux.mp4",
            quality: "360p",
            videoOnly: false,
            mimeType: "video/mp4",
            bitrate: 477_000,
          },
          {
            url: "https://g.example/360v-hi.mp4",
            quality: "360p",
            videoOnly: true,
            mimeType: "video/mp4",
            bitrate: 591_000,
          },
          {
            url: "https://g.example/360v-lo.mp4",
            quality: "360p",
            videoOnly: true,
            mimeType: "video/mp4",
            bitrate: 400_000,
          },
        ],
        audioSources: [
          {
            url: "https://g.example/aud.m4a",
            quality: "medium",
            mimeType: "audio/mp4",
            language: "en",
            audioTrackDisplayName: "English",
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants.every((v) => v.t === "split")).toBe(true);
      expect(w.variants).toHaveLength(1);
      if (w.variants[0]?.t === "split") {
        expect(w.variants[0].videoUrl).toBe("https://g.example/360v-hi.mp4");
      }
    }
  });

  it("keeps a single split per quality label (highest bitrate)", () => {
    const w = buildWatchPlayback(
      base({
        videoSources: [
          {
            url: "https://g.example/1440-a.mp4",
            quality: "1440p60",
            videoOnly: true,
            mimeType: "video/mp4",
            bitrate: 12_000_000,
          },
          {
            url: "https://g.example/1440-b.mp4",
            quality: "1440p60",
            videoOnly: true,
            mimeType: "video/mp4",
            bitrate: 14_000_000,
          },
          {
            url: "https://g.example/1440-c.mp4",
            quality: "1440p60",
            videoOnly: true,
            mimeType: "video/mp4",
            bitrate: 13_000_000,
          },
        ],
        audioSources: [
          {
            url: "https://g.example/aud.m4a",
            quality: "medium",
            mimeType: "audio/mp4",
            language: "en",
            audioTrackDisplayName: "English",
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants).toHaveLength(1);
      if (w.variants[0]?.t === "split") {
        expect(w.variants[0].videoUrl).toBe("https://g.example/1440-b.mp4");
      }
    }
  });

  it("lists muxed and split variants when both exist (full quality menu)", () => {
    const w = buildWatchPlayback(
      base({
        videoSources: [
          {
            url: "https://g.example/1080v.mp4",
            quality: "1080p",
            videoOnly: true,
            mimeType: "video/mp4",
          },
          {
            url: "https://g.example/360mux.mp4",
            quality: "360p",
            videoOnly: false,
            mimeType: "video/mp4",
          },
        ],
        audioSources: [
          {
            url: "https://g.example/aud.m4a",
            quality: "medium",
            mimeType: "audio/mp4",
            language: "en",
            audioTrackDisplayName: "English",
          },
          {
            url: "https://g.example/aud2.m4a",
            quality: "high",
            mimeType: "audio/mp4",
            language: "fr",
            audioTrackDisplayName: "French",
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants).toHaveLength(2);
      expect(w.variants.map((v) => v.t)).toEqual(["split", "muxed"]);
      expect(w.variants.map((v) => v.label)).toEqual(["1080p", "360p"]);
      if (w.variants[0]?.t === "split") {
        expect(w.variants[0].audioOptions).toHaveLength(2);
      }
    }
  });

  it("lists one split row per video-only quality", () => {
    const w = buildWatchPlayback(
      base({
        videoSources: [
          {
            url: "https://g.example/1080v.mp4",
            quality: "1080p",
            videoOnly: true,
            mimeType: "video/mp4",
          },
          {
            url: "https://g.example/720v.mp4",
            quality: "720p",
            videoOnly: true,
            mimeType: "video/mp4",
          },
        ],
        audioSources: [
          {
            url: "https://g.example/aud.m4a",
            quality: "medium",
            mimeType: "audio/mp4",
            language: "en",
            audioTrackDisplayName: "English",
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants).toHaveLength(2);
      expect(w.variants.map((v) => v.label)).toEqual(["1080p", "720p"]);
    }
  });

  it("uses split when there is no muxed stream", () => {
    const w = buildWatchPlayback(
      base({
        videoSources: [
          {
            url: "https://g.example/1080v.mp4",
            quality: "1080p",
            videoOnly: true,
            mimeType: "video/mp4",
          },
        ],
        audioSources: [
          {
            url: "https://g.example/aud.m4a",
            quality: "medium",
            mimeType: "audio/mp4",
            language: "en",
            audioTrackDisplayName: "English",
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants).toHaveLength(1);
      expect(w.variants[0]?.t).toBe("split");
      if (w.variants[0]?.t === "split") {
        expect(w.variants[0].label).toBe("1080p");
        expect(w.variants[0].videoUrl).toBe("https://g.example/1080v.mp4");
        expect(w.variants[0].audioUrl).toBe("https://g.example/aud.m4a");
      }
    }
  });
});

describe("pickPlaybackForVidstack (compat)", () => {
  it("returns first progressive url", () => {
    const r = pickPlaybackForVidstack(
      base({
        videoSources: [
          { url: "https://g.example/360.mp4", quality: "360p" },
          { url: "https://g.example/1080.mp4", quality: "1080p" },
        ],
      }),
    );
    expect(r.src).toBe("https://g.example/1080.mp4");
  });
});

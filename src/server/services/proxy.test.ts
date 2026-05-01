import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { videoCache } from "@/server/db/schema";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import {
  fetchRelatedVideos,
  fetchVideoDetail,
  searchVideos,
} from "@/server/services/proxy";
import { resetRateLimiterForTests } from "@/server/services/rate-limiter";
import { createTestDb } from "@/test/db";

describe("searchVideos", () => {
  beforeEach(() => {
    resetRateLimiterForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("fetch not mocked for this test"))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PIPED_BASE_URL;
    delete process.env.INVIDIOUS_BASE_URL;
    delete process.env.PORT;
  });

  it("returns unified videos from Piped-shaped JSON", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              type: "stream",
              url: "/watch?v=dQw4w9WgXcQ",
              title: "Example",
              thumbnail: "https://example.com/t.jpg",
              duration: 212,
              views: 1000,
              uploaderName: "Channel",
              uploaderUrl: "/channel/UCuAXFkgsw1L7xaCfnd5JJOw",
              uploaderAvatar: "/avatars/u.jpg",
            },
          ],
          nextpage: "",
        }),
      ),
    );

    const r = await searchVideos(db, { q: "music", limit: 10 });
    expect(r.sourceUsed).toBe("piped");
    expect(r.videos).toHaveLength(1);
    expect(r.videos[0]?.videoId).toBe("dQw4w9WgXcQ");
    expect(r.videos[0]?.channelId).toBe("UCuAXFkgsw1L7xaCfnd5JJOw");
    expect(r.videos[0]?.channelAvatarUrl).toBe(
      "https://piped.test/avatars/u.jpg",
    );
    sqlite.close();
  });

  it("parses Piped view counts sent as strings or alternate keys", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              type: "stream",
              url: "/watch?v=dQw4w9WgXcQ",
              title: "String views",
              viewCount: "2500000",
              uploaderUrl: "/channel/UCx",
            },
            {
              type: "stream",
              url: "/watch?v=abcdefghijk",
              title: "K suffix",
              views: "1.2M",
              uploaderUrl: "/channel/UCy",
            },
          ],
        }),
      ),
    );

    const r = await searchVideos(db, { q: "views", limit: 10 });
    expect(r.videos[0]?.viewCount).toBe(2_500_000);
    expect(r.videos[1]?.viewCount).toBe(1_200_000);
    sqlite.close();
  });

  it("falls back to Invidious when Piped fails", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    process.env.INVIDIOUS_BASE_URL = "https://inv.test";

    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              type: "video",
              videoId: "abc12345678",
              title: "From Invidious",
              author: "Creator",
              authorId: "UCxyz",
              authorThumbnails: [
                { url: "https://example.com/ch.jpg", width: 88, quality: "" },
              ],
              videoThumbnails: [{ url: "https://example.com/thumb.jpg" }],
              lengthSeconds: 60,
              viewCount: 500,
              publishedText: "1 day ago",
            },
          ]),
        ),
      );

    const r = await searchVideos(db, { q: "test", limit: 10 });
    expect(r.sourceUsed).toBe("invidious");
    expect(r.videos[0]?.videoId).toBe("abc12345678");
    expect(r.videos[0]?.channelAvatarUrl).toBe("https://example.com/ch.jpg");
    sqlite.close();
  });

  it("serves stale cache when both upstreams fail", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    process.env.INVIDIOUS_BASE_URL = "https://inv.test";

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              type: "stream",
              url: "/watch?v=dQw4w9WgXcQ",
              title: "Cached",
            },
          ],
        }),
      ),
    );
    await searchVideos(db, { q: "cache-me", limit: 10 });
    db.update(videoCache).set({ expiresAt: 0 }).run();

    vi.mocked(fetch).mockRejectedValue(new Error("down"));
    const stale = await searchVideos(db, { q: "cache-me", limit: 10 });
    expect(stale.sourceUsed).toBe("cache");
    expect(stale.stale).toBe(true);
    expect(stale.warning).toContain("stale cache");
    sqlite.close();
  });

  it("returns video detail from Piped stream endpoint", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          videoId: "dQw4w9WgXcQ",
          title: "Stream title",
          uploader: "Streamer",
          uploaderId: "UC1",
          hls: "https://media.example.com/master.m3u8",
          audioStreams: [{ url: "https://media.example.com/audio.m4a" }],
          videoStreams: [{ url: "https://media.example.com/video.mp4" }],
        }),
      ),
    );
    const detail = await fetchVideoDetail(db, { videoId: "dQw4w9WgXcQ" });
    expect(detail.sourceUsed).toBe("piped");
    expect(detail.hlsUrl).toContain(".m3u8");
    sqlite.close();
  });

  it("fetchVideoDetail bypassDetailCache skips a fresh SQLite row", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "disabled";
    process.env.INVIDIOUS_BASE_URL = "http://localhost:3001";

    let invCalls = 0;
    vi.mocked(fetch).mockImplementation((input) => {
      const u = String(input);
      if (u.includes("/api/v1/videos/dQw4w9WgXcQ") && !u.includes("/related")) {
        invCalls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              videoId: "dQw4w9WgXcQ",
              title: "Invidious",
              hlsUrl: `/api/manifest/hls/playlist/dQw4w9WgXcQ?c=${invCalls}`,
            }),
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });

    const d1 = await fetchVideoDetail(db, { videoId: "dQw4w9WgXcQ" });
    expect(d1.hlsUrl).toContain("c=1");
    expect(invCalls).toBe(1);

    const d2 = await fetchVideoDetail(db, { videoId: "dQw4w9WgXcQ" });
    expect(d2.hlsUrl).toContain("c=1");
    expect(invCalls).toBe(1);

    const d3 = await fetchVideoDetail(
      db,
      { videoId: "dQw4w9WgXcQ" },
      undefined,
      { bypassDetailCache: true },
    );
    expect(d3.hlsUrl).toContain("c=2");
    expect(invCalls).toBe(2);

    sqlite.close();
  });

  it("returns related videos from Invidious fallback", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    process.env.INVIDIOUS_BASE_URL = "https://inv.test";

    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("piped down"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              type: "video",
              videoId: "abc12345678",
              title: "Related",
              author: "Creator",
            },
          ]),
        ),
      );

    const related = await fetchRelatedVideos(db, { videoId: "dQw4w9WgXcQ" }, 5);
    expect(related.sourceUsed).toBe("invidious");
    expect(related.videos[0]?.videoId).toBe("abc12345678");
    sqlite.close();
  });

  it("fills related from uploader channel when instance returns no related list", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    process.env.INVIDIOUS_BASE_URL = "https://inv.test";

    vi.mocked(fetch).mockImplementation((input) => {
      const u = String(input);
      if (u.includes("/streams/") && u.includes("/related")) {
        return Promise.resolve(
          new Response(JSON.stringify({ relatedStreams: [] })),
        );
      }
      if (u.includes("/api/v1/videos/") && u.includes("/related")) {
        return Promise.resolve(new Response("[]"));
      }
      if (u.includes("/streams/dQw4w9WgXcQ") && !u.includes("/related")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              videoId: "dQw4w9WgXcQ",
              title: "Main",
              uploaderId: "UCchan",
              uploader: "Artist",
            }),
          ),
        );
      }
      if (u.includes("/channel/UCchan")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              name: "Artist",
              id: "UCchan",
              relatedStreams: [
                {
                  type: "stream",
                  url: "/watch?v=dQw4w9WgXcQ",
                  title: "Main",
                  uploaderUrl: "/channel/UCchan",
                },
                {
                  type: "stream",
                  url: "/watch?v=abcdefghijk",
                  title: "Other upload",
                  uploaderUrl: "/channel/UCchan",
                },
              ],
            }),
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });

    const r = await fetchRelatedVideos(db, { videoId: "dQw4w9WgXcQ" }, 5);
    expect(r.videos).toHaveLength(1);
    expect(r.videos[0]?.videoId).toBe("abcdefghijk");
    expect(r.warning).toContain("same channel");
    sqlite.close();
  });

  it("treats Invidious 200 with empty body on /related as an empty list", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "disabled";
    process.env.INVIDIOUS_BASE_URL = "https://inv.test";

    vi.mocked(fetch).mockImplementation((input) => {
      const u = String(input);
      if (u.includes("/api/v1/videos/") && u.includes("/related")) {
        return Promise.resolve(new Response("", { status: 200 }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });

    const r = await fetchRelatedVideos(db, { videoId: "dQw4w9WgXcQ" }, 5);
    expect(r.videos).toEqual([]);
    expect(r.sourceUsed).toBe("invidious");
    sqlite.close();
  });

  it("resolves Invidious relative stream URLs and uses 127.0.0.1 instead of localhost", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "disabled";
    process.env.INVIDIOUS_BASE_URL = "http://localhost:3001";

    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      expect(url).toContain("127.0.0.1");
      expect(url).toContain("/api/v1/videos/dQw4w9WgXcQ");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            videoId: "dQw4w9WgXcQ",
            title: "Invidious relative URLs",
            adaptiveFormats: [
              {
                url: "/api/v1/manifest/dash/id/dQw4w9WgXcQ",
                type: "video/mp4",
                qualityLabel: "720p",
              },
            ],
            hlsUrl: "/api/v1/manifest/hls/playlist/dQw4w9WgXcQ",
          }),
        ),
      );
    });

    const detail = await fetchVideoDetail(db, { videoId: "dQw4w9WgXcQ" });
    expect(detail.sourceUsed).toBe("invidious");
    expect(detail.hlsUrl).toBe(
      "http://127.0.0.1:3001/api/v1/manifest/hls/playlist/dQw4w9WgXcQ",
    );
    expect(detail.videoSources[0]?.url).toBe(
      "http://127.0.0.1:3001/api/v1/manifest/dash/id/dQw4w9WgXcQ",
    );
    sqlite.close();
  });

  it("repairs malformed Invidious absolute URLs missing hostname", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "disabled";
    process.env.INVIDIOUS_BASE_URL = "http://192.168.1.11:3210";

    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/v1/videos/dQw4w9WgXcQ")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              videoId: "dQw4w9WgXcQ",
              title: "Malformed absolute URLs",
              dashUrl: "http://:3210/api/manifest/dash/id/dQw4w9WgXcQ",
              hlsUrl: "http://:3210/api/manifest/hls/playlist/dQw4w9WgXcQ",
              adaptiveFormats: [
                {
                  url: "http://:3210/videoplayback?id=abc",
                  type: "video/mp4",
                  qualityLabel: "720p",
                },
              ],
            }),
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    const detail = await fetchVideoDetail(db, { videoId: "dQw4w9WgXcQ" });
    expect(detail.sourceUsed).toBe("invidious");
    expect(detail.dashUrl).toBe(
      "http://192.168.1.11:3210/api/manifest/dash/id/dQw4w9WgXcQ",
    );
    expect(detail.hlsUrl).toBe(
      "http://192.168.1.11:3210/api/manifest/hls/playlist/dQw4w9WgXcQ",
    );
    expect(detail.videoSources[0]?.url).toBe(
      "http://192.168.1.11:3210/videoplayback?id=abc",
    );
    sqlite.close();
  });

  it("rejects search when Invidious shares the same loopback port as Next", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "disabled";
    process.env.PORT = "3001";
    process.env.INVIDIOUS_BASE_URL = "http://127.0.0.1:3001";

    await expect(searchVideos(db, { q: "test", limit: 10 })).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof UpstreamUnavailableError &&
        /same loopback port|server fetch would hit OwnTube/i.test(err.message),
    );

    sqlite.close();
  });
});

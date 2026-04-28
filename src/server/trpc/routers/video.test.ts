import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

describe("videoRouter", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("fetch not mocked for this test"))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PIPED_BASE_URL;
    delete process.env.INVIDIOUS_BASE_URL;
  });

  it("returns detail query payload", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          videoId: "dQw4w9WgXcQ",
          title: "Title",
          videoStreams: [{ url: "https://example.com/video.mp4" }],
          audioStreams: [],
        }),
      ),
    );
    const caller = appRouter.createCaller({ db, userId: null });
    const detail = await caller.video.detail({ videoId: "dQw4w9WgXcQ" });
    expect(detail.title).toBe("Title");
    sqlite.close();
  });
});

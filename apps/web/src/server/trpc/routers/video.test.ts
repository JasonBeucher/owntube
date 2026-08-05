import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { users } from "@/server/db/schema";
import { upsertUserSettings } from "@/server/settings/profile";
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
          proxyUrl: "https://piped.test",
          videoStreams: [
            {
              url: "https://piped.test/videoplayback?itag=18",
              quality: "360p",
              videoOnly: false,
              mimeType: "video/mp4",
            },
          ],
          audioStreams: [],
        }),
      ),
    );
    const caller = appRouter.createCaller({ db, userId: null });
    const detail = await caller.video.detail({ videoId: "dQw4w9WgXcQ" });
    expect(detail.title).toBe("Title");
    sqlite.close();
  });

  it("returns comments query payload", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          comments: [
            {
              author: "Viewer",
              commentId: "x",
              commentText: "Hello",
              commentedTime: "now",
            },
          ],
          disabled: false,
          nextpage: "",
        }),
      ),
    );
    const caller = appRouter.createCaller({ db, userId: null });
    const comments = await caller.video.comments({
      videoId: "dQw4w9WgXcQ",
      sortBy: "top",
    });
    expect(comments.comments).toHaveLength(1);
    expect(comments.comments[0]?.text).toBe("Hello");
    sqlite.close();
  });

  it("filters blocked recommendation channels out of related videos", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    process.env.INVIDIOUS_BASE_URL = "disabled";
    const ts = Math.floor(Date.now() / 1000);
    const user = db
      .insert(users)
      .values({
        email: "related@example.com",
        passwordHash: "x",
        createdAt: ts,
        updatedAt: ts,
      })
      .returning({ id: users.id })
      .get();
    upsertUserSettings(db, user.id, {
      blockedRecommendationChannels: ["UCblocked"],
    });

    vi.mocked(fetch).mockImplementation((input) => {
      const u = String(input);
      if (u.includes("/streams/dQw4w9WgXcQ")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              videoId: "dQw4w9WgXcQ",
              title: "Main",
              relatedStreams: [
                {
                  url: "/watch?v=keep0000001",
                  title: "Kept clip",
                  duration: 120,
                  uploaderUrl: "/channel/UCkept",
                },
                {
                  url: "/watch?v=drop0000001",
                  title: "Blocked channel clip",
                  duration: 90,
                  uploaderUrl: "/channel/UCblocked",
                },
              ],
            }),
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });

    const caller = appRouter.createCaller({ db, userId: user.id });
    const related = await caller.video.related({ videoId: "dQw4w9WgXcQ" });
    expect(related.videos.map((v) => v.videoId)).toEqual(["keep0000001"]);
    sqlite.close();
  });
});

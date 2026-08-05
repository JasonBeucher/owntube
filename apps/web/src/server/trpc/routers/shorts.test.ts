import { afterEach, describe, expect, it, vi } from "vitest";
import * as shortsFeed from "@/server/recommendation/shorts-feed";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

describe("shortsRouter", () => {
  afterEach(() => vi.restoreAllMocks());

  it("forwards the lightweight shelf purpose to the recommendation service", async () => {
    const { db, sqlite } = createTestDb();
    const fetchShortsFeedForViewer = vi
      .spyOn(shortsFeed, "fetchShortsFeedForViewer")
      .mockResolvedValue({
        videos: [],
        continuation: null,
        sourceUsed: "cache",
      });
    const caller = appRouter.createCaller({ db, userId: null });

    await caller.shorts.feed({
      region: "FR",
      limit: 18,
      purpose: "shelf",
    });

    expect(fetchShortsFeedForViewer).toHaveBeenCalledWith(
      db,
      null,
      expect.objectContaining({ purpose: "shelf" }),
      undefined,
    );
    sqlite.close();
  });
});

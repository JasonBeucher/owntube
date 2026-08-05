import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { videoCache } from "@/server/db/schema";
import {
  readPersistedRecommendationPool,
  writePersistedRecommendationPool,
} from "@/server/recommendation/persistent-pool-cache";
import { createTestDb } from "@/test/db";

describe("persistent recommendation pool cache", () => {
  it("round-trips a fresh personalized pool", () => {
    const { db, sqlite } = createTestDb();
    writePersistedRecommendationPool(db, "user-1|FR", {
      coldStart: false,
      videos: [{ videoId: "abcdefghijk", title: "A cached video" }],
    });

    expect(readPersistedRecommendationPool(db, "user-1|FR")).toEqual({
      coldStart: false,
      fresh: true,
      videos: [{ videoId: "abcdefghijk", title: "A cached video" }],
    });
    sqlite.close();
  });

  it("keeps an expired pool available for stale-while-revalidate", () => {
    const { db, sqlite } = createTestDb();
    writePersistedRecommendationPool(db, "user-2|US", {
      coldStart: true,
      videos: [{ videoId: "lmnopqrstuv", title: "Stale but useful" }],
    });
    db.update(videoCache)
      .set({ expiresAt: 0 })
      .where(eq(videoCache.kind, "recommendation"))
      .run();

    expect(readPersistedRecommendationPool(db, "user-2|US")).toMatchObject({
      fresh: false,
      videos: [{ videoId: "lmnopqrstuv", title: "Stale but useful" }],
    });
    sqlite.close();
  });
});

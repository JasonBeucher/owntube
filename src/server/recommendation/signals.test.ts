import { describe, expect, it } from "vitest";
import { users, watchHistory } from "@/server/db/schema";
import { collectUserSignals } from "@/server/recommendation/signals";
import { createTestDb } from "@/test/db";

function seedUser(db: ReturnType<typeof createTestDb>["db"]): number {
  const now = Math.floor(Date.now() / 1000);
  return db
    .insert(users)
    .values({
      email: "signals@example.com",
      passwordHash: "x",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: users.id })
    .get().id;
}

describe("collectUserSignals — excludeShorts", () => {
  it("drops Shorts-feed channels from the long-form signal", () => {
    const { db } = createTestDb();
    const userId = seedUser(db);
    const now = Math.floor(Date.now() / 1000);

    // A real long-form watch and a glanced short from a junk channel.
    db.insert(watchHistory)
      .values([
        {
          userId,
          videoId: "longformVid1",
          channelId: "UC-real",
          startedAt: now - 100,
          isShort: 0,
          createdAt: now,
        },
        {
          userId,
          videoId: "shortVid1",
          channelId: "UC-junk-short",
          startedAt: now - 50,
          isShort: 1,
          createdAt: now,
        },
      ])
      .run();

    const longform = collectUserSignals(db, userId, { excludeShorts: true });
    expect(longform.channelWeights.has("UC-real")).toBe(true);
    expect(longform.channelWeights.has("UC-junk-short")).toBe(false);
    expect(longform.totalWatches).toBe(1);

    // Default (no exclusion) still sees both — the Shorts pool relies on this.
    const all = collectUserSignals(db, userId);
    expect(all.channelWeights.has("UC-junk-short")).toBe(true);
    expect(all.totalWatches).toBe(2);
  });
});

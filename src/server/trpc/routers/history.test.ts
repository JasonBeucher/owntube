import { describe, expect, it } from "vitest";
import { users } from "@/server/db/schema";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

describe("historyRouter", () => {
  it("writes and lists history entries", async () => {
    const { db, sqlite } = createTestDb();
    const now = Math.floor(Date.now() / 1000);
    const user = db
      .insert(users)
      .values({
        email: "history@example.com",
        passwordHash: "x",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: users.id })
      .get();

    const caller = appRouter.createCaller({ db, userId: user.id });
    await caller.history.upsertEvent({
      videoId: "dQw4w9WgXcQ",
      channelId: "UC1",
      durationWatched: 42,
      completed: false,
    });
    const rows = await caller.history.list({ page: 1, pageSize: 20 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.videoId).toBe("dQw4w9WgXcQ");
    sqlite.close();
  });
});

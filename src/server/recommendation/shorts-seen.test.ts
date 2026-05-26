import { describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import {
  loadShortSeenVideoIds,
  recordShortSeen,
} from "@/server/recommendation/shorts-seen";

describe("shorts-seen", () => {
  it("records and loads seen shorts", () => {
    const db = getDb();
    const ts = Math.floor(Date.now() / 1000);
    const user = db
      .insert(users)
      .values({
        email: `shorts-seen-${ts}@test.local`,
        passwordHash: "x",
        createdAt: ts,
        updatedAt: ts,
      })
      .returning({ id: users.id })
      .get();

    recordShortSeen(db, user.id, "abcdefghijk", "chan123");
    recordShortSeen(db, user.id, "klmnopqrstu", "chan456");

    const seen = loadShortSeenVideoIds(db, user.id);
    expect(seen.has("abcdefghijk")).toBe(true);
    expect(seen.has("klmnopqrstu")).toBe(true);
    expect(seen.size).toBe(2);
  });
});

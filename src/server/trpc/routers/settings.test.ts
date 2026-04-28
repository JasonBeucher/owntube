import { describe, expect, it } from "vitest";
import { users } from "@/server/db/schema";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

describe("settingsRouter", () => {
  it("updates and reads user settings", async () => {
    const { db, sqlite } = createTestDb();
    const ts = Math.floor(Date.now() / 1000);
    const user = db
      .insert(users)
      .values({
        email: "settings@example.com",
        passwordHash: "x",
        createdAt: ts,
        updatedAt: ts,
      })
      .returning({ id: users.id })
      .get();

    const caller = appRouter.createCaller({ db, userId: user.id });
    const updated = await caller.settings.update({
      theme: "dark",
      invidiousBaseUrl: "https://inv.example/",
    });
    expect(updated.theme).toBe("dark");
    expect(updated.invidiousBaseUrl).toBe("https://inv.example");

    const fetched = await caller.settings.get();
    expect(fetched.theme).toBe("dark");
    expect(fetched.invidiousBaseUrl).toBe("https://inv.example");
    sqlite.close();
  });
});

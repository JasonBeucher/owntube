import { describe, expect, it } from "vitest";
import { users } from "@/server/db/schema";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

function seedUser(db: ReturnType<typeof createTestDb>["db"], email: string) {
  const ts = Math.floor(Date.now() / 1000);
  return db
    .insert(users)
    .values({ email, passwordHash: "x", createdAt: ts, updatedAt: ts })
    .returning({ id: users.id })
    .get();
}

describe("friendsRouter", () => {
  it("runs the request → accept → share → seen/dismiss flow", async () => {
    const { db, sqlite } = createTestDb();
    const alice = seedUser(db, "alice@example.com");
    const bob = seedUser(db, "bob@example.com");
    const asAlice = appRouter.createCaller({ db, userId: alice.id });
    const asBob = appRouter.createCaller({ db, userId: bob.id });

    const requested = await asAlice.friends.sendRequest({
      email: "bob@example.com",
    });
    expect(requested.outcome).toBe("sent");

    const bobOverview = await asBob.friends.overview();
    expect(bobOverview.incoming).toHaveLength(1);
    expect(bobOverview.incoming[0]?.label).toBe("alice");
    const aliceOverview = await asAlice.friends.overview();
    expect(aliceOverview.outgoing).toHaveLength(1);

    const requestId = bobOverview.incoming[0]?.requestId;
    if (!requestId) throw new Error("missing request id");
    await asBob.friends.respond({ requestId, accept: true });

    expect((await asBob.friends.overview()).friends).toHaveLength(1);
    expect((await asAlice.friends.overview()).friends).toHaveLength(1);

    const sent = await asAlice.friends.send({
      recipientIds: [bob.id],
      videoId: "dQw4w9WgXcQ",
      videoTitle: "A video",
      channelName: "A channel",
      note: "watch this!",
    });
    expect(sent.sent).toBe(1);

    expect((await asBob.friends.unseenCount()).count).toBe(1);
    const inbox = await asBob.friends.inbox({ limit: 10 });
    expect(inbox.shares).toHaveLength(1);
    expect(inbox.shares[0]?.senderLabel).toBe("alice");
    expect(inbox.shares[0]?.note).toBe("watch this!");
    expect(inbox.shares[0]?.seen).toBe(false);

    const shareId = inbox.shares[0]?.id;
    if (!shareId) throw new Error("missing share id");
    await asBob.friends.markSeen({ shareId });
    expect((await asBob.friends.unseenCount()).count).toBe(0);
    expect((await asBob.friends.inbox({ limit: 10 })).shares[0]?.seen).toBe(
      true,
    );

    const outbox = await asAlice.friends.outbox({ limit: 10 });
    expect(outbox.shares[0]?.recipientLabel).toBe("bob");
    expect(outbox.shares[0]?.seen).toBe(true);

    await asBob.friends.dismiss({ shareId });
    expect((await asBob.friends.inbox({ limit: 10 })).shares).toHaveLength(0);

    sqlite.close();
  });

  it("refuses sharing to non-friends and hides account existence on requests", async () => {
    const { db, sqlite } = createTestDb();
    const alice = seedUser(db, "alice@example.com");
    const mallory = seedUser(db, "mallory@example.com");
    const asMallory = appRouter.createCaller({ db, userId: mallory.id });

    await expect(
      asMallory.friends.send({
        recipientIds: [alice.id],
        videoId: "dQw4w9WgXcQ",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Same response whether or not the address exists on the instance.
    const unknown = await asMallory.friends.sendRequest({
      email: "ghost@example.com",
    });
    const known = await asMallory.friends.sendRequest({
      email: "alice@example.com",
    });
    expect(unknown).toEqual(known);

    await expect(
      asMallory.friends.sendRequest({ email: "mallory@example.com" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    sqlite.close();
  });

  it("auto-accepts when both users request each other and dedupes edges", async () => {
    const { db, sqlite } = createTestDb();
    const alice = seedUser(db, "alice@example.com");
    const bob = seedUser(db, "bob@example.com");
    const asAlice = appRouter.createCaller({ db, userId: alice.id });
    const asBob = appRouter.createCaller({ db, userId: bob.id });

    await asAlice.friends.sendRequest({ email: "bob@example.com" });
    // Re-sending stays idempotent instead of stacking duplicate rows.
    const repeat = await asAlice.friends.sendRequest({
      email: "bob@example.com",
    });
    expect(repeat.outcome).toBe("sent");
    expect((await asAlice.friends.overview()).outgoing).toHaveLength(1);

    const crossed = await asBob.friends.sendRequest({
      email: "alice@example.com",
    });
    expect(crossed.outcome).toBe("accepted");
    expect((await asAlice.friends.overview()).friends).toHaveLength(1);
    expect((await asBob.friends.overview()).friends).toHaveLength(1);

    const again = await asBob.friends.sendRequest({
      email: "alice@example.com",
    });
    expect(again.outcome).toBe("already-friends");

    sqlite.close();
  });

  it("supports decline, cancel, and removal with recipient-only visibility", async () => {
    const { db, sqlite } = createTestDb();
    const alice = seedUser(db, "alice@example.com");
    const bob = seedUser(db, "bob@example.com");
    const carol = seedUser(db, "carol@example.com");
    const asAlice = appRouter.createCaller({ db, userId: alice.id });
    const asBob = appRouter.createCaller({ db, userId: bob.id });
    const asCarol = appRouter.createCaller({ db, userId: carol.id });

    await asAlice.friends.sendRequest({ email: "bob@example.com" });
    const requestId = (await asBob.friends.overview()).incoming[0]?.requestId;
    if (!requestId) throw new Error("missing request id");

    // Only the addressee may respond.
    await expect(
      asCarol.friends.respond({ requestId, accept: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await asBob.friends.respond({ requestId, accept: false });
    expect((await asAlice.friends.overview()).outgoing).toHaveLength(0);

    await asAlice.friends.sendRequest({ email: "carol@example.com" });
    const outgoingId = (await asAlice.friends.overview()).outgoing[0]
      ?.requestId;
    if (!outgoingId) throw new Error("missing outgoing id");
    await asAlice.friends.cancelRequest({ requestId: outgoingId });
    expect((await asCarol.friends.overview()).incoming).toHaveLength(0);

    await asAlice.friends.sendRequest({ email: "bob@example.com" });
    const secondRequest = (await asBob.friends.overview()).incoming[0]
      ?.requestId;
    if (!secondRequest) throw new Error("missing request id");
    await asBob.friends.respond({ requestId: secondRequest, accept: true });
    await asBob.friends.removeFriend({ userId: alice.id });
    expect((await asAlice.friends.overview()).friends).toHaveLength(0);

    // After removal, sharing is closed again in both directions.
    await expect(
      asAlice.friends.send({ recipientIds: [bob.id], videoId: "dQw4w9WgXcQ" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // A recipient cannot see or mutate someone else's shares.
    await asAlice.friends.sendRequest({ email: "carol@example.com" });
    const carolRequest = (await asCarol.friends.overview()).incoming[0]
      ?.requestId;
    if (!carolRequest) throw new Error("missing request id");
    await asCarol.friends.respond({ requestId: carolRequest, accept: true });
    await asAlice.friends.send({
      recipientIds: [carol.id],
      videoId: "dQw4w9WgXcQ",
    });
    const carolShare = (await asCarol.friends.inbox({ limit: 5 })).shares[0]
      ?.id;
    if (!carolShare) throw new Error("missing share id");
    await expect(
      asBob.friends.dismiss({ shareId: carolShare }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    sqlite.close();
  });
});

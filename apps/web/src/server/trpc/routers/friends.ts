import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/server/db/client";
import { friendships, users, videoShares } from "@/server/db/schema";
import { protectedProcedure, router } from "@/server/trpc/init";

/** Cap on unanswered outgoing requests — keeps a hijacked account from probing addresses. */
const MAX_PENDING_OUTGOING_REQUESTS = 50;
const MAX_SHARE_RECIPIENTS = 25;

const emailInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

const shareInputSchema = z.object({
  recipientIds: z
    .array(z.number().int().positive())
    .min(1)
    .max(MAX_SHARE_RECIPIENTS),
  videoId: z.string().min(5).max(64),
  videoTitle: z.string().trim().max(300).optional(),
  channelId: z.string().max(128).optional(),
  channelName: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).optional(),
});

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/** Short display name for a friend: the part of the email before the @. */
function labelFromEmail(email: string): string {
  const local = email.split("@")[0];
  return local && local.length > 0 ? local : email;
}

/** The single friendship row between two users, whichever direction it was created in. */
function edgeBetween(db: AppDb, userA: number, userB: number) {
  return db
    .select()
    .from(friendships)
    .where(
      or(
        and(
          eq(friendships.requesterId, userA),
          eq(friendships.addresseeId, userB),
        ),
        and(
          eq(friendships.requesterId, userB),
          eq(friendships.addresseeId, userA),
        ),
      ),
    )
    .limit(1)
    .all()[0];
}

function assertAcceptedFriends(db: AppDb, userId: number, otherIds: number[]) {
  if (otherIds.length === 0) return;
  const rows = db
    .select({
      requesterId: friendships.requesterId,
      addresseeId: friendships.addresseeId,
    })
    .from(friendships)
    .where(
      and(
        eq(friendships.status, "accepted"),
        or(
          and(
            eq(friendships.requesterId, userId),
            inArray(friendships.addresseeId, otherIds),
          ),
          and(
            eq(friendships.addresseeId, userId),
            inArray(friendships.requesterId, otherIds),
          ),
        ),
      ),
    )
    .all();
  const friendIds = new Set(
    rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId)),
  );
  for (const id of otherIds) {
    if (!friendIds.has(id)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You can only send videos to accepted friends.",
      });
    }
  }
}

export const friendsRouter = router({
  overview: protectedProcedure.query(({ ctx }) => {
    const rows = ctx.db
      .select({
        id: friendships.id,
        requesterId: friendships.requesterId,
        addresseeId: friendships.addresseeId,
        status: friendships.status,
        createdAt: friendships.createdAt,
        respondedAt: friendships.respondedAt,
      })
      .from(friendships)
      .where(
        or(
          eq(friendships.requesterId, ctx.userId),
          eq(friendships.addresseeId, ctx.userId),
        ),
      )
      .all();

    const otherIds = [
      ...new Set(
        rows.map((r) =>
          r.requesterId === ctx.userId ? r.addresseeId : r.requesterId,
        ),
      ),
    ];
    const userRows =
      otherIds.length > 0
        ? ctx.db
            .select({ id: users.id, email: users.email })
            .from(users)
            .where(inArray(users.id, otherIds))
            .all()
        : [];
    const emailById = new Map(userRows.map((u) => [u.id, u.email]));

    const describe = (otherId: number) => {
      const email = emailById.get(otherId) ?? "unknown";
      return { userId: otherId, email, label: labelFromEmail(email) };
    };

    const friends = rows
      .filter((r) => r.status === "accepted")
      .map((r) => ({
        ...describe(
          r.requesterId === ctx.userId ? r.addresseeId : r.requesterId,
        ),
        since: r.respondedAt ?? r.createdAt,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const incoming = rows
      .filter((r) => r.status === "pending" && r.addresseeId === ctx.userId)
      .map((r) => ({
        requestId: r.id,
        ...describe(r.requesterId),
        requestedAt: r.createdAt,
      }))
      .sort((a, b) => b.requestedAt - a.requestedAt);

    const outgoing = rows
      .filter((r) => r.status === "pending" && r.requesterId === ctx.userId)
      .map((r) => ({
        requestId: r.id,
        ...describe(r.addresseeId),
        requestedAt: r.createdAt,
      }))
      .sort((a, b) => b.requestedAt - a.requestedAt);

    return { friends, incoming, outgoing };
  }),

  sendRequest: protectedProcedure
    .input(emailInputSchema)
    .mutation(({ ctx, input }) => {
      const self = ctx.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, ctx.userId))
        .limit(1)
        .all()[0];
      if (self && self.email.toLowerCase() === input.email) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That is your own address.",
        });
      }

      const pendingOutgoing = ctx.db
        .select({ id: friendships.id })
        .from(friendships)
        .where(
          and(
            eq(friendships.requesterId, ctx.userId),
            eq(friendships.status, "pending"),
          ),
        )
        .all().length;
      if (pendingOutgoing >= MAX_PENDING_OUTGOING_REQUESTS) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many pending requests. Cancel some first.",
        });
      }

      const target = ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1)
        .all()[0];

      // Unknown address: reply exactly like a successful request so the
      // endpoint cannot be used to enumerate instance accounts.
      if (!target) return { outcome: "sent" as const };

      const existing = edgeBetween(ctx.db, ctx.userId, target.id);
      const ts = nowUnix();

      if (!existing) {
        ctx.db
          .insert(friendships)
          .values({
            requesterId: ctx.userId,
            addresseeId: target.id,
            status: "pending",
            createdAt: ts,
          })
          .run();
        return { outcome: "sent" as const };
      }
      if (existing.status === "accepted") {
        return { outcome: "already-friends" as const };
      }
      if (existing.requesterId === ctx.userId) {
        return { outcome: "sent" as const };
      }
      // They already asked us — adding them back means both sides agree.
      ctx.db
        .update(friendships)
        .set({ status: "accepted", respondedAt: ts })
        .where(eq(friendships.id, existing.id))
        .run();
      return { outcome: "accepted" as const };
    }),

  respond: protectedProcedure
    .input(z.object({ requestId: z.number().int(), accept: z.boolean() }))
    .mutation(({ ctx, input }) => {
      const request = ctx.db
        .select()
        .from(friendships)
        .where(
          and(
            eq(friendships.id, input.requestId),
            eq(friendships.addresseeId, ctx.userId),
            eq(friendships.status, "pending"),
          ),
        )
        .limit(1)
        .all()[0];
      if (!request) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Request not found.",
        });
      }
      if (input.accept) {
        ctx.db
          .update(friendships)
          .set({ status: "accepted", respondedAt: nowUnix() })
          .where(eq(friendships.id, request.id))
          .run();
        return { ok: true as const, accepted: true as const };
      }
      ctx.db.delete(friendships).where(eq(friendships.id, request.id)).run();
      return { ok: true as const, accepted: false as const };
    }),

  cancelRequest: protectedProcedure
    .input(z.object({ requestId: z.number().int() }))
    .mutation(({ ctx, input }) => {
      const deleted = ctx.db
        .delete(friendships)
        .where(
          and(
            eq(friendships.id, input.requestId),
            eq(friendships.requesterId, ctx.userId),
            eq(friendships.status, "pending"),
          ),
        )
        .run();
      if (deleted.changes === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Request not found.",
        });
      }
      return { ok: true as const };
    }),

  removeFriend: protectedProcedure
    .input(z.object({ userId: z.number().int() }))
    .mutation(({ ctx, input }) => {
      const edge = edgeBetween(ctx.db, ctx.userId, input.userId);
      if (!edge || edge.status !== "accepted") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Not in your friends.",
        });
      }
      ctx.db.delete(friendships).where(eq(friendships.id, edge.id)).run();
      return { ok: true as const };
    }),

  send: protectedProcedure
    .input(shareInputSchema)
    .mutation(({ ctx, input }) => {
      const recipientIds = [...new Set(input.recipientIds)].filter(
        (id) => id !== ctx.userId,
      );
      if (recipientIds.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Pick at least one friend.",
        });
      }
      assertAcceptedFriends(ctx.db, ctx.userId, recipientIds);
      const ts = nowUnix();
      for (const recipientId of recipientIds) {
        ctx.db
          .insert(videoShares)
          .values({
            senderId: ctx.userId,
            recipientId,
            videoId: input.videoId,
            channelId: input.channelId ?? null,
            videoTitle: input.videoTitle ?? null,
            channelName: input.channelName ?? null,
            note: input.note && input.note.length > 0 ? input.note : null,
            createdAt: ts,
          })
          .run();
      }
      return { ok: true as const, sent: recipientIds.length };
    }),

  inbox: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
    .query(({ ctx, input }) => {
      const rows = ctx.db
        .select({
          id: videoShares.id,
          videoId: videoShares.videoId,
          channelId: videoShares.channelId,
          videoTitle: videoShares.videoTitle,
          channelName: videoShares.channelName,
          note: videoShares.note,
          createdAt: videoShares.createdAt,
          seenAt: videoShares.seenAt,
          senderEmail: users.email,
          senderId: videoShares.senderId,
        })
        .from(videoShares)
        .innerJoin(users, eq(users.id, videoShares.senderId))
        .where(eq(videoShares.recipientId, ctx.userId))
        .orderBy(desc(videoShares.createdAt), desc(videoShares.id))
        .limit(input.limit)
        .all();
      return {
        shares: rows.map((r) => ({
          id: r.id,
          videoId: r.videoId,
          channelId: r.channelId ?? undefined,
          videoTitle: r.videoTitle ?? undefined,
          channelName: r.channelName ?? undefined,
          note: r.note ?? undefined,
          createdAt: r.createdAt,
          seen: r.seenAt != null,
          senderId: r.senderId,
          senderLabel: labelFromEmail(r.senderEmail),
        })),
      };
    }),

  outbox: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }))
    .query(({ ctx, input }) => {
      const rows = ctx.db
        .select({
          id: videoShares.id,
          videoId: videoShares.videoId,
          videoTitle: videoShares.videoTitle,
          note: videoShares.note,
          createdAt: videoShares.createdAt,
          seenAt: videoShares.seenAt,
          recipientEmail: users.email,
        })
        .from(videoShares)
        .innerJoin(users, eq(users.id, videoShares.recipientId))
        .where(eq(videoShares.senderId, ctx.userId))
        .orderBy(desc(videoShares.createdAt), desc(videoShares.id))
        .limit(input.limit)
        .all();
      return {
        shares: rows.map((r) => ({
          id: r.id,
          videoId: r.videoId,
          videoTitle: r.videoTitle ?? undefined,
          note: r.note ?? undefined,
          createdAt: r.createdAt,
          seen: r.seenAt != null,
          recipientLabel: labelFromEmail(r.recipientEmail),
        })),
      };
    }),

  unseenCount: protectedProcedure.query(({ ctx }) => {
    const rows = ctx.db
      .select({ id: videoShares.id })
      .from(videoShares)
      .where(
        and(
          eq(videoShares.recipientId, ctx.userId),
          isNull(videoShares.seenAt),
        ),
      )
      .all();
    return { count: rows.length };
  }),

  markSeen: protectedProcedure
    .input(z.object({ shareId: z.number().int() }))
    .mutation(({ ctx, input }) => {
      ctx.db
        .update(videoShares)
        .set({ seenAt: nowUnix() })
        .where(
          and(
            eq(videoShares.id, input.shareId),
            eq(videoShares.recipientId, ctx.userId),
            isNull(videoShares.seenAt),
          ),
        )
        .run();
      return { ok: true as const };
    }),

  markAllSeen: protectedProcedure.mutation(({ ctx }) => {
    ctx.db
      .update(videoShares)
      .set({ seenAt: nowUnix() })
      .where(
        and(
          eq(videoShares.recipientId, ctx.userId),
          isNull(videoShares.seenAt),
        ),
      )
      .run();
    return { ok: true as const };
  }),

  dismiss: protectedProcedure
    .input(z.object({ shareId: z.number().int() }))
    .mutation(({ ctx, input }) => {
      const deleted = ctx.db
        .delete(videoShares)
        .where(
          and(
            eq(videoShares.id, input.shareId),
            eq(videoShares.recipientId, ctx.userId),
          ),
        )
        .run();
      if (deleted.changes === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Share not found." });
      }
      return { ok: true as const };
    }),
});

import { and, eq } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { shortsSeen } from "@/server/db/schema";

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/** All shorts the user has scrolled past in the vertical feed (lifetime). */
export function loadShortSeenVideoIds(db: AppDb, userId: number): Set<string> {
  const rows = db
    .select({ videoId: shortsSeen.videoId })
    .from(shortsSeen)
    .where(eq(shortsSeen.userId, userId))
    .limit(20_000)
    .all();
  return new Set(rows.map((r) => r.videoId));
}

export function recordShortSeen(
  db: AppDb,
  userId: number,
  videoId: string,
  channelId: string,
): void {
  const trimmedId = videoId.trim();
  if (trimmedId.length < 5) return;
  const ts = nowUnix();
  const existing = db
    .select({ id: shortsSeen.id })
    .from(shortsSeen)
    .where(
      and(eq(shortsSeen.userId, userId), eq(shortsSeen.videoId, trimmedId)),
    )
    .limit(1)
    .all()[0];

  if (existing) {
    db.update(shortsSeen)
      .set({
        channelId: channelId.trim() || "unknown",
        seenAt: ts,
      })
      .where(eq(shortsSeen.id, existing.id))
      .run();
    return;
  }

  db.insert(shortsSeen)
    .values({
      userId,
      videoId: trimmedId,
      channelId: channelId.trim() || "unknown",
      seenAt: ts,
    })
    .run();
}

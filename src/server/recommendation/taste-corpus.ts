import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { videoCache } from "@/server/db/schema";
import { videoDetailSchema } from "@/server/services/proxy.types";

/** Must match `detailCacheKey` in `proxy.ts` (streams detail payload). */
function streamsDetailCacheKey(videoId: string): string {
  const h = createHash("sha256")
    .update(JSON.stringify({ v: 4, kind: "streams", videoId }))
    .digest("hex");
  return `streams:v4:${h}`;
}

function readOneCachedTitle(db: AppDb, videoId: string): string | undefined {
  if (!videoId || videoId.length < 5) return undefined;
  const key = streamsDetailCacheKey(videoId);
  const row = db
    .select({ payloadJson: videoCache.payloadJson })
    .from(videoCache)
    .where(eq(videoCache.cacheKey, key))
    .orderBy(desc(videoCache.fetchedAt))
    .limit(1)
    .all()[0];
  if (!row) return undefined;
  try {
    const parsed = videoDetailSchema.safeParse(JSON.parse(row.payloadJson));
    if (!parsed.success) return undefined;
    const t = parsed.data.title.trim();
    return t || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads cached video detail titles for interaction-based taste (likes/saves).
 * Best-effort: skips missing/stale cache without network calls.
 */
export function readCachedDetailTitlesForVideos(
  db: AppDb,
  videoIds: readonly string[],
  maxTitles: number,
): string[] {
  const titles: string[] = [];
  const seenLower = new Set<string>();
  let n = 0;
  for (const videoId of videoIds) {
    if (n >= maxTitles) break;
    const t = readOneCachedTitle(db, videoId);
    if (!t) continue;
    const low = t.toLowerCase();
    if (seenLower.has(low)) continue;
    seenLower.add(low);
    titles.push(t);
    n += 1;
  }
  return titles;
}

/** One title per dislike row (allows duplicates) for token mining. */
export function readCachedDislikeTitlesOrdered(
  db: AppDb,
  videoIds: readonly string[],
  max: number,
): string[] {
  const out: string[] = [];
  for (const videoId of videoIds) {
    if (out.length >= max) break;
    const t = readOneCachedTitle(db, videoId);
    if (t) out.push(t);
  }
  return out;
}

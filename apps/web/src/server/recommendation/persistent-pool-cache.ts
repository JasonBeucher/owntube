import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/server/db/client";
import { videoCache } from "@/server/db/schema";
import {
  type UnifiedVideo,
  unifiedVideoSchema,
} from "@/server/services/proxy.types";

const PERSISTED_RECOMMENDATION_POOL_TTL_SEC = 10 * 60;

const persistedRecommendationPoolSchema = z.object({
  version: z.literal(1),
  coldStart: z.boolean(),
  videos: z.array(unifiedVideoSchema),
});

export type PersistedRecommendationPool = {
  videos: UnifiedVideo[];
  coldStart: boolean;
  fresh: boolean;
};

function persistedRecommendationPoolKey(cacheIdentity: string): string {
  const hash = createHash("sha256").update(cacheIdentity).digest("hex");
  return `recommendation:v1:${hash}`;
}

export function readPersistedRecommendationPool(
  db: AppDb,
  cacheIdentity: string,
): PersistedRecommendationPool | null {
  const row = db
    .select()
    .from(videoCache)
    .where(
      eq(videoCache.cacheKey, persistedRecommendationPoolKey(cacheIdentity)),
    )
    .limit(1)
    .all()[0];
  if (!row) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(row.payloadJson) as unknown;
  } catch {
    return null;
  }
  const parsed = persistedRecommendationPoolSchema.safeParse(raw);
  if (!parsed.success) return null;

  return {
    videos: parsed.data.videos,
    coldStart: parsed.data.coldStart,
    fresh: row.expiresAt > Math.floor(Date.now() / 1000),
  };
}

export function writePersistedRecommendationPool(
  db: AppDb,
  cacheIdentity: string,
  pool: { videos: UnifiedVideo[]; coldStart: boolean },
): void {
  const now = Math.floor(Date.now() / 1000);
  const row = {
    cacheKey: persistedRecommendationPoolKey(cacheIdentity),
    source: "local",
    kind: "recommendation",
    payloadJson: JSON.stringify({
      version: 1,
      videos: pool.videos,
      coldStart: pool.coldStart,
    }),
    fetchedAt: now,
    expiresAt: now + PERSISTED_RECOMMENDATION_POOL_TTL_SEC,
  };
  db.insert(videoCache)
    .values(row)
    .onConflictDoUpdate({
      target: videoCache.cacheKey,
      set: {
        source: row.source,
        kind: row.kind,
        payloadJson: row.payloadJson,
        fetchedAt: row.fetchedAt,
        expiresAt: row.expiresAt,
      },
    })
    .run();
}

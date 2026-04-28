import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { watchHistory } from "@/server/db/schema";
import { RateLimitExceededError } from "@/server/errors/rate-limit-exceeded";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import { getRecommendations } from "@/server/recommendation/engine";
import { fetchTrendingVideos } from "@/server/services/proxy";
import { trendingVideoCategorySchema } from "@/server/services/proxy.types";
import {
  getUserProxyOverrides,
  getUserSettings,
  normalizeTrendingRegionStored,
} from "@/server/settings/profile";
import { publicProcedure, router } from "@/server/trpc/init";

const homeInputSchema = z
  .object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(48).default(24),
    region: z.string().length(2).optional(),
    /** When set, home uses regional trending for this Invidious category (any user). */
    category: trendingVideoCategorySchema,
  })
  .optional();

export const feedRouter = router({
  home: publicProcedure.input(homeInputSchema).query(async ({ ctx, input }) => {
    const page = input?.page ?? 1;
    const pageSize = input?.pageSize ?? 24;
    const category = input?.category;
    const savedRegion =
      ctx.userId != null
        ? normalizeTrendingRegionStored(
            getUserSettings(ctx.db, ctx.userId).trendingRegion,
          )
        : undefined;
    const region = normalizeTrendingRegionStored(
      input?.region ?? savedRegion ?? "US",
    );
    const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
    try {
      if (ctx.userId && !category) {
        const rec = await getRecommendations(ctx.db, ctx.userId, {
          page,
          pageSize,
          region,
          overrides,
        });
        return {
          kind: "personalized" as const,
          videos: rec.videos,
          coldStart: rec.coldStart,
          hasMore: rec.hasMore,
          region,
          category: null as null,
        };
      }
      const limit = Math.min(200, page * pageSize + pageSize);
      const trending = await fetchTrendingVideos(
        ctx.db,
        { region, limit, category },
        overrides,
      );
      const start = (page - 1) * pageSize;
      let pool = trending.videos;
      if (ctx.userId) {
        const seenRows = ctx.db
          .select({ videoId: watchHistory.videoId })
          .from(watchHistory)
          .where(
            and(
              eq(watchHistory.userId, ctx.userId),
              eq(watchHistory.isDeleted, 0),
            ),
          )
          .limit(10_000)
          .all();
        const seen = new Set(seenRows.map((r) => r.videoId));
        pool = pool.filter((v) => !seen.has(v.videoId));
      }
      const videos = pool.slice(start, start + pageSize);
      const hasMore = start + videos.length < pool.length;
      return {
        kind: "trending" as const,
        videos,
        coldStart: true,
        hasMore,
        region,
        category: category ?? null,
      };
    } catch (e) {
      if (e instanceof UpstreamUnavailableError) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: e.message });
      }
      if (e instanceof RateLimitExceededError) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: e.message });
      }
      throw e;
    }
  }),
});

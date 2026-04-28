import { fetchRelatedVideos, fetchVideoDetail } from "@/server/services/proxy";
import { videoDetailInputSchema } from "@/server/services/proxy.types";
import { getUserProxyOverrides } from "@/server/settings/profile";
import { publicProcedure, router } from "@/server/trpc/init";

export const videoRouter = router({
  detail: publicProcedure
    .input(videoDetailInputSchema)
    .query(async ({ ctx, input }) => {
      const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
      return fetchVideoDetail(ctx.db, input, overrides);
    }),
  related: publicProcedure
    .input(videoDetailInputSchema)
    .query(async ({ ctx, input }) => {
      const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
      return fetchRelatedVideos(ctx.db, input, 20, overrides);
    }),
});

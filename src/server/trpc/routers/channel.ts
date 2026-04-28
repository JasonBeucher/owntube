import { TRPCError } from "@trpc/server";
import { RateLimitExceededError } from "@/server/errors/rate-limit-exceeded";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import { fetchChannelPage } from "@/server/services/proxy";
import { channelPageInputSchema } from "@/server/services/proxy.types";
import { getUserProxyOverrides } from "@/server/settings/profile";
import { publicProcedure, router } from "@/server/trpc/init";

export const channelRouter = router({
  page: publicProcedure
    .input(channelPageInputSchema)
    .query(async ({ ctx, input }) => {
      try {
        const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
        return await fetchChannelPage(ctx.db, input, overrides);
      } catch (e) {
        if (e instanceof UpstreamUnavailableError) {
          throw new TRPCError({ code: "BAD_GATEWAY", message: e.message });
        }
        if (e instanceof RateLimitExceededError) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: e.message,
          });
        }
        throw e;
      }
    }),
});

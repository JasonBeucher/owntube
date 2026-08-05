import { createTRPCClient, httpBatchLink } from "@trpc/client";
// Type-only import: erased at build time, so Metro never bundles any server
// code. It gives the TV client the same end-to-end type safety as the web app.
import type { AppRouter } from "@web/server/trpc/root";
import superjson from "superjson";
import { getToken, handleUnauthorized } from "@/lib/auth-token";
import { TRPC_URL, withCurrentBaseUrl } from "@/lib/config";

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      // `url` is fixed at client creation, so it carries a placeholder origin
      // that the fetch wrapper below rewrites to whichever instance is
      // configured right now — the user can change it without a restart.
      url: TRPC_URL,
      transformer: superjson,
      fetch: async (input, init) => {
        const target =
          typeof input === "string"
            ? withCurrentBaseUrl(input)
            : input instanceof URL
              ? withCurrentBaseUrl(input.toString())
              : input;
        const response = await fetch(target, init);
        // An expired or revoked device token has to drop the user back to the
        // login screen; otherwise the app looks signed in but every protected
        // call silently fails.
        if (response.status === 401) await handleUnauthorized();
        return response;
      },
      // Read on every request so a fresh login (or logout) takes effect without
      // rebuilding the client. The server falls back to this Bearer token when
      // there is no Auth.js cookie (createTRPCContext).
      headers: async () => {
        const token = await getToken();
        return token ? { authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});

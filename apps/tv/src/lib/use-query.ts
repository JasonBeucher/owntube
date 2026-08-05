import { useCallback, useEffect, useState } from "react";

type QueryState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

/** `refetch` re-runs the query — used by retry buttons and after mutations. */
export type QueryResult<T> = QueryState<T> & { refetch: () => void };

/**
 * Minimal data hook over the vanilla tRPC client — the TV app has no
 * @trpc/react-query provider, and a handful of screens don't justify pulling
 * one in. Re-runs when `deps` change; ignores stale resolutions on unmount.
 *
 * No caching/dedup. Add @trpc/react-query only if cross-screen cache reuse or
 * background refetch becomes a real need.
 */
export function useQuery<T>(
  queryFn: () => Promise<T>,
  deps: readonly unknown[],
): QueryResult<T> {
  const [state, setState] = useState<QueryState<T>>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  // queryFn identity is owned by the caller via deps; reloadToken forces a re-run.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are explicit
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    queryFn()
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({ status: "error", message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [...deps, reloadToken]);

  const refetch = useCallback(() => setReloadToken((token) => token + 1), []);

  return { ...state, refetch };
}

/** Surfaces tRPC/upstream error messages (rate-limit, upstream-unavailable). */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

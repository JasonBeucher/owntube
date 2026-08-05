/**
 * Shape returned by next-auth v5 `signIn(..., { redirect: false })`.
 * `ok` reflects the HTTP response, not the credential check: a rejected login
 * still answers 200, so `ok` is true while `error` is set and `url` is null.
 */
export type SignInResultLike = {
  error?: string | null;
  ok?: boolean;
  url?: string | null;
};

export type SignInOutcome =
  | { status: "success"; destination: string }
  | { status: "failed" };

/**
 * Same-origin destination after a successful sign-in. `result.url` is resolved
 * against AUTH_URL and may point at another host (LAN IP, Tailscale name) where
 * the freshly-set session cookie does not exist, so only the path is kept.
 */
function destinationFromUrl(url: string | null | undefined): string {
  if (!url) return "/";
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url.startsWith("/") ? url : "/";
  }
}

/**
 * Decides whether a sign-in attempt actually authenticated the user.
 * Must key off `error`, never `ok` alone — otherwise invalid credentials are
 * treated as success and the user is redirected while still logged out.
 */
export function resolveSignInOutcome(
  result: SignInResultLike | undefined | null,
  fallbackDestination = "/",
): SignInOutcome {
  if (!result) return { status: "failed" };
  if (result.error) return { status: "failed" };
  if (result.ok === false) return { status: "failed" };
  const destination = result.url
    ? destinationFromUrl(result.url)
    : fallbackDestination;
  return { status: "success", destination };
}

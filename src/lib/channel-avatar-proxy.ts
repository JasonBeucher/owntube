import { resolveChannelAvatarUrl } from "@/lib/channel-avatar";
import { normalizeUpstreamBaseUrl } from "@/lib/upstream-base-url";

const MAX_CHANNEL_AVATAR_URL_LEN = 8_192;

/** Public YouTube avatar/thumbnail hosts — safe to load directly in the browser. */
export function isYoutubeAvatarCdn(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h.endsWith(".googleusercontent.com") ||
    h.endsWith(".ggpht.com") ||
    h.endsWith(".ytimg.com")
  );
}

export function isPrivateOrLanHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") return true;
  if (h.startsWith("192.168.")) return true;
  if (h.startsWith("10.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

/** Origins allowed for `/channel-avatar` upstream fetches (server-side). */
export function collectAllowedChannelAvatarOrigins(): string[] {
  const out = new Set<string>();
  for (const raw of [
    process.env.PIPED_BASE_URL,
    process.env.PIPED_PROXY_BASE_URL,
    process.env.INVIDIOUS_BASE_URL,
  ]) {
    const base = normalizeUpstreamBaseUrl(raw);
    if (!base) continue;
    try {
      const u = new URL(base);
      out.add(u.origin);
      if (u.hostname === "localhost") {
        const port = u.port ? `:${u.port}` : "";
        out.add(`${u.protocol}//127.0.0.1${port}`);
      }
      if (u.hostname === "127.0.0.1") {
        const port = u.port ? `:${u.port}` : "";
        out.add(`${u.protocol}//localhost${port}`);
      }
    } catch {
      /* ignore malformed env */
    }
  }
  return [...out];
}

export function isAllowedChannelAvatarFetchTarget(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (isYoutubeAvatarCdn(url.hostname) && url.protocol === "https:") {
    return true;
  }
  if (collectAllowedChannelAvatarOrigins().includes(url.origin)) {
    return true;
  }
  return false;
}

/** Invidious media paths already served by `/invidious/…`. */
export function invidiousAvatarProxyPath(resolvedUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(resolvedUrl);
  } catch {
    return null;
  }
  const path = parsed.pathname;
  if (
    path.startsWith("/vi/") ||
    path.startsWith("/api/v1/") ||
    path.startsWith("/ggpht/")
  ) {
    return `/invidious${path}${parsed.search}`;
  }
  return null;
}

export function shouldProxyChannelAvatarUrl(url: URL): boolean {
  if (url.protocol === "http:") return true;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (isPrivateOrLanHost(host)) return true;
  if (collectAllowedChannelAvatarOrigins().includes(url.origin)) return true;
  return false;
}

/**
 * Browser-ready avatar URL: same-origin hops for LAN/HTTP upstreams (mixed
 * content on HTTPS reverse proxies) and Invidious `/vi/` paths.
 */
export function toBrowserChannelAvatarUrl(
  raw: string | undefined | null,
): string | undefined {
  const resolved = resolveChannelAvatarUrl(raw ?? undefined);
  if (!resolved) return undefined;
  if (resolved.length > MAX_CHANNEL_AVATAR_URL_LEN) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(resolved);
  } catch {
    return undefined;
  }

  if (isYoutubeAvatarCdn(parsed.hostname) && parsed.protocol === "https:") {
    return resolved;
  }

  const invidiousPath = invidiousAvatarProxyPath(resolved);
  if (invidiousPath) return invidiousPath;

  if (shouldProxyChannelAvatarUrl(parsed)) {
    return `/channel-avatar?url=${encodeURIComponent(resolved)}`;
  }

  return resolved;
}

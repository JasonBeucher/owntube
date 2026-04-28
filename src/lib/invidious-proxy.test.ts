import { describe, expect, it } from "vitest";
import {
  rewriteM3u8ForOwnTubeProxy,
  shouldUseInvidiousProxyForUrl,
  toProxiedOrDirectPlayback,
} from "@/lib/invidious-proxy";
import type { VideoDetail } from "@/server/services/proxy.types";

describe("shouldUseInvidiousProxyForUrl", () => {
  it("matches newer Invidious HLS under /api/manifest/ (not only /api/v1/)", () => {
    process.env.INVIDIOUS_BASE_URL = "http://127.0.0.1:3001";
    const detail = { sourceUsed: "invidious" } as VideoDetail;
    const url =
      "http://127.0.0.1:3001/api/manifest/hls_playlist/expire/1/id/x/playlist/index.m3u8";
    expect(shouldUseInvidiousProxyForUrl(detail, url)).toBe(true);
    expect(
      toProxiedOrDirectPlayback(url, "http://localhost:3000", "", detail),
    ).toBe(
      "http://localhost:3000/invidious/api/manifest/hls_playlist/expire/1/id/x/playlist/index.m3u8",
    );
  });
});

describe("rewriteM3u8ForOwnTubeProxy", () => {
  it("replaces 127.0.0.1 invidious origin with the proxy path", () => {
    const body = `#EXTM3U
http://127.0.0.1:3001/api/v1/segment/abc`;
    expect(
      rewriteM3u8ForOwnTubeProxy(
        body,
        "http://192.168.1.14:3000",
        "192.168.1.14:3000",
        "http://127.0.0.1:3001",
      ),
    ).toContain("http://192.168.1.14:3000/invidious/api/v1/segment/abc");
  });
});

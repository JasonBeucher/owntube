import { afterEach, describe, expect, it } from "vitest";
import {
  collectAllowedChannelAvatarOrigins,
  invidiousAvatarProxyPath,
  isAllowedChannelAvatarFetchTarget,
  isYoutubeAvatarCdn,
  toBrowserChannelAvatarUrl,
} from "@/lib/channel-avatar-proxy";

describe("isYoutubeAvatarCdn", () => {
  it("matches common YouTube avatar hosts", () => {
    expect(isYoutubeAvatarCdn("yt3.ggpht.com")).toBe(true);
    expect(isYoutubeAvatarCdn("i.ytimg.com")).toBe(true);
    expect(isYoutubeAvatarCdn("example.com")).toBe(false);
  });
});

describe("toBrowserChannelAvatarUrl", () => {
  afterEach(() => {
    delete process.env.PIPED_BASE_URL;
    delete process.env.PIPED_PROXY_BASE_URL;
    delete process.env.INVIDIOUS_BASE_URL;
  });

  it("keeps HTTPS YouTube CDN URLs direct", () => {
    const url = "https://yt3.ggpht.com/abc=s88-c-k-c0x00ffffff-no-rj";
    expect(toBrowserChannelAvatarUrl(url)).toBe(url);
  });

  it("routes Invidious /vi/ paths through /invidious", () => {
    const url = "http://192.168.1.11:3210/vi/UCabc/hqdefault.jpg";
    expect(toBrowserChannelAvatarUrl(url)).toBe(
      "/invidious/vi/UCabc/hqdefault.jpg",
    );
  });

  it("proxies HTTP LAN Piped proxy URLs", () => {
    process.env.PIPED_PROXY_BASE_URL = "http://192.168.1.11:8092";
    const url = "http://192.168.1.11:8092/cache/avatar.jpg";
    expect(toBrowserChannelAvatarUrl(url)).toBe(
      `/channel-avatar?url=${encodeURIComponent(url)}`,
    );
  });

  it("repairs broken host-less URLs then proxies when needed", () => {
    process.env.INVIDIOUS_BASE_URL = "http://192.168.1.11:3210";
    expect(
      toBrowserChannelAvatarUrl("http://:3210/vi/UCabc/hqdefault.jpg"),
    ).toBe("/invidious/vi/UCabc/hqdefault.jpg");
  });
});

describe("isAllowedChannelAvatarFetchTarget", () => {
  afterEach(() => {
    delete process.env.PIPED_BASE_URL;
    delete process.env.PIPED_PROXY_BASE_URL;
    delete process.env.INVIDIOUS_BASE_URL;
  });

  it("allows configured upstream origins", () => {
    process.env.PIPED_BASE_URL = "http://192.168.1.11:8091";
    expect(
      isAllowedChannelAvatarFetchTarget(
        new URL("http://192.168.1.11:8091/avatars/x.jpg"),
      ),
    ).toBe(true);
  });

  it("rejects arbitrary hosts", () => {
    process.env.PIPED_BASE_URL = "http://192.168.1.11:8091";
    expect(
      isAllowedChannelAvatarFetchTarget(new URL("http://evil.example/x.jpg")),
    ).toBe(false);
  });

  it("collects localhost and 127.0.0.1 variants", () => {
    process.env.INVIDIOUS_BASE_URL = "http://localhost:3210";
    const origins = collectAllowedChannelAvatarOrigins();
    expect(origins).toContain("http://localhost:3210");
    expect(origins).toContain("http://127.0.0.1:3210");
  });
});

describe("invidiousAvatarProxyPath", () => {
  it("returns null for non-invidious paths", () => {
    expect(
      invidiousAvatarProxyPath("http://192.168.1.11:8092/cache/x.jpg"),
    ).toBeNull();
  });
});

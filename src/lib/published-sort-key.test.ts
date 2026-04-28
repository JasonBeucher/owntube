import { describe, expect, it } from "vitest";
import type { UnifiedVideo } from "@/server/services/proxy.types";
import {
  coercePublishedSecondsFromUpstream,
  compareSubscriptionHeads,
  parseRelativePublishedToUnix,
  publishedSortKey,
} from "./published-sort-key";

describe("parseRelativePublishedToUnix", () => {
  it("parses English ago", () => {
    const now = 1_700_000_000;
    expect(parseRelativePublishedToUnix("2 hours ago", now)).toBe(now - 7200);
    expect(parseRelativePublishedToUnix("Streamed 3 days ago", now)).toBe(
      now - 3 * 86400,
    );
  });

  it("parses French il y a", () => {
    const now = 1_700_000_000;
    expect(parseRelativePublishedToUnix("il y a 5 minutes", now)).toBe(
      now - 300,
    );
  });
});

describe("publishedSortKey", () => {
  it("uses publishedAt when set", () => {
    const v: UnifiedVideo = {
      videoId: "abc",
      title: "t",
      publishedAt: 1_699_999_000,
    };
    expect(publishedSortKey(v)).toBe(1_699_999_000);
  });

  it("falls back to publishedText when publishedAt is not a real unix timestamp", () => {
    const now = 1_700_000_000;
    const v: UnifiedVideo = {
      videoId: "abc",
      title: "t",
      publishedAt: 3_600,
      publishedText: "14 hours ago",
    };
    expect(publishedSortKey(v, now)).toBe(now - 14 * 3600);
  });
});

describe("coercePublishedSecondsFromUpstream", () => {
  it("rejects tiny numeric values that are not plausible unix timestamps", () => {
    expect(coercePublishedSecondsFromUpstream(3_600)).toBeUndefined();
  });
});

describe("compareSubscriptionHeads", () => {
  it("prefers another channel when timestamps tie", () => {
    const now = 1_700_000_000;
    const a = {
      subscriptionChannelId: "UCaaa",
      v: {
        videoId: "v1",
        title: "a",
        publishedText: "1 day ago",
      } as UnifiedVideo,
    };
    const b = {
      subscriptionChannelId: "UCbbb",
      v: {
        videoId: "v2",
        title: "b",
        publishedText: "1 day ago",
      } as UnifiedVideo,
    };
    const last = "UCaaa";
    expect(compareSubscriptionHeads(a, b, last, now)).toBeGreaterThan(0);
    expect(compareSubscriptionHeads(b, a, last, now)).toBeLessThan(0);
  });
});

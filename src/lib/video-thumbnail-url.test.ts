import { describe, expect, it } from "vitest";
import {
  isLowerTierVideoThumbnailFilename,
  nextFallbackVideoThumbnailUrl,
  preferHighResVideoThumbnailUrl,
} from "@/lib/video-thumbnail-url";

describe("video-thumbnail-url", () => {
  it("upgrades Piped hq720 list thumbs to maxresdefault", () => {
    const raw =
      "http://192.168.1.11:8092/vi/abc123/hq720.jpg?host=i.ytimg.com&rs=sig";
    expect(preferHighResVideoThumbnailUrl(raw, "abc123")).toBe(
      "http://192.168.1.11:8092/vi/abc123/maxresdefault.jpg?host=i.ytimg.com&rs=sig",
    );
  });

  it("leaves maxres URLs unchanged", () => {
    const raw =
      "http://192.168.1.11:8092/bp/abc123/maxresdefault.webp?host=i.ytimg.com";
    expect(preferHighResVideoThumbnailUrl(raw)).toBe(raw);
  });

  it("detects lower-tier filenames", () => {
    expect(isLowerTierVideoThumbnailFilename("hq720.jpg")).toBe(true);
    expect(isLowerTierVideoThumbnailFilename("maxresdefault.jpg")).toBe(false);
  });

  it("falls back from maxres to hqdefault on img error", () => {
    const raw = "https://i.ytimg.com/vi/x/maxresdefault.jpg";
    expect(nextFallbackVideoThumbnailUrl(raw)).toBe(
      "https://i.ytimg.com/vi/x/hqdefault.jpg",
    );
  });
});

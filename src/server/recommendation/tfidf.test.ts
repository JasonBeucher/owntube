import { describe, expect, it } from "vitest";
import { titleTfidfSimilarity, tokenize } from "@/server/recommendation/tfidf";

describe("tfidf", () => {
  it("tokenizes words", () => {
    expect(tokenize("Hello World! Testing")).toContain("hello");
    expect(tokenize("Hello World! Testing")).toContain("world");
    expect(tokenize("Hello World! Testing")).toContain("testing");
  });

  it("scores similar titles higher against corpus", () => {
    const corpus = [
      "rust programming tutorial",
      "learn rust async",
      "systems programming intro",
    ];
    const a = titleTfidfSimilarity("rust async programming", corpus);
    const b = titleTfidfSimilarity("cooking pasta recipes", corpus);
    expect(a).toBeGreaterThan(b);
  });
});

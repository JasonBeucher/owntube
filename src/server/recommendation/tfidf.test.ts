import { describe, expect, it } from "vitest";
import {
  buildTfidfModel,
  termFrequencyVector,
  titleTfidfSimilarity,
  tokenize,
} from "@/server/recommendation/tfidf";

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

  it("buildTfidfModel matches the legacy single-centroid helper", () => {
    const corpus = ["rust programming tutorial", "learn rust async"];
    const model = buildTfidfModel(corpus);
    expect(model.similarity("rust async")).toBeCloseTo(
      titleTfidfSimilarity("rust async", corpus),
      12,
    );
  });

  it("multi-centroid does not dilute a single-interest match", () => {
    const corpus = [
      "rust async runtime",
      "rust borrow checker",
      "sourdough bread baking",
      "pasta carbonara recipe",
    ];
    const single = buildTfidfModel(corpus);
    const grouped = buildTfidfModel(corpus, {
      groups: [
        ["rust async runtime", "rust borrow checker"],
        ["sourdough bread baking", "pasta carbonara recipe"],
      ],
    });
    const title = "rust async runtime internals";
    // The per-interest centroid should score the on-topic title at least as
    // high as the pooled centroid that mixes cooking + rust.
    expect(grouped.similarity(title)).toBeGreaterThanOrEqual(
      single.similarity(title),
    );
  });

  it("empty corpus yields zero similarity", () => {
    const model = buildTfidfModel([]);
    expect(model.isEmpty).toBe(true);
    expect(model.similarity("anything")).toBe(0);
  });

  it("termFrequencyVector counts tokens", () => {
    const vec = termFrequencyVector("rust rust async");
    expect(vec.get("rust")).toBe(2);
    expect(vec.get("async")).toBe(1);
  });
});

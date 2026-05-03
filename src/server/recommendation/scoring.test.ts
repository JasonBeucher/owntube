import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isLikelyShortVideo,
  publicationFreshnessScore,
  scoreCandidate,
  scoreCandidateDetail,
  watchedRepeatPenalty,
} from "@/server/recommendation/scoring";
import type { UserSignals } from "@/server/recommendation/signals";

function emptySignals(overrides: Partial<UserSignals> = {}): UserSignals {
  return {
    channelWeights: new Map(),
    totalWatches: 0,
    watchedVideoIds: new Set(),
    watchedVideoLastSeen: new Map(),
    distinctWatchesByChannel: new Map(),
    totalDistinctVideosWatched: 0,
    channelLastWatchedAt: new Map(),
    channelsOrderedByRecentWatch: [],
    historyChannelIds: new Set(),
    likedVideoIds: new Set(),
    dislikedVideoIds: new Set(),
    savedVideoIds: new Set(),
    interactionInterestChannelIds: new Set(),
    ...overrides,
  };
}

describe("scoring", () => {
  it("ranks more recently published text higher when parseable", () => {
    expect(publicationFreshnessScore("2 hours ago")).toBeGreaterThan(
      publicationFreshnessScore("5 days ago"),
    );
    expect(publicationFreshnessScore("1 day ago")).toBeGreaterThan(
      publicationFreshnessScore("21 days ago"),
    );
  });

  it("detects likely shorts from duration or title", () => {
    expect(
      isLikelyShortVideo({
        videoId: "a",
        title: "Clip",
        durationSeconds: 45,
      }),
    ).toBe(true);
    expect(
      isLikelyShortVideo({
        videoId: "b",
        title: "Something #shorts",
      }),
    ).toBe(true);
  });

  it("watched repeat penalty decays with age", () => {
    const now = 1_700_000_000;
    const last = new Map([["vid1", now - 60]]);
    const fresh = watchedRepeatPenalty("vid1", last, now);
    const old = watchedRepeatPenalty(
      "vid1",
      new Map([["vid1", now - 20 * 24 * 3600]]),
      now,
    );
    expect(fresh).toBeGreaterThan(old);
    expect(watchedRepeatPenalty("unknown", last, now)).toBe(0);
  });

  it("scoreCandidateDetail score matches scoreCandidate", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const video = {
      videoId: "v",
      channelId: "UC1",
      title: "Hello world",
      viewCount: 100,
      publishedText: "1 day ago",
    };
    const signals = emptySignals({
      channelWeights: new Map([["UC1", 3]]),
      totalWatches: 20,
    });
    const corpus = ["hello", "world"];
    const ctx = { recentCoverageByChannel: new Map([["UC1", 0.5]]) };
    const d = scoreCandidateDetail(video, signals, corpus, 3, ctx);
    const s = scoreCandidate(video, signals, corpus, 3, ctx);
    expect(d.score).toBeCloseTo(s, 12);
    const sum =
      d.breakdown.components.titleSimilarity +
      d.breakdown.components.channelAffinity +
      d.breakdown.components.popularity +
      d.breakdown.components.freshness +
      d.breakdown.components.repeatPenalty +
      d.breakdown.components.formatBias +
      d.breakdown.components.explore +
      d.breakdown.components.shareFromChannel +
      d.breakdown.components.catalogCoverage +
      d.breakdown.components.recentChannelBoost;
    expect(sum).toBeCloseTo(d.score, 12);
  });

  it("prefers long-form over shorts when other signals match", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const base = {
      videoId: "x",
      channelId: "UCsame",
      title: "Topic",
      viewCount: 1000,
      publishedText: "1 day ago",
    };
    const signals = emptySignals({
      channelWeights: new Map([["UCsame", 5]]),
    });
    const corpus = ["topic deep dive"];
    const shortScore = scoreCandidate(
      { ...base, title: "Topic #shorts", durationSeconds: 30 },
      signals,
      corpus,
      5,
    );
    const longScore = scoreCandidate(
      { ...base, title: "Topic deep dive", durationSeconds: 600 },
      signals,
      corpus,
      5,
    );
    expect(longScore).toBeGreaterThan(shortScore);
  });

  it("boosts channels that dominate distinct watch share and recent upload coverage", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const video = {
      videoId: "newVid",
      channelId: "UCfan",
      title: "Deadlock patch notes",
      viewCount: 500,
      publishedText: "1 day ago",
    };
    const baseSignals = emptySignals({
      channelWeights: new Map([["UCfan", 2]]),
      distinctWatchesByChannel: new Map([["UCfan", 8]]),
      totalDistinctVideosWatched: 10,
      watchedVideoLastSeen: new Map(),
    });
    const corpus = ["deadlock gameplay", "deadlock guide"];
    const low = scoreCandidate(video, baseSignals, corpus, 2, {
      recentCoverageByChannel: new Map([["UCfan", 0.1]]),
    });
    const high = scoreCandidate(video, baseSignals, corpus, 2, {
      recentCoverageByChannel: new Map([["UCfan", 0.9]]),
    });
    expect(high).toBeGreaterThan(low);
    const lowShare = scoreCandidate(
      { ...video, channelId: "UCother" },
      baseSignals,
      corpus,
      2,
      { recentCoverageByChannel: new Map() },
    );
    const fanShare = scoreCandidate(video, baseSignals, corpus, 2, {
      recentCoverageByChannel: new Map(),
    });
    expect(fanShare).toBeGreaterThan(lowShare);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

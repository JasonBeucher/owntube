"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  filterVideosBySessionDislikes,
  type SessionDislike,
} from "@/lib/taste-deck-filter";
import type { UnifiedVideo } from "@/server/services/proxy.types";
import { trpc } from "@/trpc/react";

type Step = "keywords" | "videos";

const SUGGESTED_KEYWORDS: readonly string[] = [
  "linux",
  "cooking",
  "gaming",
  "music",
  "tech",
  "science",
  "history",
  "cars",
  "diy",
  "movies",
  "photography",
  "fitness",
  "travel",
  "art",
];

function splitKeywords(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function dedupeKeywords(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of raw) {
    const t = k.trim();
    if (!t) continue;
    const low = t.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(t);
    if (out.length >= 24) break;
  }
  return out;
}

function ThumbsUpIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <title>Like</title>
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.96 2.4l-1.4 7A2 2 0 0 1 18.43 21H7V10l5-9 1.86 1.86a2 2 0 0 1 .54 2.02Z" />
    </svg>
  );
}

function ThumbsDownIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <title>Dislike</title>
      <path d="M17 14V2" />
      <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.96-2.4l1.4-7A2 2 0 0 1 5.57 3H17v11l-5 9-1.86-1.86A2 2 0 0 1 9.6 19.1Z" />
    </svg>
  );
}

function SkipIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <title>Skip</title>
      <polygon points="5 4 15 12 5 20 5 4" />
      <line x1="19" y1="5" x2="19" y2="19" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <title>Remove</title>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function TasteOnboardingClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const manual = searchParams.get("manual") === "1";

  const utils = trpc.useUtils();
  const settingsQuery = trpc.settings.get.useQuery();
  const saveKeywordsMutation = trpc.taste.saveKeywords.useMutation();
  const completeMutation = trpc.taste.complete.useMutation();
  const skipMutation = trpc.taste.skip.useMutation();
  const setInteractionMutation = trpc.interactions.set.useMutation();

  const [step, setStep] = useState<Step>("keywords");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [draftKeyword, setDraftKeyword] = useState("");
  const [keywordsSaved, setKeywordsSaved] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const deckInitialized = useRef(false);

  const [queue, setQueue] = useState<UnifiedVideo[]>([]);
  const [sessionDislikes, setSessionDislikes] = useState<SessionDislike[]>([]);
  const [answered, setAnswered] = useState(0);

  const deckQuery = trpc.taste.deck.useQuery(undefined, {
    enabled: step === "videos" && keywordsSaved,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
  });

  const current = queue[0];

  const goHome = useCallback(() => {
    void utils.settings.get.invalidate();
    void utils.feed.home.invalidate();
    router.push("/");
  }, [router, utils]);

  /** Allow seeding the queue again whenever we enter the videos step (avoids stale deckInitialized + empty React Query cache). */
  // biome-ignore lint/correctness/useExhaustiveDependencies: both deps intentional so Continue always re-seeds the deck.
  useEffect(() => {
    deckInitialized.current = false;
  }, [step, keywordsSaved]);

  useEffect(() => {
    if (!settingsQuery.isSuccess) return;
    if (manual) return;
    if (keywordsSaved || step !== "keywords") return;
    const s = settingsQuery.data;
    if (
      typeof s.tasteOnboardingCompletedAt === "number" ||
      typeof s.tasteOnboardingSkippedAt === "number"
    ) {
      router.replace("/");
    }
  }, [
    settingsQuery.isSuccess,
    settingsQuery.data,
    manual,
    router,
    keywordsSaved,
    step,
  ]);

  useEffect(() => {
    const stored = settingsQuery.data?.tasteKeywords;
    if (!stored?.length) return;
    setKeywords((prev) => (prev.length > 0 ? prev : dedupeKeywords(stored)));
  }, [settingsQuery.data?.tasteKeywords]);

  /** Seed queue from deck; if the deck is empty, finish here (same effect avoids a race where queue.length === 0 was read before setQueue committed). */
  useEffect(() => {
    if (step !== "videos" || !keywordsSaved) return;
    if (!deckQuery.isSuccess || !deckQuery.data) return;
    if (deckInitialized.current) return;
    deckInitialized.current = true;
    const raw = deckQuery.data.videos ?? [];
    const filtered = filterVideosBySessionDislikes(raw, []);
    setQueue(filtered);
  }, [step, keywordsSaved, deckQuery.isSuccess, deckQuery.data]);

  const addKeyword = (raw: string) => {
    const next = dedupeKeywords([...keywords, ...splitKeywords(raw)]);
    setKeywords(next);
    setDraftKeyword("");
  };

  const removeKeyword = (kw: string) => {
    setKeywords((prev) => prev.filter((k) => k !== kw));
  };

  const onKeywordKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (draftKeyword.trim().length > 0) addKeyword(draftKeyword);
    } else if (
      e.key === "Backspace" &&
      draftKeyword.length === 0 &&
      keywords.length > 0
    ) {
      const last = keywords[keywords.length - 1];
      if (last) removeKeyword(last);
    }
  };

  const remainingSuggestions = useMemo(() => {
    const have = new Set(keywords.map((k) => k.toLowerCase()));
    return SUGGESTED_KEYWORDS.filter((s) => !have.has(s.toLowerCase()));
  }, [keywords]);

  const onSkipEntirely = async () => {
    setMessage(null);
    try {
      await skipMutation.mutateAsync();
      goHome();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not skip.");
    }
  };

  const onSaveKeywordsContinue = async () => {
    setMessage(null);
    const merged = dedupeKeywords([
      ...keywords,
      ...splitKeywords(draftKeyword),
    ]);
    try {
      await saveKeywordsMutation.mutateAsync({ keywords: merged });
      await utils.taste.deck.reset();
      setKeywords(merged);
      setDraftKeyword("");
      setKeywordsSaved(true);
      setStep("videos");
      setSessionDislikes([]);
      setAnswered(0);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save keywords.");
    }
  };

  const onVideoVote = async (type: "like" | "dislike") => {
    const cur = queue[0];
    if (!cur) return;
    setMessage(null);
    try {
      await setInteractionMutation.mutateAsync({
        videoId: cur.videoId,
        channelId: cur.channelId,
        type,
        active: true,
      });
      const nextSession: SessionDislike[] =
        type === "dislike"
          ? [...sessionDislikes, { channelId: cur.channelId, title: cur.title }]
          : sessionDislikes;
      if (type === "dislike") setSessionDislikes(nextSession);
      setAnswered((n) => n + 1);

      await utils.taste.deck.invalidate();
      const d = await utils.taste.deck.fetch();
      const nextQueue = filterVideosBySessionDislikes(d.videos, nextSession);
      setQueue(nextQueue);
      if (nextQueue.length === 0) {
        await completeMutation.mutateAsync();
        goHome();
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save choice.");
    }
  };

  const onSkipVideo = () => {
    setQueue((q) => q.slice(1));
    setAnswered((n) => n + 1);
  };

  const onFinishVideosEarly = async () => {
    setMessage(null);
    try {
      await completeMutation.mutateAsync();
      goHome();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not finish.");
    }
  };

  const totalToRate = answered + queue.length;
  const progressPct =
    totalToRate > 0 ? Math.round((answered / totalToRate) * 100) : 0;

  const blockedChannelLabels = useMemo(() => {
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const d of sessionDislikes) {
      if (!d.channelId) continue;
      if (seen.has(d.channelId)) continue;
      seen.add(d.channelId);
      const cur = queue.find((q) => q.channelId === d.channelId);
      labels.push(cur?.channelName ?? d.channelId);
    }
    return labels.slice(-4);
  }, [sessionDislikes, queue]);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 py-2">
      <header className="space-y-3">
        <div className="flex items-center justify-between gap-3 text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          <span>Step {step === "keywords" ? "1" : "2"} of 2</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void onSkipEntirely()}
            disabled={skipMutation.isPending}
          >
            Skip all
          </Button>
        </div>
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-[hsl(var(--muted))]"
          aria-hidden
        >
          <div
            className="h-full rounded-full bg-[hsl(var(--primary))] transition-all duration-300"
            style={{ width: step === "keywords" ? "50%" : "100%" }}
          />
        </div>
      </header>

      {step === "keywords" ? (
        <section className="space-y-6 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-extrabold tracking-tight">
              What do you actually watch?
            </h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Topics you add here are mixed with your watch history to bias the
              home feed. You can change them later in Settings.
            </p>
          </div>

          {keywords.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="Selected topics">
              {keywords.map((kw) => (
                <li key={kw}>
                  <button
                    type="button"
                    onClick={() => removeKeyword(kw)}
                    className="group inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--primary)_/_0.4)] bg-[hsl(var(--primary)_/_0.12)] px-3 py-1 text-sm font-medium text-[hsl(var(--primary))] transition-colors hover:bg-[hsl(var(--primary)_/_0.2)]"
                    aria-label={`Remove ${kw}`}
                  >
                    {kw}
                    <span className="grid h-3.5 w-3.5 place-items-center text-[hsl(var(--primary))] opacity-70 group-hover:opacity-100">
                      <CloseIcon />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="space-y-2">
            <label
              htmlFor="taste-kw"
              className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]"
            >
              Add a topic
            </label>
            <div className="flex gap-2">
              <Input
                id="taste-kw"
                value={draftKeyword}
                onChange={(e) => setDraftKeyword(e.target.value)}
                onKeyDown={onKeywordKeyDown}
                placeholder="e.g. retro gaming, jazz guitar, kubernetes"
                autoComplete="off"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => addKeyword(draftKeyword)}
                disabled={draftKeyword.trim().length === 0}
              >
                Add
              </Button>
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Press Enter or comma to add. Backspace removes the last one.
            </p>
          </div>

          {remainingSuggestions.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Suggestions
              </p>
              <ul className="flex flex-wrap gap-2">
                {remainingSuggestions.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => addKeyword(s)}
                      className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.5)] px-3 py-1 text-sm capitalize text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--primary)_/_0.5)] hover:bg-[hsl(var(--primary)_/_0.08)] hover:text-[hsl(var(--primary))]"
                    >
                      + {s}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <Button
              type="button"
              size="lg"
              className="flex-1"
              onClick={() => void onSaveKeywordsContinue()}
              disabled={saveKeywordsMutation.isPending}
            >
              {saveKeywordsMutation.isPending ? "Saving…" : "Continue"}
            </Button>
          </div>
        </section>
      ) : null}

      {step === "videos" ? (
        <section className="space-y-5">
          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold tracking-tight">
              Rate a few videos
            </h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Like to see more like it. Dislike hides the channel and similar
              titles for the rest of this session.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-[hsl(var(--muted))]"
              aria-hidden
            >
              <div
                className="h-full rounded-full bg-[hsl(var(--primary))] transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="font-mono text-xs tabular-nums text-[hsl(var(--muted-foreground))]">
              {answered}/{totalToRate || 0}
            </span>
          </div>

          {deckQuery.isLoading ? (
            <div className="grid gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-sm">
              <div className="aspect-video w-full animate-pulse rounded-xl bg-[hsl(var(--muted)_/_0.6)]" />
              <div className="space-y-2">
                <div className="h-4 w-4/5 animate-pulse rounded bg-[hsl(var(--muted)_/_0.6)]" />
                <div className="h-3 w-2/5 animate-pulse rounded bg-[hsl(var(--muted)_/_0.6)]" />
              </div>
            </div>
          ) : deckQuery.isError ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600">
              {deckQuery.error.message ||
                "Could not load videos. Try again later or check your instance settings."}
            </p>
          ) : deckQuery.isSuccess &&
            (deckQuery.data?.videos?.length ?? 0) === 0 ? (
            <div className="space-y-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] p-4 text-sm text-[hsl(var(--muted-foreground))]">
              <p>
                Nothing to rate right now: the personalized pool is empty, or
                every suggestion was already in your likes, dislikes, or saves.
                Check your instance URLs in Settings, watch a few videos so we
                can pull from your channels, then try Retry.
              </p>
              {deckQuery.data?.warning ? (
                <p className="text-xs opacity-90">{deckQuery.data.warning}</p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  deckInitialized.current = false;
                  void deckQuery.refetch();
                }}
                disabled={deckQuery.isFetching}
              >
                {deckQuery.isFetching ? "Loading…" : "Retry"}
              </Button>
            </div>
          ) : !current ? (
            <div className="space-y-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.4)] p-4 text-sm text-[hsl(var(--muted-foreground))]">
              <p>No clip in the queue right now.</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  deckInitialized.current = false;
                  void deckQuery.refetch();
                }}
                disabled={deckQuery.isFetching}
              >
                {deckQuery.isFetching ? "Loading…" : "Reload deck"}
              </Button>
            </div>
          ) : (
            <article className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm">
              <div className="relative aspect-video w-full bg-black">
                {current.thumbnailUrl ? (
                  // biome-ignore lint/performance/noImgElement: arbitrary upstream thumbnail hosts
                  <img
                    src={current.thumbnailUrl}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : null}
                <div
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/70 to-transparent"
                  aria-hidden
                />
                {current.publishedText ? (
                  <span className="absolute right-3 top-3 rounded-full bg-black/65 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
                    {current.publishedText}
                  </span>
                ) : null}
                <div className="absolute inset-x-0 bottom-0 space-y-1 p-4 text-white">
                  <p className="line-clamp-2 text-base font-semibold leading-snug">
                    {current.title}
                  </p>
                  {current.channelName ? (
                    <p className="text-xs text-white/80">
                      {current.channelName}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 p-3">
                <Button
                  type="button"
                  className="h-12"
                  onClick={() => void onVideoVote("like")}
                  disabled={setInteractionMutation.isPending}
                >
                  <ThumbsUpIcon />
                  Like
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-12"
                  onClick={() => void onVideoVote("dislike")}
                  disabled={setInteractionMutation.isPending}
                >
                  <ThumbsDownIcon />
                  Dislike
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-12"
                  onClick={onSkipVideo}
                  disabled={setInteractionMutation.isPending}
                >
                  <SkipIcon />
                  Skip
                </Button>
              </div>
            </article>
          )}

          {blockedChannelLabels.length > 0 ? (
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] p-3 text-xs text-[hsl(var(--muted-foreground))]">
              <span className="font-medium text-[hsl(var(--foreground))]">
                Hidden this session:
              </span>{" "}
              {blockedChannelLabels.join(" · ")}
            </div>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => void onFinishVideosEarly()}
            disabled={completeMutation.isPending}
          >
            Done — save what I&apos;ve rated
          </Button>
        </section>
      ) : null}

      {message ? (
        <p
          className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600"
          role="alert"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

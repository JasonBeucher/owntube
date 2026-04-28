import { createHash } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { invidiousPortCollidesWithNextApp } from "@/lib/invidious-port-collision";
import { logger } from "@/lib/logger";
import {
  coercePublishedSecondsFromUpstream,
  parseRelativePublishedToUnix,
} from "@/lib/published-sort-key";
import type { AppDb } from "@/server/db/client";
import { videoCache } from "@/server/db/schema";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import {
  type ChannelPageInput,
  type ChannelPageResult,
  cachedChannelPayloadSchema,
  cachedSearchPayloadSchema,
  cachedTrendingPayloadSchema,
  channelPageResultSchema,
  type RelatedVideosResult,
  relatedVideosResultSchema,
  type SearchVideosInput,
  type SearchVideosResult,
  searchVideosResultSchema,
  type TrendingInput,
  type TrendingVideosResult,
  trendingVideosResultSchema,
  type UnifiedVideo,
  unifiedVideoSchema,
  type VideoDetail,
  type VideoDetailInput,
  videoDetailSchema,
} from "@/server/services/proxy.types";
import { acquireUpstreamSlot } from "@/server/services/rate-limiter";
import { upstreamGetText } from "@/server/services/upstream-get";

const CACHE_TTL_SEC = 6 * 60 * 60;
/** Invidious/Piped HLS and DASH URLs expire quickly; long TTL serves dead 404 manifests. */
const STREAMS_DETAIL_CACHE_TTL_SEC = 3 * 60;
const FETCH_TIMEOUT_MS = 20_000;
const inFlightTrending = new Map<string, Promise<TrendingVideosResult>>();
const inFlightChannel = new Map<string, Promise<ChannelPageResult>>();

export type ProxySourceOverrides = {
  pipedBaseUrl?: string | null;
  invidiousBaseUrl?: string | null;
};

/** Cache rows store the real upstream name (`piped` / `invidious`), never `"cache"`. */
function liveUpstreamSource(
  label: "piped" | "invidious" | "cache",
): "piped" | "invidious" {
  if (label === "cache") {
    throw new Error("proxy: write path received cache source label");
  }
  return label;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Invidious often returns paths like `/api/v1/manifest/...` — resolve against the instance base. */
function resolveInvidiousAbsoluteMediaUrl(
  pathOrUrl: string | undefined,
  baseUrl: string,
): string | undefined {
  if (typeof pathOrUrl !== "string") return undefined;
  const t = pathOrUrl.trim();
  if (!t) return undefined;
  if (t.startsWith("http://") || t.startsWith("https://")) return t;
  if (t.startsWith("//")) return `https:${t}`;
  const base = normalizeBaseUrl(baseUrl);
  if (t.startsWith("/")) return `${base}${t}`;
  return undefined;
}

/**
 * Docker often publishes `127.0.0.1:port` only; Node may resolve `localhost` to `::1` and fail.
 * Use IPv4 loopback for outbound fetches and for absolute URLs sent to the browser in dev.
 */
function normalizeInvidiousOutboundBase(base: string): string {
  try {
    const u = new URL(base);
    if (u.hostname === "localhost") {
      u.hostname = "127.0.0.1";
    }
    return normalizeBaseUrl(u.toString());
  } catch {
    return normalizeBaseUrl(base);
  }
}

function invidiousBaseFromEnv(): string {
  const raw = process.env.INVIDIOUS_BASE_URL?.trim();
  if (!raw) return "";
  return normalizeInvidiousOutboundBase(normalizeBaseUrl(raw));
}

function resolveProxyBases(overrides?: ProxySourceOverrides): {
  pipedBase: string;
  invidiousBase: string;
} {
  const pipedCandidate = overrides?.pipedBaseUrl?.trim();
  const pipedRaw =
    pipedCandidate !== undefined
      ? pipedCandidate
      : process.env.PIPED_BASE_URL?.trim();
  const pipedBase =
    pipedRaw && pipedRaw !== "disabled" ? normalizeBaseUrl(pipedRaw) : "";

  const invidiousCandidate = overrides?.invidiousBaseUrl?.trim();
  const invidiousBase =
    invidiousCandidate !== undefined
      ? invidiousCandidate
        ? normalizeInvidiousOutboundBase(normalizeBaseUrl(invidiousCandidate))
        : ""
      : invidiousBaseFromEnv();

  return { pipedBase, invidiousBase };
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function searchCacheKey(input: SearchVideosInput): string {
  const h = createHash("sha256")
    .update(
      JSON.stringify({
        v: 2,
        kind: "search",
        q: input.q,
        limit: input.limit ?? 20,
        c: input.continuation ?? null,
      }),
    )
    .digest("hex");
  return `search:v2:${h}`;
}

function detailCacheKey(input: VideoDetailInput): string {
  const h = createHash("sha256")
    .update(JSON.stringify({ v: 4, kind: "streams", videoId: input.videoId }))
    .digest("hex");
  return `streams:v4:${h}`;
}

function relatedCacheKey(input: VideoDetailInput): string {
  const h = createHash("sha256")
    .update(JSON.stringify({ v: 2, kind: "related", videoId: input.videoId }))
    .digest("hex");
  return `related:v2:${h}`;
}

function trendingCacheKey(input: TrendingInput): string {
  const h = createHash("sha256")
    .update(
      JSON.stringify({
        v: 3,
        kind: "trending",
        region: input.region.toUpperCase(),
        limit: input.limit ?? 40,
        category: input.category ?? null,
      }),
    )
    .digest("hex");
  return `trending:v3:${h}`;
}

function channelCacheKey(input: ChannelPageInput): string {
  const h = createHash("sha256")
    .update(
      JSON.stringify({
        v: 2,
        kind: "channel",
        channelId: input.channelId,
        c: input.continuation ?? null,
      }),
    )
    .digest("hex");
  return `channel:v2:${h}`;
}

function extractVideoIdFromUrl(url: string): string | undefined {
  const m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  const m2 = url.match(
    /(?:youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  );
  if (m2) return m2[1];
  return undefined;
}

function channelIdFromPath(
  uploaderUrl: string | undefined,
): string | undefined {
  if (!uploaderUrl) return undefined;
  const m = uploaderUrl.match(/\/channel\/([^/?#]+)/);
  if (m) return decodeURIComponent(m[1]);
  return undefined;
}

function pipedRootItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.items)) return o.items;
    if (Array.isArray(o.results)) return o.results;
  }
  return [];
}

function pipedNextPage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const n = o.nextpage;
  if (typeof n === "string" && n.length > 0) return n;
  return null;
}

/** Piped / Invidious sometimes send counts as strings, alternate keys, or localized numbers. */
function parseViewCountValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const t = value.replace(/\u202f|\s/g, "").trim();
    if (!t) return undefined;
    const compact = /^([\d,.]+)\s*([kKmMbB])?$/;
    const m = compact.exec(t);
    if (m) {
      const base = Number(m[1].replace(/,/g, ""));
      if (!Number.isFinite(base) || base < 0) return undefined;
      const suf = (m[2] ?? "").toLowerCase();
      const mult =
        suf === "k" ? 1e3 : suf === "m" ? 1e6 : suf === "b" ? 1e9 : 1;
      return Math.floor(base * mult);
    }
    const n = Number(t.replace(/,/g, ""));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  }
  return undefined;
}

function pickViewCount(o: Record<string, unknown>): number | undefined {
  const keys = ["views", "viewCount", "view_count"] as const;
  let zeroish: number | undefined;
  for (const k of keys) {
    const n = parseViewCountValue(o[k]);
    if (n !== undefined && n > 0) return n;
    if (n === 0 && zeroish === undefined) zeroish = 0;
  }
  return zeroish;
}

/** Piped list items (search, trending, related) often include uploader avatar on each item. */
function pickPipedUploaderAvatar(
  o: Record<string, unknown>,
  pipedBase: string,
): string | undefined {
  const stringKeys = [
    "uploaderAvatar",
    "uploader_avatar",
    "channelAvatarUrl",
  ] as const;
  for (const key of stringKeys) {
    const raw = o[key];
    if (typeof raw !== "string") continue;
    const u = resolveInvidiousAbsoluteMediaUrl(raw, pipedBase);
    if (u?.startsWith("http")) return u;
  }
  for (const key of ["uploaderAvatars", "avatars"] as const) {
    const u = resolveInvidiousThumbnail(o[key], pipedBase);
    if (u?.startsWith("http")) return u;
  }
  return undefined;
}

function reconcilePublishedAtWithText(
  publishedAt: number | undefined,
  publishedText: string | undefined,
): number | undefined {
  if (!publishedText?.trim()) return publishedAt;
  const now = Math.floor(Date.now() / 1000);
  const fromText = parseRelativePublishedToUnix(publishedText, now);
  if (fromText === undefined) return publishedAt;
  if (publishedAt === undefined) return fromText;
  // Some instances return a mismatched numeric timestamp (often "too recent").
  // If delta is large, trust relative text for consistency in feed ordering/labels.
  if (Math.abs(publishedAt - fromText) > 2 * 3600) return fromText;
  return publishedAt;
}

function mapPipedItem(raw: unknown, pipedBase = ""): UnifiedVideo | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const t = typeof o.type === "string" ? o.type.toLowerCase() : "";
  if (t && t !== "stream" && t !== "video") return null;
  const url = typeof o.url === "string" ? o.url : "";
  const title = typeof o.title === "string" ? o.title : "";
  const videoId = extractVideoIdFromUrl(url);
  if (!videoId || !title) return null;
  const thumbnail = typeof o.thumbnail === "string" ? o.thumbnail : undefined;
  const duration =
    typeof o.duration === "number" && Number.isFinite(o.duration)
      ? o.duration
      : undefined;
  const viewCount = pickViewCount(o);
  const publishedText =
    typeof o.uploadedDate === "string" ? o.uploadedDate : undefined;
  const publishedAt =
    coercePublishedSecondsFromUpstream(o.uploaded) ??
    coercePublishedSecondsFromUpstream(o.time) ??
    coercePublishedSecondsFromUpstream(o.timestamp) ??
    coercePublishedSecondsFromUpstream(o.published);
  const reconciledPublishedAt = reconcilePublishedAtWithText(
    publishedAt,
    publishedText,
  );
  const channelName =
    typeof o.uploaderName === "string"
      ? o.uploaderName
      : typeof o.uploader === "string"
        ? o.uploader
        : undefined;
  const uploaderUrl =
    typeof o.uploaderUrl === "string" ? o.uploaderUrl : undefined;
  const channelId = channelIdFromPath(uploaderUrl);
  const channelAvatarUrl = pickPipedUploaderAvatar(o, pipedBase);
  const parsed = unifiedVideoSchema.safeParse({
    videoId,
    title,
    channelId,
    channelName,
    channelAvatarUrl,
    thumbnailUrl: thumbnail,
    durationSeconds: duration,
    viewCount,
    publishedText,
    publishedAt: reconciledPublishedAt,
  });
  if (!parsed.success) return null;
  return parsed.data;
}

function resolveInvidiousThumbnail(
  thumbs: unknown,
  baseUrl: string,
): string | undefined {
  if (!Array.isArray(thumbs)) return undefined;
  const preferred = [
    "maxresdefault",
    "sddefault",
    "high",
    "medium",
    "default",
    "low",
    "maxres",
    "hq720",
    "hqdefault",
    "mqdefault",
  ];
  const candidates = new Map<string, string>();
  let bestByWidth: { w: number; url: string } | undefined;
  const base = normalizeBaseUrl(baseUrl);
  for (const thumb of thumbs) {
    if (!thumb || typeof thumb !== "object") continue;
    const t = thumb as Record<string, unknown>;
    const u = typeof t.url === "string" ? t.url : "";
    const q = typeof t.quality === "string" ? t.quality : "";
    const wRaw = t.width;
    const w =
      typeof wRaw === "number" && Number.isFinite(wRaw) && wRaw > 0 ? wRaw : 0;
    if (!u) continue;
    const resolved = resolveInvidiousAbsoluteMediaUrl(u, base);
    if (!resolved?.startsWith("http")) continue;
    if (q) candidates.set(q, resolved);
    if (w > 0 && (!bestByWidth || w > bestByWidth.w)) {
      bestByWidth = { w, url: resolved };
    }
  }
  if (bestByWidth && bestByWidth.w >= 48) return bestByWidth.url;
  for (const q of preferred) {
    if (candidates.has(q)) return candidates.get(q);
  }
  return bestByWidth?.url ?? candidates.values().next().value;
}

function mapInvidiousItem(raw: unknown, baseUrl = ""): UnifiedVideo | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.type !== "video") return null;
  const videoId = typeof o.videoId === "string" ? o.videoId : "";
  const title = typeof o.title === "string" ? o.title : "";
  if (!videoId || !title) return null;
  const thumbnailUrl = resolveInvidiousThumbnail(o.videoThumbnails, baseUrl);
  const durationSeconds =
    typeof o.lengthSeconds === "number" && Number.isFinite(o.lengthSeconds)
      ? o.lengthSeconds
      : undefined;
  const viewCount = pickViewCount(o);
  const publishedText =
    typeof o.publishedText === "string" ? o.publishedText : undefined;
  const publishedAt =
    coercePublishedSecondsFromUpstream(o.published) ??
    coercePublishedSecondsFromUpstream(o.publishedAt) ??
    coercePublishedSecondsFromUpstream(o.timestamp) ??
    coercePublishedSecondsFromUpstream(o.premiereTimestamp);
  const reconciledPublishedAt = reconcilePublishedAtWithText(
    publishedAt,
    publishedText,
  );
  const channelName = typeof o.author === "string" ? o.author : undefined;
  const channelId = typeof o.authorId === "string" ? o.authorId : undefined;
  const channelAvatarUrl = resolveInvidiousThumbnail(
    o.authorThumbnails,
    baseUrl,
  );
  const parsed = unifiedVideoSchema.safeParse({
    videoId,
    title,
    channelId,
    channelName,
    channelAvatarUrl,
    thumbnailUrl,
    durationSeconds,
    viewCount,
    publishedText,
    publishedAt: reconciledPublishedAt,
  });
  if (!parsed.success) return null;
  return parsed.data;
}

type FetchJsonOptions = {
  /**
   * Some upstreams (notably Invidious `/api/v1/videos/{id}/related`) return 2xx with a
   * completely empty body instead of `[]` when there are no related items.
   */
  emptyBodyAs?: unknown;
};

async function fetchJson(
  url: string,
  options?: FetchJsonOptions,
): Promise<unknown> {
  const { status, ok, text } = await upstreamGetText(url, FETCH_TIMEOUT_MS);
  const trimmed = text.trim();
  if (!ok) {
    const hint = trimmed.slice(0, 240);
    throw new Error(
      hint ? `HTTP ${status}: ${hint}` : `HTTP ${status} (empty body)`,
    );
  }
  if (!trimmed) {
    if (options?.emptyBodyAs !== undefined) {
      return options.emptyBodyAs;
    }
    throw new Error(
      `HTTP ${status} with empty body (expected JSON from upstream)`,
    );
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch (e) {
    const isHtml = trimmed.startsWith("<");
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      isHtml
        ? `Invalid JSON (upstream returned HTML): ${msg}; start: ${trimmed.slice(0, 120)}`
        : `Invalid JSON: ${msg}; start: ${trimmed.slice(0, 120)}`,
    );
  }
}

function toUnixText(seconds: unknown): string | undefined {
  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    return `${Math.floor(seconds)}s`;
  }
  return undefined;
}

function buildPipedSearchUrl(base: string, input: SearchVideosInput): string {
  const u = new URL("/search", `${base}/`);
  u.searchParams.set("q", input.q);
  u.searchParams.set("filter", "videos");
  if (input.continuation) {
    u.searchParams.set("nextpage", input.continuation);
  }
  return u.toString();
}

function buildInvidiousSearchUrl(
  base: string,
  input: SearchVideosInput,
): string {
  const u = new URL("/api/v1/search", `${base}/`);
  u.searchParams.set("q", input.q);
  u.searchParams.set("type", "video");
  const page =
    input.continuation && /^\d+$/.test(input.continuation)
      ? input.continuation
      : "1";
  u.searchParams.set("page", page);
  return u.toString();
}

function readFreshCacheRow(db: AppDb, key: string) {
  return db
    .select()
    .from(videoCache)
    .where(
      and(eq(videoCache.cacheKey, key), gt(videoCache.expiresAt, nowUnix())),
    )
    .limit(1)
    .all()[0];
}

function readLatestCacheRow(db: AppDb, key: string) {
  return db
    .select()
    .from(videoCache)
    .where(eq(videoCache.cacheKey, key))
    .orderBy(desc(videoCache.fetchedAt))
    .limit(1)
    .all()[0];
}

function readFreshSearchCache(
  db: AppDb,
  key: string,
): SearchVideosResult | null {
  const row = readFreshCacheRow(db, key);
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  const parsed = cachedSearchPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  logger.info("video_cache.hit", { cacheKey: key, kind: row.kind });
  return {
    videos: parsed.data.videos,
    continuation: parsed.data.continuation,
    sourceUsed: "cache",
    stale: false,
  };
}

function readStaleSearchCache(
  db: AppDb,
  key: string,
): SearchVideosResult | null {
  const row = readLatestCacheRow(db, key);
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  const parsed = cachedSearchPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  logger.warn("video_cache.stale_hit", { cacheKey: key, kind: row.kind });
  return {
    videos: parsed.data.videos,
    continuation: parsed.data.continuation,
    sourceUsed: "cache",
    stale: true,
    warning: "Upstream unavailable, serving stale cache.",
  };
}

function cacheTtlSecForKind(
  kind: "search" | "streams" | "related" | "trending" | "channel",
): number {
  return kind === "streams" ? STREAMS_DETAIL_CACHE_TTL_SEC : CACHE_TTL_SEC;
}

/** Persists a live upstream response. `payload` is JSON-serialized as stored (never a stale `sourceUsed: "cache"` row). */
function writeCache(
  db: AppDb,
  key: string,
  source: "piped" | "invidious",
  payload: unknown,
  kind: "search" | "streams" | "related" | "trending" | "channel",
): void {
  const t = nowUnix();
  const ttl = cacheTtlSecForKind(kind);
  const row = {
    cacheKey: key,
    source,
    kind,
    payloadJson: JSON.stringify(payload),
    fetchedAt: t,
    expiresAt: t + ttl,
  };
  db.insert(videoCache)
    .values(row)
    .onConflictDoUpdate({
      target: videoCache.cacheKey,
      set: {
        payloadJson: row.payloadJson,
        source: row.source,
        kind: row.kind,
        fetchedAt: row.fetchedAt,
        expiresAt: row.expiresAt,
      },
    })
    .run();
  logger.info("video_cache.write", {
    cacheKey: key,
    kind,
    source,
    ttlSec: ttl,
  });
}

function parsePipedSearch(
  data: unknown,
  limit: number,
  pipedBase: string,
): { videos: UnifiedVideo[]; continuation: string | null } {
  const items = pipedRootItems(data);
  const videos: UnifiedVideo[] = [];
  for (const item of items) {
    const v = mapPipedItem(item, pipedBase);
    if (v) videos.push(v);
    if (videos.length >= limit) break;
  }
  return { videos, continuation: pipedNextPage(data) };
}

function parseInvidiousSearch(
  data: unknown,
  limit: number,
  page: number,
  baseUrl: string,
): { videos: UnifiedVideo[]; continuation: string | null } {
  if (!Array.isArray(data)) return { videos: [], continuation: null };
  const videos: UnifiedVideo[] = [];
  for (const item of data) {
    const v = mapInvidiousItem(item, baseUrl);
    if (v) videos.push(v);
    if (videos.length >= limit) break;
  }
  const continuation = videos.length >= limit ? String(page + 1) : null;
  return { videos, continuation };
}

export async function searchVideos(
  db: AppDb,
  input: SearchVideosInput,
  overrides?: ProxySourceOverrides,
): Promise<SearchVideosResult> {
  const parsedInput = input;
  const limit = parsedInput.limit ?? 20;
  const key = searchCacheKey(parsedInput);

  const cached = readFreshSearchCache(db, key);
  if (cached) return cached;

  const { pipedBase, invidiousBase } = resolveProxyBases(overrides);

  const errors: string[] = [];

  const tryPiped = async (): Promise<SearchVideosResult | null> => {
    if (!pipedBase) return null;
    try {
      acquireUpstreamSlot();
      const url = buildPipedSearchUrl(pipedBase, parsedInput);
      logger.info("proxy.piped.request", {
        url: url.replace(parsedInput.q, "[q]"),
      });
      const json = await fetchJson(url);
      const { videos, continuation } = parsePipedSearch(json, limit, pipedBase);
      const result: SearchVideosResult = {
        videos,
        continuation,
        sourceUsed: "piped",
      };
      const safe = searchVideosResultSchema.parse(result);
      return safe;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`piped:${msg}`);
      logger.warn("proxy.piped.failed", { message: msg });
      return null;
    }
  };

  const tryInvidious = async (): Promise<SearchVideosResult | null> => {
    if (!invidiousBase) return null;
    if (invidiousPortCollidesWithNextApp(invidiousBase)) {
      errors.push(
        "invidious:INVIDIOUS_BASE_URL uses the same loopback port as this Next.js server (PORT). Server fetch would hit OwnTube itself (404 on /api/v1/...). Run Invidious on another port (e.g. 3001 in docker-compose) or start Next on a different port (e.g. pnpm dev -- -p 3000).",
      );
      return null;
    }
    try {
      acquireUpstreamSlot();
      const page =
        parsedInput.continuation && /^\d+$/.test(parsedInput.continuation)
          ? Number.parseInt(parsedInput.continuation, 10)
          : 1;
      const url = buildInvidiousSearchUrl(invidiousBase, {
        ...parsedInput,
        continuation: String(page),
      });
      logger.info("proxy.invidious.request", {
        url: url.replace(parsedInput.q, "[q]"),
      });
      const json = await fetchJson(url);
      const { videos, continuation } = parseInvidiousSearch(
        json,
        limit,
        page,
        invidiousBase,
      );
      const result: SearchVideosResult = {
        videos,
        continuation,
        sourceUsed: "invidious",
      };
      return searchVideosResultSchema.parse(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`invidious:${msg}`);
      logger.warn("proxy.invidious.failed", { message: msg });
      return null;
    }
  };

  let resolved = await tryPiped();
  if (!resolved || resolved.videos.length === 0) {
    const fromInv = await tryInvidious();
    if (fromInv) {
      resolved = fromInv;
    }
  }

  if (!resolved || resolved.videos.length === 0) {
    const stale = readStaleSearchCache(db, key);
    if (stale) return stale;
    throw new UpstreamUnavailableError(errors.join("; ") || "no results");
  }
  writeCache(
    db,
    key,
    liveUpstreamSource(resolved.sourceUsed),
    resolved,
    "search",
  );
  return resolved;
}

function pickVideoThumbnail(thumbnails: unknown): string | undefined {
  if (!Array.isArray(thumbnails)) return undefined;
  for (const item of thumbnails) {
    if (!item || typeof item !== "object") continue;
    const maybe = (item as { url?: unknown }).url;
    if (typeof maybe === "string" && maybe.startsWith("http")) return maybe;
  }
  return undefined;
}

function readPositiveNumberField(
  o: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const v = o[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    if (typeof v === "string") {
      const n = Number.parseFloat(v);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return undefined;
}

/** Invidious/Piped `height` / Invidious `size` ("1280x720"); includes 0 if API sends it. */
function readStreamHeightPx(stream: Record<string, unknown>): number | undefined {
  const h = stream.height;
  if (typeof h === "number" && Number.isFinite(h) && h >= 0) return Math.round(h);
  if (typeof h === "string") {
    const n = Number.parseInt(h.trim(), 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const sz = stream.size;
  if (typeof sz === "string") {
    const m = sz.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (m) {
      const px = Number.parseInt(m[2] ?? "", 10);
      if (Number.isFinite(px) && px > 0) return px;
    }
  }
  return undefined;
}

function mapPipedStream(data: unknown, pipedBase: string): VideoDetail | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const videoId =
    typeof o.videoId === "string"
      ? o.videoId
      : extractVideoIdFromUrl(String(o.url ?? ""));
  const title = typeof o.title === "string" ? o.title : "";
  if (!videoId || !title) return null;

  const audioStreams = Array.isArray(o.audioStreams) ? o.audioStreams : [];
  const videoStreams = Array.isArray(o.videoStreams) ? o.videoStreams : [];
  const audioSources = audioStreams
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const stream = item as Record<string, unknown>;
      const url = typeof stream.url === "string" ? stream.url : "";
      if (!url.startsWith("http")) return null;
      const bitrate = readPositiveNumberField(stream, [
        "bitrate",
        "averageBitrate",
      ]);
      const fps = readPositiveNumberField(stream, ["fps", "frameRate"]);
      return {
        url,
        mimeType:
          typeof stream.mimeType === "string" ? stream.mimeType : undefined,
        quality:
          typeof stream.quality === "string" ? stream.quality : undefined,
        bitrate,
        fps,
        language:
          typeof stream.language === "string"
            ? stream.language
            : typeof stream.lang === "string"
              ? stream.lang
              : typeof stream.audioLanguage === "string"
                ? stream.audioLanguage
                : undefined,
        audioTrackDisplayName:
          typeof stream.audioTrackName === "string"
            ? stream.audioTrackName
            : typeof stream.audioTrackDisplayName === "string"
              ? stream.audioTrackDisplayName
              : undefined,
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  const videoSources = videoStreams
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const stream = item as Record<string, unknown>;
      const url = typeof stream.url === "string" ? stream.url : "";
      if (!url.startsWith("http")) return null;
      const bitrate = readPositiveNumberField(stream, [
        "bitrate",
        "averageBitrate",
      ]);
      const fps = readPositiveNumberField(stream, ["fps", "frameRate"]);
      const height = readStreamHeightPx(stream);
      return {
        url,
        mimeType:
          typeof stream.mimeType === "string" ? stream.mimeType : undefined,
        quality:
          typeof stream.quality === "string" ? stream.quality : undefined,
        bitrate,
        fps,
        height,
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  const detail = {
    videoId,
    title,
    description: typeof o.description === "string" ? o.description : undefined,
    channelId: typeof o.uploaderId === "string" ? o.uploaderId : undefined,
    channelName: typeof o.uploader === "string" ? o.uploader : undefined,
    channelAvatarUrl: pickPipedUploaderAvatar(o, pipedBase),
    thumbnailUrl:
      typeof o.thumbnailUrl === "string"
        ? o.thumbnailUrl
        : pickVideoThumbnail(o.thumbnails),
    durationSeconds:
      typeof o.duration === "number" && Number.isFinite(o.duration)
        ? Math.floor(o.duration)
        : undefined,
    viewCount: pickViewCount(o),
    publishedText:
      typeof o.uploadDate === "string" ? o.uploadDate : toUnixText(o.uploaded),
    hlsUrl: typeof o.hls === "string" ? o.hls : undefined,
    dashUrl: typeof o.dash === "string" ? o.dash : undefined,
    audioSources,
    videoSources,
    sourceUsed: "piped" as const,
  };
  const parsed = videoDetailSchema.safeParse(detail);
  if (!parsed.success) return null;
  return parsed.data;
}

function invidiousAdaptiveMimeIsAudio(mime: string | undefined): boolean {
  if (!mime) return false;
  return mime.toLowerCase().trim().startsWith("audio/");
}

function readInvidiousAdaptiveAudioMeta(st: Record<string, unknown>): {
  language?: string;
  displayName?: string;
} {
  const at = st.audioTrack;
  if (at && typeof at === "object") {
    const t = at as Record<string, unknown>;
    const displayName =
      typeof t.displayName === "string" ? t.displayName : undefined;
    let language: string | undefined;
    if (typeof t.id === "string" && t.id.length > 0) {
      language = t.id.replace(/^\./, "").split(".")[0];
    } else if (typeof t.languageCode === "string") {
      language = t.languageCode;
    } else if (typeof t.language === "string") {
      language = t.language;
    }
    return { displayName, language };
  }
  if (typeof st.audioTrackId === "string" && st.audioTrackId.length > 0) {
    return {
      language: st.audioTrackId.replace(/^\./, "").split(/[.]/)[0],
    };
  }

  const lang =
    typeof st.language === "string"
      ? st.language
      : typeof st.lang === "string"
        ? st.lang
        : typeof st.audioLanguage === "string"
          ? st.audioLanguage
          : undefined;
  const displayName =
    typeof st.audioTrackDisplayName === "string"
      ? st.audioTrackDisplayName
      : typeof st.name === "string"
        ? st.name
        : undefined;
  if (lang || displayName) return { language: lang, displayName };

  const ql = typeof st.qualityLabel === "string" ? st.qualityLabel.trim() : "";
  if (
    ql &&
    !/^(tiny|low|light|medium|high|small|144p|240p|360p|480p|720p|1080p)/i.test(
      ql,
    )
  ) {
    return { displayName: ql };
  }

  return {};
}

type InvidiousStream = {
  url: string;
  mimeType: string | undefined;
  quality: string | undefined;
  videoOnly: boolean;
  bitrate?: number;
  fps?: number;
  height?: number;
};

function mapInvidiousStreamItem(
  item: unknown,
  baseUrl: string,
  videoOnly: boolean,
): InvidiousStream | null {
  if (!item || typeof item !== "object") return null;
  const stream = item as Record<string, unknown>;
  const rawUrl = typeof stream.url === "string" ? stream.url : "";
  const url = resolveInvidiousAbsoluteMediaUrl(rawUrl, baseUrl);
  if (!url) return null;
  const type = typeof stream.type === "string" ? stream.type : undefined;
  const quality =
    typeof stream.qualityLabel === "string"
      ? stream.qualityLabel
      : typeof stream.quality === "string"
        ? stream.quality
        : undefined;
  const bitrate = readPositiveNumberField(stream, [
    "bitrate",
    "averageBitrate",
  ]);
  const fps = readPositiveNumberField(stream, ["fps", "frameRate"]);
  const height = readStreamHeightPx(stream);
  return { url, mimeType: type, quality, videoOnly, bitrate, fps, height };
}

function mapInvidiousVideo(data: unknown, baseUrl = ""): VideoDetail | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const videoId = typeof o.videoId === "string" ? o.videoId : "";
  const title = typeof o.title === "string" ? o.title : "";
  if (!videoId || !title) return null;
  const formatStreams = Array.isArray(o.formatStreams) ? o.formatStreams : [];
  const adaptiveFormats = Array.isArray(o.adaptiveFormats)
    ? o.adaptiveFormats
    : [];
  const fromFormat = formatStreams
    .map((item) => mapInvidiousStreamItem(item, baseUrl, false))
    .filter((value): value is InvidiousStream => Boolean(value));

  const fromAdaptiveVideo: InvidiousStream[] = [];
  const audioFromAdaptive: {
    url: string;
    mimeType: string | undefined;
    quality: string | undefined;
    bitrate?: number;
    fps?: number;
    language?: string;
    audioTrackDisplayName?: string;
  }[] = [];
  for (const item of adaptiveFormats) {
    if (!item || typeof item !== "object") continue;
    const st = item as Record<string, unknown>;
    const mime = typeof st.type === "string" ? st.type : undefined;
    if (invidiousAdaptiveMimeIsAudio(mime)) {
      const m = mapInvidiousStreamItem(item, baseUrl, false);
      if (m) {
        const meta = readInvidiousAdaptiveAudioMeta(st);
        audioFromAdaptive.push({
          url: m.url,
          mimeType: m.mimeType,
          quality: m.quality,
          bitrate: m.bitrate,
          fps: m.fps,
          language: meta.language,
          audioTrackDisplayName: meta.displayName,
        });
      }
    } else {
      const m = mapInvidiousStreamItem(item, baseUrl, true);
      if (m) fromAdaptiveVideo.push(m);
    }
  }

  const videoSources: InvidiousStream[] = [...fromFormat, ...fromAdaptiveVideo];

  const hlsResolved = resolveInvidiousAbsoluteMediaUrl(
    typeof o.hlsUrl === "string" ? o.hlsUrl : undefined,
    baseUrl,
  );
  const dashResolved = resolveInvidiousAbsoluteMediaUrl(
    typeof o.dashUrl === "string" ? o.dashUrl : undefined,
    baseUrl,
  );

  const detail = {
    videoId,
    title,
    description: typeof o.description === "string" ? o.description : undefined,
    channelId: typeof o.authorId === "string" ? o.authorId : undefined,
    channelName: typeof o.author === "string" ? o.author : undefined,
    channelAvatarUrl: resolveInvidiousThumbnail(o.authorThumbnails, baseUrl),
    thumbnailUrl: resolveInvidiousThumbnail(o.videoThumbnails, baseUrl),
    durationSeconds:
      typeof o.lengthSeconds === "number" && Number.isFinite(o.lengthSeconds)
        ? Math.floor(o.lengthSeconds)
        : undefined,
    viewCount: pickViewCount(o),
    publishedText:
      typeof o.publishedText === "string"
        ? o.publishedText
        : toUnixText(o.published),
    hlsUrl: hlsResolved,
    dashUrl: dashResolved,
    audioSources: audioFromAdaptive,
    videoSources,
    sourceUsed: "invidious" as const,
  };
  const parsed = videoDetailSchema.safeParse(detail);
  if (!parsed.success) return null;
  return parsed.data;
}

function readFreshDetailCache(db: AppDb, key: string): VideoDetail | null {
  const row = readFreshCacheRow(db, key);
  if (!row) return null;
  const parsed = videoDetailSchema.safeParse(
    JSON.parse(row.payloadJson) as unknown,
  );
  if (!parsed.success) return null;
  logger.info("video_cache.hit", { cacheKey: key, kind: row.kind });
  return { ...parsed.data, sourceUsed: "cache", stale: false };
}

function readStaleDetailCache(db: AppDb, key: string): VideoDetail | null {
  const row = readLatestCacheRow(db, key);
  if (!row) return null;
  const parsed = videoDetailSchema.safeParse(
    JSON.parse(row.payloadJson) as unknown,
  );
  if (!parsed.success) return null;
  logger.warn("video_cache.stale_hit", { cacheKey: key, kind: row.kind });
  return {
    ...parsed.data,
    sourceUsed: "cache",
    stale: true,
    warning: "Upstream unavailable, serving stale cache.",
  };
}

function readFreshRelatedCache(
  db: AppDb,
  key: string,
): RelatedVideosResult | null {
  const row = readFreshCacheRow(db, key);
  if (!row) return null;
  const parsed = relatedVideosResultSchema.safeParse(
    JSON.parse(row.payloadJson) as unknown,
  );
  if (!parsed.success) return null;
  logger.info("video_cache.hit", { cacheKey: key, kind: row.kind });
  return { ...parsed.data, sourceUsed: "cache", stale: false };
}

function readStaleRelatedCache(
  db: AppDb,
  key: string,
): RelatedVideosResult | null {
  const row = readLatestCacheRow(db, key);
  if (!row) return null;
  const parsed = relatedVideosResultSchema.safeParse(
    JSON.parse(row.payloadJson) as unknown,
  );
  if (!parsed.success) return null;
  logger.warn("video_cache.stale_hit", { cacheKey: key, kind: row.kind });
  return {
    ...parsed.data,
    sourceUsed: "cache",
    stale: true,
    warning: "Upstream unavailable, serving stale cache.",
  };
}

function buildPipedStreamsUrl(base: string, videoId: string): string {
  return new URL(
    `/streams/${encodeURIComponent(videoId)}`,
    `${base}/`,
  ).toString();
}

function buildInvidiousVideosUrl(base: string, videoId: string): string {
  return new URL(
    `/api/v1/videos/${encodeURIComponent(videoId)}`,
    `${base}/`,
  ).toString();
}

function buildPipedRelatedUrl(base: string, videoId: string): string {
  return new URL(
    `/streams/${encodeURIComponent(videoId)}/related`,
    `${base}/`,
  ).toString();
}

function buildInvidiousRelatedUrl(base: string, videoId: string): string {
  return new URL(
    `/api/v1/videos/${encodeURIComponent(videoId)}/related`,
    `${base}/`,
  ).toString();
}

export type FetchVideoDetailOptions = {
  /**
   * When true, skip the SQLite “fresh” row for this video so Invidious/Piped
   * return a new `hlsUrl` and adaptive URLs (signed links go 404 quickly).
   */
  bypassDetailCache?: boolean;
};

export type FetchChannelPageOptions = {
  /** Force a live upstream read instead of using the fresh channel cache row. */
  bypassChannelCache?: boolean;
};

export async function fetchVideoDetail(
  db: AppDb,
  input: VideoDetailInput,
  overrides?: ProxySourceOverrides,
  opts?: FetchVideoDetailOptions,
): Promise<VideoDetail> {
  const key = detailCacheKey(input);
  if (!opts?.bypassDetailCache) {
    const cached = readFreshDetailCache(db, key);
    if (cached) return cached;
  }

  const { pipedBase, invidiousBase } = resolveProxyBases(overrides);
  const errors: string[] = [];

  let resolved: VideoDetail | null = null;
  if (pipedBase) {
    try {
      acquireUpstreamSlot();
      const json = await fetchJson(
        buildPipedStreamsUrl(pipedBase, input.videoId),
      );
      resolved = mapPipedStream(json, pipedBase);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`piped:${msg}`);
    }
  }
  if (!resolved && invidiousBase) {
    if (invidiousPortCollidesWithNextApp(invidiousBase)) {
      errors.push(
        "invidious:INVIDIOUS_BASE_URL port conflicts with Next.js PORT (server would call itself).",
      );
    } else {
      try {
        acquireUpstreamSlot();
        const json = await fetchJson(
          buildInvidiousVideosUrl(invidiousBase, input.videoId),
        );
        resolved = mapInvidiousVideo(json, invidiousBase);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`invidious:${msg}`);
      }
    }
  }

  if (!resolved) {
    const stale = readStaleDetailCache(db, key);
    if (stale) return stale;
    throw new UpstreamUnavailableError(
      errors.join("; ") || "video detail unavailable",
    );
  }

  writeCache(
    db,
    key,
    liveUpstreamSource(resolved.sourceUsed),
    resolved,
    "streams",
  );
  return resolved;
}

function parseRelatedFromPiped(
  data: unknown,
  limit: number,
  pipedBase: string,
): UnifiedVideo[] {
  const items = pipedRootItems(data);
  const videos: UnifiedVideo[] = [];
  for (const item of items) {
    const mapped = mapPipedItem(item, pipedBase);
    if (mapped) videos.push(mapped);
    if (videos.length >= limit) break;
  }
  return videos;
}

function parseRelatedFromInvidious(
  data: unknown,
  limit: number,
  baseUrl: string,
): UnifiedVideo[] {
  if (!Array.isArray(data)) return [];
  const videos: UnifiedVideo[] = [];
  for (const item of data) {
    const mapped = mapInvidiousItem(item, baseUrl);
    if (mapped) videos.push(mapped);
    if (videos.length >= limit) break;
  }
  return videos;
}

async function relatedVideosFromSameUploader(
  db: AppDb,
  input: VideoDetailInput,
  limit: number,
  overrides?: ProxySourceOverrides,
): Promise<UnifiedVideo[] | null> {
  try {
    const detail = await fetchVideoDetail(db, input, overrides);
    const channelId = detail.channelId;
    if (!channelId) return null;
    const page = await fetchChannelPage(db, { channelId }, overrides);
    const list = page.videos.filter((v) => v.videoId !== input.videoId);
    if (list.length === 0) return null;
    return list.slice(0, limit);
  } catch {
    return null;
  }
}

export async function fetchRelatedVideos(
  db: AppDb,
  input: VideoDetailInput,
  limit = 20,
  overrides?: ProxySourceOverrides,
): Promise<RelatedVideosResult> {
  const key = relatedCacheKey(input);
  const cached = readFreshRelatedCache(db, key);
  if (cached) return cached;

  const { pipedBase, invidiousBase } = resolveProxyBases(overrides);
  const errors: string[] = [];

  let resolved: RelatedVideosResult | null = null;
  if (pipedBase) {
    try {
      acquireUpstreamSlot();
      const json = await fetchJson(
        buildPipedRelatedUrl(pipedBase, input.videoId),
        { emptyBodyAs: [] },
      );
      resolved = relatedVideosResultSchema.parse({
        videos: parseRelatedFromPiped(json, limit, pipedBase),
        sourceUsed: "piped",
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`piped:${msg}`);
    }
  }

  if ((!resolved || resolved.videos.length === 0) && invidiousBase) {
    if (invidiousPortCollidesWithNextApp(invidiousBase)) {
      errors.push(
        "invidious:INVIDIOUS_BASE_URL port conflicts with Next.js PORT (server would call itself).",
      );
    } else {
      try {
        acquireUpstreamSlot();
        const json = await fetchJson(
          buildInvidiousRelatedUrl(invidiousBase, input.videoId),
          { emptyBodyAs: [] },
        );
        resolved = relatedVideosResultSchema.parse({
          videos: parseRelatedFromInvidious(json, limit, invidiousBase),
          sourceUsed: "invidious",
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`invidious:${msg}`);
      }
    }
  }

  if (!resolved) {
    const stale = readStaleRelatedCache(db, key);
    if (stale) return stale;
    throw new UpstreamUnavailableError(
      errors.join("; ") || "related videos unavailable",
    );
  }

  if (resolved.videos.length === 0) {
    const fallback = await relatedVideosFromSameUploader(
      db,
      input,
      limit,
      overrides,
    );
    if (fallback && fallback.length > 0) {
      resolved = {
        videos: fallback,
        sourceUsed: resolved.sourceUsed,
        warning:
          "This instance returned no related list; showing recent uploads from the same channel.",
      };
    }
  }

  if (resolved.videos.length > 0) {
    writeCache(
      db,
      key,
      liveUpstreamSource(resolved.sourceUsed),
      resolved,
      "related",
    );
  }
  return resolved;
}

/* -------------------------------------------------------------------------- */
/* Trending                                                                   */
/* -------------------------------------------------------------------------- */

function readFreshTrendingCache(
  db: AppDb,
  key: string,
): TrendingVideosResult | null {
  const row = readFreshCacheRow(db, key);
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  const parsed = cachedTrendingPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  logger.info("video_cache.hit", { cacheKey: key, kind: row.kind });
  return {
    videos: parsed.data.videos,
    sourceUsed: "cache",
    stale: false,
  };
}

function readStaleTrendingCache(
  db: AppDb,
  key: string,
): TrendingVideosResult | null {
  const row = readLatestCacheRow(db, key);
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  const parsed = cachedTrendingPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  logger.warn("video_cache.stale_hit", { cacheKey: key, kind: row.kind });
  return {
    videos: parsed.data.videos,
    sourceUsed: "cache",
    stale: true,
    warning: "Upstream unavailable, serving stale cache.",
  };
}

function buildPipedTrendingUrl(
  base: string,
  region: string,
  category?: string,
): string {
  const u = new URL("/trending", `${normalizeBaseUrl(base)}/`);
  u.searchParams.set("region", region.toUpperCase());
  if (category) u.searchParams.set("type", category);
  return u.toString();
}

function buildInvidiousTrendingUrl(
  base: string,
  region: string,
  category?: string,
): string {
  const u = new URL("/api/v1/trending", `${normalizeBaseUrl(base)}/`);
  u.searchParams.set("region", region.toUpperCase());
  if (category) u.searchParams.set("type", category);
  return u.toString();
}

function parsePipedTrending(
  data: unknown,
  limit: number,
  pipedBase: string,
): UnifiedVideo[] {
  const items = Array.isArray(data) ? data : pipedRootItems(data);
  const videos: UnifiedVideo[] = [];
  for (const item of items) {
    const m = mapPipedItem(item, pipedBase);
    if (m) videos.push(m);
    if (videos.length >= limit) break;
  }
  return videos;
}

function parseInvidiousTrending(
  data: unknown,
  limit: number,
  invidiousBase: string,
): UnifiedVideo[] {
  if (!Array.isArray(data)) return [];
  const videos: UnifiedVideo[] = [];
  for (const item of data) {
    const m = mapInvidiousItem(item, invidiousBase);
    if (m) videos.push(m);
    if (videos.length >= limit) break;
  }
  return videos;
}

export async function fetchTrendingVideos(
  db: AppDb,
  input: TrendingInput,
  overrides?: ProxySourceOverrides,
): Promise<TrendingVideosResult> {
  const region = input.region.toUpperCase();
  const limit = Math.min(200, input.limit ?? 40);
  const key = trendingCacheKey({ region, limit, category: input.category });
  const fresh = readFreshTrendingCache(db, key);
  if (fresh) return fresh;
  const inFlight = inFlightTrending.get(key);
  if (inFlight) return inFlight;

  const task = (async (): Promise<TrendingVideosResult> => {
    const { pipedBase, invidiousBase } = resolveProxyBases(overrides);
    const errors: string[] = [];

    let resolved: TrendingVideosResult | null = null;

    if (pipedBase) {
      try {
        acquireUpstreamSlot();
        const json = await fetchJson(
          buildPipedTrendingUrl(pipedBase, region, input.category),
          {
            emptyBodyAs: [],
          },
        );
        const videos = parsePipedTrending(json, limit, pipedBase);
        if (videos.length > 0) {
          resolved = trendingVideosResultSchema.parse({
            videos,
            sourceUsed: "piped",
          });
        }
      } catch (e) {
        errors.push(`piped:${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if ((!resolved || resolved.videos.length === 0) && invidiousBase) {
      if (invidiousPortCollidesWithNextApp(invidiousBase)) {
        errors.push("invidious:port collision with Next.js");
      } else {
        try {
          acquireUpstreamSlot();
          const json = await fetchJson(
            buildInvidiousTrendingUrl(invidiousBase, region, input.category),
            { emptyBodyAs: [] },
          );
          const videos = parseInvidiousTrending(json, limit, invidiousBase);
          if (videos.length > 0) {
            resolved = trendingVideosResultSchema.parse({
              videos,
              sourceUsed: "invidious",
            });
          }
        } catch (e) {
          errors.push(
            `invidious:${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }

    if (!resolved || resolved.videos.length === 0) {
      const stale = readStaleTrendingCache(db, key);
      if (stale) return stale;
      throw new UpstreamUnavailableError(
        errors.join("; ") || "trending unavailable",
      );
    }

    const store = {
      videos: resolved.videos,
      sourceUsed: liveUpstreamSource(resolved.sourceUsed),
    };
    writeCache(db, key, store.sourceUsed, store, "trending");
    return resolved;
  })();
  inFlightTrending.set(key, task);
  try {
    return await task;
  } finally {
    inFlightTrending.delete(key);
  }
}

/* -------------------------------------------------------------------------- */
/* Channel                                                                    */
/* -------------------------------------------------------------------------- */

function readFreshChannelCache(
  db: AppDb,
  key: string,
): ChannelPageResult | null {
  const row = readFreshCacheRow(db, key);
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  const parsed = cachedChannelPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  logger.info("video_cache.hit", { cacheKey: key, kind: row.kind });
  return {
    ...parsed.data,
    sourceUsed: "cache",
    stale: false,
  };
}

function readStaleChannelCache(
  db: AppDb,
  key: string,
): ChannelPageResult | null {
  const row = readLatestCacheRow(db, key);
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  const parsed = cachedChannelPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  logger.warn("video_cache.stale_hit", { cacheKey: key, kind: row.kind });
  return {
    ...parsed.data,
    sourceUsed: "cache",
    stale: true,
    warning: "Upstream unavailable, serving stale cache.",
  };
}

function buildPipedChannelUrl(base: string, channelId: string): string {
  return new URL(
    `/channel/${encodeURIComponent(channelId)}`,
    `${normalizeBaseUrl(base)}/`,
  ).toString();
}

function buildPipedChannelNextUrl(
  base: string,
  channelId: string,
  continuation: string,
): string {
  const u = new URL(
    `/nextpage/channel/${encodeURIComponent(channelId)}`,
    `${normalizeBaseUrl(base)}/`,
  );
  u.searchParams.set("nextpage", continuation);
  return u.toString();
}

function buildInvidiousChannelMetaUrl(base: string, channelId: string): string {
  return new URL(
    `/api/v1/channels/${encodeURIComponent(channelId)}`,
    `${normalizeBaseUrl(base)}/`,
  ).toString();
}

function buildInvidiousChannelVideosUrl(
  base: string,
  channelId: string,
  continuation?: string,
): string {
  const u = new URL(
    `/api/v1/channels/${encodeURIComponent(channelId)}/videos`,
    `${normalizeBaseUrl(base)}/`,
  );
  if (continuation) u.searchParams.set("continuation", continuation);
  return u.toString();
}

function pipedChannelNextContinuation(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const n = (data as Record<string, unknown>).nextpage;
  if (typeof n === "string" && n.length > 0) return n;
  return null;
}

/** Piped `/channel/{id}` payloads vary by instance; avatar may be missing on the root but present on items. */
function pickPipedChannelAvatarUrl(
  o: Record<string, unknown>,
  pipedBase: string,
): string | undefined {
  const stringCandidates = [
    o.avatarUrl,
    o.avatar,
    o.uploaderAvatar,
    o.thumbnailUrl,
  ];
  for (const raw of stringCandidates) {
    if (typeof raw !== "string") continue;
    const u = resolveInvidiousAbsoluteMediaUrl(raw, pipedBase);
    if (u?.startsWith("http")) return u;
  }
  for (const key of ["avatars", "authorThumbnails", "thumbnails"] as const) {
    const u = resolveInvidiousThumbnail(o[key], pipedBase);
    if (u?.startsWith("http")) return u;
  }
  const streams = Array.isArray(o.relatedStreams) ? o.relatedStreams : [];
  for (const item of streams) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const ua = s.uploaderAvatar;
    if (typeof ua === "string") {
      const u = resolveInvidiousAbsoluteMediaUrl(ua, pipedBase);
      if (u?.startsWith("http")) return u;
    }
  }
  return undefined;
}

function pickPipedChannelBannerUrl(
  o: Record<string, unknown>,
  pipedBase: string,
): string | undefined {
  const stringCandidates = [o.bannerUrl, o.banner, o.authorBanner];
  for (const raw of stringCandidates) {
    if (typeof raw !== "string") continue;
    const u = resolveInvidiousAbsoluteMediaUrl(raw, pipedBase);
    if (u?.startsWith("http")) return u;
  }
  const u = resolveInvidiousThumbnail(o.banners ?? o.authorBanners, pipedBase);
  if (u?.startsWith("http")) return u;
  return undefined;
}

function parsePipedChannelPage(
  data: unknown,
  channelId: string,
  pipedBase: string,
): ChannelPageResult | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name : "";
  const id = typeof o.id === "string" && o.id.length > 0 ? o.id : channelId;
  const description =
    typeof o.description === "string" ? o.description : undefined;
  const avatarUrl = pickPipedChannelAvatarUrl(o, pipedBase);
  const bannerUrl = pickPipedChannelBannerUrl(o, pipedBase);
  const subscriberCount =
    typeof o.subscriberCount === "number" && Number.isFinite(o.subscriberCount)
      ? Math.round(o.subscriberCount)
      : undefined;
  const streams = Array.isArray(o.relatedStreams) ? o.relatedStreams : [];
  const videos: UnifiedVideo[] = [];
  for (const item of streams) {
    const m = mapPipedItem(item, pipedBase);
    if (m) videos.push(m);
  }
  if (!name && videos.length === 0) return null;
  const continuation = pipedChannelNextContinuation(data);
  return channelPageResultSchema.parse({
    channelId: id,
    name: name || "Channel",
    description,
    avatarUrl,
    bannerUrl,
    subscriberCount,
    videos,
    continuation,
    sourceUsed: "piped",
  });
}

function parsePipedChannelContinuation(
  data: unknown,
  channelId: string,
  pipedBase: string,
): ChannelPageResult | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const streams = Array.isArray(o.relatedStreams) ? o.relatedStreams : [];
  const videos: UnifiedVideo[] = [];
  for (const item of streams) {
    const m = mapPipedItem(item, pipedBase);
    if (m) videos.push(m);
  }
  const continuation = pipedChannelNextContinuation(data);
  return channelPageResultSchema.parse({
    channelId,
    videos,
    continuation,
    sourceUsed: "piped",
  });
}

function parseInvidiousChannelCombined(
  meta: unknown,
  videosPayload: unknown,
  channelId: string,
  invidiousBase: string,
): ChannelPageResult | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  const name =
    typeof m.author === "string"
      ? m.author
      : typeof m.title === "string"
        ? m.title
        : "";
  const description =
    typeof m.description === "string" ? m.description : undefined;
  const avatarUrl = resolveInvidiousThumbnail(
    m.authorThumbnails,
    invidiousBase,
  );
  const bannerUrl = resolveInvidiousThumbnail(m.authorBanners, invidiousBase);
  let subscriberCount: number | undefined;
  if (typeof m.subCount === "number" && Number.isFinite(m.subCount)) {
    subscriberCount = Math.round(m.subCount);
  }
  const videos: UnifiedVideo[] = [];
  let continuation: string | null = null;
  if (videosPayload && typeof videosPayload === "object") {
    const vp = videosPayload as Record<string, unknown>;
    const arr = Array.isArray(vp.videos) ? vp.videos : [];
    for (const item of arr) {
      const v = mapInvidiousItem(item, invidiousBase);
      if (v) videos.push(v);
    }
    const c = vp.continuation;
    if (typeof c === "string" && c.length > 0) continuation = c;
  }
  const id =
    typeof m.authorId === "string" && m.authorId.length > 0
      ? m.authorId
      : channelId;
  if (!name && videos.length === 0) return null;
  return channelPageResultSchema.parse({
    channelId: id,
    name: name || "Channel",
    description,
    avatarUrl,
    bannerUrl,
    subscriberCount,
    videos,
    continuation,
    sourceUsed: "invidious",
  });
}

function parseInvidiousChannelVideosContinuation(
  videosPayload: unknown,
  channelId: string,
  invidiousBase: string,
): ChannelPageResult | null {
  if (!videosPayload || typeof videosPayload !== "object") return null;
  const vp = videosPayload as Record<string, unknown>;
  const arr = Array.isArray(vp.videos) ? vp.videos : [];
  const videos: UnifiedVideo[] = [];
  for (const item of arr) {
    const v = mapInvidiousItem(item, invidiousBase);
    if (v) videos.push(v);
  }
  let continuation: string | null = null;
  const c = vp.continuation;
  if (typeof c === "string" && c.length > 0) continuation = c;
  if (videos.length === 0) return null;
  return channelPageResultSchema.parse({
    channelId,
    videos,
    continuation,
    sourceUsed: "invidious",
  });
}

export async function fetchChannelPage(
  db: AppDb,
  input: ChannelPageInput,
  overrides?: ProxySourceOverrides,
  opts?: FetchChannelPageOptions,
): Promise<ChannelPageResult> {
  const key = channelCacheKey(input);
  if (!opts?.bypassChannelCache) {
    const fresh = readFreshChannelCache(db, key);
    if (fresh) return fresh;
  }
  const inFlight = inFlightChannel.get(key);
  if (inFlight) return inFlight;

  const task = (async (): Promise<ChannelPageResult> => {
    const { pipedBase, invidiousBase } = resolveProxyBases(overrides);
    const errors: string[] = [];

    let resolved: ChannelPageResult | null = null;

    if (pipedBase) {
      try {
        acquireUpstreamSlot();
        const url = input.continuation
          ? buildPipedChannelNextUrl(
              pipedBase,
              input.channelId,
              input.continuation,
            )
          : buildPipedChannelUrl(pipedBase, input.channelId);
        const json = await fetchJson(url);
        resolved = input.continuation
          ? parsePipedChannelContinuation(json, input.channelId, pipedBase)
          : parsePipedChannelPage(json, input.channelId, pipedBase);
      } catch (e) {
        errors.push(`piped:${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (!resolved && invidiousBase) {
      if (invidiousPortCollidesWithNextApp(invidiousBase)) {
        errors.push("invidious:port collision with Next.js");
      } else {
        try {
          if (input.continuation) {
            acquireUpstreamSlot();
            const json = await fetchJson(
              buildInvidiousChannelVideosUrl(
                invidiousBase,
                input.channelId,
                input.continuation,
              ),
            );
            resolved = parseInvidiousChannelVideosContinuation(
              json,
              input.channelId,
              invidiousBase,
            );
          } else {
            acquireUpstreamSlot();
            acquireUpstreamSlot();
            const metaUrl = buildInvidiousChannelMetaUrl(
              invidiousBase,
              input.channelId,
            );
            const videosUrl = buildInvidiousChannelVideosUrl(
              invidiousBase,
              input.channelId,
            );
            const [metaJson, videosJson] = await Promise.all([
              fetchJson(metaUrl),
              fetchJson(videosUrl),
            ]);
            resolved = parseInvidiousChannelCombined(
              metaJson,
              videosJson,
              input.channelId,
              invidiousBase,
            );
          }
        } catch (e) {
          errors.push(
            `invidious:${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }

    if (!resolved) {
      const stale = readStaleChannelCache(db, key);
      if (stale) return stale;
      throw new UpstreamUnavailableError(
        errors.join("; ") || "channel unavailable",
      );
    }

    const store = {
      channelId: resolved.channelId,
      name: resolved.name,
      description: resolved.description,
      avatarUrl: resolved.avatarUrl,
      bannerUrl: resolved.bannerUrl,
      subscriberCount: resolved.subscriberCount,
      videos: resolved.videos,
      continuation: resolved.continuation ?? null,
      sourceUsed: liveUpstreamSource(resolved.sourceUsed),
    };
    writeCache(db, key, store.sourceUsed, store, "channel");
    return resolved;
  })();
  inFlightChannel.set(key, task);
  try {
    return await task;
  } finally {
    inFlightChannel.delete(key);
  }
}

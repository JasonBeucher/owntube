import type { UnifiedVideo } from "@/server/services/proxy.types";

const UNIT_SECONDS_EN: Record<string, number> = {
  second: 1,
  minute: 60,
  hour: 3600,
  day: 86400,
  week: 604_800,
  month: 2_592_000,
  year: 31_536_000,
};

const UNIT_SECONDS_FR: Record<string, number> = {
  seconde: 1,
  minute: 60,
  heure: 3600,
  jour: 86400,
  semaine: 604_800,
  mois: 2_592_000,
  année: 31_536_000,
};

/** Ignore bogus "epoch-like" values (e.g. `uploaded=3600` meaning "seconds ago"). */
const MIN_REASONABLE_PUBLISHED_UNIX = 1_100_000_000; // ~2004-11
const MAX_REASONABLE_PUBLISHED_UNIX = 2_200_000_000; // ~2040-09

function normalizePublishedUnix(raw: number): number | undefined {
  let s = Math.floor(raw);
  if (s > 1_000_000_000_000) s = Math.floor(s / 1000);
  if (s >= MIN_REASONABLE_PUBLISHED_UNIX && s < MAX_REASONABLE_PUBLISHED_UNIX) {
    return s;
  }
  return undefined;
}

/** Normalise les timestamps upstream (secondes ou millisecondes, parfois en chaîne). */
export function coercePublishedSecondsFromUpstream(
  raw: unknown,
): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return normalizePublishedUnix(raw);
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (/^\d+$/.test(t)) {
      return coercePublishedSecondsFromUpstream(Number.parseInt(t, 10));
    }
    const p = Date.parse(t);
    if (!Number.isNaN(p)) return Math.floor(p / 1000);
  }
  return undefined;
}

/** Estime une date unix à partir de textes du type « 3 days ago » / « il y a 2 heures ». */
export function parseRelativePublishedToUnix(
  text: string,
  nowSec: number,
): number | undefined {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return undefined;

  const en = t.match(
    /(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/i,
  );
  if (en) {
    const n = Number.parseInt(en[1], 10);
    const u = en[2].toLowerCase();
    const mult = UNIT_SECONDS_EN[u];
    if (Number.isFinite(n) && mult) return nowSec - n * mult;
  }

  const fr = t.match(
    /il\s+y\s+a\s+(\d+)\s*(seconde|minute|heure|jour|semaine|mois|année)s?/i,
  );
  if (fr) {
    const n = Number.parseInt(fr[1], 10);
    let u = fr[2].toLowerCase();
    if (u !== "mois" && u.endsWith("s")) u = u.slice(0, -1);
    const mult = UNIT_SECONDS_FR[u];
    if (Number.isFinite(n) && mult) return nowSec - n * mult;
  }

  if (/^just\s+now$/i.test(t) || /^à\s+l['’]instant$/i.test(t)) {
    return nowSec - 30;
  }

  return undefined;
}

/** Secondes unix pour le tri (plus récent = plus grand). */
export function publishedSortKey(v: UnifiedVideo, nowSec?: number): number {
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  if (typeof v.publishedAt === "number" && Number.isFinite(v.publishedAt)) {
    const normalized = normalizePublishedUnix(v.publishedAt);
    if (normalized !== undefined) return normalized;
  }
  const text = v.publishedText?.trim();
  if (text) {
    const rel = parseRelativePublishedToUnix(text, now);
    if (rel !== undefined) return rel;
    const parsed = Date.parse(text);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  }
  return 0;
}

export function newerPublished(
  a: UnifiedVideo,
  b: UnifiedVideo,
  nowSec?: number,
): number {
  const ka = publishedSortKey(a, nowSec);
  const kb = publishedSortKey(b, nowSec);
  if (kb !== ka) return kb - ka;
  return a.videoId.localeCompare(b.videoId);
}

export type PickNewestPerChannelOptions = {
  nowSec?: number;
  /**
   * Max uploads kept per channel (newest first by `publishedSortKey`).
   * Default 10 — enough for the reco pool / infinite scroll; use 1 to keep only
   * the single newest candidate per channel.
   */
  maxPerChannel?: number;
};

/**
 * For each `channelId`, keep the `maxPerChannel` most recently published
 * videos (default 10). Entries without `channelId` are all kept. Trims stale
 * duplicates from the same channel while preserving pool depth for pagination.
 */
export function pickNewestVideoPerChannel(
  videos: readonly UnifiedVideo[],
  options?: PickNewestPerChannelOptions,
): UnifiedVideo[] {
  const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1000);
  const maxPerChannel = Math.max(
    1,
    Math.min(36, options?.maxPerChannel ?? 10),
  );
  const byChannel = new Map<string, UnifiedVideo[]>();
  const withoutChannel: UnifiedVideo[] = [];
  for (const v of videos) {
    if (!v.channelId || v.channelId.length === 0) {
      withoutChannel.push(v);
      continue;
    }
    let list = byChannel.get(v.channelId);
    if (!list) {
      list = [];
      byChannel.set(v.channelId, list);
    }
    list.push(v);
  }
  const out: UnifiedVideo[] = [...withoutChannel];
  for (const arr of byChannel.values()) {
    const sorted = [...arr].sort((a, b) => {
      const d = publishedSortKey(b, nowSec) - publishedSortKey(a, nowSec);
      if (d !== 0) return d;
      return a.videoId.localeCompare(b.videoId);
    });
    out.push(...sorted.slice(0, maxPerChannel));
  }
  const seen = new Set<string>();
  return out.filter((v) => {
    if (seen.has(v.videoId)) return false;
    seen.add(v.videoId);
    return true;
  });
}

/** Tri type flux abonnements : date décroissante, puis évite d'enchaîner sur la même chaîne si dates égales. */
export function compareSubscriptionHeads(
  a: { subscriptionChannelId: string; v: UnifiedVideo },
  b: { subscriptionChannelId: string; v: UnifiedVideo },
  lastSubscriptionChannelId: string | undefined,
  nowSec: number,
): number {
  const ka = publishedSortKey(a.v, nowSec);
  const kb = publishedSortKey(b.v, nowSec);
  if (kb !== ka) return kb - ka;
  if (lastSubscriptionChannelId) {
    const aLast = a.subscriptionChannelId === lastSubscriptionChannelId ? 1 : 0;
    const bLast = b.subscriptionChannelId === lastSubscriptionChannelId ? 1 : 0;
    if (aLast !== bLast) return aLast - bLast;
  }
  return a.v.videoId.localeCompare(b.v.videoId);
}

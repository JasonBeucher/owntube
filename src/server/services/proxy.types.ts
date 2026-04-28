import { z } from "zod";

export const searchVideosInputSchema = z.object({
  q: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(50).optional(),
  continuation: z.string().max(4096).optional(),
});

export type SearchVideosInput = z.infer<typeof searchVideosInputSchema>;

export const unifiedVideoSchema = z.object({
  videoId: z.string(),
  title: z.string(),
  channelId: z.string().optional(),
  channelName: z.string().optional(),
  /** Channel / uploader avatar from upstream (absolute URL). */
  channelAvatarUrl: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  durationSeconds: z.number().optional(),
  viewCount: z.number().optional(),
  publishedText: z.string().optional(),
  /** Unix seconds when known from upstream (Invidious `published`, Piped `uploaded`, …). */
  publishedAt: z.number().optional(),
});

export type UnifiedVideo = z.infer<typeof unifiedVideoSchema>;

export const searchVideosResultSchema = z.object({
  videos: z.array(unifiedVideoSchema),
  continuation: z.string().nullable().optional(),
  sourceUsed: z.enum(["piped", "invidious", "cache"]),
  warning: z.string().optional(),
  stale: z.boolean().optional(),
});

export const cachedSearchPayloadSchema = z.object({
  videos: z.array(unifiedVideoSchema),
  continuation: z.string().nullable().optional(),
  sourceUsed: z.enum(["piped", "invidious"]),
});

export type SearchVideosResult = z.infer<typeof searchVideosResultSchema>;

export const videoDetailInputSchema = z.object({
  videoId: z.string().min(11).max(20),
});

export type VideoDetailInput = z.infer<typeof videoDetailInputSchema>;

export const streamSourceSchema = z.object({
  url: z.string().url(),
  mimeType: z.string().optional(),
  quality: z.string().optional(),
  /** Bitrate in bits per second (Invidious/Piped `bitrate`). */
  bitrate: z.number().finite().nonnegative().optional(),
  /** Frames per second when upstream provides it. */
  fps: z.number().positive().optional(),
  /** Video height in pixels when upstream provides it (0 = no video plane). */
  height: z.number().finite().nonnegative().optional(),
  /** BCP-47 / YouTube audio track id prefix when provided by upstream. */
  language: z.string().optional(),
  /** Invidious `audioTrack.displayName` when present. */
  audioTrackDisplayName: z.string().optional(),
  /**
   * True when this URL is video-only (YouTube/Invidious adaptive) and must not
   * be used alone in a single &lt;video src&gt; — no muxed audio.
   */
  videoOnly: z.boolean().optional(),
});

export const videoDetailSchema = z.object({
  videoId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  channelId: z.string().optional(),
  channelName: z.string().optional(),
  channelAvatarUrl: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  durationSeconds: z.number().int().optional(),
  viewCount: z.number().optional(),
  publishedText: z.string().optional(),
  hlsUrl: z.string().url().optional(),
  dashUrl: z.string().url().optional(),
  audioSources: z.array(streamSourceSchema),
  videoSources: z.array(streamSourceSchema),
  sourceUsed: z.enum(["piped", "invidious", "cache"]),
  warning: z.string().optional(),
  stale: z.boolean().optional(),
});

export type VideoDetail = z.infer<typeof videoDetailSchema>;

export const relatedVideosResultSchema = z.object({
  videos: z.array(unifiedVideoSchema),
  sourceUsed: z.enum(["piped", "invidious", "cache"]),
  warning: z.string().optional(),
  stale: z.boolean().optional(),
});

export type RelatedVideosResult = z.infer<typeof relatedVideosResultSchema>;

/** Invidious `type` on `/api/v1/trending` (Piped often accepts the same query param). */
export const trendingVideoCategorySchema = z
  .enum(["music", "gaming", "movies"])
  .optional();

export const trendingInputSchema = z.object({
  region: z.string().length(2).default("US"),
  limit: z.number().int().min(1).max(60).optional(),
  category: trendingVideoCategorySchema,
});

export type TrendingInput = z.infer<typeof trendingInputSchema>;

export const trendingVideosResultSchema = z.object({
  videos: z.array(unifiedVideoSchema),
  sourceUsed: z.enum(["piped", "invidious", "cache"]),
  warning: z.string().optional(),
  stale: z.boolean().optional(),
});

export type TrendingVideosResult = z.infer<typeof trendingVideosResultSchema>;

export const cachedTrendingPayloadSchema = z.object({
  videos: z.array(unifiedVideoSchema),
  sourceUsed: z.enum(["piped", "invidious"]),
});

export const channelPageInputSchema = z.object({
  channelId: z.string().min(3).max(128),
  continuation: z.string().max(16384).optional(),
});

export type ChannelPageInput = z.infer<typeof channelPageInputSchema>;

export const channelPageResultSchema = z.object({
  channelId: z.string(),
  /** Absent on continuation-only pages (load more). */
  name: z.string().optional(),
  description: z.string().optional(),
  avatarUrl: z.string().optional(),
  bannerUrl: z.string().optional(),
  subscriberCount: z.number().optional(),
  videos: z.array(unifiedVideoSchema),
  continuation: z.string().nullable().optional(),
  sourceUsed: z.enum(["piped", "invidious", "cache"]),
  warning: z.string().optional(),
  stale: z.boolean().optional(),
});

export type ChannelPageResult = z.infer<typeof channelPageResultSchema>;

export const cachedChannelPayloadSchema = z.object({
  channelId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  avatarUrl: z.string().optional(),
  bannerUrl: z.string().optional(),
  subscriberCount: z.number().optional(),
  videos: z.array(unifiedVideoSchema),
  continuation: z.string().nullable().optional(),
  sourceUsed: z.enum(["piped", "invidious"]),
});

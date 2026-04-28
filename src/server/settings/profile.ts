import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/server/db/client";
import { userProfile } from "@/server/db/schema";
import type { ProxySourceOverrides } from "@/server/services/proxy";

export const themeSchema = z.enum(["system", "light", "dark"]);

export const appSettingsSchema = z.object({
  theme: themeSchema.default("system"),
  pipedBaseUrl: z.string().max(512).optional(),
  invidiousBaseUrl: z.string().max(512).optional(),
  /** ISO 3166-1 alpha-2 trending region (Piped / Invidious). */
  trendingRegion: z.string().length(2).default("US"),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

export function normalizeTrendingRegionStored(
  input: string | undefined,
  fallback = "US",
): string {
  if (!input || typeof input !== "string") return fallback;
  const t = input.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(t) ? t : fallback;
}

const defaultSettings: AppSettings = {
  theme: "system",
  trendingRegion: "US",
};

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizeUrlLike(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const value = input.trim();
  return value.length > 0 ? value.replace(/\/+$/, "") : undefined;
}

export function getUserSettings(db: AppDb, userId: number): AppSettings {
  const row = db
    .select({ profileJson: userProfile.profileJson })
    .from(userProfile)
    .where(eq(userProfile.userId, userId))
    .limit(1)
    .all()[0];
  if (!row) return defaultSettings;
  try {
    const parsed = appSettingsSchema.safeParse(JSON.parse(row.profileJson));
    return parsed.success ? parsed.data : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

export function upsertUserSettings(
  db: AppDb,
  userId: number,
  patch: Partial<AppSettings>,
): AppSettings {
  const previous = getUserSettings(db, userId);
  const merged: AppSettings = {
    ...previous,
    ...patch,
    pipedBaseUrl: normalizeUrlLike(patch.pipedBaseUrl ?? previous.pipedBaseUrl),
    invidiousBaseUrl: normalizeUrlLike(
      patch.invidiousBaseUrl ?? previous.invidiousBaseUrl,
    ),
    trendingRegion: normalizeTrendingRegionStored(
      patch.trendingRegion ?? previous.trendingRegion,
    ),
  };
  const safe = appSettingsSchema.parse(merged);
  const ts = nowUnix();
  db.insert(userProfile)
    .values({
      userId,
      profileJson: JSON.stringify(safe),
      updatedAt: ts,
    })
    .onConflictDoUpdate({
      target: userProfile.userId,
      set: {
        profileJson: JSON.stringify(safe),
        updatedAt: ts,
      },
    })
    .run();
  return safe;
}

export function getUserProxyOverrides(
  db: AppDb,
  userId: number | null,
): ProxySourceOverrides | undefined {
  if (!userId) return undefined;
  const settings = getUserSettings(db, userId);
  if (!settings.pipedBaseUrl && !settings.invidiousBaseUrl) return undefined;
  return {
    pipedBaseUrl: settings.pipedBaseUrl,
    invidiousBaseUrl: settings.invidiousBaseUrl,
  };
}

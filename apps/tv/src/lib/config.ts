import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

/**
 * Base URL of the OwnTube web instance the TV app talks to.
 *
 * `EXPO_PUBLIC_OWNTUBE_URL` / `app.json` `extra.owntubeUrl` is only the
 * **default**: a sideloaded APK has no way to be rebuilt per instance, so the
 * value is editable at runtime (login screen and Settings) and persisted.
 * On the Android emulator, the host machine is reachable at `10.0.2.2`.
 */
const INSTANCE_URL_KEY = "owntube.instance-url";

const fromEnv = process.env.EXPO_PUBLIC_OWNTUBE_URL;
const fromExtra = (
  Constants.expoConfig?.extra as { owntubeUrl?: string } | undefined
)?.owntubeUrl;

export const DEFAULT_BASE_URL = normalizeBaseUrl(
  fromEnv ?? fromExtra ?? "http://10.0.2.2:3000",
);

// Kept in module scope so the tRPC fetch wrapper can read it synchronously on
// every request without turning the whole client into a promise.
let baseUrl = DEFAULT_BASE_URL;

/** Trims trailing slashes and assumes http:// when no scheme was typed. */
export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export function getBaseUrl(): string {
  return baseUrl;
}

/** Call once at boot, before the first tRPC request. */
export async function loadBaseUrl(): Promise<string> {
  const stored = await SecureStore.getItemAsync(INSTANCE_URL_KEY);
  const normalized = stored ? normalizeBaseUrl(stored) : "";
  baseUrl = normalized || DEFAULT_BASE_URL;
  return baseUrl;
}

export async function setBaseUrl(input: string): Promise<string> {
  const normalized = normalizeBaseUrl(input) || DEFAULT_BASE_URL;
  baseUrl = normalized;
  await SecureStore.setItemAsync(INSTANCE_URL_KEY, normalized);
  return normalized;
}

/**
 * The tRPC client is created once with this fixed origin; the fetch wrapper in
 * `lib/trpc.ts` swaps it for the current instance on every request, so changing
 * the URL takes effect without rebuilding the client.
 */
export const PLACEHOLDER_ORIGIN = "http://instance.owntube.invalid";

export const TRPC_URL = `${PLACEHOLDER_ORIGIN}/api/trpc`;

export function withCurrentBaseUrl(url: string): string {
  return url.startsWith(PLACEHOLDER_ORIGIN)
    ? `${baseUrl}${url.slice(PLACEHOLDER_ORIGIN.length)}`
    : url;
}

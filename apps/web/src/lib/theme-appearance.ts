export type ThemeMode = "system" | "light" | "dark";
export type VisualTheme = "default" | "terminal" | "aurora" | "sky";

/** Single source of truth for selectable visual themes (settings UI, Zod schema, boot script). */
export const VISUAL_THEMES = ["default", "terminal", "aurora", "sky"] as const;

export const VISUAL_THEME_LABELS: Record<VisualTheme, string> = {
  default: "Default",
  terminal: "Terminal",
  aurora: "Aurora",
  sky: "Sky",
};

export const VISUAL_THEME_DESCRIPTIONS: Record<VisualTheme, string> = {
  default: "Clean, neutral SaaS look",
  terminal: "Square pixels, mono accents, CRT vibes",
  aurora: "Deep violet glass with soft glows",
  sky: "Painted clouds, deep blue and soft white",
};

export const THEME_STORAGE_KEY = "owntube-theme";

export function isVisualTheme(value: unknown): value is VisualTheme {
  return (
    typeof value === "string" &&
    (VISUAL_THEMES as readonly string[]).includes(value)
  );
}

export function resolveIsDarkTheme(theme: ThemeMode): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

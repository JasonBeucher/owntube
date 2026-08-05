import { THEME_STORAGE_KEY, VISUAL_THEMES } from "@/lib/theme-appearance";

/** Runs before paint so persisted appearance and visual theme apply before hydration. */
export function FaviconInitScript() {
  const script = `
(function () {
  try {
    var storageKey = ${JSON.stringify(THEME_STORAGE_KEY)};
    var visualThemes = ${JSON.stringify(VISUAL_THEMES)};
    var theme = "system";
    var raw = localStorage.getItem(storageKey);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.state && parsed.state.theme) {
        theme = parsed.state.theme;
      }
      var visual = parsed && parsed.state && parsed.state.visualTheme;
      if (visual && visual !== "default" && visualThemes.indexOf(visual) !== -1) {
        document.documentElement.dataset.visualTheme = visual;
      }
    }
    document.documentElement.classList.remove("light", "dark");
    if (theme === "light") {
      document.documentElement.classList.add("light");
    }
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    }
  } catch (_) {}
})();
`.trim();

  return (
    <script
      // biome-ignore lint/security/noDangerouslySetInnerHtml: inline boot script
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}

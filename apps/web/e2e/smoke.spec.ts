import { expect, test } from "@playwright/test";

test.describe("P0 smoke", () => {
  test("home shows entry to search", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: "owntube home" }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Global search" }),
    ).toBeVisible();
  });

  test("home may show shorts shelf when upstream has shorts", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: "owntube home" }),
    ).toBeVisible();
    // While the shorts query is pending the shelf renders a skeleton that has
    // the heading but no "See all" link, so waiting on the heading would race
    // the real content. Wait for "See all" instead; its absence is legitimate
    // (upstream may return no shorts at all) and ends the test early.
    const shelf = page.locator('section[aria-label="Shorts"]');
    const seeAll = shelf.getByRole("link", { name: "See all" });
    const loaded = await seeAll
      .waitFor({ state: "visible", timeout: 45_000 })
      .then(() => true)
      .catch(() => false);
    if (!loaded) return;
    await expect(shelf.locator('a[href^="/shorts?v="]').first()).toBeVisible();
  });

  test("shorts page loads feed shell", async ({ page }) => {
    await page.goto("/shorts");
    // Match on the accessible name: the nav icons carry an SVG <title>, so the
    // link's text content is "HomeHome" and a /^Home$/ text filter never hits.
    await expect(
      page
        .getByRole("link", { name: "Home", exact: true })
        .first()
        .or(
          page
            .getByText(
              /Loading shorts|No shorts available|Shorts feed is temporarily unavailable/i,
            )
            .first(),
        ),
    ).toBeVisible({ timeout: 30_000 });
    const active = page.locator('[data-short-active="true"]');
    if ((await active.count()) === 0) return;
    await expect(active).toBeVisible({ timeout: 30_000 });
    await expect(active.getByText(/^Loading…$/)).toBeHidden({
      timeout: 45_000,
    });
    await expect(active.locator("video").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("search page shows form", async ({ page }) => {
    await page.goto("/search");
    await expect(
      page.getByRole("heading", { level: 1, name: "Search" }),
    ).toBeVisible();
    await expect(
      page.getByRole("searchbox", { name: "Search videos" }),
    ).toBeVisible();
  });
});

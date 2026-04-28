import { expect, test } from "@playwright/test";

test.describe("P0 smoke", () => {
  test("home shows entry to search", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "OwnTube" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Search videos" }),
    ).toBeVisible();
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

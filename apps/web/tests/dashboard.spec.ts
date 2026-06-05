import { expect, test } from "@playwright/test";

test("login page renders the initial auth surface", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByText(/23 comments|Supabase設定が見つかりません/)
  ).toBeVisible();
});

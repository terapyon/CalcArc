import { expect, test } from "@playwright/test";

test("the calculator loads and shows zero", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
  await expect(page.getByRole("main")).toBeVisible();
});

test("the core version is reported", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("core-version")).toContainText("0.1.0");
});

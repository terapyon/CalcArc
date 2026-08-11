import { expect, test } from "@playwright/test";

test("the calculator loads and shows zero", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

test("the core version is reported", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("core-version")).toContainText("0.1.0");
});

test("a pressed key reaches the calculation core", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "3" }).click();
  await expect(page.getByTestId("display-main")).toHaveText("3");
});

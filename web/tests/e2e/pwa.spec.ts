import { expect, type Page, test } from "@playwright/test";

/** 画面のボタンを順に押す(vertical-slice.spec.ts と同じ流儀)。 */
async function press(page: Page, labels: string[]): Promise<void> {
  for (const label of labels) {
    await page.getByRole("button", { name: label, exact: true }).click();
  }
}

const main = (page: Page) => page.getByTestId("display-main");

const dataScaleStatus = (page: Page) =>
  page.getByRole("region", { name: "データスケール計算" }).getByRole("status");

test("the manifest is fetchable, standalone, and its icons resolve", async ({
  page,
  baseURL,
}) => {
  await page.goto("/");

  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();

  const manifestUrl = new URL(href as string, baseURL).toString();
  const manifestResponse = await page.request.get(manifestUrl);
  expect(manifestResponse.status()).toBe(200);

  const manifest = await manifestResponse.json();
  expect(manifest.display).toBe("standalone");

  const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
  expect(sizes).toContain("192x192");
  expect(sizes).toContain("512x512");

  // icon.src はアイコン自身の記述であり、manifest の URL からの相対パス。
  for (const icon of manifest.icons as Array<{ src: string }>) {
    const iconUrl = new URL(icon.src, manifestUrl).toString();
    const iconResponse = await page.request.get(iconUrl);
    expect(iconResponse.status()).toBe(200);
  }
});

test("the service worker registration becomes ready", async ({ page }) => {
  await page.goto("/");

  const ready = await page.evaluate(() =>
    navigator.serviceWorker.ready.then(() => true),
  );
  expect(ready).toBe(true);
});

test("Scientific and Data Scale keep working once the network drops, after one controlled reload", async ({
  page,
  context,
}) => {
  await page.goto("/");
  // workbox の precache 充填は install の waitUntil 内で完了するため、
  // ready(=activated) は precache 充填済みを含意する——この待機 1 つで足りる。
  await page.evaluate(() => navigator.serviceWorker.ready);

  // 設計上 clientsClaim を使わない(Task 2 の check:sw がこれを固定している)。
  // そのため最初のロードは SW の「制御下」に無い。実測(赤確認)では、この
  // reload-1 を省いても直後の setOffline(true) → reload はそのまま成功
  // した——SW のナビゲーション捕捉は「ページが controlled か」ではなく
  // 「そのナビゲーション時点で scope に active worker が居るか」で決まり、
  // sw.ready を待った後ならそれだけで足りるため、reload-1 は必要条件では
  // ない。それでも残すのは、切断前に「オンラインでの reload が普通に
  // 機能する」ことを単独の検査点として確認しておくため
  // (offline reload が失敗したとき、そもそも reload という操作自体が
  // 壊れていたのか、offline 固有の問題なのかを切り分けられる)。
  await page.reload();
  await expect(main(page)).toHaveText("0");

  await context.setOffline(true);
  await page.reload();
  await expect(main(page)).toHaveText("0");

  // Scientific: 3 + 4 = 7 が offline でも wasm 経由で計算できる。
  await press(page, ["3", "足す", "4", "計算する"]);
  await expect(main(page)).toHaveText("7");

  // Data Scale: 基準例 100M x 768 x float32 = 307.2 GB。
  await page.getByRole("link", { name: "Data Scale", exact: true }).click();
  await page.getByLabel("件数").fill("100000000");
  await page.getByLabel("次元数").fill("768");
  await expect(dataScaleStatus(page)).toContainText("307.2 GB");
});

test("a cold visit with the network already off fails to load (the failing twin)", async ({
  page,
  context,
}) => {
  // 上の offline テストの緑が「本当に切れていた」ことの証明。SW 登録も
  // precache も存在しない新規 context で、最初のロードより前に
  // setOffline(true) にしてから goto すると失敗するはず。これが無いと
  // 「オフラインで動いた」は「そもそも切れていなかった」と区別がつかない
  // (設計書 §6)。
  await context.setOffline(true);
  await expect(page.goto("/")).rejects.toThrow();
});

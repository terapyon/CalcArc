import { test as base, expect } from "@playwright/test";

export type { Locator, Page } from "@playwright/test";
export { expect };

/**
 * レートの取得先。**`web/src/currency/provider.ts` の `PROVIDER_ENDPOINT` と
 * 二重管理である**(E2E は境界の定数を import しない)。
 *
 * **素で走らせると本物のネットワークに出る。** U-4 の計測中、実ブラウザが
 * `open.er-api.com` を実際に叩いて**当日のレート**を表示した。塞がないと
 * **CI がプロバイダのレート制限(429)と当日のレートに依存する。**
 */
export const PROVIDER_GLOB = "**/open.er-api.com/**";

/**
 * **既定でプロバイダを塞いだ `test`。すべての E2E がこれを使う。**
 *
 * 以前、塞ぎは `convert.spec.ts` の `test.beforeEach` にだけ在った。
 * **Playwright の `beforeEach` はファイルの中でしか効かない**ので、
 * 別のファイルが `#convert/currency` を開いた瞬間、**黙って本物へ出て
 * 緑になる**——壊れていないが、壊れたときに気づけない形だった。
 * `viewport-budget.spec.ts` に通貨を足せない理由も、寸法ではなくこれである。
 *
 * **塞ぎ方は「落とす」である。** 為替を測る検査は自分の `page.route` を
 * あとから張り(**あとから張ったほうが優先される**)、応答も回数も自分で
 * 決める。ここが決めるのは**何も張らなかったファイルの既定**だけで、
 * その既定は「本物に出る」ではなく「出られない」であるべきである。
 *
 * **新しい spec がここを迂回していないか**は
 * `tests/unit/e2e-imports.test.ts` が見張る——迂回できてしまうと、
 * この既定は「守られているつもり」になる。
 */
/**
 * **この機械の外へ出ようとした要求**を落として数える網(2026-09-11)。
 *
 * 為替の差し替えは `page.route` なので、**すり抜けると誰も気づかない**
 * ——WebKit の走行 34545368399 では、画面に本物のレートの日付が出たことで
 * 初めて気づいた(`docs/superpowers/sdd/known-flaky-tests.md`)。**気づけない
 * 形で外へ出ている検査があれば、ここで赤くする。**
 *
 * `context.route` は `page.route` より後に効くので、為替の既定の塞ぎ
 * (`providerBlocked`)と各検査の差し替えが捕まえた要求はここへ来ない。
 * **来るのは、誰も予期していない外向きの要求だけ**である。Service Worker は
 * 設定で止めてあるので(`pwa.spec.ts` を除く)、WebKit でも要求は route に見える。
 */
const LEAVES_THE_MACHINE = (url: URL) =>
  (url.protocol === "http:" || url.protocol === "https:") &&
  url.hostname !== "localhost" &&
  url.hostname !== "127.0.0.1";

// **`void` が正しい。** biome は `undefined` を勧めるが、そうすると
// `use()` が引数を要求してコンパイルが通らない(TS2554)——Playwright の
// 「値を持たない fixture」の型は `void` である。
// **型を 1 行に置く**——複数行にすると、下の抑止が 2 つ目以降の `void` に届かない
// (2026-09-11 に網の fixture を足したとき、実際に警告が 3 つ出た)。
// biome-ignore lint/suspicious/noConfusingVoidType: 上のとおり
type AutoFixtures = { providerBlocked: void; strayRequestsBlocked: void };

export const test = base.extend<AutoFixtures>({
  providerBlocked: [
    async ({ page }, use) => {
      await page.route(PROVIDER_GLOB, (route) => route.abort("failed"));
      await use();
    },
    { auto: true },
  ],
  strayRequestsBlocked: [
    async ({ context }, use) => {
      const stray: string[] = [];
      await context.route(LEAVES_THE_MACHINE, async (route) => {
        stray.push(route.request().url());
        await route.abort("blockedbyclient");
      });
      await use();
      expect(stray, "requests that tried to leave the machine").toEqual([]);
    },
    { auto: true },
  ],
});

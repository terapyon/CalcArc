import { defineConfig } from "@playwright/test";
import e2e from "./playwright.config";

/**
 * **撮影の設定**(`pnpm shots`)。README の写真とその文字を撮り直す
 * (マニュアルの設計書 §1・§3、計画 `docs/superpowers/plans/2026-09-10-manuals.md` T1)。
 *
 * **`webServer` と `baseURL`・時間帯は E2E の設定から読む。写さない**
 * ——ポート 4179 の理由(他人の preview を掴まない)も含めて
 * `playwright.config.ts` が 1 か所で持つ。E2E と同じ `vite build` → `preview`
 * を撮る。
 */
export default defineConfig({
  testDir: "./tests/shots",
  webServer: e2e.webServer,
  use: {
    ...e2e.use,
    // **Chromium だけ。** 書体が当たったことを CDP で確かめる
    // (`tests/shots/pinned-font.ts`)ので、Chromium でしか撮れない。
    browserName: "chromium",
    // README の写真は幅 390 の 1 倍で撮る(E2E の `mobile` と同じ寸法)。
    viewport: { width: 390, height: 844 },
    isMobile: false,
    deviceScaleFactor: 1,
    colorScheme: "light",
    // **Service Worker を止める。** `page.route` は SW が受けた要求を
    // 見られない(Playwright の文書)ので、書体のファイルを配る道が
    // 黙って外れうる。撮るのは毎回まっさらな画面なので、SW は要らない。
    serviceWorkers: "block",
  },
});

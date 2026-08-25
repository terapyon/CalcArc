# 重量級テストの独立パッケージ化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `web/` の中にある重量級専用の 43 ファイルを、独立した pnpm パッケージ
`heavy/` へ移し、`web` が重量級の存在を知らない状態にする。

**Architecture:** 移動であって書き換えではない。`heavy/tests/corpus/` を
`web/tests/heavy/` と**根から同じ深さ**に置くことで、重量級が持つ**根までの
相対パス 12 箇所を 1 文字も変えずに**運ぶ。書き換えるのは `import` の 16 箇所と
設定ファイルだけで、テストの中身・計算コード・コマンド名は 1 行も変えない。

**Tech Stack:** pnpm 10.32.1 / Playwright / vitest / vite / TypeScript /
wasm-pack

**Spec:** `docs/superpowers/specs/2026-08-25-heavy-package-split-design.md`

## Global Constraints

- **作業台は `/home/terapyon/dev/CalcArc-e2e`。** `/home/terapyon/dev/CalcArc`
  は実装側の別セッションのものなので読み書きしない。**全コマンドを
  `cd /home/terapyon/dev/CalcArc-e2e && ...` の形で打つ**（シェルの cwd は
  呼び出しごとに `/home/terapyon/dev/CalcArc` へ戻る）
- ブランチは `feature/heavy-tests-split`。**`git push` と PR 作成は行わない**
- コミットメッセージの末尾は
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`、
  件名の次は空行
- **計算コードを 1 行も変えない**（`crates/` も `web/src/calc` も）
- **コマンド名を変えない**——`heavy` / `heavy:ui` / `heavy:power` /
  `heavy:power:exact`
- **深さを崩さない。** `heavy/tests/corpus/` `heavy/tests/ui/`
  `heavy/tests/unit/` `heavy/scripts/` `heavy/harness/` は、すべて
  `web/` 側と根から同じ深さである
- **wasm の複製を作らない。** heavy は `web/src/wasm` を共有する
- **移動は `git mv` を使う**（履歴を残す）
- **戻すときは再編集する。** `git checkout <file>` は同じファイルに対する
  別の作業を巻き戻す
- 依存の版は web と同じものを写す: `@playwright/test ^1.50.0` /
  `vite ^6.0.0` / `vite-plugin-wasm ^3.4.0` /
  `vite-plugin-top-level-await ^1.4.0` / `vitest ^3.0.0` /
  `typescript ^5.7.0` / `@types/node ^26.1.2` / `@biomejs/biome ^2.0.0`

### 移動前の基準値（これと突き合わせる）

2026-08-25 に main + 0.4.0 の木で実測した値。**このブランチは `crates/`・
`web/src`・重量級のいずれにも触っていない**（版数ゲートと文書だけ）ので、
そのまま基準として使える。

| 検査 | 実測 |
|---|---|
| `pnpm heavy` | **195 passed**（32 秒） |
| `pnpm heavy:power:exact` | **10/10 ok**、赤の本数も不変（4 分） |
| `pnpm heavy:power` | **18/18 ok**、各変異の実測率は**下限のちょうど 2.00 倍**（11 分） |
| `pnpm heavy:ui` | **36 passed / 指摘 0 / 46 トークン全押下**（12 分） |

---

## File Structure

**新規に作る（`heavy/`）**

| ファイル | 責務 |
|---|---|
| `heavy/package.json` | パッケージの素性・依存・スクリプト |
| `heavy/pnpm-lock.yaml` | 依存の固定（`pnpm install` が生成） |
| `heavy/tsconfig.json` | 型検査の範囲。`../web/src` を import 経由で引き込む |
| `heavy/biome.json` | lint と整形 |
| `heavy/vitest.config.ts` | ユニット 6 本だけを拾う（`*.spec.ts` を拾わせない） |

**`git mv` で移す（43 本）**

| いま | あと |
|---|---|
| `web/tests/heavy/`（18） | `heavy/tests/corpus/` |
| `web/tests/heavy-ui/`（10） | `heavy/tests/ui/` |
| `web/tests/unit/{detection-power,detection-power-restore,exact-power,heavy-ui-finance,heavy-ui-presses,heavy-ui-select}.test.ts`（6） | `heavy/tests/unit/` |
| `web/scripts/{detection,exact}-power.mjs`（2） | `heavy/scripts/` |
| `web/src/heavy-harness.ts` | `heavy/harness/heavy-harness.ts` |
| `web/heavy-harness.html` | `heavy/harness/heavy-harness.html` |
| `web/vite.heavy.config.ts` | `heavy/vite.harness.config.ts` |
| `web/playwright.heavy.config.ts` | `heavy/playwright.corpus.config.ts` |
| `web/playwright.heavy-ui.config.ts` | `heavy/playwright.ui.config.ts` |

**書き換える `import` は 16 箇所**（全部この計画の中に実物が書いてある）

| 種類 | 件数 | 何が変わるか |
|---|---|---|
| 重量級 → `web/src` | 9 | `../../src/...` → `../../../web/src/...` |
| ハーネス → `web/src` | 2 | `./calc` `./wasm/...` → `../../web/src/...` |
| ユニット → 改名した隣 | 5 | `../heavy/` → `../corpus/`、`../heavy-ui/` → `../ui/` |

**変えない `import`**: ユニット 6 本から `../../scripts/*.mjs` への 2 箇所
（深さが同じなので**そのまま動く**）。

**web 側で直す**

| ファイル | 何を |
|---|---|
| `web/package.json` | `heavy` / `heavy:ui` / `heavy:power` / `heavy:power:exact` の 4 スクリプトを消す |
| `web/tsconfig.json` | `include` から `vite.heavy.config.ts` / `playwright.heavy.config.ts` / `playwright.heavy-ui.config.ts` の 3 行を消す |

**その他**

`.gitignore`（8 行）、`.github/workflows/heavy-corpus.yml`、`CLAUDE.md`、
`docs/corpus-measurements.md`（冒頭 1 行）、
`docs/heavy-corpus-implementation-report.md`（`:5` の 1 箇所）。

---

## Task 1: `heavy/` パッケージの骨格を立てる

**Files:**
- Create: `heavy/package.json`
- Create: `heavy/tsconfig.json`
- Create: `heavy/biome.json`
- Create: `heavy/vitest.config.ts`
- Create: `heavy/pnpm-lock.yaml`（`pnpm install` が作る）

**Interfaces:**
- Consumes: なし
- Produces: `cd heavy && pnpm <script>` が使える土台。以降のタスクはすべて
  この `package.json` のスクリプトを通って走る

- [ ] **Step 1: 移動前の基準を 1 つだけ取り直す**

32 秒で終わるものだけ、いまの木で実際に走らせて基準を確かめる。

```bash
cd /home/terapyon/dev/CalcArc-e2e/web && CI=1 pnpm heavy 2>&1 | tail -5
```

Expected: `195 passed`。**違う数が出たら、そこで止めてユーザーに報告する**
（移動の前に、基準そのものが動いている）。

- [ ] **Step 2: `heavy/package.json` を作る**

```json
{
  "name": "calcarc-heavy",
  "private": true,
  "type": "module",
  "version": "0.0.0",
  "packageManager": "pnpm@10.32.1",
  "scripts": {
    "heavy": "pnpm --dir ../web wasm && playwright test --config playwright.corpus.config.ts",
    "heavy:ui": "pnpm --dir ../web wasm && playwright test --config playwright.ui.config.ts",
    "heavy:power": "node scripts/detection-power.mjs",
    "heavy:power:exact": "node scripts/exact-power.mjs",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "biome check ."
  },
  "devDependencies": {
    "@biomejs/biome": "^2.0.0",
    "@playwright/test": "^1.50.0",
    "@types/node": "^26.1.2",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vite-plugin-top-level-await": "^1.4.0",
    "vite-plugin-wasm": "^3.4.0",
    "vitest": "^3.0.0"
  }
}
```

**`version` は `0.0.0` に固定する。** これは配られないパッケージで、
`check-version.mjs` が見る 5 箇所にも入っていない。**版数を持たせると
6 箇所目ができ、揃える対象が 1 つ増える。**

**`pnpm --dir ../web wasm` を先に呼ぶ。** いまの `web` 側の `heavy` /
`heavy:ui` が `pnpm wasm &&` で始まっているのと同じ役割で、
`web/src/wasm` を建てる（設計書 §5.1——複製は作らない）。

- [ ] **Step 3: `heavy/tsconfig.json` を作る**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "allowJs": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "types": ["vite/client", "node"]
  },
  "include": [
    "tests",
    "harness",
    "vite.harness.config.ts",
    "vitest.config.ts",
    "playwright.corpus.config.ts",
    "playwright.ui.config.ts"
  ]
}
```

**`tests` を include に入れる。** web 側の `tsconfig.json` が同じことを
していて、**そこには「以前は `src` だけで、重量級のテストコードが丸ごと
型検査の外にいた」という実害の記録がある**（存在しない引数を渡していても
緑だった）。同じ穴を新しいパッケージで開け直さない。

`jsx` は要らない——移す 43 本に JSX は 1 つも無い（実測）。

- [ ] **Step 4: `heavy/biome.json` を作る**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.6/schema.json",
  "files": { "includes": ["tests/**", "harness/**", "*.ts"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 },
  "linter": { "enabled": true, "rules": { "preset": "recommended" } }
}
```

web 側の `biome.json` と同じ形。`scripts/**` を入れないのも同じ
（`.mjs` は web でも lint の対象外である）。

- [ ] **Step 5: `heavy/vitest.config.ts` を作る**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // **時間帯を固定する。手元と CI を同じ条件にするためである。**
    // web 側の vite.config.ts と同じ理由づけで、値も揃える。
    env: { TZ: "UTC" },
    // **include を明示する。** 既定は `**/*.{test,spec}.*` なので、
    // 書かないと Playwright の `tests/corpus/*.spec.ts` を vitest が
    // 拾い上げる。web 側も同じ理由で明示している。
    include: ["tests/unit/**/*.test.ts"],
  },
});
```

**環境は既定（node）でよい。** 移す 6 本は jsdom も testing-library も
使っていない（実測）。だから `jsdom` を依存に入れていない。

- [ ] **Step 6: 依存を入れ、lockfile を作る**

```bash
cd /home/terapyon/dev/CalcArc-e2e/heavy && pnpm install
```

Expected: `heavy/pnpm-lock.yaml` と `heavy/node_modules/` ができる。

- [ ] **Step 7: 空の状態で型検査と lint が通ることを見る**

```bash
cd /home/terapyon/dev/CalcArc-e2e/heavy && pnpm typecheck && pnpm lint
```

Expected: どちらも exit 0。**まだ 1 ファイルも移していないので、
ここで落ちるなら設定そのものが誤っている。**

- [ ] **Step 8: commit**

```bash
cd /home/terapyon/dev/CalcArc-e2e && git add heavy/ && git commit -F - <<'MSG'
Give the heavy suite a package of its own, still empty

**まだ 1 本も移していない。** `heavy/` に `package.json` /
`tsconfig.json` / `biome.json` / `vitest.config.ts` と lockfile だけを置き、
**空の状態で `typecheck` と `lint` が通ること**を先に確かめた。設定が
誤っていれば、ファイルを移す前にここで落ちる。

`version` は `0.0.0` に固定した。**配られないパッケージに版数を持たせると、
揃える対象が 6 箇所目になる。**

`vitest.config.ts` の `include` を明示したのは、既定のままだと Playwright の
`*.spec.ts` を vitest が拾い上げるためである。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 2: ハーネスを移す

**Files:**
- Move: `web/src/heavy-harness.ts` → `heavy/harness/heavy-harness.ts`
- Move: `web/heavy-harness.html` → `heavy/harness/heavy-harness.html`
- Move: `web/vite.heavy.config.ts` → `heavy/vite.harness.config.ts`
- Modify: `heavy/harness/heavy-harness.ts`（import 2 箇所）
- Modify: `heavy/harness/heavy-harness.html`（script の src）
- Modify: `heavy/vite.harness.config.ts`（`input` と `outDir`）

**Interfaces:**
- Consumes: Task 1 の `heavy/package.json`
- Produces: `heavy/dist-harness/` にハーネスのページが建つ。Task 3 の
  `playwright.corpus.config.ts` がこれを 4180 で配る

- [ ] **Step 1: 3 ファイルを移す**

```bash
cd /home/terapyon/dev/CalcArc-e2e && mkdir -p heavy/harness \
  && git mv web/src/heavy-harness.ts heavy/harness/heavy-harness.ts \
  && git mv web/heavy-harness.html heavy/harness/heavy-harness.html \
  && git mv web/vite.heavy.config.ts heavy/vite.harness.config.ts
```

- [ ] **Step 2: ハーネスの import 2 箇所を書き換える**

`heavy/harness/heavy-harness.ts` の 10 行目と 21 行目。

before:
```ts
import { type Calc, initCalc, KEY_TOKENS, type KeyToken } from "./calc";
import {
  compound_deposit_for,
  ...
} from "./wasm/calcarc_wasm.js";
```

after:
```ts
import {
  type Calc,
  initCalc,
  KEY_TOKENS,
  type KeyToken,
} from "../../web/src/calc";
import {
  compound_deposit_for,
  ...
} from "../../web/src/wasm/calcarc_wasm.js";
```

**`...` の中身（10 関数）は 1 つも変えない。** 変えるのは
`from` の右側だけである。

冒頭のコメントも 1 行だけ直す——`vite.heavy.config.ts` という名前がもう無い。

before: `* vite.heavy.config.ts だけがこのエントリをビルドし、index.html からは`
after: `* vite.harness.config.ts だけがこのエントリをビルドし、web の index.html からは`

- [ ] **Step 3: html の script の src を直す**

`heavy/harness/heavy-harness.html`:

before:
```html
    <script type="module" src="/src/heavy-harness.ts"></script>
```

after:
```html
    <script type="module" src="./heavy-harness.ts"></script>
```

**相対にする。** vite の `root` は `heavy/` なので、`/src/...` は
存在しない場所を指す。

- [ ] **Step 4: vite の設定を直す**

`heavy/vite.harness.config.ts` の `build` 節:

before:
```ts
  build: {
    target: "es2022",
    outDir: "dist-heavy",
    rollupOptions: { input: "heavy-harness.html" },
  },
```

after:
```ts
  build: {
    target: "es2022",
    outDir: "dist-harness",
    rollupOptions: { input: "harness/heavy-harness.html" },
  },
```

冒頭のコメントの「既存 vite.config.ts には触らない」は**そのまま残す**——
理由（VitePWA の workbox がハーネスを precache に巻き込む）はいまも生きている。
ただし主語を `web/vite.config.ts` と書き直す。

- [ ] **Step 5: ハーネスが建つことを確かめる**

```bash
cd /home/terapyon/dev/CalcArc-e2e/web && pnpm wasm \
  && cd /home/terapyon/dev/CalcArc-e2e/heavy \
  && pnpm exec vite build --config vite.harness.config.ts 2>&1 | tail -8
```

Expected: `dist-harness/harness/heavy-harness.html` が出力される。
**エラーで落ちるなら import の書き換えが誤っている。**

- [ ] **Step 6: 型検査と lint**

```bash
cd /home/terapyon/dev/CalcArc-e2e/heavy && pnpm typecheck && pnpm lint
```

Expected: どちらも exit 0。ここで初めて `../web/src` が型検査に引き込まれる。

- [ ] **Step 7: commit**

```bash
cd /home/terapyon/dev/CalcArc-e2e && git add -A heavy web && git commit -F - <<'MSG'
Move the harness entry out of the app's source tree

`web/src/heavy-harness.ts` はアプリの `src/` に居たが、**配信物には
入らない**（`vite.heavy.config.ts` だけがビルドし、`index.html` からは
誰も辿らない）。`heavy/harness/` へ移した。

**書き換えたのは import の右側 2 箇所だけである**——`./calc` →
`../../web/src/calc`、`./wasm/calcarc_wasm.js` →
`../../web/src/wasm/calcarc_wasm.js`。10 関数の並びは 1 つも触っていない。

**wasm の複製は作っていない。** `web/src/calc` が `../wasm/…` を import
している以上、複製すると計算機の状態が 2 つになる（設計書 §5.1）。

確認: `pnpm exec vite build --config vite.harness.config.ts` が
`dist-harness/` にページを出す。`typecheck` と `lint` は緑。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 3: コーパスのテストを移す

**Files:**
- Move: `web/tests/heavy/`（18 本）→ `heavy/tests/corpus/`
- Move: `web/playwright.heavy.config.ts` → `heavy/playwright.corpus.config.ts`
- Modify: `heavy/tests/corpus/corpus.ts`（import 2 箇所）
- Modify: `heavy/tests/corpus/report.ts`（import 1 箇所）
- Modify: `heavy/playwright.corpus.config.ts`（`testDir` と `webServer.command`）

**Interfaces:**
- Consumes: Task 2 の `dist-harness`
- Produces: `pnpm heavy` が緑。Task 5 の `heavy:power` はこの走行を
  測定に使う

- [ ] **Step 1: 18 本と設定を移す**

```bash
cd /home/terapyon/dev/CalcArc-e2e && mkdir -p heavy/tests \
  && git mv web/tests/heavy heavy/tests/corpus \
  && git mv web/playwright.heavy.config.ts heavy/playwright.corpus.config.ts
```

- [ ] **Step 2: `web/src` を指す import 3 箇所を書き換える**

`heavy/tests/corpus/corpus.ts` の 4-5 行目:

before:
```ts
import type { CalcErrorCode } from "../../src/calc/types";
import { KEY_TOKENS } from "../../src/calc/types";
```

after:
```ts
import type { CalcErrorCode } from "../../../web/src/calc/types";
import { KEY_TOKENS } from "../../../web/src/calc/types";
```

`heavy/tests/corpus/report.ts` の 11 行目:

before:
```ts
import { KEY_TOKENS } from "../../src/calc/types";
```

after:
```ts
import { KEY_TOKENS } from "../../../web/src/calc/types";
```

**根までの相対パス（`../../../corpus/generated` など）は 1 文字も触らない。**
`heavy/tests/corpus/` は `web/tests/heavy/` と根から同じ深さにある。

- [ ] **Step 3: Playwright の設定を直す**

`heavy/playwright.corpus.config.ts`:

before:
```ts
  testDir: "./tests/heavy",
```
after:
```ts
  testDir: "./tests/corpus",
```

`webServer.command`:

before:
```ts
    command:
      "pnpm exec vite build --config vite.heavy.config.ts && pnpm exec vite preview --config vite.heavy.config.ts --port 4180 --strictPort",
```
after:
```ts
    command:
      "pnpm exec vite build --config vite.harness.config.ts && pnpm exec vite preview --config vite.harness.config.ts --port 4180 --strictPort",
```

`url` の `http://localhost:4180/heavy-harness.html` は
**`http://localhost:4180/harness/heavy-harness.html` に直す**——
`input` が `harness/heavy-harness.html` になったので、`dist-harness` の中でも
その階層に出る。

**ポート 4180・`--strictPort`・`reuseExistingServer` と、その長い理由づけ
（偽ハーネスを掴んだ 2026-08-15 の実例）はそのまま残す。**

- [ ] **Step 4: `pnpm heavy` を走らせる**

```bash
cd /home/terapyon/dev/CalcArc-e2e/heavy && CI=1 pnpm heavy 2>&1 | tail -8
```

Expected: **195 passed**（Task 1 Step 1 で取り直した数と同じ）。
**1 件でも違えば、12 の相対パスのどれかがずれている。**

- [ ] **Step 5: 型検査と lint**

```bash
cd /home/terapyon/dev/CalcArc-e2e/heavy && pnpm typecheck && pnpm lint
```

Expected: どちらも exit 0。

- [ ] **Step 6: commit**

```bash
cd /home/terapyon/dev/CalcArc-e2e && git add -A heavy web && git commit -F - <<'MSG'
Move the corpus tests, keeping their distance from the root

`web/tests/heavy/` の 18 本を `heavy/tests/corpus/` へ。

**根までの相対パスは 1 文字も触っていない。** これらは
`../../../corpus/generated` のように `import.meta.url` から `..` を数えて
根を出しており、`heavy/tests/corpus/` は `web/tests/heavy/` と**根から
同じ深さ**にある。書き換えたのは `web/src` を指す 3 箇所だけである。

確認: `CI=1 pnpm heavy` が **195 passed**——移動前と同じ数。
1 件でも違えば相対パスのどれかがずれている。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 4: 盤面のテストを移す

**Files:**
- Move: `web/tests/heavy-ui/`（10 本）→ `heavy/tests/ui/`
- Move: `web/playwright.heavy-ui.config.ts` → `heavy/playwright.ui.config.ts`
- Modify: `heavy/tests/ui/{corpus-ui.spec.ts,keys.ts,presses.ts,reachability.spec.ts,sampling.ts}`（import 6 箇所）
- Modify: `heavy/playwright.ui.config.ts`（`testDir` と `webServer`）

**Interfaces:**
- Consumes: Task 1 の `heavy/package.json`
- Produces: `pnpm heavy:ui` が緑。`heavy-ui-run.json` を `heavy/` の直下に
  書くので、Task 3 の報告書がそれを読む

- [ ] **Step 1: 10 本と設定を移す**

```bash
cd /home/terapyon/dev/CalcArc-e2e && git mv web/tests/heavy-ui heavy/tests/ui \
  && git mv web/playwright.heavy-ui.config.ts heavy/playwright.ui.config.ts
```

- [ ] **Step 2: `web/src` を指す import 6 箇所を書き換える**

いずれも `../../src/` を `../../../web/src/` にするだけ。

| ファイル | 行 | before | after |
|---|---|---|---|
| `corpus-ui.spec.ts` | 2 | `from "../../src/calc"` | `from "../../../web/src/calc"` |
| `keys.ts` | 1 | `from "../../src/calc"` | `from "../../../web/src/calc"` |
| `keys.ts` | 2 | `from "../../src/ui/Keypad/scientific"` | `from "../../../web/src/ui/Keypad/scientific"` |
| `presses.ts` | 10 | `from "../../src/calc"` | `from "../../../web/src/calc"` |
| `reachability.spec.ts` | 2 | `from "../../src/calc"` | `from "../../../web/src/calc"` |
| `sampling.ts` | 1 | `from "../../src/calc"` | `from "../../../web/src/calc"` |

**`presses.ts` の 34・37 行目（`../../.heavy-ui-presses/` と
`../../heavy-ui-run.json`）は触らない。** これは根ではなくパッケージの
直下を指していて、深さが同じなので `heavy/` の直下に落ちる。

- [ ] **Step 3: Playwright の設定を直す**

`heavy/playwright.ui.config.ts`:

before:
```ts
  testDir: "./tests/heavy-ui",
```
after:
```ts
  testDir: "./tests/ui",
```

`webServer` に **`cwd` を足す**。ここが本物のアプリを建てる唯一の場所である。

before:
```ts
    command:
      "pnpm exec vite build && pnpm exec vite preview --port 4181 --strictPort",
    url: "http://localhost:4181",
```
after:
```ts
    // **アプリを建てるのは web である。** heavy は自分のパッケージに
    // アプリのビルド設定を持たない——`cwd` で web に建てさせる。
    cwd: "../web",
    command:
      "pnpm exec vite build && pnpm exec vite preview --port 4181 --strictPort",
    url: "http://localhost:4181",
```

- [ ] **Step 4: `pnpm heavy:ui` を走らせる（12 分）**

```bash
cd /home/terapyon/dev/CalcArc-e2e/heavy && CI=1 pnpm heavy:ui 2>&1 | tail -15
```

Expected: **36 passed / 指摘 0 / 46 トークン全押下**。
**押下トークンが 46 未満なら、盤面に届いていないキーがある。**

- [ ] **Step 5: 型検査と lint**

```bash
cd /home/terapyon/dev/CalcArc-e2e/heavy && pnpm typecheck && pnpm lint
```

- [ ] **Step 6: commit**

```bash
cd /home/terapyon/dev/CalcArc-e2e && git add -A heavy web && git commit -F - <<'MSG'
Move the keypad run, and let web keep building the app

`web/tests/heavy-ui/` の 10 本を `heavy/tests/ui/` へ。

**アプリを建てるのは web のままである。** Playwright の `webServer` に
`cwd: "../web"` を足しただけで、コマンドは変えていない——heavy が
アプリのビルド設定を持つことはない。

書き換えたのは `web/src` を指す import 6 箇所だけ。`presses.ts` が
パッケージ直下に落とす 2 つ（`.heavy-ui-presses/` と
`heavy-ui-run.json`）は深さが同じなので触っていない。

確認: `CI=1 pnpm heavy:ui` が **36 passed / 指摘 0 / 46 トークン全押下**
——移動前と同じ。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 5: 変異スクリプトとユニット 6 本を移す

**Files:**
- Move: `web/scripts/{detection,exact}-power.mjs` → `heavy/scripts/`
- Move: `web/tests/unit/{detection-power,detection-power-restore,exact-power,heavy-ui-finance,heavy-ui-presses,heavy-ui-select}.test.ts` → `heavy/tests/unit/`
- Modify: `heavy/scripts/{detection,exact}-power.mjs`（`WEB` の名前）
- Modify: `heavy/tests/unit/{heavy-ui-finance,heavy-ui-presses,heavy-ui-select}.test.ts`（import 5 箇所）

**Interfaces:**
- Consumes: Task 3 の `tests/corpus/`、Task 4 の `tests/ui/`
- Produces: `pnpm test` / `heavy:power` / `heavy:power:exact` が動く

- [ ] **Step 1: 8 本を移す**

```bash
cd /home/terapyon/dev/CalcArc-e2e && mkdir -p heavy/scripts heavy/tests/unit \
  && git mv web/scripts/detection-power.mjs heavy/scripts/ \
  && git mv web/scripts/exact-power.mjs heavy/scripts/ \
  && for f in detection-power detection-power-restore exact-power \
              heavy-ui-finance heavy-ui-presses heavy-ui-select; do \
       git mv "web/tests/unit/$f.test.ts" "heavy/tests/unit/$f.test.ts"; \
     done
```

- [ ] **Step 2: スクリプトの `WEB` を `HEAVY` に読み替える**

`heavy/scripts/detection-power.mjs` の 20-21 行目:

before:
```js
const WEB = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = dirname(WEB);
```
after:
```js
const HEAVY = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = dirname(HEAVY);
```

`heavy/scripts/exact-power.mjs` の 20・26-27 行目も同じ形（`OUT` は
`join(WEB, "exact-power.json")` なので `join(HEAVY, ...)` になる）。

**計算は 1 つも変わらない。** 深さが同じなので `ROOT` は同じ場所を指す。
変えるのは**名前が意味することだけ**である——`WEB` のまま残すと、
`heavy/` を指す変数が `web` を名乗ることになる。

`ROOT` の JSDoc にある「テスト側で根を組み立て直すと解けない(実測)」という
理由づけはそのまま残す。

- [ ] **Step 3: ユニット 6 本の import 5 箇所を書き換える**

| ファイル | before | after |
|---|---|---|
| `heavy-ui-finance.test.ts` | `from "../heavy/corpus"` | `from "../corpus/corpus"` |
| `heavy-ui-finance.test.ts` | `from "../heavy-ui/finance-cases"` | `from "../ui/finance-cases"` |
| `heavy-ui-presses.test.ts` | `from "../heavy-ui/presses"` | `from "../ui/presses"` |
| `heavy-ui-select.test.ts`（2 行目） | `from "../heavy-ui/presses"` | `from "../ui/presses"` |
| `heavy-ui-select.test.ts`（3 行目） | `from "../heavy-ui/select"` | `from "../ui/select"` |

**`../../scripts/detection-power.mjs` と `../../scripts/exact-power.mjs`
（`detection-power-restore.test.ts:5` と `exact-power.test.ts:10`）は
触らない。** 深さが同じなので、そのまま `heavy/scripts/` を指す。

- [ ] **Step 4: ユニット 6 本を走らせる**

```bash
cd /home/terapyon/dev/CalcArc-e2e/heavy && pnpm test 2>&1 | tail -6
```

Expected: **6 ファイル / 86 passed**（2026-08-25 に web 側で実測した数と
同じ）。**`*.spec.ts` を拾っていないこと**も出力で見る——ファイル数が 6 を
超えていたら `vitest.config.ts` の `include` が効いておらず、Playwright の
テストを巻き込んでいる。

- [ ] **Step 5: 変異の検出力を測る（4 分）**

```bash
cd /home/terapyon/dev/CalcArc-e2e/heavy && pnpm heavy:power:exact 2>&1 | tail -10
```

Expected: **10/10 ok**、赤の本数も移動前と同じ。

- [ ] **Step 6: `crates/` に変異が残っていないことを確かめる**

```bash
cd /home/terapyon/dev/CalcArc-e2e && git status --short crates/ && echo "（空なら原状回復できている）"
```

Expected: 出力が空。**変異は測定中に当てるだけで、走行後は差分が無い。**

- [ ] **Step 7: 型検査と lint**

```bash
cd /home/terapyon/dev/CalcArc-e2e/heavy && pnpm typecheck && pnpm lint
```

- [ ] **Step 8: commit**

```bash
cd /home/terapyon/dev/CalcArc-e2e && git add -A heavy web && git commit -F - <<'MSG'
Move the mutation harness and the six tests that watch it

`scripts/{detection,exact}-power.mjs` と、それを見張るユニット 6 本を
`heavy/` へ。

**`const WEB` を `const HEAVY` に改名した。** 計算は 1 つも変わらない
（深さが同じなので `ROOT` は同じ場所を指す）が、**`heavy/` を指す変数が
`web` を名乗ったままなのは、いずれ誰かを誤らせる**。

書き換えた import は 5 箇所（`../heavy/` → `../corpus/`、`../heavy-ui/` →
`../ui/`）。`../../scripts/*.mjs` の 2 箇所は深さが同じなので触っていない。

確認: `pnpm test` 6 本緑、`pnpm heavy:power:exact` **10/10 ok**、
走行後の `git status crates/` が空（原状回復できている）。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 6: `web` から重量級の痕跡を消す

**Files:**
- Modify: `web/package.json`（スクリプト 4 つを削除）
- Modify: `web/tsconfig.json`（`include` から 3 行を削除）

**Interfaces:**
- Consumes: Task 2-5 で `web/` から実ファイルが消えていること
- Produces: `web` が重量級を知らない状態

- [ ] **Step 1: `web/package.json` から 4 スクリプトを消す**

消すのはこの 4 行:

```json
    "heavy": "pnpm wasm && playwright test --config playwright.heavy.config.ts",
    "heavy:ui": "pnpm wasm && playwright test --config playwright.heavy-ui.config.ts",
    "heavy:power": "node scripts/detection-power.mjs",
    "heavy:power:exact": "node scripts/exact-power.mjs",
```

**`e2e` と `test` は残す。** あちらは web 自身の検査である。

- [ ] **Step 2: `web/tsconfig.json` の `include` から 3 行を消す**

```json
    "vite.heavy.config.ts",
    "playwright.heavy.config.ts",
    "playwright.heavy-ui.config.ts"
```

**`"tests"` は残す。** `tests/e2e` と `tests/unit/check-version.test.ts` が
まだそこに居る。**この節に書かれた「以前は `src` だけで、重量級のテストが
型検査の外にいた」という記録も残す**——重量級はもう居ないが、
`tests` を include する理由は `tests/e2e` にそのまま当てはまる。

- [ ] **Step 3: `web` に重量級の痕跡が残っていないことを grep で確かめる**

```bash
cd /home/terapyon/dev/CalcArc-e2e && git grep -n -i 'heavy' -- web/ | grep -v 'check-version'
```

Expected: 出力が空（`check-version` 由来のものだけが除外で消え、残りゼロ）。
**1 件でも残っていたら、それが「入り込んでいる」最後の 1 つである。**

- [ ] **Step 4: `web` 側が何も失っていないことを見る**

```bash
cd /home/terapyon/dev/CalcArc-e2e/web && pnpm typecheck && pnpm lint \
  && pnpm test 2>&1 | tail -5
```

Expected: `typecheck` と `lint` は exit 0。vitest は
**30 ファイル / 364 passed**。移動前は 36 ファイル / 450 件で、
**移す 6 ファイルには 86 件入っている**（2026-08-25 に実測）。
450 − 86 = 364。**この引き算が合わないなら、消しすぎているか
消し足りない。**

- [ ] **Step 5: 通常の e2e が通ることを見る**

```bash
cd /home/terapyon/dev/CalcArc-e2e/web && pnpm e2e 2>&1 | tail -5
```

Expected: **181 passed**。出典は 0.4.0 の最後のコミット `06503c6` の
本文（「cargo 391 / vitest 437 / typecheck・lint / e2e 181」）。
**vitest の 437 は、私が版数ゲートで 13 件足す前の数である**
（437 + 13 = 450 で、いまの数と合う）。**違う数なら、その数を記録して
報告する。**

- [ ] **Step 6: commit**

```bash
cd /home/terapyon/dev/CalcArc-e2e && git add web && git commit -F - <<'MSG'
Stop the app package from knowing that a heavy suite exists

`web/package.json` から重量級の 4 スクリプトを、`web/tsconfig.json` の
`include` から重量級の設定 3 行を消した。

**`tests` は include に残す。** 重量級はもう居ないが、`tests/e2e` と
`tests/unit/check-version.test.ts` が居る。**「以前は `src` だけで、
テストコードが型検査の外にいた」という実害の記録も残す**——理由は
残ったテストにそのまま当てはまる。

確認: `git grep -i heavy -- web/` が空。web 側は typecheck・lint 緑、
vitest は 450 → **444 passed**（移した 6 ファイルぶん、ちょうど）。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 7: `.gitignore`・CI・文書

**Files:**
- Modify: `.gitignore`（8 行）
- Modify: `.github/workflows/heavy-corpus.yml`
- Modify: `CLAUDE.md`
- Modify: `docs/corpus-measurements.md`（冒頭に 1 行）
- Modify: `docs/heavy-corpus-implementation-report.md`（`:5` の 1 箇所）

**Interfaces:**
- Consumes: Task 1-6 で `heavy/` が完成していること
- Produces: CI が新しい配置で回る

- [ ] **Step 1: `.gitignore` の 8 行を直す**

| いま | あと |
|---|---|
| `web/dist-heavy/` | `heavy/dist-harness/` |
| `web/heavy-report.md` | `heavy/heavy-report.md` |
| `web/.heavy-summaries/` | `heavy/.heavy-summaries/` |
| `web/detection-power.json` | `heavy/detection-power.json` |
| `web/exact-power.json` | `heavy/exact-power.json` |
| `web/heavy-run.json` | `heavy/heavy-run.json` |
| `web/.heavy-ui-presses/` | `heavy/.heavy-ui-presses/` |
| `web/heavy-ui-run.json` | `heavy/heavy-ui-run.json` |

**`web/dist/` と `web/src/wasm/` は動かさない**——どちらも web 自身の
生成物である。各行に付いている説明（「`globalSetup` が毎回消す」など）は
そのまま残す。

- [ ] **Step 2: `heavy/node_modules` が無視されることを確かめる**

```bash
cd /home/terapyon/dev/CalcArc-e2e && git status --short | grep -c node_modules; echo "（0 なら無視されている）"
```

Expected: `0`。`.gitignore:2` の `node_modules/` が場所を問わず効く。

- [ ] **Step 3: `heavy-corpus.yml` の `corpus` ジョブの先頭に 4 段足す**

`- uses: ./.github/actions/setup-wasm-pack` の**次**、
`- name: Install Playwright's browser` の**前**に入れる:

```yaml
      # **heavy は自分のパッケージなので、自分で依存を入れる。** pnpm と node は
      # 上の setup-web が用意済みで、版の固定はあちらに一本化されている。
      - name: Install the heavy package
        run: pnpm install --frozen-lockfile
        working-directory: heavy

      # **11 分の変異を回す前に、数十秒で落ちるものを先に落とす。**
      # 重量級のユニット 6 本は「測る道具そのもの」を見張っており、
      # 普段の CI では走らない(2026-08-25 のユーザ裁定)。ここが唯一の場所である。
      - name: The measuring instrument must be sound
        run: pnpm typecheck && pnpm lint && pnpm test
        working-directory: heavy
```

そして下の 4 段の `working-directory: web` を **`heavy`** に直す
（`Measure what this corpus can detect` / `Type a sample on the real keypad` /
`Run the heavy corpus`）。`Install Playwright's browser` は
**`heavy` に直す**——ブラウザを使うのは heavy の Playwright である。

`Put the verdict in the job summary` と `Keep the report as an artifact` の
`web/heavy-report.md` は **`heavy/heavy-report.md`** に直す。

- [ ] **Step 4: YAML の構文と配線を機械で確かめる**

```bash
cd /home/terapyon/dev/CalcArc-e2e && python3 - <<'PY'
import yaml
d = yaml.safe_load(open(".github/workflows/heavy-corpus.yml", encoding="utf-8"))
steps = d["jobs"]["corpus"]["steps"]
for s in steps:
    print(f'{s.get("name") or s.get("uses") or s.get("run","")[:40]:55} -> {s.get("working-directory","")}')
print("jobs:", list(d["jobs"]))
PY
```

Expected: `web` を指す `working-directory` が **1 つも無い**こと
（`uv sync` の `reference` は残る）。

- [ ] **Step 5: `CLAUDE.md` に heavy を足す**

構成表に 1 行:

```
| `heavy` | 重量級の検証。独立した pnpm パッケージで、`web` はこれを知らない |
```

コマンド節に:

````
```bash
cd heavy && pnpm heavy         # 生成コーパスと参照の照合（32 秒）
cd heavy && pnpm heavy:ui      # 本物の盤面を叩く（12 分）
cd heavy && pnpm heavy:power   # 変異の検出力（11 分）
```
````

「守ること」に 1 行:

```
- **重量級のテストを `web/` に置かない。** `heavy/` が持つ。`web` から
  重量級への参照は 0 件であり、この向きを保つ。
```

- [ ] **Step 6: 日付のある記録には、直さずに 1 行だけ足す**

`docs/corpus-measurements.md` の冒頭（`# ` の見出しの直後）に:

```
> **2026-08-25 に重量級は `heavy/` へ移った。** 以下に出てくる `web/tests/heavy/`
> などのパスは、**測定した当時のもの**である。当時の事実として残してある。
```

`docs/heavy-corpus-implementation-report.md` は**現在形の案内が 1 つだけ**
あるので、そこを直す。`:5` の `web/heavy-report.md` → `heavy/heavy-report.md`。
**残りのパス（走行記録・ファイル一覧）は当時の事実なので触らない。**
同じ断り書きを冒頭に置く。

- [ ] **Step 7: commit**

```bash
cd /home/terapyon/dev/CalcArc-e2e && git add -A && git commit -F - <<'MSG'
Point the ignore list, the CI and the living docs at heavy/

`.gitignore` の 8 行を `web/` から `heavy/` へ。**`web/dist/` と
`web/src/wasm/` は動かしていない**——どちらも web 自身の生成物である。

`heavy-corpus.yml` の `corpus` ジョブに 2 段足した。**11 分の変異を回す前に、
heavy の `typecheck` / `lint` / `test`（例の 6 本）を数十秒で通す**——
これらは普段の CI では走らないと決めた(ユーザ裁定 2026-08-25)ので、
ここが道具の健全性を見る唯一の場所である。

**文書は 2 通りに分けた。** 生きている案内(`.gitignore`・`CLAUDE.md`)は直し、
**日付のある記録**(`docs/corpus-measurements.md`・
`docs/heavy-corpus-implementation-report.md`)は直さずに冒頭へ 1 行足した
——当時のパスが当時の事実であり、書き換えれば記録が嘘になる。
後者にあった現在形の案内 1 箇所だけは直した。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 8: 通しのスイープと記録

**Files:**
- Modify: `docs/corpus-measurements.md`（測定の追記）

**Interfaces:**
- Consumes: Task 1-7 のすべて
- Produces: 移動が正しいことの証拠

- [ ] **Step 1: 4 本を通しで回す（合計 28 分ほど）**

```bash
cd /home/terapyon/dev/CalcArc-e2e/heavy \
  && CI=1 pnpm heavy 2>&1 | tail -4 \
  && CI=1 pnpm heavy:power:exact 2>&1 | tail -6 \
  && CI=1 pnpm heavy:ui 2>&1 | tail -6 \
  && CI=1 pnpm heavy:power 2>&1 | tail -8
```

**基準（移動前）と突き合わせる:**

| 検査 | 動いていなければ正しい |
|---|---|
| `pnpm heavy` | 195 passed / 33,567 件 / 不一致 0 |
| `pnpm heavy:power:exact` | 10/10 ok、赤の本数 |
| `pnpm heavy:ui` | 36 passed / 指摘 0 / 46 トークン全押下 |
| `pnpm heavy:power` | 18/18 ok、**各変異の実測率が下限のちょうど 2.00 倍** |

**1 つでも動いていたら、そこで止めて報告する。** 移動で検出力が変わることは
無いはずであり、変わったなら移動が壊している。

- [ ] **Step 2: `crates/` が元に戻っていることを確かめる**

```bash
cd /home/terapyon/dev/CalcArc-e2e && git status --short crates/ && echo "（空なら原状回復できている）"
```

- [ ] **Step 3: web 側をもう一度通す**

```bash
cd /home/terapyon/dev/CalcArc-e2e/web && pnpm typecheck && pnpm lint \
  && pnpm test 2>&1 | tail -3 && pnpm e2e 2>&1 | tail -3
```

- [ ] **Step 4: Rust 側に影響が無いことを確かめる**

```bash
cd /home/terapyon/dev/CalcArc-e2e && cargo test --workspace 2>&1 | tail -5
```

Expected: 全部緑。**この移動は `crates/` を触っていないので、ここが赤なら
変異の戻しが失敗している。**

- [ ] **Step 5: 実測を記録する**

`docs/corpus-measurements.md` に節を足す。**数字は道具が印字したものを
そのまま写す**——見積りや記憶から書かない。移動前後の 4 本を並べ、
**変わっていないこと**が読めるようにする。

- [ ] **Step 6: commit**

```bash
cd /home/terapyon/dev/CalcArc-e2e && git add docs/corpus-measurements.md \
  && git commit -F - <<'MSG'
Record that the move changed none of the numbers

移動後に 4 本を通しで回し、移動前の実測と突き合わせた。**検出力も件数も
押下トークン数も動いていない**——動いていたら、移動が壊している。

数字は道具が印字したものをそのまま写した。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Self-Review（この計画を書いたあとに確かめたこと）

**spec の網羅**: §3 の配置表 → Task 2-5。§4 のパッケージ → Task 1。
§5.1 wasm → Task 1 Step 2 と Task 2。§5.2 コーパス → Task 3。§5.3 盤面 →
Task 4。§5.4 変異 → Task 5。§6 web 側 → Task 6。§7 CI → Task 7 Step 3。
§8 文書と `.gitignore` → Task 7。§9 検証 → Task 8。**取りこぼしは無い。**

**行番号は書いた日の座標である。** この計画に出てくる行番号
（`corpus.ts:47`、`presses.ts:34` など）は 2026-08-25 のものなので、
**実装のときは grep で当て直す**こと。

**移動そのものには「先に落ちるテスト」が無い。** 既存の 4 本が
そのテストであり、**移動前の数と突き合わせること**が赤確認にあたる。
だから Task 1 Step 1 で基準を 1 つ取り直してから始める。

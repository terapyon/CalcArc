# 重量級検証コーパス — 縦の 1 本 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1 シャード分のコーパスを、生成 → ハーネス → ブラウザ内一括実行 → レポートまで縦に 1 本通し、その過程で表示精度と生成時間という二つの未知を実測する。

**Architecture:** Python が式木を作り、キー列（Rust 経路の入口）と数式（Python 経路の入口）という互いを知らない二つの表現に直列化する。ブラウザは専用ハーネスページで `calc.dispatch` を DOM 抜きに回し、1 シャードを 1 回の `page.evaluate` で処理する。比較は Node 側で行い、許容誤差はコーパスの JSON から読む。

**Tech Stack:** Python 3.14 / uv / SymPy / mpmath、TypeScript / Vite / Playwright、Rust（既存の wasm を使うだけで変更しない）

**Spec:** `docs/superpowers/specs/2026-08-15-heavy-corpus-e2e-design.md`

## Global Constraints

- **計算ロジックを新しく書かない。** 計算は `calcarc-core`（Rust）と mpmath（Python）が既に持つ。本計画が書くのは式木・直列化・実行・比較・報告だけである。
- **Python にキー列を渡さない。** Python が見るのは式木と数式のみ。押した順の意味論に触れた瞬間、engine の移植になる（設計書 §5）。
- **許容誤差をテストコードに書かない。** `corpus/**/*.json` の `tolerance` から読む。形は `{"abs": ..., "rel": ...}`（`reference/scripts/generate.py` と同じ）。
- **既存ファイルを編集しない。** 例外は 3 つだけ: `web/package.json`（スクリプト追加）、`web/tsconfig.json`（`vite.heavy.config.ts` を include に追加）、`.gitignore`（成果物の除外）。`vite.config.ts` / `playwright.config.ts` / `ci.yml` / `deploy.yml` / `reference/scripts/generate.py` には**触れない**。
- **ポートは 4180、`--strictPort`。** 既存 E2E の 4179 とも Vite 既定の 4173 とも衝突させない。
- **コーパスは `corpus/` に置く。`testdata/` の下に置かない。**
- **キートークンの綴りは `web/src/calc/types.ts` の `KEY_TOKENS` が正。** Python 側の定数はこれと一字一句同じでなければならない。
- **`web/` の型検査は `web/src/wasm/` を必要とする。** 新しいクローンでは先に `cd web && pnpm wasm`。
- コミットメッセージ末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` を付ける。**`git push` と PR 作成は行わない。**
- Rust に触った場合のみ `cargo fmt` を実行する（本計画では触らない見込み）。

## File Structure

| ファイル | 責務 |
|---|---|
| `web/heavy-harness.html` | ハーネスの入口 HTML。中身は script タグ 1 つ |
| `web/src/heavy-harness.ts` | `initCalc` を読み `window.__calcarc` に露出する。ロジックはキー列を回す 1 関数だけ |
| `web/vite.heavy.config.ts` | ハーネス専用ビルド。PWA も React も持たない最小構成 |
| `web/playwright.heavy.config.ts` | 重い spec 用。`testDir` は `./tests/heavy` |
| `web/tests/heavy/harness.ts` | ページを開く／一括実行する薄いヘルパ。spec から型付きで呼ぶ |
| `web/tests/heavy/display.ts` | 表示文字列を数に戻す。ここに許容誤差は書かない |
| `web/tests/heavy/corpus.ts` | コーパス JSON の読み込みと型 |
| `web/tests/heavy/measure.spec.ts` | 段階 1 の実測。表示書式を記録する |
| `web/tests/heavy/corpus.spec.ts` | 段階 2 の本体。シャードを全件回して比較し、レポートを書く |
| `reference/src/calcarc_reference/corpus_expr.py` | 式木・キー列直列化・数式直列化。**計算しない** |
| `reference/src/calcarc_reference/corpus_eval.py` | 式木を mpmath で評価する。**キー列を見ない** |
| `reference/scripts/generate_corpus.py` | 乱択でシャードを作る。`generate.py` からは呼ばれない |
| `reference/tests/test_corpus_expr.py` | 直列化のテスト |
| `reference/tests/test_corpus_eval.py` | 評価のテスト |
| `corpus/generated/scientific-000.json` | 生成されたシャード（コミットされる） |
| `docs/corpus-measurements.md` | 段階 1 の実測結果。tolerance と件数の根拠 |

---

### Task 1: ハーネスページと heavy ビルド

DOM を経由せずに `calc.dispatch` を回せることを最初に確かめる。ここが立たなければ設計全体が成立しないので、最初に置く。

**Files:**
- Create: `web/heavy-harness.html`
- Create: `web/src/heavy-harness.ts`
- Create: `web/vite.heavy.config.ts`
- Create: `web/playwright.heavy.config.ts`
- Create: `web/tests/heavy/harness.ts`
- Test: `web/tests/heavy/harness.spec.ts`
- Modify: `web/package.json`（`scripts` に 1 行追加）
- Modify: `web/tsconfig.json`（`include` に `vite.heavy.config.ts` を追加）
- Modify: `.gitignore`（`web/dist-heavy/` を追加）

**Interfaces:**
- Consumes: `web/src/calc` の `initCalc()` / `Calc` / `KeyToken`（既存、変更しない）
- Produces:
  - `window.__calcarc.ready: Promise<void>`
  - `window.__calcarc.runAll(sequences: string[][]): HarnessResult[]`
  - `HarnessResult = { main: string; error: string | null }`
  - `openHarness(page: Page): Promise<void>`
  - `runAll(page: Page, sequences: string[][]): Promise<HarnessResult[]>`

- [ ] **Step 1: 失敗するテストを書く**

`web/tests/heavy/harness.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { openHarness, runAll } from "./harness";

test("the harness runs key sequences without touching the DOM", async ({
  page,
}) => {
  await openHarness(page);
  const results = await runAll(page, [
    ["1", "add", "2", "eq"],
    ["9", "div", "0", "eq"],
  ]);

  expect(results).toHaveLength(2);
  expect(results[0]?.error).toBeNull();
  expect(results[0]?.main).toBe("3");
  // エラーは戻り値の一部であって例外ではない(CLAUDE.md の WASM 境界の規約)。
  expect(results[1]?.error).toBe("DivisionByZero");
});

test("each sequence starts from a clean state", async ({ page }) => {
  await openHarness(page);
  const results = await runAll(page, [
    ["5", "add", "5", "eq"],
    ["7", "eq"],
  ]);

  // 2 本目が 1 本目の残りを引きずっていないこと。
  expect(results[1]?.main).toBe("7");
});
```

- [ ] **Step 2: ヘルパを書く**

`web/tests/heavy/harness.ts`:

```ts
import type { Page } from "@playwright/test";

/**
 * ハーネス 1 ケースの結果。表示は整形済み文字列で、数値は取り出せない(設計書 §6.3)。
 *
 * src/heavy-harness.ts にも同じ形の宣言がある。**重複は意図的**である——
 * あちらはブラウザで動く配線、こちらは Node で動くテスト側の型で、
 * import で繋ぐと Playwright の実行文脈にブラウザ用モジュールが引き込まれる。
 * 境界をまたぐ形は、境界の両側に書く。
 */
export interface HarnessResult {
  main: string;
  error: string | null;
}

interface HarnessWindow {
  __calcarc: {
    ready: Promise<void>;
    runAll(sequences: string[][]): HarnessResult[];
  };
}

/**
 * ハーネスページを開き、wasm の初期化を待つ。シャードごとに 1 回だけ呼ぶ。
 * ページの開き直しは高価なので、以後は同じページで回す。
 */
export async function openHarness(page: Page): Promise<void> {
  await page.goto("/heavy-harness.html");
  await page.waitForFunction(() => "__calcarc" in window);
  await page.evaluate(async () => {
    await (window as unknown as HarnessWindow).__calcarc.ready;
  });
}

/** キー列の束を 1 往復で流す。往復を増やさないことが速度の要である。 */
export async function runAll(
  page: Page,
  sequences: string[][],
): Promise<HarnessResult[]> {
  return page.evaluate(
    (batch) => (window as unknown as HarnessWindow).__calcarc.runAll(batch),
    sequences,
  );
}
```

- [ ] **Step 3: 設定ファイルを書く**

`web/vite.heavy.config.ts`:

```ts
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

/**
 * 重量級コーパス(Layer 6)専用のビルド。既存 vite.config.ts には触らない——
 * あちらに入口を足すと VitePWA の workbox がハーネスを precache に巻き込み、
 * 配信する Service Worker が変わってしまう(設計書 §6.4)。
 *
 * React も PWA も要らない。要るのは wasm を読める最小構成だけである。
 */
export default defineConfig({
  base: "/",
  plugins: [wasm(), topLevelAwait()],
  build: {
    target: "es2022",
    outDir: "dist-heavy",
    rollupOptions: { input: "heavy-harness.html" },
  },
});
```

`web/playwright.heavy.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

/**
 * 重量級コーパス(Layer 6)。既存 playwright.config.ts の testDir は
 * ./tests/e2e なので、こちらの spec は構造的に拾われない(設計書 §6.2)。
 */
export default defineConfig({
  testDir: "./tests/heavy",
  // 1 シャードで数千件を回す。既定の 30 秒では足りない。
  timeout: 300_000,
  // 失敗したケースは全部見たい。最初の 1 件で打ち切らない。
  fullyParallel: false,
  use: { baseURL: "http://localhost:4180" },
  webServer: {
    // **ポートは 4180。** 既存 E2E は 4179、Vite 既定は 4173。どちらとも
    // 衝突させない。--strictPort は「取れなければ黙って別ポートに逃げる」を
    // 禁じる——2026-08-15 に他プロジェクトの preview を掴む事故が実在した。
    command:
      "pnpm exec vite build --config vite.heavy.config.ts && pnpm exec vite preview --config vite.heavy.config.ts --port 4180 --strictPort",
    url: "http://localhost:4180/heavy-harness.html",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
```

- [ ] **Step 4: テストを実行して失敗を確かめる**

```bash
cd web && pnpm install && pnpm wasm
pnpm exec playwright install --with-deps chromium
pnpm exec playwright test --config playwright.heavy.config.ts
```

Expected: FAIL。`heavy-harness.html` が無いので preview が 404 を返し、`waitForFunction` がタイムアウトする。

- [ ] **Step 5: ハーネスを実装する**

`web/heavy-harness.html`:

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <title>CalcArc heavy harness</title>
  </head>
  <body>
    <script type="module" src="/src/heavy-harness.ts"></script>
  </body>
</html>
```

`web/src/heavy-harness.ts`:

```ts
/**
 * 重量級コーパス(Layer 6)専用の入口。**配信物には入らない**——
 * vite.heavy.config.ts だけがこのエントリをビルドし、index.html からは
 * 誰も import しないので本番バンドルに到達しない(設計書 §6.4)。
 *
 * ここが存在する理由は一つだけ。本番バンドルは src/calc をグローバルに
 * 露出していないので、page.evaluate から dispatch を呼べないためである。
 * UI そのものの検証は ui 経路(本物のアプリ)が担う。
 */
import { type Calc, initCalc, type KeyToken } from "./calc";

/** 1 ケースの結果。表示は整形済み文字列で、数値は取り出せない(設計書 §6.3)。 */
export interface HarnessResult {
  main: string;
  error: string | null;
}

declare global {
  interface Window {
    __calcarc?: {
      ready: Promise<void>;
      runAll(sequences: string[][]): HarnessResult[];
    };
  }
}

let calc: Calc | null = null;

const ready = initCalc().then((instance) => {
  calc = instance;
});

/**
 * キー列の束をまとめて回す。1 束 = 1 往復に抑えることが速度の要で、
 * ケースごとに page.evaluate すると往復のコストが計算のコストを覆い隠す。
 */
function runAll(sequences: string[][]): HarnessResult[] {
  if (calc === null) {
    throw new Error("heavy-harness: runAll was called before ready resolved");
  }
  const engine = calc;
  return sequences.map((keys) => {
    // ケースごとに初期状態から始める。前のケースの残りを引きずらない。
    let step = engine.initial();
    for (const key of keys) {
      step = engine.dispatch(step.state, key as KeyToken);
    }
    return { main: step.display.main, error: step.display.error };
  });
}

window.__calcarc = { ready, runAll };
```

- [ ] **Step 6: 設定を配線する**

`web/package.json` の `scripts` に追加:

```json
"heavy": "pnpm wasm && playwright test --config playwright.heavy.config.ts"
```

`web/tsconfig.json` の `include` を `["src", "vite.config.ts", "vite.heavy.config.ts"]` にする。

`.gitignore` に追加:

```
web/dist-heavy/
```

- [ ] **Step 7: テストを実行して通ることを確かめる**

```bash
cd web && pnpm heavy
```

Expected: PASS（2 件）。

`main` が `"3"` 以外だった場合は**テストを実測値に合わせて直す**。それが Task 2 で確定させる表示書式そのものであり、想定と違ったこと自体が記録すべき発見である。

- [ ] **Step 8: 型検査と lint**

```bash
cd web && pnpm typecheck && pnpm lint
```

Expected: どちらも PASS。`src/heavy-harness.ts` は `src` 配下なので `pnpm typecheck` の対象に入る。

- [ ] **Step 9: コミット**

```bash
git add web/heavy-harness.html web/src/heavy-harness.ts web/vite.heavy.config.ts \
        web/playwright.heavy.config.ts web/tests/heavy/ web/package.json \
        web/tsconfig.json .gitignore
git commit -m "Reach the engine without going through the buttons"
```

---

### Task 2: 表示書式を実測し、tolerance を決める

設計書 §6.3 の「表示精度の壁」を数字にする。**この層が何桁まで言えるのか**が、コーパスの `tolerance` と、生成器が許す値の範囲を決める。

**Files:**
- Create: `web/tests/heavy/measure.spec.ts`
- Create: `web/tests/heavy/display.ts`
- Create: `docs/corpus-measurements.md`
- Test: `web/tests/heavy/display.spec.ts`

**Interfaces:**
- Consumes: `openHarness` / `runAll` / `HarnessResult`（Task 1）
- Produces: `parseDisplay(main: string): number`

- [ ] **Step 1: 実測用の spec を書く**

これは合否を判定しない観測である。TDD の例外であることを承知の上で置く——測らずには次の一行が書けないためである。

`web/tests/heavy/measure.spec.ts`:

```ts
import { test } from "@playwright/test";
import { openHarness, runAll } from "./harness";

// 表示書式を知るための探り。合否は判定せず、観測結果を出力する。
const PROBES: [string, string[]][] = [
  ["整数", ["3", "eq"]],
  ["2 の平方根", ["2", "sqrt"]],
  ["1 ÷ 3", ["1", "div", "3", "eq"]],
  ["円周率", ["pi"]],
  ["負の数", ["5", "neg"]],
  ["大きい数", ["9", "zeros3", "zeros3", "mul", "9", "zeros3", "zeros3", "eq"]],
  ["小さい数", ["1", "div", "9", "zeros3", "zeros3", "eq"]],
  ["sin 30 度", ["3", "0", "sin"]],
  ["負数の平方根", ["4", "neg", "sqrt"]],
];

test("record how the display formats numbers", async ({ page }) => {
  await openHarness(page);
  const results = await runAll(
    page,
    PROBES.map(([, keys]) => keys),
  );
  for (const [index, probe] of PROBES.entries()) {
    console.log(`${probe[0]}: ${JSON.stringify(results[index])}`);
  }
});
```

- [ ] **Step 2: 実測を走らせて出力を記録する**

```bash
cd web && pnpm heavy -- measure.spec.ts
```

出力の 9 行をそのまま控える。特に見るのは 3 点:

1. **有効桁数** — `2 の平方根` が何桁出るか。これが `tolerance` の上限を決める。
2. **指数表記の有無と形** — `大きい数` / `小さい数` が `1.23e+15` の形か、別の形か、それとも桁を並べるか。
3. **区切り記号と負号** — カンマ区切りの有無、負号が ASCII の `-` か U+2212 か。

- [ ] **Step 3: 実測結果を文書にする**

`docs/corpus-measurements.md` を作り、上の 9 行と、そこから決めた値を書く。

```markdown
# コーパスの実測値

設計書 `2026-08-15-heavy-corpus-e2e-design.md` §6.3 / §11 の未知を実測した記録。

## 表示書式（2026-08-15 実測）

| 探り | キー列 | 表示 |
|---|---|---|
| 整数 | `3 =` | （実測値） |
| … | | |

## 決めた値

- **有効桁数**: （実測値）桁
- **tolerance**: `{"abs": …, "rel": …}` — 有効桁数から決めた。これより
  細かい差は表示に現れないので、主張できない。
- **平坦表示の範囲**: |x| が … 〜 … のとき指数表記にならない。縦の 1 本では
  生成器をこの範囲に閉じ込め、指数表記の解釈は段階 3 に送る。
```

- [ ] **Step 4: parseDisplay の失敗するテストを書く**

**実測した文字列そのもの**をテストに入れる。想像で書かない。

`web/tests/heavy/display.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { parseDisplay } from "./display";

// 入力は Task 2 Step 2 で実測した表示文字列そのもの。
test("plain decimals are read back", () => {
  expect(parseDisplay("3")).toBe(3);
  expect(parseDisplay("1.4142135624")).toBeCloseTo(1.4142135624, 10);
});

test("a negative sign is read whichever glyph is used", () => {
  expect(parseDisplay("-5")).toBe(-5);
  expect(parseDisplay("−5")).toBe(-5);
});

test("a display that is not a number is refused loudly", () => {
  // 黙って NaN を返すと、比較が「誤差の範囲外」ではなく「常に不一致」に
  // 化けて原因が見えなくなる。
  expect(() => parseDisplay("Error")).toThrow();
});
```

- [ ] **Step 5: テストを実行して失敗を確かめる**

```bash
cd web && pnpm heavy -- display.spec.ts
```

Expected: FAIL。`./display` が存在しない。

- [ ] **Step 6: parseDisplay を実装する**

`web/tests/heavy/display.ts`:

```ts
/**
 * 表示文字列を数に戻す。
 *
 * **許容誤差はここに書かない。** corpus の JSON が持つ(CLAUDE.md の規約)。
 * ここがするのは書式の逆変換だけである。
 */
export function parseDisplay(main: string): number {
  const cleaned = main
    .replace(/,/g, "") // 桁区切り
    .replace(/−/g, "-"); // 数学用マイナス
  const value = Number(cleaned);
  if (!Number.isFinite(value)) {
    // 黙って NaN を返すと、比較が「誤差の範囲外」ではなく「常に不一致」に
    // 化けて、原因が書式なのか計算なのか分からなくなる。
    throw new Error(`display: cannot read ${JSON.stringify(main)} as a number`);
  }
  return value;
}
```

Step 2 の実測で指数表記が `Number()` の解さない形（`×10` など）だった場合は、その形をここで `e` 表記に置き換える一行を足し、Step 4 のテストに実測値の例を 1 件足す。

- [ ] **Step 7: テストを実行して通ることを確かめる**

```bash
cd web && pnpm heavy -- display.spec.ts
```

Expected: PASS（3 件）。

- [ ] **Step 8: コミット**

```bash
git add web/tests/heavy/measure.spec.ts web/tests/heavy/display.ts \
        web/tests/heavy/display.spec.ts docs/corpus-measurements.md
git commit -m "Find out how many digits the screen is willing to say"
```

---

### Task 3: 式木とキー列直列化（Python、計算しない）

**Files:**
- Create: `reference/src/calcarc_reference/corpus_expr.py`
- Test: `reference/tests/test_corpus_expr.py`

**Interfaces:**
- Consumes: なし（純粋な Python。SymPy も mpmath も import しない）
- Produces:
  - `Num(value: int)` / `Bin(op: str, left: Node, right: Node)` / `Un(fn: str, arg: Node)`
  - `Node = Num | Bin | Un`
  - `to_keys(node: Node) -> list[str]` — `eq` を含まない
  - `to_key_sequence(node: Node) -> list[str]` — 末尾に `eq` を付ける
  - `to_expr_text(node: Node) -> str`
  - `walk(node: Node) -> Iterator[Node]`
  - `BINARY_OPS = ("+", "-", "*", "/")` / `UNARY_FNS = ("sqrt", "sqr", "sin", "cos", "tan", "neg")`

- [ ] **Step 1: 失敗するテストを書く**

`reference/tests/test_corpus_expr.py`:

```python
"""式木の二つの直列化。**ここでは一切計算しない。**"""

from calcarc_reference.corpus_expr import (
    Bin,
    Num,
    Un,
    to_expr_text,
    to_key_sequence,
    to_keys,
    walk,
)


def test_a_literal_becomes_its_digits() -> None:
    assert to_keys(Num(407)) == ["4", "0", "7"]


def test_a_binary_node_is_always_parenthesised() -> None:
    # 優先順位に頼らない。結合規則の検証は engine_table.rs の担当である。
    assert to_keys(Bin("+", Num(1), Num(2))) == [
        "lparen", "1", "add", "2", "rparen",
    ]


def test_a_unary_function_is_postfix() -> None:
    # 数を入れてから押す。
    assert to_keys(Un("sqrt", Num(2))) == ["2", "sqrt"]


def test_nesting_keeps_both_shapes_in_step() -> None:
    node = Bin("*", Un("sqrt", Num(2)), Num(3))
    assert to_keys(node) == ["lparen", "2", "sqrt", "mul", "3", "rparen"]
    assert to_expr_text(node) == "(sqrt(2) * 3)"


def test_the_sequence_ends_with_equals() -> None:
    assert to_key_sequence(Num(5)) == ["5", "eq"]


def test_trigonometry_says_the_angle_is_degrees() -> None:
    # コーパスの mode は Deg 固定。数式側にもそう書いておかないと、
    # 読んだ人が弧度法と取り違える。
    assert to_expr_text(Un("sin", Num(30))) == "sin(rad(30))"


def test_walk_visits_every_subtree() -> None:
    node = Bin("+", Num(1), Un("neg", Num(2)))
    assert len(list(walk(node))) == 4
```

- [ ] **Step 2: テストを実行して失敗を確かめる**

```bash
cd reference && uv run pytest tests/test_corpus_expr.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'calcarc_reference.corpus_expr'`

- [ ] **Step 3: 実装する**

`reference/src/calcarc_reference/corpus_expr.py`:

```python
"""重量級コーパスの式木と、その二つの直列化(設計書 §5)。

**このモジュールは計算しない。** ここが作るのは「同じ式木の二つの書き方」
だけで、値を出すのは Rust(キー列を食べる)と mpmath(数式を評価する)が
それぞれ独立に行う。両者がアルゴリズムを共有しないことが検証の土台である。

SymPy も mpmath も import しない。純粋であることが目で見て分かるようにする。
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

# **綴りは web/src/calc/types.ts の KEY_TOKENS が正。** 一字でも違うと
# ブラウザ側で未知のキーとして扱われる。
DIGIT_KEYS = ("0", "1", "2", "3", "4", "5", "6", "7", "8", "9")
BINARY_KEYS = {"+": "add", "-": "sub", "*": "mul", "/": "div"}
UNARY_KEYS = {
    "sqrt": "sqrt",
    "sqr": "sqr",
    "sin": "sin",
    "cos": "cos",
    "tan": "tan",
    "neg": "neg",
}

BINARY_OPS = ("+", "-", "*", "/")
UNARY_FNS = ("sqrt", "sqr", "sin", "cos", "tan", "neg")


@dataclass(frozen=True)
class Num:
    """非負整数のリテラル。押した桁がそのままキーになる。"""

    value: int


@dataclass(frozen=True)
class Bin:
    op: str
    left: Node
    right: Node


@dataclass(frozen=True)
class Un:
    fn: str
    arg: Node


Node = Num | Bin | Un


def walk(node: Node) -> Iterator[Node]:
    """自身と全ての部分木。生成器が中間値の範囲を検査するために使う。"""
    yield node
    if isinstance(node, Bin):
        yield from walk(node.left)
        yield from walk(node.right)
    elif isinstance(node, Un):
        yield from walk(node.arg)


def to_keys(node: Node) -> list[str]:
    """式木をキー列にする。**二項は常に括弧で囲む。**

    優先順位に頼らないので、直列化が engine の結合規則を知らずに済む。
    優先順位そのものの検証は engine_table.rs の担当である(設計書 §5.1)。
    括弧を省いた版は段階 3 で足す。
    """
    if isinstance(node, Num):
        return [DIGIT_KEYS[int(digit)] for digit in str(node.value)]
    if isinstance(node, Un):
        return [*to_keys(node.arg), UNARY_KEYS[node.fn]]
    return [
        "lparen",
        *to_keys(node.left),
        BINARY_KEYS[node.op],
        *to_keys(node.right),
        "rparen",
    ]


def to_key_sequence(node: Node) -> list[str]:
    """corpus の `keys` に入る形。末尾の `=` まで含む。"""
    return [*to_keys(node), "eq"]


def to_expr_text(node: Node) -> str:
    """corpus の `expr` に入る形。**人が読んで検算できることが要件**である。

    投稿者はこの文字列を見て「この期待値で合っているか」を判断する。
    """
    if isinstance(node, Num):
        return str(node.value)
    if isinstance(node, Un):
        inner = to_expr_text(node.arg)
        if node.fn == "sqr":
            return f"({inner})^2"
        if node.fn == "neg":
            return f"-({inner})"
        if node.fn in ("sin", "cos", "tan"):
            # 角度が度であることを数式そのものに書く。読み違えを防ぐ。
            return f"{node.fn}(rad({inner}))"
        return f"sqrt({inner})"
    return f"({to_expr_text(node.left)} {node.op} {to_expr_text(node.right)})"
```

- [ ] **Step 4: テストを実行して通ることを確かめる**

```bash
cd reference && uv run pytest tests/test_corpus_expr.py -v
```

Expected: PASS（7 件）

- [ ] **Step 5: lint と format**

```bash
cd reference && uv run ruff check . && uv run ruff format --check .
```

Expected: どちらも PASS。落ちたら `uv run ruff format .` で直す。

- [ ] **Step 6: コミット**

```bash
git add reference/src/calcarc_reference/corpus_expr.py reference/tests/test_corpus_expr.py
git commit -m "Write the same expression twice, in two notations that share nothing"
```

---

### Task 4: 式木の評価（mpmath、キー列を見ない）

**Files:**
- Create: `reference/src/calcarc_reference/corpus_eval.py`
- Test: `reference/tests/test_corpus_eval.py`

**Interfaces:**
- Consumes: `Num` / `Bin` / `Un` / `Node` / `walk`（Task 3）
- Produces:
  - `OutOfShard(Exception)` — この層で扱わない値に当たったことを表す
  - `evaluate(node: Node) -> mpmath.mpf`

- [ ] **Step 1: 失敗するテストを書く**

`reference/tests/test_corpus_eval.py`:

```python
"""式木の評価。**キー列を一切見ない**——見た瞬間 engine の移植になる。"""

import mpmath as mp
import pytest

from calcarc_reference.corpus_eval import OutOfShard, evaluate
from calcarc_reference.corpus_expr import Bin, Num, Un


def test_arithmetic() -> None:
    assert evaluate(Bin("+", Num(1), Num(2))) == mp.mpf(3)
    assert evaluate(Bin("/", Num(1), Num(4))) == mp.mpf("0.25")


def test_square_root() -> None:
    assert evaluate(Un("sqrt", Num(2))) == mp.sqrt(2)


def test_trigonometry_is_in_degrees() -> None:
    # sin 30 度 = 1/2。弧度法で読むと 0.5 にならない。
    assert abs(evaluate(Un("sin", Num(30))) - mp.mpf("0.5")) < mp.mpf("1e-40")


def test_division_by_zero_is_out_of_this_shard() -> None:
    # エラーの扱いは段階 3 の主題。縦の 1 本では生成器が避ける。
    with pytest.raises(OutOfShard):
        evaluate(Bin("/", Num(1), Num(0)))


def test_the_square_root_of_a_negative_is_out_of_this_shard() -> None:
    # 複素数に落ちる。実部・虚部の比較は段階 3 で扱う。
    with pytest.raises(OutOfShard):
        evaluate(Un("sqrt", Un("neg", Num(4))))


def test_precision_is_higher_than_the_display_can_show() -> None:
    # 50 桁で評価する。表示が言えるのはその一部だが、参照側が
    # 表示精度に合わせて丸む理由はない(設計書 §6.3)。
    value = evaluate(Un("sqrt", Num(2)))
    assert mp.nstr(value, 30) != mp.nstr(mp.mpf(1.4142135623730951), 30)
```

- [ ] **Step 2: テストを実行して失敗を確かめる**

```bash
cd reference && uv run pytest tests/test_corpus_eval.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'calcarc_reference.corpus_eval'`

- [ ] **Step 3: 実装する**

`reference/src/calcarc_reference/corpus_eval.py`:

```python
"""式木を数として評価する経路(設計書 §5)。

**キー列を見てはならない。** ここが見るのは式木の数学的な意味だけで、
押した順の意味論(保留演算・括弧・角度モードの切り替え)には一切触れない。
触った瞬間 engine の移植になり、独立検証が壊れる。

精度は scientific_ref.py と同じ 50 桁。表示が言えるのはその一部だが、
参照側が表示に合わせて精度を落とす理由はない。
"""

from __future__ import annotations

import mpmath as mp

from .corpus_expr import Bin, Node, Num, Un

mp.mp.dps = 50


class OutOfShard(Exception):
    """このシャードが扱わない値に当たった。生成器はこれを見て捨てる。

    縦の 1 本では、エラー(ゼロ除算)と複素数(負数の平方根)を範囲外にする。
    どちらも扱えないからではなく、比較の形が違うので段階を分けたためである。
    """


def evaluate(node: Node) -> mp.mpf:
    if isinstance(node, Num):
        return mp.mpf(node.value)
    if isinstance(node, Un):
        value = evaluate(node.arg)
        if node.fn == "sqrt":
            if value < 0:
                raise OutOfShard("sqrt of a negative number")
            return mp.sqrt(value)
        if node.fn == "sqr":
            return value * value
        if node.fn == "neg":
            return -value
        # 角度は度。ラジアンに直してから渡す。
        return getattr(mp, node.fn)(value * mp.pi / 180)
    left = evaluate(node.left)
    right = evaluate(node.right)
    if node.op == "+":
        return left + right
    if node.op == "-":
        return left - right
    if node.op == "*":
        return left * right
    if right == 0:
        raise OutOfShard("division by zero")
    return left / right
```

- [ ] **Step 4: テストを実行して通ることを確かめる**

```bash
cd reference && uv run pytest tests/test_corpus_eval.py -v
```

Expected: PASS（6 件）

`test_trigonometry_is_in_degrees` が落ちる場合、`tan` の極（90 度など）に当たっていないか確認する。当たっていれば `OutOfShard` に加える判断が要る——その場合は判断を `docs/corpus-measurements.md` に記録してから足す。

- [ ] **Step 5: lint と format**

```bash
cd reference && uv run ruff check . && uv run ruff format --check .
```

- [ ] **Step 6: コミット**

```bash
git add reference/src/calcarc_reference/corpus_eval.py reference/tests/test_corpus_eval.py
git commit -m "Let mpmath answer without ever seeing which buttons were pressed"
```

---

### Task 5: 生成器と 1 シャード、そして生成時間の実測

**Files:**
- Create: `reference/scripts/generate_corpus.py`
- Create: `corpus/generated/scientific-000.json`
- Modify: `docs/corpus-measurements.md`（生成時間の節を追加）
- Test: `reference/tests/test_generate_corpus.py`

**Interfaces:**
- Consumes: Task 3 と Task 4 の全て
- Produces:
  - `random_node(rng: random.Random, depth: int) -> Node`
  - `build_shard(seed: int, count: int) -> dict`
  - `SCHEMA = 1` / `TOLERANCE`（Task 2 の実測値）/ `MIN_ABS` / `MAX_ABS`

- [ ] **Step 1: 失敗するテストを書く**

`reference/tests/test_generate_corpus.py`:

```python
"""生成器。**同じ種から常に同じコーパスが出ること**が最重要である。"""

import importlib.util
import pathlib
import sys

import mpmath as mp

_PATH = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "generate_corpus.py"
_SPEC = importlib.util.spec_from_file_location("generate_corpus", _PATH)
assert _SPEC is not None and _SPEC.loader is not None
generate_corpus = importlib.util.module_from_spec(_SPEC)
sys.modules["generate_corpus"] = generate_corpus
_SPEC.loader.exec_module(generate_corpus)


def test_the_same_seed_gives_the_same_shard() -> None:
    # 固定コーパスの土台。ここが崩れると「通った」の意味が毎回変わる。
    first = generate_corpus.build_shard(seed=1, count=20)
    second = generate_corpus.build_shard(seed=1, count=20)
    assert first == second


def test_a_different_seed_gives_a_different_shard() -> None:
    first = generate_corpus.build_shard(seed=1, count=20)
    second = generate_corpus.build_shard(seed=2, count=20)
    assert first != second


def test_ids_are_unique() -> None:
    shard = generate_corpus.build_shard(seed=3, count=200)
    ids = [case["id"] for case in shard["cases"]]
    assert len(set(ids)) == len(ids)


def test_every_case_carries_both_notations() -> None:
    shard = generate_corpus.build_shard(seed=4, count=50)
    for case in shard["cases"]:
        assert case["kind"] == "value"
        assert case["keys"]
        assert case["expr"]
        assert "re" in case["expect"]


def test_every_value_stays_inside_the_plain_display_range() -> None:
    # 指数表記の解釈は段階 3 に送った。生成器がその範囲に踏み込まないこと。
    shard = generate_corpus.build_shard(seed=5, count=200)
    for case in shard["cases"]:
        magnitude = abs(mp.mpf(case["expect"]["re"]))
        assert magnitude == 0 or generate_corpus.MIN_ABS <= magnitude <= generate_corpus.MAX_ABS


def test_the_envelope_matches_the_existing_golden_convention() -> None:
    shard = generate_corpus.build_shard(seed=6, count=10)
    assert shard["schema"] == 1
    assert "sympy" in shard["generated_by"]
    assert set(shard["tolerance"]) == {"abs", "rel"}
```

- [ ] **Step 2: テストを実行して失敗を確かめる**

```bash
cd reference && uv run pytest tests/test_generate_corpus.py -v
```

Expected: FAIL — `scripts/generate_corpus.py` が存在せず `spec_from_file_location` が `None` を返す。

- [ ] **Step 3: 実装する**

`reference/scripts/generate_corpus.py`:

```python
"""corpus/generated/*.json を生成する(設計書 §7.1)。

**generate.py からは呼ばれない。** 呼ぶと毎 PR の再生成一致チェックが
数万件を背負う。再生成が一致することの確認はリリース時にだけ行う。

種を固定するので、同じ入力から常に同じシャードが出る(固定コーパス)。
"""

from __future__ import annotations

import json
import pathlib
import random
import sys
import time

import mpmath as mp
import sympy

from calcarc_reference.corpus_eval import OutOfShard, evaluate
from calcarc_reference.corpus_expr import (
    BINARY_OPS,
    UNARY_FNS,
    Bin,
    Node,
    Num,
    Un,
    to_expr_text,
    to_key_sequence,
    walk,
)

SCHEMA = 1
# Task 2 の実測から決めた値。表示が言えない細かさを主張しない(設計書 §6.3)。
TOLERANCE = {"abs": 1e-9, "rel": 1e-9}
# 平坦な十進表示に収まる範囲。指数表記の解釈は段階 3 に送った。
MIN_ABS = mp.mpf("1e-6")
MAX_ABS = mp.mpf("1e10")
MAX_DEPTH = 3
CORPUS = pathlib.Path(__file__).resolve().parents[2] / "corpus" / "generated"


def _provenance() -> str:
    # generate.py の _provenance と同じ形。生成器の版が golden に残る。
    return (
        f"sympy {sympy.__version__} / mpmath {mp.__version__}, "
        f"Python {sys.version_info.major}.{sys.version_info.minor}"
    )


def random_node(rng: random.Random, depth: int) -> Node:
    """深さで打ち切る乱択。葉は 1〜3 桁の非負整数。

    分布は意図して決める。放っておくと似た形ばかり出て、「大量に試した」が
    「同じような式を大量に試した」に化ける(設計書 §11)。
    """
    if depth <= 0 or rng.random() < 0.35:
        return Num(rng.randint(0, 999))
    if rng.random() < 0.45:
        return Un(rng.choice(UNARY_FNS), random_node(rng, depth - 1))
    return Bin(
        rng.choice(BINARY_OPS),
        random_node(rng, depth - 1),
        random_node(rng, depth - 1),
    )


def _within_range(node: Node) -> bool:
    """**中間値も範囲に収める。** 着地だけ見ると、途中で指数表記に飛んだ
    式が混ざり、表示の読み取りが書式の問題で落ちる。"""
    for sub in walk(node):
        value = evaluate(sub)
        if value != 0 and not (MIN_ABS <= abs(value) <= MAX_ABS):
            return False
    return True


def build_shard(seed: int, count: int) -> dict:
    rng = random.Random(seed)
    entries: list[dict] = []
    seen: set[str] = set()
    attempts = 0
    while len(entries) < count:
        attempts += 1
        if attempts > count * 200:
            raise RuntimeError(
                f"gave up after {attempts} attempts with {len(entries)}/{count} cases"
            )
        node = random_node(rng, MAX_DEPTH)
        try:
            if not _within_range(node):
                continue
            value = evaluate(node)
        except OutOfShard:
            continue
        expr = to_expr_text(node)
        if expr in seen:
            continue
        seen.add(expr)
        entries.append(
            {
                "kind": "value",
                "id": f"sci-{len(entries):06d}",
                "mode": "Deg",
                "keys": to_key_sequence(node),
                "expr": expr,
                "expect": {"re": float(value), "im": 0.0},
            }
        )
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "tolerance": TOLERANCE,
        "cases": entries,
    }


def write(name: str, payload: dict) -> None:
    path = CORPUS / name
    path.parent.mkdir(parents=True, exist_ok=True)
    # generate.py と同じ整形。差分を安定させ、nan / inf を書き出さない。
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {path} ({len(payload['cases'])} cases)")


def main() -> None:
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
    started = time.monotonic()
    write("scientific-000.json", build_shard(seed=20260815, count=count))
    elapsed = time.monotonic() - started
    # 生成時間はコーパスの上限を決める(設計書 §11)。必ず表に出す。
    print(f"generated {count} cases in {elapsed:.1f}s ({elapsed / count * 1000:.1f}ms each)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: テストを実行して通ることを確かめる**

```bash
cd reference && uv run pytest tests/test_generate_corpus.py -v
```

Expected: PASS（6 件）

- [ ] **Step 5: 生成時間を測る**

```bash
cd reference && uv run python scripts/generate_corpus.py 1000
```

出力の `generated 1000 cases in …s (…ms each)` を控える。これが設計書 §11 の
「コーパスの上限は生成時間で決まる」を数字にしたものである。

`docs/corpus-measurements.md` に節を足す:

```markdown
## 生成時間（2026-08-15 実測）

- 1 ケースあたり: … ms
- 2000 件のシャード 1 枚: … 秒
- 目標総件数 … 件に必要な生成時間: … 分

この時間はリリース時にしか払わない（毎 PR の再生成一致チェックには乗せない）。
```

- [ ] **Step 6: 本番のシャードを生成する**

```bash
cd reference && uv run python scripts/generate_corpus.py 2000
```

- [ ] **Step 7: lint と format**

```bash
cd reference && uv run ruff check . && uv run ruff format --check .
```

- [ ] **Step 8: コミット**

```bash
git add reference/scripts/generate_corpus.py reference/tests/test_generate_corpus.py \
        corpus/generated/scientific-000.json docs/corpus-measurements.md
git commit -m "Grow the first two thousand, and time how long growing costs"
```

---

### Task 6: シャードを全件回して比較する

**Files:**
- Create: `web/tests/heavy/corpus.ts`
- Test: `web/tests/heavy/corpus.spec.ts`

**Interfaces:**
- Consumes: `openHarness` / `runAll` / `HarnessResult`（Task 1）、`parseDisplay`（Task 2）、`corpus/generated/*.json`（Task 5）
- Produces:
  - `Tolerance = { abs: number; rel: number }`
  - `ValueCase = { kind: "value"; id: string; mode: string; keys: string[]; expr: string; expect: { re: number; im: number } }`
  - `Shard = { schema: number; generated_by: string; tolerance: Tolerance; cases: ValueCase[] }`
  - `loadShards(): { name: string; shard: Shard }[]`
  - `withinTolerance(actual: number, expected: number, tolerance: Tolerance): boolean`

- [ ] **Step 1: 失敗するテストを書く**

`web/tests/heavy/corpus.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { loadShards, withinTolerance } from "./corpus";
import { parseDisplay } from "./display";
import { openHarness, runAll } from "./harness";

test("withinTolerance compares against the numbers it is handed", () => {
  // ここのリテラルは **withinTolerance 自身の入力**であって、コーパスの
  // 許容誤差ではない。実際の比較(下の test)は shard.tolerance だけを使う。
  // CLAUDE.md が禁じているのは後者をコードに書くことである。
  const tolerance = { abs: 1e-9, rel: 1e-9 };
  expect(withinTolerance(1, 1 + 1e-12, tolerance)).toBe(true);
  expect(withinTolerance(1, 1.5, tolerance)).toBe(false);
  // 相対誤差が効く大きさ。
  expect(withinTolerance(1e8, 1e8 + 1, tolerance)).toBe(false);
});

test("at least one shard is present", () => {
  expect(loadShards().length).toBeGreaterThan(0);
});

for (const { name, shard } of loadShards()) {
  test(`every case in ${name} matches the reference`, async ({ page }) => {
    await openHarness(page);
    // 1 シャード = 1 往復。ケースごとに evaluate すると往復が計算を覆い隠す。
    const results = await runAll(
      page,
      shard.cases.map((c) => c.keys),
    );

    const mismatches: string[] = [];
    for (const [index, testCase] of shard.cases.entries()) {
      const result = results[index];
      if (result === undefined) {
        mismatches.push(`${testCase.id}: the harness returned nothing`);
        continue;
      }
      if (result.error !== null) {
        mismatches.push(`${testCase.id}: ${testCase.expr} → error ${result.error}`);
        continue;
      }
      const actual = parseDisplay(result.main);
      if (!withinTolerance(actual, testCase.expect.re, shard.tolerance)) {
        mismatches.push(
          `${testCase.id}: ${testCase.expr} → ${result.main}, expected ${testCase.expect.re}`,
        );
      }
    }

    // 先頭 20 件だけ読ませる。端末で読める量に上限を置き、全件は
    // Task 8 のレポートが持つ(設計書 §8)。
    expect(
      mismatches.slice(0, 20).join("\n"),
      `${mismatches.length} of ${shard.cases.length} cases disagree`,
    ).toBe("");
  });
}
```

- [ ] **Step 2: テストを実行して失敗を確かめる**

```bash
cd web && pnpm heavy -- corpus.spec.ts
```

Expected: FAIL — `./corpus` が存在しない。

- [ ] **Step 3: 実装する**

`web/tests/heavy/corpus.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** 許容誤差。**値はコーパスの JSON が持つ**(CLAUDE.md の規約)。 */
export interface Tolerance {
  abs: number;
  rel: number;
}

export interface ValueCase {
  kind: "value";
  id: string;
  mode: string;
  keys: string[];
  expr: string;
  expect: { re: number; im: number };
}

export interface Shard {
  schema: number;
  generated_by: string;
  tolerance: Tolerance;
  cases: ValueCase[];
}

// web/tests/heavy/ から見たリポジトリ直下。package.json が type: module
// なので __dirname は無い。
const HERE = fileURLToPath(new URL(".", import.meta.url));
const CORPUS = join(HERE, "..", "..", "..", "corpus", "generated");

export function loadShards(): { name: string; shard: Shard }[] {
  return readdirSync(CORPUS)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({
      name,
      shard: JSON.parse(readFileSync(join(CORPUS, name), "utf-8")) as Shard,
    }));
}

/**
 * 絶対誤差と相対誤差のどちらかに収まれば一致とみなす。
 * generate.py の tolerance が abs / rel の対である以上、読み方も対にする。
 */
export function withinTolerance(
  actual: number,
  expected: number,
  tolerance: Tolerance,
): boolean {
  const difference = Math.abs(actual - expected);
  if (difference <= tolerance.abs) {
    return true;
  }
  const scale = Math.abs(expected);
  return scale > 0 && difference / scale <= tolerance.rel;
}
```

- [ ] **Step 4: テストを実行して通ることを確かめる**

```bash
cd web && pnpm heavy -- corpus.spec.ts
```

Expected: PASS（3 件。うち 1 件が 2000 ケースを回す）

**落ちた場合、それは成果である。** 落ちたケースの `expr` を手で検算し、
Rust・Python・直列化のどれが外れているかを切り分けてから直す。
直列化の誤りなら Task 3 に戻る。tolerance が厳しすぎるなら Task 2 の
実測に戻る。**電卓が間違っているなら、それがこの層を作った理由である。**

- [ ] **Step 5: 実行時間を控える**

出力の実行時間を `docs/corpus-measurements.md` に足す。2000 件で何秒かが、
数万件に伸ばしたときの見積りの根拠になる。

- [ ] **Step 6: コミット**

```bash
git add web/tests/heavy/corpus.ts web/tests/heavy/corpus.spec.ts docs/corpus-measurements.md
git commit -m "Ask two thousand questions in one trip across the boundary"
```

---

### Task 7: 同値ケース

期待値を持たないケース。Python が介在せず、電卓が自分自身と矛盾しないことだけを見る。

**Files:**
- Modify: `reference/scripts/generate_corpus.py`（`build_equivalences` を追加）
- Modify: `reference/tests/test_generate_corpus.py`（同値ケースのテストを追加）
- Modify: `web/tests/heavy/corpus.ts`（`EquivalenceCase` を追加）
- Modify: `web/tests/heavy/corpus.spec.ts`（同値ケースの検証を追加）
- Create: `corpus/generated/equivalence-000.json`

**Interfaces:**
- Consumes: Task 3〜6 の全て
- Produces:
  - `EquivalenceCase = { kind: "equivalence"; id: string; mode: string; left: string[]; right: string[] }`
  - `build_equivalences(seed: int, count: int) -> dict`
  - `Shard["cases"]` は `(ValueCase | EquivalenceCase)[]` になる

- [ ] **Step 1: Python 側の失敗するテストを書く**

`reference/tests/test_generate_corpus.py` に追加:

```python
def test_equivalence_cases_carry_two_sequences_and_no_expected_value() -> None:
    shard = generate_corpus.build_equivalences(seed=7, count=30)
    for case in shard["cases"]:
        assert case["kind"] == "equivalence"
        assert case["left"] and case["right"]
        assert "expect" not in case


def test_the_two_sides_are_never_the_same_keys() -> None:
    # 両辺が同じ経路に落ちると常に緑になる(設計書 §11)。生成器が
    # 自明な対を出さないことを、生成器自身のテストで見る。
    shard = generate_corpus.build_equivalences(seed=8, count=100)
    for case in shard["cases"]:
        assert case["left"] != case["right"]


def test_equivalences_are_deterministic() -> None:
    assert generate_corpus.build_equivalences(
        seed=9, count=20
    ) == generate_corpus.build_equivalences(seed=9, count=20)
```

- [ ] **Step 2: テストを実行して失敗を確かめる**

```bash
cd reference && uv run pytest tests/test_generate_corpus.py -v
```

Expected: FAIL — `module 'generate_corpus' has no attribute 'build_equivalences'`

- [ ] **Step 3: 生成器に同値ケースを足す**

`reference/scripts/generate_corpus.py` に追加:

```python
def _equivalent_pair(rng: random.Random, node: Node) -> tuple[Node, Node] | None:
    """同じ値に着く二つの式木。**両辺の経路を必ず変える。**

    左右が同じ形に落ちると常に緑になり、テストが何も言わなくなる。
    """
    which = rng.randrange(3)
    if which == 0:
        # 平方して根を取ると戻る(非負のときだけ)。
        return node, Un("sqrt", Un("sqr", node))
    if which == 1:
        # 符号を二度反転すると戻る。
        return node, Un("neg", Un("neg", node))
    # 0 を足しても変わらない。左辺は素のまま。
    return node, Bin("+", node, Num(0))


def build_equivalences(seed: int, count: int) -> dict:
    rng = random.Random(seed)
    entries: list[dict] = []
    attempts = 0
    while len(entries) < count:
        attempts += 1
        if attempts > count * 200:
            raise RuntimeError(
                f"gave up after {attempts} attempts with {len(entries)}/{count} cases"
            )
        node = random_node(rng, MAX_DEPTH - 1)
        try:
            if not _within_range(node):
                continue
            value = evaluate(node)
        except OutOfShard:
            continue
        if value < 0:
            # 平方根の往復が使えない。負の値は段階 3 で扱う。
            continue
        pair = _equivalent_pair(rng, node)
        if pair is None:
            continue
        left, right = pair
        try:
            if not _within_range(right):
                continue
        except OutOfShard:
            continue
        left_keys = to_key_sequence(left)
        right_keys = to_key_sequence(right)
        if left_keys == right_keys:
            continue
        entries.append(
            {
                "kind": "equivalence",
                "id": f"eqv-{len(entries):06d}",
                "mode": "Deg",
                "left": left_keys,
                "right": right_keys,
            }
        )
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "tolerance": TOLERANCE,
        "cases": entries,
    }
```

`main()` に 1 行足す:

```python
    write("equivalence-000.json", build_equivalences(seed=20260816, count=count))
```

- [ ] **Step 4: Python のテストを通す**

```bash
cd reference && uv run pytest tests/test_generate_corpus.py -v
uv run ruff check . && uv run ruff format --check .
```

Expected: PASS（9 件）

- [ ] **Step 5: TypeScript 側の失敗するテストを書く**

`web/tests/heavy/corpus.spec.ts` に追加:

```ts
for (const { name, shard } of loadShards()) {
  const equivalences = shard.cases.filter(
    (c): c is EquivalenceCase => c.kind === "equivalence",
  );
  if (equivalences.length === 0) {
    continue;
  }
  test(`both routes agree in ${name}`, async ({ page }) => {
    await openHarness(page);
    // 左右をまとめて 1 往復で流す。前半が左、後半が右。
    const results = await runAll(page, [
      ...equivalences.map((c) => c.left),
      ...equivalences.map((c) => c.right),
    ]);

    const mismatches: string[] = [];
    for (const [index, testCase] of equivalences.entries()) {
      const left = results[index];
      const right = results[index + equivalences.length];
      if (left === undefined || right === undefined) {
        mismatches.push(`${testCase.id}: the harness returned nothing`);
        continue;
      }
      if (left.error !== null || right.error !== null) {
        mismatches.push(
          `${testCase.id}: error ${left.error ?? "none"} / ${right.error ?? "none"}`,
        );
        continue;
      }
      if (
        !withinTolerance(
          parseDisplay(left.main),
          parseDisplay(right.main),
          shard.tolerance,
        )
      ) {
        mismatches.push(`${testCase.id}: ${left.main} vs ${right.main}`);
      }
    }

    expect(
      mismatches.slice(0, 20).join("\n"),
      `${mismatches.length} of ${equivalences.length} pairs disagree`,
    ).toBe("");
  });
}
```

`corpus.spec.ts` の import に `EquivalenceCase` を足す。

- [ ] **Step 6: 型を足す**

`web/tests/heavy/corpus.ts` を変更:

```ts
export interface EquivalenceCase {
  kind: "equivalence";
  id: string;
  mode: string;
  left: string[];
  right: string[];
}

export type CorpusCase = ValueCase | EquivalenceCase;
```

`Shard` の `cases` を `CorpusCase[]` にし、`corpus.spec.ts` の値ケース側も
`shard.cases.filter((c): c is ValueCase => c.kind === "value")` で絞る。

- [ ] **Step 7: シャードを生成してテストを通す**

```bash
cd reference && uv run python scripts/generate_corpus.py 2000
cd ../web && pnpm heavy
```

Expected: すべて PASS。

- [ ] **Step 8: コミット**

```bash
git add reference/scripts/generate_corpus.py reference/tests/test_generate_corpus.py \
        web/tests/heavy/corpus.ts web/tests/heavy/corpus.spec.ts corpus/generated/
git commit -m "Make the calculator answer the same question by two different roads"
```

---

### Task 8: 外から読めるレポート

緑のチェックは「何を何件どこまでの精度で確かめたか」を答えない。それを答える成果物を作る（設計書 §8）。

**Files:**
- Create: `web/tests/heavy/report.ts`
- Modify: `web/tests/heavy/corpus.spec.ts`（結果を集めて書き出す）
- Modify: `.gitignore`（`web/heavy-report.md` を追加）
- Test: `web/tests/heavy/report.spec.ts`

**Interfaces:**
- Consumes: `Tolerance`（Task 6）
- Produces:
  - `ShardSummary = { name: string; total: number; values: number; equivalences: number; mismatches: string[]; maxRelativeError: number; tolerance: Tolerance }`
  - `record(summary: ShardSummary): void`
  - `renderReport(summaries: ShardSummary[]): string`
  - `writeReport(): void`

- [ ] **Step 1: 失敗するテストを書く**

`web/tests/heavy/report.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { renderReport } from "./report";

const TOLERANCE = { abs: 1e-9, rel: 1e-9 };

test("the report says what was checked, not just that it passed", () => {
  const markdown = renderReport([
    {
      name: "scientific-000.json",
      total: 2000,
      values: 2000,
      equivalences: 0,
      mismatches: [],
      maxRelativeError: 3.4e-12,
      tolerance: TOLERANCE,
    },
  ]);

  expect(markdown).toContain("2000");
  expect(markdown).toContain("scientific-000.json");
  // 観測された最大誤差が読めること。
  expect(markdown).toContain("3.4");
  // 表示精度の但し書きは必ず載る(設計書 §11)。
  expect(markdown).toContain("表示");
});

test("failures are listed, not summarised away", () => {
  const markdown = renderReport([
    {
      name: "scientific-000.json",
      total: 2,
      values: 2,
      equivalences: 0,
      mismatches: ["sci-000001: sqrt(2) → 1.41, expected 1.4142135624"],
      maxRelativeError: 0.003,
      tolerance: TOLERANCE,
    },
  ]);

  expect(markdown).toContain("sci-000001");
});
```

- [ ] **Step 2: テストを実行して失敗を確かめる**

```bash
cd web && pnpm heavy -- report.spec.ts
```

Expected: FAIL — `./report` が存在しない。

- [ ] **Step 3: 実装する**

`web/tests/heavy/report.ts`:

```ts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Tolerance } from "./corpus";

export interface ShardSummary {
  name: string;
  total: number;
  values: number;
  equivalences: number;
  mismatches: string[];
  maxRelativeError: number;
  tolerance: Tolerance;
}

const summaries: ShardSummary[] = [];

export function record(summary: ShardSummary): void {
  summaries.push(summary);
}

/**
 * 外の人が読んで「これなら大丈夫だ」と判断できる材料を出す。
 * **緑のチェックは何件どこまでの精度で確かめたかを答えない**(設計書 §8)。
 */
export function renderReport(entries: ShardSummary[]): string {
  const total = entries.reduce((sum, entry) => sum + entry.total, 0);
  const failed = entries.reduce((sum, entry) => sum + entry.mismatches.length, 0);
  const lines = [
    "# 重量級コーパスの実行結果",
    "",
    `- 総ケース数: **${total}**`,
    `- 不一致: **${failed}**`,
    "",
    "## シャード別",
    "",
    "| シャード | 総数 | 値 | 同値 | 不一致 | 観測された最大相対誤差 | 許容 |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const entry of entries) {
    lines.push(
      `| ${entry.name} | ${entry.total} | ${entry.values} | ${entry.equivalences} | ` +
        `${entry.mismatches.length} | ${entry.maxRelativeError.toExponential(2)} | ` +
        `abs ${entry.tolerance.abs} / rel ${entry.tolerance.rel} |`,
    );
  }
  const failures = entries.flatMap((entry) =>
    entry.mismatches.map((line) => `- \`${entry.name}\` ${line}`),
  );
  if (failures.length > 0) {
    lines.push("", "## 不一致の全件", "", ...failures);
  }
  lines.push(
    "",
    "## この結果が主張していないこと",
    "",
    "電卓の表示は整形済みの文字列で、数値をそのまま取り出す口がない。",
    "したがってこの層が言えるのは**表示される桁まで正しい**ことであって、",
    "倍精度の最後の桁まで正しいことではない。より深い精度は Rust 側の",
    "単体テストと golden（Layer 1〜4）の担当である。",
    "",
  );
  return lines.join("\n");
}

export function writeReport(): void {
  const path = fileURLToPath(new URL("../../heavy-report.md", import.meta.url));
  writeFileSync(path, renderReport(summaries), "utf-8");
  console.log(`wrote ${path}`);
}
```

- [ ] **Step 4: テストを実行して通ることを確かめる**

```bash
cd web && pnpm heavy -- report.spec.ts
```

Expected: PASS（2 件）

- [ ] **Step 5: corpus.spec.ts を配線する**

値ケースの test を、記録を挟む形に書き換える。同値ケースの test も同じ形にする。

```ts
  test(`every case in ${name} matches the reference`, async ({ page }) => {
    await openHarness(page);
    const values = shard.cases.filter((c): c is ValueCase => c.kind === "value");
    const results = await runAll(
      page,
      values.map((c) => c.keys),
    );

    const mismatches: string[] = [];
    let maxRelativeError = 0;
    for (const [index, testCase] of values.entries()) {
      const result = results[index];
      if (result === undefined) {
        mismatches.push(`${testCase.id}: the harness returned nothing`);
        continue;
      }
      if (result.error !== null) {
        mismatches.push(`${testCase.id}: ${testCase.expr} → error ${result.error}`);
        continue;
      }
      const actual = parseDisplay(result.main);
      const expected = testCase.expect.re;
      // 期待値が 0 のときに無限大にしないため、分母に 1 の下限を置く。
      const relative =
        Math.abs(actual - expected) / Math.max(Math.abs(expected), 1);
      maxRelativeError = Math.max(maxRelativeError, relative);
      if (!withinTolerance(actual, expected, shard.tolerance)) {
        mismatches.push(
          `${testCase.id}: ${testCase.expr} → ${result.main}, expected ${expected}`,
        );
      }
    }

    // **expect より先に記録する。** 落ちたときこそレポートが要るのに、
    // 先に expect を書くとそこで打ち切られてレポートが空になる。
    record({
      name,
      total: values.length,
      values: values.length,
      equivalences: 0,
      mismatches,
      maxRelativeError,
      tolerance: shard.tolerance,
    });

    expect(
      mismatches.slice(0, 20).join("\n"),
      `${mismatches.length} of ${values.length} cases disagree`,
    ).toBe("");
  });
```

ファイル末尾に:

```ts
test.afterAll(() => {
  writeReport();
});
```

import に `record` / `writeReport` / `ValueCase` を足す。

`.gitignore` に追加:

```
web/heavy-report.md
```

- [ ] **Step 6: 全体を回して成果物を目で見る**

```bash
cd web && pnpm heavy
cat heavy-report.md
```

Expected: すべて PASS し、`heavy-report.md` に総件数・シャード別の表・
最大相対誤差・但し書きが載っている。

- [ ] **Step 7: 型検査と lint**

```bash
cd web && pnpm typecheck && pnpm lint
```

- [ ] **Step 8: 既存レイヤーに影響が無いことを確かめる**

```bash
cd web && pnpm test && pnpm exec playwright test
cd ../reference && uv run pytest
cargo test --workspace
```

Expected: すべて既存のまま PASS。**重い spec が既存の `playwright test` に
拾われていないこと**（`testDir` が別であること）をここで確認する。

- [ ] **Step 9: コミット**

```bash
git add web/tests/heavy/report.ts web/tests/heavy/report.spec.ts \
        web/tests/heavy/corpus.spec.ts .gitignore
git commit -m "Say what was checked, so someone else can judge it"
```

---

## この計画が積み残すもの

設計書 §12 の段階 3〜5。**段階 1 の実測値が出てから**別計画にする。

- **段階 3（横に広げる）** — 電卓の種類ごとのジェネレータ、シャードの増加、
  指数表記の解釈、エラーケースと複素数ケース、括弧を省いたキー列。
- **段階 4（UI 経路）** — 抽出 200 件を本物のボタン操作で回す。抽出は id の
  ハッシュ順で決定的に。
- **段階 5（外向き）** — `corpus-gate.yml`、`heavy-e2e.yml`、`docs/corpus.md`、
  `corpus/contributed/` の受け入れ、`ci.yml` の層番号コメント修正。

縦の 1 本が通るまでこれらに手を付けない。`tolerance` と目標件数が決まる前に
広げると、決まった後で全部やり直すことになる。

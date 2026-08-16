# コーパスの許容を表示分解能まで詰める 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 合否の判定を相対誤差だけにして 1315 件の緩みを消し、それで落ちる 2 件を理由つきの上書きとして名指しで許す。

**Architecture:** 判定は `web/tests/heavy/corpus.ts` の `classify` 一箇所に集約済みなので、変更はそこと、新設する上書きの読み込み層に閉じる。上書きは `corpus/overrides.json` に置き、生成器は存在を知らない——`corpus/generated/` は再生成一致ゲートが守る領域で、人の判断を混ぜない。

**Tech Stack:** TypeScript / Playwright（`web/tests/heavy/`）。Python 側と Rust 側は一切触らない。

**Spec:** `docs/superpowers/specs/2026-08-16-corpus-tolerance-design.md`（要件 R1〜R14）

## Global Constraints

- **許容の値をテストコードに書かない。** 合否に使う値は `corpus/**/*.json` から読む（CLAUDE.md）。関数自身の単体テストに入力としてリテラルを書くのは従来どおり可。
- **`corpus/generated/*.json` を書き換えない。** 再生成一致ゲート（`reference/tests/test_corpus_reproducibility.py`）が生成器の出力とバイト単位の一致を毎回確かめている。
- **`reference/` と `crates/` を一切触らない。** この計画は `web/` と `corpus/overrides.json` だけで完結する。
- **`corpus_expr.py` の `UNARY_FNS` / `BINARY_OPS` を触らない**（R13）。触ると同じ種でも既存 4000 件が総入れ替えになる。
- **落ちるケースが 3 件以上出たら、上書きせずに報告して止まる**（R14）。
- **既存 4 レイヤーに影響を出さない。** 既存の `pnpm exec playwright test`（設定なし）が heavy を 1 件も拾わないこと。
- コミットメッセージ末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`。**`git push` と PR 作成は行わない。**

### 設計書 §6 の訂正（この計画で正す）

設計書 §6 は「変わるのは `tolerance` フィールドの値で、生成器を直して再生成すれば済む」と書いているが、**これは不正確である。`{abs: 5e-10, rel: 5e-10}` という値は変わらない。** 変わるのは判定側の**解釈**だけで、`abs` が「OR の片側」から「期待値が 0 のときの専用経路」に格下げされる。したがって:

- **`reference/scripts/generate_corpus.py` は変更しない**
- **`corpus/generated/*.json` は 1 バイトも変わらない**
- 再生成一致ゲートは無変更のまま通る

Task 5 で設計書のこの記述を実測に合わせて直す。

## File Structure

| ファイル | 責務 |
|---|---|
| `corpus/overrides.json` | 上書きのデータ。人が書く。ケース id → `rel` と `reason` |
| `web/tests/heavy/overrides.ts` | 上書きの読み込み・検証・解決・腐り検出 |
| `web/tests/heavy/overrides.spec.ts` | 上のテスト |
| `web/tests/heavy/corpus.ts` | `withinTolerance` / `classify` の判定を変える（既存） |
| `web/tests/heavy/corpus.spec.ts` | 上書きの解決と腐り検出を比較ループに配線（既存） |
| `web/tests/heavy/report.ts` | 上書きの開示（既存） |
| `web/tests/heavy/report.spec.ts` | 上のテスト（既存。`PROVENANCE` と `summary()` のヘルパが既にある） |
| `.gitignore` | 変更なし |

---

### Task 1: 上書きの読み込みと検証

データと読み込み層だけを作る。**この時点で合否は 1 件も変わらない**（上書きは空）。

**Files:**
- Create: `corpus/overrides.json`
- Create: `web/tests/heavy/overrides.ts`
- Test: `web/tests/heavy/overrides.spec.ts`

**Interfaces:**
- Consumes: `Tolerance`（`./corpus` から。`{ abs: number; rel: number }`）
- Produces:
  - `KNOWN_OVERRIDES_SCHEMA = 1`
  - `Override = { rel: number; reason: string }`
  - `loadOverrides(): Map<string, Override>`
  - `resolveTolerance(caseId: string, base: Tolerance, overrides: Map<string, Override>): Tolerance`

- [ ] **Step 1: 失敗するテストを書く**

`web/tests/heavy/overrides.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import type { Tolerance } from "./corpus";
import { loadOverrides, resolveTolerance } from "./overrides";

const BASE: Tolerance = { abs: 5e-10, rel: 5e-10 };

test("the overrides file loads", () => {
  const overrides = loadOverrides();
  expect(overrides).toBeInstanceOf(Map);
});

test("a case with no override keeps the shard's tolerance", () => {
  const resolved = resolveTolerance("sci-999999", BASE, new Map());
  expect(resolved).toEqual(BASE);
});

test("an override replaces rel and leaves abs alone", () => {
  const overrides = new Map([
    ["sci-001332", { rel: 2e-9, reason: "巨大角度の三角関数。引数の刻み幅が結果の精度を縛る。" }],
  ]);
  const resolved = resolveTolerance("sci-001332", BASE, overrides);
  // abs は期待値 0 専用の経路なので、上書きの対象ではない。
  expect(resolved).toEqual({ abs: 5e-10, rel: 2e-9 });
});
```

- [ ] **Step 2: テストを実行して失敗を確かめる**

```bash
cd web && pnpm exec playwright test --config playwright.heavy.config.ts tests/heavy/overrides.spec.ts
```

Expected: FAIL — `Cannot find module './overrides'`

（走行の最後に `globalTeardown` が「シャードの集計が無い」と言って落ちるのは正常。`measure.spec.ts` だけを回したときと同じで、レポートの書き出しを拒む防御が働いている。）

- [ ] **Step 3: データファイルを作る**

`corpus/overrides.json`:

```json
{
  "schema": 1,
  "overrides": {}
}
```

- [ ] **Step 4: 読み込み層を実装する**

`web/tests/heavy/overrides.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Tolerance } from "./corpus";

/**
 * **緩めた例外を、名指しで、理由を添えて残す場所。**
 *
 * `corpus/generated/` の中には書かない。あそこは再生成一致ゲートが
 * 「生成器の出力とバイト単位で一致」を毎回確かめている領域で、人の判断が
 * 混ざるとその保証が壊れる。生成は機械、例外は人——境界をファイルの
 * 所有者で表す(設計書 §3.3)。
 *
 * 生成器はこのファイルの存在を知らない。読んで適用するのは比較する側だけである。
 */
export const KNOWN_OVERRIDES_SCHEMA = 1;

export interface Override {
  /** このケースにだけ許す相対誤差。シャードの rel より緩い値。 */
  rel: number;
  /**
   * **なぜ緩めてよいのか。必須。**
   *
   * 理由のない上書きは、名指しの体裁をした静かな緩和である。理由が書けない
   * なら、それは上書きすべきケースではなく直すべきバグである(設計書 §3.3)。
   */
  reason: string;
}

interface OverridesFile {
  schema: number;
  overrides: Record<string, Override>;
}

const OVERRIDES_PATH = fileURLToPath(
  new URL("../../../corpus/overrides.json", import.meta.url),
);

export function loadOverrides(): Map<string, Override> {
  let raw: string;
  try {
    raw = readFileSync(OVERRIDES_PATH, "utf-8");
  } catch (cause) {
    throw new Error(
      `overrides: ${OVERRIDES_PATH} が読めない。上書きが無いときも ` +
        `{"schema": 1, "overrides": {}} を置くこと——ファイルの不在と ` +
        `「上書きが 0 件」を区別できなくなる。`,
      { cause },
    );
  }
  const parsed = JSON.parse(raw) as OverridesFile;
  if (parsed.schema !== KNOWN_OVERRIDES_SCHEMA) {
    throw new Error(
      `overrides: schema ${parsed.schema} は読み方を知らない ` +
        `(知っているのは ${KNOWN_OVERRIDES_SCHEMA})`,
    );
  }
  return new Map(Object.entries(parsed.overrides));
}

/**
 * このケースに適用する許容を決める。上書きがあれば rel だけ差し替える。
 *
 * `abs` は差し替えない——あれは期待値が厳密に 0 のときの専用経路で、
 * 相対誤差が定義できない場合の逃げ道である。上書きが語るのは
 * 「このケースの相対誤差はここまで許す」ことだけである。
 */
export function resolveTolerance(
  caseId: string,
  base: Tolerance,
  overrides: Map<string, Override>,
): Tolerance {
  const override = overrides.get(caseId);
  return override === undefined ? base : { abs: base.abs, rel: override.rel };
}
```

- [ ] **Step 5: テストを実行して通ることを確かめる**

```bash
cd web && pnpm exec playwright test --config playwright.heavy.config.ts tests/heavy/overrides.spec.ts
```

Expected: PASS（3 件）。teardown の「集計が無い」エラーは Step 2 と同じ理由で正常。

- [ ] **Step 6: 全体が緑のままであることを確かめる**

```bash
cd web && pnpm heavy && pnpm typecheck && pnpm lint
```

Expected: すべて PASS。上書きが空なので合否は 1 件も変わらない。

- [ ] **Step 7: コミット**

```bash
git add corpus/overrides.json web/tests/heavy/overrides.ts web/tests/heavy/overrides.spec.ts
git commit -m "Make a place where a loosened case has to say why"
```

---

### Task 2: 腐った上書きを赤にする

上書きは放っておくと溜まる。溜まった上書きは、誰も見に行かないまま層の主張を削る。

**Files:**
- Modify: `web/tests/heavy/overrides.ts`
- Test: `web/tests/heavy/overrides.spec.ts`

**Interfaces:**
- Consumes: `Override` / `loadOverrides` / `resolveTolerance`（Task 1）
- Produces:
  - `assertOverridesAreSound(overrides: Map<string, Override>, knownCaseIds: Set<string>): void`
  - `assertNoStaleOverrides(staleIds: string[], overrides: Map<string, Override>): void`

- [ ] **Step 1: 失敗するテストを書く**

`web/tests/heavy/overrides.spec.ts` に追加:

```ts
import {
  assertNoStaleOverrides,
  assertOverridesAreSound,
} from "./overrides";

const IDS = new Set(["sci-000019", "sci-001332"]);

test("an override without a reason is refused", () => {
  const overrides = new Map([["sci-000019", { rel: 2e-9, reason: "  " }]]);
  expect(() => assertOverridesAreSound(overrides, IDS)).toThrow(/reason/);
});

test("an override pointing at a case that does not exist is refused", () => {
  const overrides = new Map([
    ["sci-999999", { rel: 2e-9, reason: "存在しないケースを指している" }],
  ]);
  expect(() => assertOverridesAreSound(overrides, IDS)).toThrow(/sci-999999/);
});

test("an override that is not looser than nothing is refused", () => {
  // rel は正の有限値でなければならない。0 や負や Infinity は、
  // 「何も通らない」か「何でも通る」で、どちらも上書きの意味を成さない。
  const overrides = new Map([
    ["sci-000019", { rel: 0, reason: "何も通らない値" }],
  ]);
  expect(() => assertOverridesAreSound(overrides, IDS)).toThrow(/rel/);
});

test("a sound override passes", () => {
  const overrides = new Map([
    ["sci-000019", { rel: 2e-9, reason: "巨大角度の三角関数。引数の刻み幅が結果の精度を縛る。" }],
  ]);
  expect(() => assertOverridesAreSound(overrides, IDS)).not.toThrow();
});

test("an override whose case now passes without it is refused", () => {
  const overrides = new Map([
    ["sci-000019", { rel: 2e-9, reason: "もう要らない上書き" }],
  ]);
  expect(() => assertNoStaleOverrides(["sci-000019"], overrides)).toThrow(
    /sci-000019/,
  );
});

test("no stale overrides is quiet", () => {
  const overrides = new Map([
    ["sci-000019", { rel: 2e-9, reason: "まだ要る" }],
  ]);
  expect(() => assertNoStaleOverrides([], overrides)).not.toThrow();
});
```

- [ ] **Step 2: テストを実行して失敗を確かめる**

```bash
cd web && pnpm exec playwright test --config playwright.heavy.config.ts tests/heavy/overrides.spec.ts
```

Expected: FAIL — `assertOverridesAreSound` / `assertNoStaleOverrides` が export されていない。

- [ ] **Step 3: 実装する**

`web/tests/heavy/overrides.ts` に追加:

```ts
/**
 * 上書きが正気であることを、読み込んだ時点で確かめる。
 *
 * ここで throw するのは、あとで「なぜか緩い」と気づくより、その場で
 * 名指しで落ちる方が原因に近いためである。
 */
export function assertOverridesAreSound(
  overrides: Map<string, Override>,
  knownCaseIds: Set<string>,
): void {
  const complaints: string[] = [];
  for (const [caseId, override] of overrides) {
    if (!knownCaseIds.has(caseId)) {
      complaints.push(
        `${caseId}: このケースはコーパスに無い。` +
          `コーパスが変わって id が消えても上書きだけが残ると、` +
          `何を緩めているのか分からなくなる。`,
      );
    }
    if (
      typeof override.reason !== "string" ||
      override.reason.trim().length === 0
    ) {
      complaints.push(
        `${caseId}: reason が空である。理由のない上書きは、名指しの体裁を ` +
          `した静かな緩和である。理由が書けないなら、それは上書きすべき ` +
          `ケースではなく直すべきバグである。`,
      );
    }
    if (
      typeof override.rel !== "number" ||
      !Number.isFinite(override.rel) ||
      override.rel <= 0
    ) {
      complaints.push(
        `${caseId}: rel が ${String(override.rel)} である。` +
          `正の有限値でなければならない。`,
      );
    }
  }
  if (complaints.length > 0) {
    throw new Error(`overrides:\n${complaints.join("\n")}`);
  }
}

/**
 * **要らなくなった上書きを赤にする。**
 *
 * 上書きは放っておくと溜まる。溜まった上書きは、誰も見に行かないまま層の
 * 主張を削る。「ガードは緑のまま理由が嘘になる」形で腐るので、腐ったら
 * 赤くする(設計書 §3.4)。
 *
 * @param staleIds 上書き**なし**の許容で通ったケースの id
 */
export function assertNoStaleOverrides(
  staleIds: string[],
  overrides: Map<string, Override>,
): void {
  if (staleIds.length === 0) {
    return;
  }
  const lines = staleIds.map((id) => {
    const reason = overrides.get(id)?.reason ?? "(理由が読めない)";
    return `  ${id} — 記録されている理由: ${reason}`;
  });
  throw new Error(
    `overrides: 次の上書きは、もう無くてもシャードの rel で通る。\n` +
      `${lines.join("\n")}\n` +
      `corpus/overrides.json から消すこと。要らない上書きを残すと、` +
      `層の主張が理由なく弱いままになる。`,
  );
}
```

- [ ] **Step 4: テストを実行して通ることを確かめる**

```bash
cd web && pnpm exec playwright test --config playwright.heavy.config.ts tests/heavy/overrides.spec.ts
```

Expected: PASS（9 件）

- [ ] **Step 5: 全体が緑のままであることを確かめる**

```bash
cd web && pnpm heavy && pnpm typecheck && pnpm lint
```

- [ ] **Step 6: コミット**

```bash
git add web/tests/heavy/overrides.ts web/tests/heavy/overrides.spec.ts
git commit -m "Refuse the override that has outlived its reason"
```

---

### Task 3: 判定を rel だけにし、落ちた分を名指しで許す

**この 2 つは同じコミットで行う。** 判定だけ変えるとスイートが赤の状態が残り、上書きだけ足しても意味がない。

**Files:**
- Modify: `web/tests/heavy/corpus.ts`（`withinTolerance` と `classify`）
- Modify: `web/tests/heavy/corpus.spec.ts`（上書きの解決と腐り検出を配線）
- Modify: `corpus/overrides.json`（落ちたケースを登録）
- Test: `web/tests/heavy/corpus.spec.ts` の既存テストを更新

**Interfaces:**
- Consumes: `loadOverrides` / `resolveTolerance` / `assertOverridesAreSound` / `assertNoStaleOverrides`（Task 1, 2）
- Produces: `classify(actual, expected, tolerance, baseRel?)` — 第 4 引数は帯の目盛りに使う上書き前の `rel`。省略時は `tolerance.rel`

- [ ] **Step 1: 判定の失敗するテストを書く**

`web/tests/heavy/corpus.spec.ts` の `withinTolerance` の単体テスト群を、新しい契約に書き換える:

```ts
test("withinTolerance judges by relative error alone", () => {
  // ここのリテラルは withinTolerance 自身の入力であって、コーパスの許容ではない。
  const tolerance = { abs: 5e-10, rel: 5e-10 };

  // 相対で収まれば通る。
  expect(withinTolerance(1, 1 + 4e-10, tolerance)).toBe(true);
  // 相対で外れれば、絶対誤差がどれだけ小さくても落ちる。
  // **これが今回の変更の本体である**——以前は abs の OR が救っていた。
  expect(withinTolerance(1e-6, 1e-6 + 4e-10, tolerance)).toBe(false);
});

test("abs is only for an expectation of exactly zero", () => {
  const tolerance = { abs: 5e-10, rel: 5e-10 };
  expect(withinTolerance(0, 0, tolerance)).toBe(true);
  expect(withinTolerance(4e-10, 0, tolerance)).toBe(true);
  expect(withinTolerance(6e-10, 0, tolerance)).toBe(false);
});

test("classify reports the relative tolerance as the effective one", () => {
  const tolerance = { abs: 5e-10, rel: 5e-10 };
  const small = classify(1e-6, 1e-6, tolerance);
  // 以前はここが abs / |期待値| = 5e-4 に膨らんでいた。
  expect(small.effectiveRelTolerance).toBe(5e-10);
  expect(small.bucket).toBe("display");
});

test("an overridden case lands in a looser band", () => {
  const overridden = { abs: 5e-10, rel: 2e-9 };
  const c = classify(1, 1, overridden, 5e-10);
  expect(c.effectiveRelTolerance).toBe(2e-9);
  expect(c.bucket).not.toBe("display");
});
```

- [ ] **Step 2: テストを実行して失敗を確かめる**

```bash
cd web && pnpm exec playwright test --config playwright.heavy.config.ts tests/heavy/corpus.spec.ts
```

Expected: FAIL — `withinTolerance(1e-6, 1e-6 + 4e-10, ...)` がまだ `true` を返す（abs の OR が生きている）。

- [ ] **Step 3: 判定を書き換える**

`web/tests/heavy/corpus.ts` の `withinTolerance`:

```ts
/**
 * **相対誤差だけで判定する。**
 *
 * 表示は有効数字 10 桁で、最下位桁の丸め幅の半分を相対で見ると 5e-11〜5e-10 に
 * 収まり、値の大きさに依らない。だから単一の相対許容が、あらゆるマグニチュードで
 * 表示の丸めをちょうど覆う(設計書 §2)。
 *
 * 以前はここが abs と rel の OR だった。その形は |期待値| < 1 のところで
 * abs の側が常に緩い方になり、実効的な相対許容が `abs / |期待値|` に膨らむ——
 * 1e-6 の値なら 5e-4 まで許していた。4000 件中 1315 件が表示分解能より緩く
 * 検査されており、最悪は 4.15e-4 だった。
 */
export function withinTolerance(
  actual: number,
  expected: number,
  tolerance: Tolerance,
): boolean {
  const difference = Math.abs(actual - expected);
  const scale = Math.abs(expected);
  if (scale === 0) {
    // 期待値が厳密に 0。相対誤差は数学的に定義できない。**ここだけが abs の出番。**
    return difference <= tolerance.abs;
  }
  return difference / scale <= tolerance.rel;
}
```

`classify` の該当箇所（`effectiveRelTolerance` の算出と第 4 引数）:

```ts
export function classify(
  actual: number,
  expected: number,
  tolerance: Tolerance,
  /**
   * 帯の目盛りに使う、**上書き前**の rel。省略時は tolerance.rel。
   * 上書きされたケースが緩い帯に落ちるのは、それが実際に緩く検査されたからで、
   * 報告書がその件数を数えられる必要がある。
   */
  baseRel: number = tolerance.rel,
): Classification {
  const absoluteError = Math.abs(actual - expected);
  const scale = Math.abs(expected);
  const passed = withinTolerance(actual, expected, tolerance);
  if (scale === 0) {
    return {
      passed,
      relativeError: 0,
      absoluteError,
      effectiveRelTolerance: Number.POSITIVE_INFINITY,
      bucket: "undefined",
    };
  }
  // OR をやめたので、実際に許している相対誤差は rel そのものである。
  const effectiveRelTolerance = tolerance.rel;
  return {
    passed,
    absoluteError,
    relativeError: absoluteError / scale,
    effectiveRelTolerance,
    bucket: bandOf(effectiveRelTolerance, baseRel),
  };
}
```

- [ ] **Step 4: 単体テストが通ることを確かめる**

```bash
cd web && pnpm exec playwright test --config playwright.heavy.config.ts tests/heavy/corpus.spec.ts
```

Expected: 単体テスト 4 件は PASS。**シャードを回すテストは赤になる**（落ちるケースが出る）。それが次のステップの入力である。

- [ ] **Step 5: 何件落ちたかを数える。3 件以上なら止まる**

Step 4 の出力から、不一致になったケースの id と相対誤差を全部書き出す。

**落ちたのが 2 件で、どちらも巨大角度の三角関数（`sci-000019` と `sci-001332`）なら、Step 6 に進む。**

**3 件以上なら、Step 6 に進まず報告して止まる**（R14）。2 件という見積りは実測だが、実装して回すまで確定しない。**理由が書けないケースが 1 件でもあれば、それは電卓のバグかもしれない。** 落ちた全件の id・式・実測値・期待値・相対誤差を報告に載せること。

- [ ] **Step 6: 上書きを比較ループに配線する**

`web/tests/heavy/corpus.spec.ts`:

- ファイル先頭で一度だけ `const overrides = loadOverrides();`
- 全シャードのケース id を集めて健全性を確かめる。`loadShards()` は既にモジュール
  先頭で 1 回だけ呼ばれているので、その結果を使う:

```ts
const allCaseIds = new Set(
  shards.flatMap(({ shard }) => shard.cases.map((c) => c.id)),
);
assertOverridesAreSound(overrides, allCaseIds);
```
- 値ケースの比較ループで、`classify` に渡す許容を差し替える:

```ts
const effective = resolveTolerance(testCase.id, shard.tolerance, overrides);
const verdict = classify(actual, expected, effective, shard.tolerance.rel);
```

- 上書きされたケースについては、**上書きなしでも通るか**を同時に見る:

```ts
if (overrides.has(testCase.id)) {
  const withoutOverride = classify(actual, expected, shard.tolerance);
  if (withoutOverride.passed) {
    stale.push(testCase.id);
  }
}
```

- ループの後、`expect` より**前**に `assertNoStaleOverrides(stale, overrides)` を呼ぶ

同値ケースの側は**上書きの対象外**である（期待値を持たないので「どこまで緩めるか」の基準が無い）。同値ケースのループでは `shard.tolerance` をそのまま使い、`classify` の第 4 引数も省略する。

- [ ] **Step 7: 上書きを登録する**

`corpus/overrides.json` に、Step 5 で落ちた 2 件を書く。`rel` は**観測された相対誤差より少し大きい**値にする（ちょうどにすると浮動小数点の端で不安定になる）。

```json
{
  "schema": 1,
  "overrides": {
    "sci-000019": {
      "rel": 1e-9,
      "reason": "巨大角度の三角関数。tan(rad(376 × 788²)) の角度は 233,474,944 度で、ラジアン換算 4,074,906.49。その大きさでの f64 の刻み幅は 4.66e-10 ラジアンなので、引数そのものがその精度でしか表現できない。tan の微分は 1 以上あるため、結果の精度が引数の精度を超えられない。mpmath は 50 桁で引数を保持できるので真値に着く。どちらの実装も自分の精度の範囲で正しく、電卓の欠陥ではない。"
    },
    "sci-001332": {
      "rel": 2e-9,
      "reason": "巨大角度の三角関数。cos(rad((815×412)×(747+422))) の角度は 392,526,820 度で、ラジアン換算 6,850,885.41。その大きさでの f64 の刻み幅は 9.31e-10 ラジアン。360 で還元すれば cos(100°) だが、f64 の経路は引数をそこまで解像できない。観測された絶対誤差 2.33e-10 はこの上界の内側に収まる。電卓の欠陥ではない。"
    }
  }
}
```

**実際の `rel` は Step 5 で観測した値から決めること。** 上の値は観測どおりなら妥当だが、違ったら観測に合わせる。

- [ ] **Step 8: 全体が緑になることを確かめる**

```bash
cd web && pnpm heavy && pnpm typecheck && pnpm lint
```

Expected: すべて PASS。**レポートの「表示分解能より緩く検査されたケース」が 1315 から 2 に落ちているはず**（上書きした 2 件だけが緩い帯に残る）。

- [ ] **Step 9: 上書きが本当に効いていることを攻撃で確かめる**

`corpus/overrides.json` を scratchpad にコピーし、コピー側で `sci-001332` の項目を消して回す。**そのケースが不一致として落ちること**を確認する。リポジトリのファイルは書き換えないこと。

- [ ] **Step 10: コミット**

```bash
git add web/tests/heavy/corpus.ts web/tests/heavy/corpus.spec.ts corpus/overrides.json
git commit -m "Judge by the digits the display actually shows"
```

---

### Task 4: 上書きをレポートに出す

外の読み手が「何件が特別扱いされ、なぜか」を数えられることが要件（R9〜R11）。

**Files:**
- Modify: `web/tests/heavy/report.ts`
- Modify: `web/tests/heavy/corpus.spec.ts`（`record` に上書きの情報を渡す）
- Test: `web/tests/heavy/report.spec.ts`

**Interfaces:**
- Consumes: `Override`（Task 1）、`ShardSummary`（既存）
- Produces: `ShardSummary.appliedOverrides: { id: string; rel: number; baseRel: number; reason: string }[]`

- [ ] **Step 1: 失敗するテストを書く**

`web/tests/heavy/report.spec.ts` に追加:

```ts
test("the report counts and quotes every override", () => {
  const markdown = renderReport(
    [
      summary({
        appliedOverrides: [
          {
            id: "sci-001332",
            rel: 2e-9,
            baseRel: 5e-10,
            reason: "巨大角度の三角関数。引数の刻み幅が結果の精度を縛る。",
          },
        ],
      }),
    ],
    PROVENANCE,
  );
  // 件数が見出しに出る。
  expect(markdown).toContain("上書き");
  // id と緩めた倍率と理由の全文が出る。
  expect(markdown).toContain("sci-001332");
  expect(markdown).toContain("4 倍");
  expect(markdown).toContain("引数の刻み幅が結果の精度を縛る");
});

test("no overrides is stated as zero, not omitted", () => {
  const markdown = renderReport([summary({ appliedOverrides: [] })], PROVENANCE);
  expect(markdown).toContain("上書きされたケース: **0**");
});
```

- [ ] **Step 2: テストを実行して失敗を確かめる**

```bash
cd web && pnpm exec playwright test --config playwright.heavy.config.ts tests/heavy/report.spec.ts
```

Expected: FAIL — `appliedOverrides` が `ShardSummary` に無い。

- [ ] **Step 3: 実装する**

`ShardSummary` に追加:

```ts
  /**
   * このシャードで実際に適用された上書き。
   * **件数と理由の全文をレポートに出す**——外の読み手が「何件が特別扱いされ、
   * なぜか」を数えられることが要件である(設計書 §3.5)。2 件が 200 件に増えたら
   * この層が壊れている兆候で、レポートを読めばそれが分かる。
   */
  appliedOverrides: {
    id: string;
    rel: number;
    baseRel: number;
    reason: string;
  }[];
```

見出しに 1 行:

```ts
    `- 上書きされたケース: **${overrideCount}**`,
```

`overrideCount` は `entries.reduce((sum, e) => sum + e.appliedOverrides.length, 0)`。

節を 1 つ:

```ts
function renderOverrides(entries: ShardSummary[]): string[] {
  const all = entries.flatMap((entry) =>
    entry.appliedOverrides.map((o) => ({ shard: entry.name, ...o })),
  );
  if (all.length === 0) {
    return [
      "## 名指しで緩めたケース",
      "",
      "**0 件。** すべてのケースがシャードの許容そのままで判定された。",
      "",
    ];
  }
  const lines = [
    "## 名指しで緩めたケース",
    "",
    `**${all.length} 件。** 下のケースは、シャードの許容では落ちるが、` +
      "理由を添えて個別に緩めてある。緩めた分だけこの層の主張は弱い。",
    "",
  ];
  for (const o of all) {
    const factor = Math.round(o.rel / o.baseRel);
    lines.push(
      `- \`${o.shard}\` **${o.id}** — rel ${o.rel.toExponential(2)}` +
        `（シャードの ${o.baseRel.toExponential(2)} の **${factor} 倍**）`,
      `  - ${o.reason}`,
    );
  }
  lines.push("");
  return lines;
}
```

「この結果が主張していないこと」に 1 段落（`renderCaveats` の中）:

```ts
    "**名指しで緩めたケースの分だけ、この層の主張は弱い。** 件数と理由の全文は",
    "「名指しで緩めたケース」の節にある。0 件ならその節がそう書く。",
    "",
```

- [ ] **Step 4: `corpus.spec.ts` から渡す**

比較ループで、上書きが適用されたケースを集めて `record` に渡す:

```ts
const appliedOverrides = values
  .filter((c) => overrides.has(c.id))
  .map((c) => {
    const o = overrides.get(c.id);
    if (o === undefined) {
      throw new Error(`overrides: ${c.id} が消えた`);
    }
    return {
      id: c.id,
      rel: o.rel,
      baseRel: shard.tolerance.rel,
      reason: o.reason,
    };
  });
```

同値ケースの `record` には `appliedOverrides: []` を渡す（上書きの対象外）。

- [ ] **Step 5: テストが通ることを確かめる**

```bash
cd web && pnpm exec playwright test --config playwright.heavy.config.ts tests/heavy/report.spec.ts
```

- [ ] **Step 6: 全体を回してレポートを目で読む**

```bash
cd web && pnpm heavy && cat heavy-report.md
```

**この件を何も知らない外部の人になったつもりで読むこと。** 「2 件が特別扱いされていて、その理由はこれ」が誤解の余地なく読めるか。読めなければ、そこが直すべき場所である。

- [ ] **Step 7: 型検査と lint**

```bash
cd web && pnpm typecheck && pnpm lint
```

- [ ] **Step 8: コミット**

```bash
git add web/tests/heavy/report.ts web/tests/heavy/report.spec.ts web/tests/heavy/corpus.spec.ts
git commit -m "Let the report say which cases were let off, and why"
```

---

### Task 5: 文書を実測に合わせ、既存レイヤーへの非干渉を確かめる

**Files:**
- Modify: `docs/superpowers/specs/2026-08-16-corpus-tolerance-design.md`（§6 の訂正）
- Modify: `docs/corpus-measurements.md`（新しい数字）

- [ ] **Step 1: 設計書 §6 を実測に合わせる**

現行の §6 は「変わるのは `tolerance` フィールドの値で、生成器を直して再生成すれば済む」と書いているが、**値は変わらなかった**。変わったのは判定側の解釈だけである。次の趣旨に書き換える:

- `{abs: 5e-10, rel: 5e-10}` の**値は変わらない**
- 変わったのは `abs` の**役割**——「OR の片側」から「期待値が 0 のときの専用経路」へ
- したがって `reference/scripts/generate_corpus.py` も `corpus/generated/*.json` も**無変更**で、再生成一致ゲートはそのまま通った
- **この訂正自体が「根拠が腐る」形の一例である**——計画を書く過程で気づいた

- [ ] **Step 2: `docs/corpus-measurements.md` を更新する**

新しい数字を書く:

- 表示分解能より緩く検査されたケース: 1315 → **実測値**
- 最悪の実効相対許容: 4.15e-4 → **実測値**
- 名指しで緩めたケース: **実測値**（id と rel）

**実際に走らせて出た数字を写すこと。** 予想を書かない。

- [ ] **Step 3: 既存 4 レイヤーへの非干渉を確かめる**

```bash
cd web && pnpm test && pnpm exec playwright test
cd ../reference && UV_NO_CONFIG=1 uv run pytest
cargo test --workspace
```

**特に `reference` の再生成一致ゲートが緑であること**を確認する（`corpus/generated/` を触っていないので通るはず。赤なら何かを触っている）。

**既存の `playwright test`（設定なし）が heavy を 1 件も拾わないこと**も確認する:

```bash
cd web && pnpm exec playwright test --list | grep -c heavy
```

Expected: `0`

- [ ] **Step 4: コミット**

```bash
git add docs/superpowers/specs/2026-08-16-corpus-tolerance-design.md docs/corpus-measurements.md
git commit -m "Correct the design where the implementation proved it wrong again"
```

---

## この計画が積み残すもの

- **カンマの桁区切り。** 別セッションが既定の表示に 3 桁毎のカンマを入れる（ユーザ裁定 2026-08-16）。値シャード 2000 件のうち 555 件（27.8%）が当たり、`parseDisplay` と `measure.spec.ts` の assertion 1 個が破れる。**この計画には入れない**——いま書けば未観測の書式に備えるコードになり、それは以前レビューで落としたものと同じである。実際に入ってから、実測付きで直す。
- **段階 3b（エラー経路）と 3c（括弧を省いたキー列）。** どちらを先にするかは未定。
- **期待値が 0 のケースで誤差が出たときの判定。** いまの 5 件は全件が絶対誤差 0 の完全一致なので、判断を先送りしてよい（設計書 §7）。

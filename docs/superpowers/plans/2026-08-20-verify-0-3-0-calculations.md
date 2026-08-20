# 0.3.0 の計算の検証 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 0.3.0 の 3 つの計算（単位換算・LLM メモリ・データ転送量）について、**いま在る検査が欠陥を実際に捕まえるか**を変異で測り、捕まえられなかった帯にだけケースを足す。

**Architecture:** 既存の `web/scripts/detection-power.mjs` は「変異を当てる → 重量級コーパスを走らせる → シャードが反応したか」を測る。0.3.0 の 3 計算には**生成コーパスが無い**ので、同じ枠組みの**測り先を差し替える**——`cargo test` を走らせ、**赤くなったテストの名前の集合**を期待と突き合わせる。既存の 18 種の変異とその判定は 1 行も変えない。

**Tech Stack:** Node.js（ESM、`web/scripts/`）／ vitest（`web/tests/unit/`）／ Rust `cargo test`（`crates/calcarc-core`）／ Playwright（Layer 5 e2e）

**Spec:** `docs/superpowers/specs/2026-08-20-verify-0-3-0-calculations-design.md`（ユーザー承認済み 2026-08-20）

## Global Constraints

**【基準値の訂正 2026-08-20】この計画の初稿の件数は、0.2.1 ベースの旧ブランチで数えた値だった。**
Task 1 の実装者が実測で見つけた（vitest は 263 ではなく **354**）。**新しい BASE `f1fdc2e` /
`7bfe62e` で数え直した基準値は次のとおり**——各タスクの「期待」はこちらを使うこと。

| 検査 | この BASE での実測 | 初稿に書いていた誤り |
|---|---:|---:|
| `pnpm test`（vitest） | **355**（Task 1 の +1 を含む） | 263 |
| `cargo test --workspace` | **373** | 304 |
| `pnpm exec playwright test`（Layer 5） | **164**（12.9 秒） | 132 |
| `uv run --no-config pytest` | **362** | 311 |
| `pnpm heavy` | **195**（31.8 秒） | 195（偶然一致） |

**なぜ間違えたか**: 0.3.0 のアプリ（Convert・Scale の UI と計算）が main に入ったぶん、
検査そのものが増えている。**旧ブランチで数えた数字を新しい BASE の計画に持ち込んだ**のが誤りで、
[[plan-inventories-need-grep]] の「行番号は書いた日の座標」と同じ型である——**件数も測った日の座標**。

- **前提の main は `f1fdc2e`。** この計画の実測値はすべてそこで数えた。
- **`git push` と PR 作成は行わない**（ユーザー専権）。コミット末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`、**件名の 1 行目のあとに空行**。
- **`crates/` に計算の変更を入れない。** 変異は測定中に一時的に当てるだけで、走行後に `git diff -- crates/` が空であること。
- **網羅的な生成コーパスを作らない**（spec §2、ユーザーの言葉「網羅的なテストは不要」）。`corpus/generated/*.json` を増やさない。
- **誤差帯を新設しない。** 3 計算は厳密計算で、`convert`/`llm`/`transfer`/`data_scale` の golden は `tolerance` を持たない（実測）。
- **段 2 で足す golden は、変異 1 件につき最大 5 件・合計 20 件まで**（spec §7-3 の確定）。超えるなら設計を見直す合図。
- **赤確認の戻しは再編集**（`git checkout` を使わない）。
- `uv` は必ず `--no-config`。

---

## File Structure

| ファイル | 責務 |
|---|---|
| `web/scripts/detection-power.mjs`（Modify） | **追加のみ**: `runOneMutation` に判定関数の注入口を足す。`MUTATIONS`（18 種）と `verdictFor` は不変 |
| `web/scripts/exact-power.mjs`（Create） | 0.3.0 の 3 計算用の測定。`EXACT_MUTATIONS`（6 種）・`measureCargo()`・`verdictForTests()`・`main()` |
| `web/tests/unit/exact-power.test.ts`（Create） | 上の純粋部分（出力の解析・判定）の vitest |
| `web/package.json`（Modify） | `"heavy:power:exact": "node scripts/exact-power.mjs"` |
| `docs/corpus-measurements.md`（Modify） | 実測の記録（**設計書と計画には数字を書き戻さない**） |
| `reference/scripts/generate.py` 系（Modify、Task 4 のみ） | 暗い帯が出たときだけ golden を足す |
| `web/tests/e2e/convert.spec.ts`（Modify、Task 5） | 盤面から打てるかの穴埋め |

---

### Task 1: 判定関数を注入できるようにする（既存 18 種は不変）

**Files:**
- Modify: `web/scripts/detection-power.mjs`（`runOneMutation`、実測 `:802`）
- Test: `web/tests/unit/detection-power.test.ts`（追記）

**Interfaces:**
- Produces: `runOneMutation(mutation, { root, measure, verdict })` — `verdict` は既定 `verdictFor`。Task 3 が `verdictForTests` を渡す。

**なぜ注入なのか（実装者への説明）:** `runOneMutation` は**変異を当てて、測って、必ず戻して、戻ったことをバイトで確かめる**という手続きを持っている。0.3.0 側でこの手続きを写すと、**戻し忘れの経路が 2 つになる**。測り方と判定だけを差し替える。

- [ ] **Step 1: 失敗するテストを書く**

`web/tests/unit/detection-power.test.ts` に追記する（既存の import に `runOneMutation` を足す）:

```ts
it("lets the caller decide the verdict, without touching the shard rules", () => {
  // **判定の差し替えは、戻しの手続きを写さないための口である。**
  // 変異を当てて戻すのは 1 か所だけにする。
  const file = join(tmpdir(), `exact-power-${process.pid}.txt`);
  writeFileSync(file, "alpha beta", "utf-8");
  const mutation = { id: "m", what: "w", file: basename(file), from: "beta", to: "gamma" };
  const seen: string[] = [];
  const record = runOneMutation(mutation, {
    root: tmpdir(),
    measure: () => {
      seen.push(readFileSync(file, "utf-8"));
      return { failed: ["x"] };
    },
    verdict: () => ({ ok: true, kind: "ok", why: "注入された判定" }),
  });
  // 測っているあいだは変異が当たっている
  expect(seen).toEqual(["alpha gamma"]);
  // 判定は注入されたものが使われる
  expect(record.ok).toBe(true);
  expect(record.why).toBe("注入された判定");
  // **戻っている**——ここが写したくない手続きである
  expect(readFileSync(file, "utf-8")).toBe("alpha beta");
  rmSync(file, { force: true });
});
```

- [ ] **Step 2: 走らせて落ちることを見る**

```bash
cd /home/terapyon/dev/CalcArc-e2e/web && pnpm test detection-power
```
期待: 赤くなること。**落ち方は予想と違ってよい**——実測（Task 1）では `record.why` の比較まで
到達せず、`resultRecord` が `measurement.mismatchesByShard` を読んで `TypeError` で落ちた。
**落ち方が違ったらそのまま報告する。**

- [ ] **Step 3: 実装する**

`runOneMutation` の署名と 1 行だけを変える:

```js
export function runOneMutation(
  mutation,
  { root = ROOT, measure: measureFn = measure, verdict: verdictFn = verdictFor } = {},
) {
```

本体の判定行を差し替える:

```js
    const measurement = measureFn();
    const verdict = verdictFn(mutation, measurement);
    return resultRecord(mutation, measurement, verdict);
```

**`MUTATIONS`・`verdictFor`・`measure`・`ALL_SHARDS` は 1 行も変えない。**

- [ ] **Step 4: 走らせて通ることを見る**

```bash
cd /home/terapyon/dev/CalcArc-e2e/web && pnpm test
```
期待: 既存 **355** + 新規 1（Task 1 で計上済み）——**この計画の初稿は 263 と書いていたが、
それは 0.2.1 ベースの旧ブランチで数えた値だった**（下の【基準値の訂正】を読むこと）。既存の `detection-power.test.ts` が 1 本も赤くならないこと（既定の判定が変わっていない証拠）。

- [ ] **Step 5: コミット**

```bash
cd /home/terapyon/dev/CalcArc-e2e
git add web/scripts/detection-power.mjs web/tests/unit/detection-power.test.ts
git commit   # 例: "Let the caller bring its own verdict, so the revert stays in one place"
```

---

### Task 2: `cargo test` の結果を読む測定（純粋部分から）

**Files:**
- Create: `web/scripts/exact-power.mjs`
- Create: `web/tests/unit/exact-power.test.ts`

**Interfaces:**
- Produces: `parseFailedTests(stdout: string): string[]`、`readCargoMeasurement({ buildOk, exitCode, stdout }): { buildOk, exitCode, failed }`、`verdictForTests(mutation, measurement)`
- Consumes: Task 1 の `runOneMutation`（Task 3 で使う）

**判定の規則（spec §7-2 の確定 + 監視役の所見③）:** **両側を主張する。** 期待したテストが赤くなっていること**と**、期待していないテストが**緑のまま**であること。`expectShards` の `sameSet` と同じ厳しさにする——片側だけだと「何かが赤い」で通ってしまい、**どの層が捕まえたか**という地図が描けない。

- [ ] **Step 1: 失敗するテストを書く**

`web/tests/unit/exact-power.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  parseFailedTests,
  readCargoMeasurement,
  verdictForTests,
} from "../../scripts/exact-power.mjs";

const SAMPLE = [
  "running 27 tests",
  "test convert::tests::mm_to_in_is_exact ... ok",
  "test convert::tests::degf_offset_is_not_dropped ... FAILED",
  "test data_scale::transfer::tests::a_partial_byte_rounds_up ... FAILED",
  "test result: FAILED. 25 passed; 2 failed; 0 ignored",
].join("\n");

describe("what cargo printed", () => {
  it("takes the failing test names, not the passing ones", () => {
    expect(parseFailedTests(SAMPLE)).toEqual([
      "convert::tests::degf_offset_is_not_dropped",
      "data_scale::transfer::tests::a_partial_byte_rounds_up",
    ]);
  });

  it("returns an empty list when everything passed, and that is not an error", () => {
    expect(parseFailedTests("test a ... ok\ntest result: ok. 1 passed")).toEqual([]);
  });

  it("does not mistake the summary line for a test", () => {
    // `test result: FAILED.` は 1 行だけ形が似ている。**数え間違えると、
    // 変異が捕まった件数が毎回 1 多くなる。**
    expect(parseFailedTests("test result: FAILED. 0 passed; 1 failed")).toEqual([]);
  });
});

describe("the verdict names both sides", () => {
  const mutation = {
    id: "m",
    what: "w",
    file: "crates/x.rs",
    from: "a",
    to: "b",
    expectTests: ["convert::tests::degf_offset_is_not_dropped"],
  };

  it("refuses to call a failed build 'nothing was detected'", () => {
    const v = verdictForTests(mutation, readCargoMeasurement({ buildOk: false, exitCode: null, stdout: "" }));
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("measurement-failed");
  });

  it("is ok when exactly the expected tests went red", () => {
    const stdout = "test convert::tests::degf_offset_is_not_dropped ... FAILED";
    const v = verdictForTests(mutation, readCargoMeasurement({ buildOk: true, exitCode: 101, stdout }));
    expect(v.ok).toBe(true);
  });

  it("is not ok when the expected test stayed green", () => {
    const v = verdictForTests(mutation, readCargoMeasurement({ buildOk: true, exitCode: 0, stdout: "test x ... ok" }));
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("caught-nothing");
  });

  it("is not ok when a test nobody expected went red", () => {
    // **片側だけの主張にしない。** 期待していない赤は、変異が広すぎるか、
    // 期待の書き方が足りないかのどちらかで、**どちらも測定の欠陥である。**
    const stdout = [
      "test convert::tests::degf_offset_is_not_dropped ... FAILED",
      "test data_scale::transfer::tests::a_partial_byte_rounds_up ... FAILED",
    ].join("\n");
    const v = verdictForTests(mutation, readCargoMeasurement({ buildOk: true, exitCode: 101, stdout }));
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("unexpected-red");
    expect(v.why).toContain("data_scale::transfer::tests::a_partial_byte_rounds_up");
  });
});
```

- [ ] **Step 2: 走らせて落ちることを見る**

```bash
cd /home/terapyon/dev/CalcArc-e2e/web && pnpm test exact-power
```
期待: `scripts/exact-power.mjs` が無いので import に失敗する。

- [ ] **Step 3: 実装する**

`web/scripts/exact-power.mjs`（この Task では純粋部分と `measureCargo` まで。変異表は Task 3）:

```js
#!/usr/bin/env node
// @ts-check
/**
 * **0.3.0 の 3 計算（単位換算・LLM メモリ・データ転送量）の検出力を測る。**
 *
 * `detection-power.mjs` は生成コーパスのシャードが反応したかを見るが、
 * この 3 つには**生成コーパスが無い**（実測 2026-08-20: 18 枚のシャードに
 * convert・llm・transfer は 1 枚も無い）。代わりに `cargo test` を走らせ、
 * **赤くなったテストの名前の集合**を期待と突き合わせる。
 *
 * **変異を当てて戻す手続きは写さない**——`detection-power.mjs` の
 * `runOneMutation` に判定を注入して使う（戻し忘れの経路を 2 つにしない）。
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

const WEB = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = dirname(WEB);
const OUT = join(WEB, "exact-power.json");

/**
 * `cargo test` が 1 テストごとに出す `test <名前> ... FAILED` を拾う。
 *
 * **要約行（`test result: FAILED. ...`）を拾わない。** 形が似ているので、
 * 数え間違えると赤の件数が毎回 1 多くなる。
 */
export function parseFailedTests(stdout) {
  const failed = [];
  for (const line of stdout.split("\n")) {
    const match = /^test (.+) \.\.\. FAILED$/.exec(line.trim());
    if (match && match[1] !== "result:") failed.push(match[1]);
  }
  return failed;
}

export function readCargoMeasurement({ buildOk, exitCode, stdout }) {
  return { buildOk, exitCode, failed: buildOk ? parseFailedTests(stdout) : [] };
}

function sameSet(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((x) => b.has(x));
}

/**
 * **両側を主張する。** 期待したテストが赤いこと**と**、期待していない
 * テストが緑のままであること。片側だけだと「何かが赤い」で通り、
 * **どの層が捕まえたか**の地図が描けない（`verdictFor` の `sameSet` と同じ）。
 */
export function verdictForTests(mutation, m) {
  const fail = (kind, why) => ({ ok: false, kind, why });
  if (!m.buildOk) return fail("measurement-failed", "cargo がビルドできなかった——検出の有無は測れていない");
  if (m.exitCode === null) return fail("measurement-failed", "cargo を起動できなかった");
  const expected = mutation.expectTests;
  const missing = expected.filter((name) => !m.failed.includes(name));
  const extra = m.failed.filter((name) => !expected.includes(name));
  if (missing.length > 0 && m.failed.length === 0) {
    return fail("caught-nothing", `1 本も赤くならなかった（期待: ${expected.join(", ")}）`);
  }
  if (extra.length > 0) {
    return fail("unexpected-red", `期待していないテストが赤い: ${extra.join(", ")}`);
  }
  if (missing.length > 0) {
    return fail("missed", `期待したテストが緑のまま: ${missing.join(", ")}`);
  }
  return sameSet(m.failed, expected)
    ? { ok: true, kind: "ok", why: `期待どおり ${m.failed.length} 本が赤くなった` }
    : fail("missed", "集合が一致しない");
}

/** 変異を当てた状態で `cargo test` を走らせる。**wasm は要らない**（Rust だけ見る）。 */
export function measureCargo() {
  try {
    const stdout = execFileSync(
      "cargo",
      ["test", "--workspace", "--no-fail-fast"],
      { cwd: ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return readCargoMeasurement({ buildOk: true, exitCode: 0, stdout });
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout : "";
    // **ビルド失敗と「テストが赤い」を混ぜない。** ビルドが失敗すると
    // 1 本も走らないので、`failed` が空になり「捕まえられなかった」に見える。
    const buildOk = stdout.includes("running ") || stdout.includes("test result:");
    return readCargoMeasurement({ buildOk, exitCode: error?.status ?? null, stdout });
  }
}
```

- [ ] **Step 4: 走らせて通ることを見る**

```bash
cd /home/terapyon/dev/CalcArc-e2e/web && pnpm test exact-power && pnpm lint
```
期待: 新規 7 本が緑。

- [ ] **Step 5: 赤確認（実出力を報告に貼る）**

`parseFailedTests` の正規表現から `$` を落とす（`\.\.\. FAILED` を部分一致にする）。
→ **`does not mistake the summary line for a test` が赤くなること**を確かめる。戻しは再編集。

- [ ] **Step 6: コミット**

```bash
cd /home/terapyon/dev/CalcArc-e2e
git add web/scripts/exact-power.mjs web/tests/unit/exact-power.test.ts
git commit   # 例: "Read which cargo tests went red, and say so from both sides"
```

---

### Task 3: 変異 6 種を宣言して、実際に測る

**Files:**
- Modify: `web/scripts/exact-power.mjs`（`EXACT_MUTATIONS` と `main()` を足す）
- Modify: `web/package.json`（`heavy:power:exact`）
- Modify: `docs/corpus-measurements.md`（実測の記録）
- Test: `web/tests/unit/exact-power.test.ts`（変異表の不変条件）

**Interfaces:**
- Consumes: Task 1 の `runOneMutation(mutation, { verdict })`、Task 2 の `measureCargo` / `verdictForTests`
- Produces: `EXACT_MUTATIONS`、`web/exact-power.json`

- [ ] **Step 0: 変異 3 が単体テストで止まらないかを確かめる（spec §5 の一般則）**

係数表を壊す変異は、**同じファイルの単体テストが literal で固定していればそこで止まる**
（transfer で実証済み: `every_unit_has_its_factor` が 8 つの係数を literal で持つので、
係数を壊しても測れるのはその 1 本だけだった）。

```bash
cd /home/terapyon/dev/CalcArc-e2e
grep -n "1_000_000\|Unit::Um" crates/calcarc-core/src/convert/mod.rs | sed -n '1,20p'
```

**私の実測（`f1fdc2e`）**: `convert/mod.rs` には `#[test]` が 27 本あり、`Um` の係数を
`1_000_000` の literal で assert している行は**見当たらなかった**（係数表の行 `:348` 以外に
`1_000_000` が出てこない）。**それでも自分の目で確かめること**——見落としがあれば、
この変異は `convert::tests::*` の 1 本で止まり、**golden まで届いたかを測れない**。

**止まると分かったら合成を壊す変異に差し替える**（例: `to_base` と `from_base` の適用順、
あるいは `checked_mul` の順序）。**差し替えたら、その理由を報告と `docs/corpus-measurements.md`
に書く。**

- [ ] **Step 1: 変異表を書く**

`web/scripts/exact-power.mjs` に追記する。**`expectTests` は最初は空で置かず、`grep` で当たりを付けてから書く**——空で走らせると `caught-nothing` と `missed` の区別が付かない。

**`from` の綴りはすべて実物から取った（`f1fdc2e` で実測）。行番号は動くので `grep` で当て直すこと。**

```js
export const EXACT_MUTATIONS = [
  {
    id: "binary-base-is-decimal",
    what: "2 進の基数を単位表から導かず 1000 に固定する",
    file: "crates/calcarc-core/src/data_scale/format.rs",
    // **実測: 製品コードに `1024` の literal は無い**（doc コメントとテストにしか出ない）。
    // 基数は `units[0]` から導いている——だから壊すのは導出のほうである。
    from: "let base = units[0].1;",
    to: "let base = 1000;",
    expectTests: [],
  },
  {
    id: "degf-offset-dropped",
    what: "華氏のオフセット(459.67 × 5/9)を落とす",
    file: "crates/calcarc-core/src/convert/mod.rs",
    // アフィン変換の平行移動。比だけの単位では起きない壊れ方（spec §5）。
    from: "Rational::from_ratio(45967, 180)?",
    to: "zero",
    expectTests: [],
  },
  {
    id: "micrometre-off-by-thousand",
    what: "um の係数を 1/1,000,000 から 1/1,000 にずらす",
    file: "crates/calcarc-core/src/convert/mod.rs",
    // **Step 0 で literal 固定の有無を確かめること**（下記）。止まるなら差し替える。
    from: "Unit::Um => (Rational::from_ratio(1, 1_000_000)?, zero)",
    to: "Unit::Um => (Rational::from_ratio(1, 1_000)?, zero)",
    expectTests: [],
  },
  {
    id: "half-even-becomes-half-up",
    what: "表示の丸めを half-even から half-up に変える",
    file: "crates/calcarc-core/src/convert/format.rs",
    from: "core::cmp::Ordering::Equal => last_is_odd,",
    to: "core::cmp::Ordering::Equal => true,",
    expectTests: [],
  },
  {
    id: "kv-counts-once-not-twice",
    what: "KV キャッシュの 2 倍(K と V)を 1 倍にする",
    file: "crates/calcarc-core/src/data_scale/llm.rs",
    from: "let mut kv_bits = 2u128;",
    to: "let mut kv_bits = 1u128;",
    expectTests: [],
  },
  {
    id: "partial-byte-truncated",
    what: "ビットからバイトへの端数を切り上げでなく切り捨てにする",
    file: "crates/calcarc-core/src/data_scale/transfer.rs",
    from: "Ok(bits.div_ceil(8))",
    to: "Ok(bits / 8)",
    expectTests: [],
  },
];
```

**`expectTests` は空のままコミットしない。** Step 4 で 1 度走らせ、**実際に赤くなった名前**を
書き入れてから Step 2 のテストを緑にする。**先に期待を書いて実測を合わせない**——順序が逆だと、
「期待どおり」が「自分の推測どおり」になる。

- [ ] **Step 2: 変異表の不変条件をテストで固定する**

```ts
it("declares a from-string that still exists in the file it names", () => {
  // **黙って当たらない変異を許さない。** `runOneMutation` は
  // `mutation-site-missing` を返すが、それは走らせて初めて分かる。
  for (const mutation of EXACT_MUTATIONS) {
    const source = readFileSync(join(ROOT, mutation.file), "utf-8");
    expect(source, `${mutation.id} の from`).toContain(mutation.from);
  }
});

it("expects at least one test per mutation", () => {
  // 期待が空の変異は、何を測っているのか誰にも分からない。
  for (const mutation of EXACT_MUTATIONS) {
    expect(mutation.expectTests.length, mutation.id).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 3: `main()` と npm script**

```js
function main() {
  const results = EXACT_MUTATIONS.map((mutation) =>
    runOneMutation(mutation, { measure: measureCargo, verdict: verdictForTests }),
  );
  writeFileSync(OUT, `${JSON.stringify({ results }, null, 2)}\n`);
  const bad = results.filter((r) => !r.ok);
  for (const r of results) console.log(`[${r.id}] ${r.ok ? "ok" : r.kind} — ${r.why}`);
  process.exitCode = bad.length === 0 ? 0 : 1;
}
```

`web/package.json` に `"heavy:power:exact": "node scripts/exact-power.mjs"`。

- [ ] **Step 4: 実際に測る（長走行ではない。`cargo test` × 6 回 ≈ 1 分）**

```bash
cd /home/terapyon/dev/CalcArc-e2e/web && pnpm heavy:power:exact
```
**赤が出たらそのまま報告する。** この Task の目的は全部 `ok` にすることではなく、
**どの変異がどの検査に捕まるかの地図を作ること**である。`missed` や `caught-nothing` は
**暗い帯の発見**であって失敗ではない（Task 4 の入力になる）。

- [ ] **Step 5: `git diff -- crates/` が空であることを確かめる**

```bash
cd /home/terapyon/dev/CalcArc-e2e && git diff --stat -- crates/
```
期待: 空。空でなければ戻しに失敗しているので、**再編集で戻してから**先へ進む。

- [ ] **Step 6: 実測を記録する**

`docs/corpus-measurements.md` に節を足す: 6 種それぞれの `id` / 判定 / **赤くなったテストの名前**
／変異 3 を差し替えたならその理由。**設計書と計画には数字を書き戻さない。**

- [ ] **Step 7: コミット**

```bash
cd /home/terapyon/dev/CalcArc-e2e
git add web/scripts/exact-power.mjs web/tests/unit/exact-power.test.ts web/package.json docs/corpus-measurements.md
git commit   # 例: "Measure which checks notice each of the six defects"
```

---

### Task 4: 暗い帯にだけケースを足す（Task 3 の結果次第）

**Files:**
- Modify: `reference/scripts/generate.py`（および対応する `reference/*_ref.py`）
- Modify: `testdata/*.json`（生成物。手で書かない）
- Modify: `docs/corpus-measurements.md`

**Interfaces:**
- Consumes: Task 3 の `web/exact-power.json`

**【この Task は条件付きである】** Task 3 で **`ok` 以外の判定が 1 件も無ければ、この Task は
「足すものが無かった」ことを記録して終わる**——それが**測ってから足す**ということである。
**「念のため足す」をしない。**

- [ ] **Step 1: 暗い帯を数える**

```bash
cd /home/terapyon/dev/CalcArc-e2e && python3 -c "
import json; r=json.load(open('web/exact-power.json'))['results']
dark=[x for x in r if not x['ok']]
print('暗い帯:', len(dark))
for x in dark: print(' ', x['id'], x['kind'], x['why'])"
```

- [ ] **Step 2: 帯ごとに、足す前の赤確認を書く**

暗い帯 1 件につき **golden を最大 5 件**（Global Constraints）。
**Python 参照側に足す → `uv run --no-config python scripts/generate.py` で `testdata/*.json` を再生成 → Rust の golden ハーネスが突き合わせる**、という既存の経路をそのまま使う。
**`testdata/*.json` を手で編集しない**（生成物である）。

- [ ] **Step 3: 足したあとに、同じ変異で赤くなることを確かめる**

```bash
cd /home/terapyon/dev/CalcArc-e2e/web && pnpm heavy:power:exact
```
期待: その変異の判定が `ok` に変わり、`expectTests` に**足した golden のテスト名が入る**。
**`expectTests` の更新を忘れると `unexpected-red` になる**——それが両側主張の効き目である。

- [ ] **Step 4: 生成物が生成器と一致することを確かめる**

```bash
cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config python scripts/generate.py
cd /home/terapyon/dev/CalcArc-e2e && git add --intent-to-add testdata/ && git diff --exit-code testdata/
```

- [ ] **Step 5: コミット**

```bash
cd /home/terapyon/dev/CalcArc-e2e
git add reference testdata docs/corpus-measurements.md web/scripts/exact-power.mjs
git commit   # 例: "Add cases only where the measurement found nothing watching"
```

---

### Task 5: 盤面から打てるかの穴埋め（6 件）

**Files:**
- Modify: `web/tests/e2e/convert.spec.ts`

**【裁定（実測にもとづく、spec §5 段 3 からの変更）】** spec は 段 3 を「Convert 7 + LLM 1 +
transfer 1 = 9 件」と書き、置き場所を `heavy:ui` の文脈で語っていた。**実測すると、9 件のうち
3 件は既に在る**——`web/tests/e2e/llm.spec.ts` の `the headline case: 27B INT4 with an 8K context`、
`transfer.spec.ts` の `the headline case: 100 Mbps for three hours`、`data-scale.spec.ts` の
`the headline case: 100M x 768 x float32 is 307.2 GB / 286.1 GiB` が、**実画面から打って計算値を
主張している**。Convert も `types the fixed point of the two temperature scales` で温度 1 件が在る。

**したがって新規は 6 件**（Convert の残り 6 カテゴリ: length・mass・area・volume・data-size・speed）
**であり、置き場所は Layer 5 の `convert.spec.ts`** とする。理由: ①同じ主張の既存 4 件がそこに在り、
**二重に作らない** ②Layer 5 は毎 push で走る（`heavy:ui` は手動・タグ・週 1）——「打てるか」は
**壊れたその日に知りたい** ③実測で Layer 5 は **164 本 12.9 秒**、6 件足しても秒の単位。
**`heavy:ui` は 1 本も足さない**（11.9 分の走行を伸ばさない）。

- [ ] **Step 1: 失敗するテストを書く**

`web/tests/e2e/convert.spec.ts` に追記する。**既存の `press` / `panel` ヘルパをそのまま使う**
（同ファイル冒頭に在る）。**キーのアクセシブルネームは `web/src/ui/Keypad/convert.ts` の
`ariaLabel` が正**——画面のラベルではない（S-0 の教訓）。

```ts
// **カテゴリごとに 1 件、値が core まで往復することだけを見る。**
// 換算の正しさは golden（`testdata/convert.json`）が持っている。ここが
// 見るのは「**その値をこの盤面から打てるか**」——U-1 で、計算はできるのに
// `±` が無くて不動点が打てない、という穴を実機で見つけた前例がある。
const TYPEABLE = [
  { category: "length", keys: ["1"], from: "キロメートル", to: "メートル", expect: "1000 m" },
  { category: "mass", keys: ["1"], from: "キログラム", to: "グラム", expect: "1000 g" },
  // area・volume・data-size・speed も同じ形で 1 件ずつ（合計 6 件）
] as const;

for (const c of TYPEABLE) {
  test(`${c.category}: a value typed on the keypad comes back converted`, async ({ page }) => {
    await page.goto(`/#convert/${c.category}`);
    await expect(panel(page)).toBeVisible();
    await press(page, ["値を入力", ...c.keys]);
    await press(page, ["変換元の単位を選ぶ", c.from]);
    await press(page, ["変換先の単位を選ぶ", c.to]);
    await expect(main(page)).toHaveText(c.expect);
  });
}
```

**期待値は `testdata/convert.json` から取る**（自分で計算しない。同じ値が 2 か所で
食い違ったら、どちらが正かを言えるのは golden の側である）。

- [ ] **Step 2: 走らせて落ちることを見る**

```bash
cd /home/terapyon/dev/CalcArc-e2e/web && pnpm exec playwright test convert.spec.ts
```
期待: 6 本が赤（まだ書いていない期待値・単位名の綴りが違えばそこで落ちる）。**綴りは
`Keypad/convert.ts` の `UNIT_LABELS` を読んで直す**。

- [ ] **Step 3: 緑にする**

単位名と期待値を実物に合わせる。**盤面から打てない値が見つかったら、テストを緩めずに
そのまま報告する**——それがこの Task の発見である（`crates/` も UI も直さない。spec §9）。

- [ ] **Step 4: 走らせて通ることを見る**

```bash
cd /home/terapyon/dev/CalcArc-e2e/web && pnpm exec playwright test
```
期待: 既存 **164** + 新規 6 = **170 passed**。

- [ ] **Step 5: 赤確認**

`convert.ts` の `UNIT_LABELS` から 1 つの綴りを変える → **その カテゴリの 1 本だけが赤**に
なることを確かめる（全部赤くなるなら、6 件が同じものを見ている）。戻しは再編集。

- [ ] **Step 6: コミット**

```bash
cd /home/terapyon/dev/CalcArc-e2e
git add web/tests/e2e/convert.spec.ts
git commit   # 例: "Type one value per convert category, where nobody typed before"
```

---

### Task 6: フルスイープと記録

**Files:**
- Modify: `docs/corpus-measurements.md`

**【一覧は CI から起こす。plan の一覧を信じない】**（`.github/workflows/*.yml` が正）

- [ ] **Step 1: 全部走らせる**

```bash
cd /home/terapyon/dev/CalcArc-e2e && cargo fmt --check
cd /home/terapyon/dev/CalcArc-e2e && cargo clippy --workspace --all-targets -- -D warnings
cd /home/terapyon/dev/CalcArc-e2e && cargo test --workspace
cd /home/terapyon/dev/CalcArc-e2e && wasm-pack build crates/calcarc-wasm --target web --out-dir ../../web/src/wasm
cd /home/terapyon/dev/CalcArc-e2e && wasm-pack test --headless --firefox crates/calcarc-wasm
cd /home/terapyon/dev/CalcArc-e2e/web && pnpm typecheck && pnpm lint && pnpm test
cd /home/terapyon/dev/CalcArc-e2e/web && pnpm exec vite build && pnpm check:sw && pnpm check:version
cd /home/terapyon/dev/CalcArc-e2e/web && pnpm exec playwright test
cd /home/terapyon/dev/CalcArc-e2e/reference && uv sync --locked --no-config
cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config ruff check . && uv run --no-config ruff format --check .
cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config pytest
cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config python scripts/generate.py
cd /home/terapyon/dev/CalcArc-e2e && git add --intent-to-add testdata/ && git diff --exit-code testdata/
cd /home/terapyon/dev/CalcArc-e2e/web && pnpm heavy:power:exact
cd /home/terapyon/dev/CalcArc-e2e && git diff --stat -- crates/   # 空であること
```

**`pnpm heavy`（31 秒）は変異 1・4 が `data_scale` の表示に触るので 1 度だけ回す。**
**`heavy:power`（11.2 分）と `heavy:ui`（11.9 分）は回さない**——この計画は `crates/` の
計算を変えないので、重量級の検出力は動かない。**回さない判断を記録に書く。**

- [ ] **Step 2: 記録する**

`docs/corpus-measurements.md` に、①6 種の判定と赤くなったテスト名 ②足した golden（在れば）
③盤面の 6 件 ④**回さなかった走行とその理由**。

- [ ] **Step 3: コミット**

```bash
cd /home/terapyon/dev/CalcArc-e2e
git add docs/corpus-measurements.md
git commit   # 例: "Write down what the six defects hit, and what stayed silent"
```

---

## Self-Review（計画作成時に実施済み）

**1. spec の網羅**

| spec の節 | どのタスク |
|---|---|
| §4 検出力が測られていない | Task 1・2・3（測る枠と 6 種の実測） |
| §5 段 1（変異 6 種） | Task 3。**変異 3 が単体テストで止まらないかの確認を Step の先頭に置いた** |
| §5 段 2（暗い帯にだけ足す） | Task 4（**条件付き**。暗い帯が無ければ「無かった」と記録して終わる） |
| §5 段 3（盤面経路） | Task 5。**9 件 → 6 件に減らし、置き場所を Layer 5 に変えた**（裁定を本文に明記） |
| §6 厳密一致 | 新しい許容誤差を作らない（Global Constraints） |
| §7-1 段 3 を含める | Task 5 |
| §7-2 `expectTests` | Task 1・2（既存 18 種と `verdictFor` は不変） |
| §7-3 上限 20 件 | Global Constraints + Task 4 |
| §7-4 speed は測定後 | Task 4（Task 3 の結果でしか足さない） |
| §8 完了条件 | Task 3・4・5・6 |
| §9 作らないもの | どのタスクにも登場しない |

**2. 埋めていない穴（実装者は変えてよいが、変えたら報告に書くこと）**

- **裁定 1**: 段 3 は Layer 5 の `convert.spec.ts` に置く（`heavy:ui` を伸ばさない）。既存 4 件と二重に作らない。
- **裁定 2**: 測定は `cargo test --workspace --no-fail-fast` のみ。**wasm も Playwright も回さない**（Rust の変異なので、Rust の検査で足りる）。ただし変異 1・4 は `pnpm heavy` の data-scale シャードにも見えるはずなので、Task 6 で 1 度だけ確かめる。
- **裁定 3**: `expectTests` は**テスト名の集合の完全一致**（`sameSet`）。**期待していない赤も失格**にする。

**3. 型の一貫性**

`runOneMutation(mutation, { root, measure, verdict })` — Task 1 が足し、Task 3 が使う。
`parseFailedTests` / `readCargoMeasurement` / `verdictForTests` / `measureCargo` / `EXACT_MUTATIONS` —
Task 2 が作り、Task 3 が使う。`web/exact-power.json` — Task 3 が書き、Task 4 が読む。

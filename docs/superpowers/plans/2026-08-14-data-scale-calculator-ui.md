# Data Scale の電卓化（D）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Data Scale をフォームから電卓の体裁へ作り替える。数字キーパッド + K/M/G、データ型のキー、主表示の切り替え —— 計算コアも `data_scale.json` も 1 件も変えない。

**Architecture:** L が作った万/億の文法を `web/src/units/entry.ts` へ引き上げ、単位表と桁数上限を各モジュールが束ねる（Loan は万/億・20 桁、Data Scale は K/M/G・39 桁）。キーパッド領域はアクティブ項目で数字面と型面を入れ替えるが、**格子の高さと DEL/AC の位置は動かさない**。

**Tech Stack:** React 19 + TypeScript、CSS Modules、vitest、Playwright。

## Global Constraints

- **`crates/` の差分ゼロ**、`testdata/data_scale.json` も無変更（spec §12-2）。
- **golden 不変の 3 条件**（spec §9）: 境界の署名 `data_scale(count, dimensions, dtype)` を変えない／`format.rs` の単位テーブルに触らない／KB・KiB は**コアが常に両方返し、表示層が主副を選ぶ**。
- **コアへ渡すのは素の数字列**。K/M/G は UI 層の文字列展開（`parse_count` は数字だけを受ける。base-spec §26）。
- 区画名は spec §3 から動かさない（`入力する項目` / `数字と単位のキー` / `データ型のキー`）。**E2E はパネル（`region` 名 `データスケール計算`）起点で引く**——`入力する項目` と `数字と単位のキー` は Loan と同名である。
- **44px**: 数字面・型面は縦横 44px 以上、項目行は横 44px 以上・縦 44px 未満、主表示トグルは 44px 以上。理由を spec とテストの両方に書く。
- **`DATA_TYPE_TOKENS` を増やさない**（同じ 9 個をボタンにするだけ。増やすと `token_parity` 経由で wasm 段が検証に加わる）。
- コミットはブランチガード付き（`test "$(git branch --show-current)" = feature/data-scale-calculator-ui || exit 1`）。**`git push` と PR 作成は行わない**。Co-Authored-By を付ける。
- ベースライン（L 完了時点）: Rust 192 / wasm 16 / vitest 115 / e2e 73 / Python 30。

---

### Task 1: 万・億の文法を `units/` へ引き上げる

**Files:**
- Create: `web/src/units/entry.ts`（機構。単位表も桁数上限も持たない）
- Create: `web/src/units/entry.test.ts`（機構そのものの表駆動テスト）
- Modify: `web/src/loan/entry.ts`（万・億と 20 桁を束ねて再エクスポートする窓口へ）
- Keep: `web/src/loan/entry.test.ts` を**無改修**のまま緑にする（spec §12-3）

**Interfaces:**
- Produces:
  - `units/entry.ts`: `Unit`、`Entry`、`EMPTY`、`pushDigit(entry, digit, maxDigits)`、
    `pushUnit(entry, unit)`、`canPushUnit(entry, unit)`、`backspace(entry)`、
    `isEmpty(entry)`、`text(entry)`、`digits(entry)`、`grouped(amount)`
  - `loan/entry.ts`: `MAN`、`OKU`、上を束ねた `pushDigit(entry, digit)` と、
    そのまま通す残りの再エクスポート

- [ ] **Step 1: 引き上げる（挙動は変えない）**

`web/src/units/entry.ts` は現行 `loan/entry.ts` の中身をそのまま移し、
**`MAX_DIGITS` だけ引数にする**:

```ts
/**
 * 位取りのある数の打鍵を解釈する純関数。**React も WASM も知らない**。
 *
 * 構造は「確定済みセグメントの列 + 入力中の数字」(L 設計書 §5)。累計を持たず、
 * 値・表示・DEL のすべてをこの 1 つの構造から導く。
 *
 * **単位表と桁数の上限は持たない**——それは呼び出す側の定義域だからである
 * (Loan は 万/億 と u64 の 20 桁、Data Scale は K/M/G と u128 の 39 桁)。
 */
export function pushDigit(entry: Entry, digit: string, maxDigits: number): Entry {
  if (!/^\d$/.test(digit)) return entry;
  if (entry.digits.length >= maxDigits) return entry;
  const head = entry.digits === "0" ? "" : entry.digits;
  return { ...entry, digits: head + digit };
}
```

他の関数は現行のまま移す（`pushUnit` の「下る単位しか受けない」規則も同じ）。

`web/src/loan/entry.ts` は**単位表と上限を束ねる窓口**にする:

```ts
/**
 * Loan の金額入力。機構は `units/entry.ts` にあり、ここは**この電卓の
 * 定義域**——万・億と、u64 の 10 進 20 桁——を束ねるだけである。
 *
 * D が K/M/G で同じ機構を使うので、2 人目の利用者が出た時点で引き上げた
 * (S1 の部品を L が一般化したのと同じ順序)。
 */
import * as units from "../units/entry";

export type { Entry, Unit } from "../units/entry";
export {
  backspace,
  canPushUnit,
  digits,
  EMPTY,
  grouped,
  isEmpty,
  pushUnit,
  text,
} from "../units/entry";

export const MAN: units.Unit = { label: "万", scale: 10n ** 4n };
export const OKU: units.Unit = { label: "億", scale: 10n ** 8n };

/** 円は u64。10 進 20 桁で頭打ちにする。 */
const MAX_YEN_DIGITS = 20;

export function pushDigit(entry: units.Entry, digit: string): units.Entry {
  return units.pushDigit(entry, digit, MAX_YEN_DIGITS);
}
```

- [ ] **Step 2: 機構のテストを書く**

`web/src/units/entry.test.ts`。**Loan の表とは別に、機構そのもの**を見る
（単位表を差し替えても文法が同じであることが D の前提だから）:

```ts
import { describe, expect, it } from "vitest";
import type { Unit } from "./entry";
import {
  backspace,
  canPushUnit,
  digits,
  EMPTY,
  isEmpty,
  pushDigit,
  pushUnit,
  text,
} from "./entry";

// 架空の単位表。機構が単位表に依存しないことを、Loan でも D でもない
// 組み合わせで確かめる。
const SMALL: Unit = { label: "s", scale: 10n ** 2n };
const BIG: Unit = { label: "B", scale: 10n ** 5n };

function press(keys: string, max = 39) {
  let entry = EMPTY;
  for (const key of keys) {
    if (key === "s" || key === "B") {
      const next = pushUnit(entry, key === "s" ? SMALL : BIG);
      if (next === null) throw new Error(`文法違反: ${keys}`);
      entry = next;
    } else {
      entry = pushDigit(entry, key, max);
    }
  }
  return entry;
}

describe("位取り入力の機構", () => {
  it("adds the segments together, whatever the units are", () => {
    expect(digits(press("1B2s"))).toBe("100200");
    expect(text(press("1B2s"))).toBe("1B2s");
  });

  it("only accepts units that step down", () => {
    expect(canPushUnit(press("1s2"), BIG)).toBe(false);
    expect(canPushUnit(press("1B2"), SMALL)).toBe(true);
    expect(canPushUnit(EMPTY, SMALL)).toBe(false);
  });

  it("takes the digit limit from the caller", () => {
    // 呼び出し側の定義域(Loan は u64 の 20 桁、D は u128 の 39 桁)。
    let entry = EMPTY;
    for (const digit of "123456") entry = pushDigit(entry, digit, 3);
    expect(text(entry)).toBe("123");
  });

  it("walks back one stage at a time", () => {
    expect(text(backspace(press("1B23")))).toBe("1B2");
    expect(text(backspace(press("1B")))).toBe("1");
    expect(isEmpty(backspace(press("1")))).toBe(true);
  });
});
```

- [ ] **Step 3: 緑を確認**

Run: `cd web && pnpm test --run src/units src/loan && pnpm typecheck && pnpm lint`
Expected: PASS。**`web/src/loan/entry.test.ts` は 1 文字も変えずに緑**である
こと（spec §12-3）。`git status` で確認して報告に書く。

- [ ] **Step 4: コミット**

```bash
test "$(git branch --show-current)" = feature/data-scale-calculator-ui || exit 1
git add web/src
git commit  # 件名の趣旨:「2 人目の利用者が来たので、位取りの機構を引き上げる」
```

---

### Task 2: Data Scale のキー集合と面の入れ替え

**Files:**
- Create: `web/src/datascale/entry.ts`（K/M/G と 39 桁を束ねる窓口）
- Create: `web/src/ui/Keypad/dataScale.ts`（キー集合。数字面と型面）
- Create: `web/src/ui/Keypad/dataScale.test.ts`

**Interfaces:**
- Produces:
  - `datascale/entry.ts`: `K`、`M`、`G`、`pushDigit(entry, digit)` と再エクスポート
  - `DataScaleKeyToken`、`DATA_SCALE_SECTIONS`（項目・数字面）、
    `TYPE_SECTION`（型面）

- [ ] **Step 1: キー集合のテストを書く**

```ts
import { describe, expect, it } from "vitest";
import { DATA_TYPE_TOKENS } from "../../datascale";
import { DATA_SCALE_SECTIONS, TYPE_SECTION } from "./dataScale";

describe("Data Scale のキー集合", () => {
  it("names its sections the way the design fixed them", () => {
    expect(DATA_SCALE_SECTIONS.map((s) => s.ariaLabel)).toEqual([
      "入力する項目",
      "数字と単位のキー",
    ]);
    expect(TYPE_SECTION.ariaLabel).toBe("データ型のキー");
  });

  it("keeps both faces on the same four by four frame", () => {
    // 面を入れ替えても画面が伸び縮みしないこと(設計書 §2)。
    const pad = DATA_SCALE_SECTIONS[1];
    expect(pad?.columns).toBe(4);
    expect(TYPE_SECTION.columns).toBe(4);
    expect(pad?.height).toBe("square");
    expect(TYPE_SECTION.height).toBe("square");
  });

  it("puts DEL and AC in the same place on both faces", () => {
    // 右上と、その下(設計書 §2)。面が変わっても指の位置が変わらない。
    const pad = DATA_SCALE_SECTIONS[1];
    expect(pad?.keys[3]?.token).toBe("del");
    expect(pad?.keys[7]?.token).toBe("ac");
    expect(TYPE_SECTION.keys[3]?.token).toBe("del");
    expect(TYPE_SECTION.keys[7]?.token).toBe("ac");
  });

  it("offers every data type the core knows, and no new tokens", () => {
    // token_parity は DATA_TYPE_TOKENS ↔ DataType::ALL を見ている。
    // キー化はボタンにするだけで、トークンは増やさない(設計書 §5)。
    const types = TYPE_SECTION.keys
      .map((k) => k.token)
      .filter((t): t is string => typeof t === "string" && t.startsWith("dtype:"))
      .map((t) => t.slice("dtype:".length));
    expect(types.sort()).toEqual([...DATA_TYPE_TOKENS].sort());
  });

  it("leaves the spare cells empty rather than drawing dead buttons", () => {
    // 恒久の空きは何も描かない(予約スロットとは別物。設計書 §2)。
    expect(TYPE_SECTION.keys).toHaveLength(11); // 9 型 + DEL + AC
  });

  it("gives every key an accessible name", () => {
    for (const s of [...DATA_SCALE_SECTIONS, TYPE_SECTION]) {
      for (const key of s.keys) {
        expect(key.ariaLabel.length).toBeGreaterThan(0);
      }
    }
  });
});
```

- [ ] **Step 2: 赤を確認 → 実装**

`web/src/datascale/entry.ts`:

```ts
/**
 * Data Scale の数の入力。機構は `units/entry.ts`、ここは**この電卓の
 * 定義域**——K/M/G と、u128 の 10 進 39 桁——を束ねる。
 */
import * as units from "../units/entry";

export type { Entry, Unit } from "../units/entry";
export {
  backspace,
  canPushUnit,
  digits,
  EMPTY,
  grouped,
  isEmpty,
  pushUnit,
  text,
} from "../units/entry";

export const K: units.Unit = { label: "K", scale: 10n ** 3n };
export const M: units.Unit = { label: "M", scale: 10n ** 6n };
export const G: units.Unit = { label: "G", scale: 10n ** 9n };

/** 件数と次元数は u128。10 進 39 桁で頭打ちにする。 */
const MAX_COUNT_DIGITS = 39;

export function pushDigit(entry: units.Entry, digit: string): units.Entry {
  return units.pushDigit(entry, digit, MAX_COUNT_DIGITS);
}
```

`web/src/ui/Keypad/dataScale.ts`:

```ts
import type { DataTypeToken } from "../../datascale";
import type { KeypadSection } from "./types";

export type DataScaleKeyToken =
  | `digit:${"0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"}`
  | "zeros3"
  | "k"
  | "m"
  | "g"
  | "del"
  | "ac"
  | "field:count"
  | "field:dimensions"
  | "field:dtype"
  | `dtype:${DataTypeToken}`;

const FIELDS: KeypadSection<DataScaleKeyToken> = {
  ariaLabel: "入力する項目",
  columns: 3,
  height: "half",
  keys: [
    { token: "field:count", label: "件数", ariaLabel: "件数を入力", variant: "function" },
    { token: "field:dimensions", label: "次元数", ariaLabel: "次元数を入力", variant: "function" },
    { token: "field:dtype", label: "データ型", ariaLabel: "データ型を選ぶ", variant: "function" },
  ],
};

// 数字面と型面は同じ 4×4 の枠。DEL は右上、AC はその下——**両面で同じ位置**
// (設計書 §2)。面を入れ替えても指の位置が変わらない。
const PAD: KeypadSection<DataScaleKeyToken> = {
  ariaLabel: "数字と単位のキー",
  columns: 4,
  height: "square",
  keys: [
    { token: "digit:7", label: "7", ariaLabel: "7", variant: "digit" },
    { token: "digit:8", label: "8", ariaLabel: "8", variant: "digit" },
    { token: "digit:9", label: "9", ariaLabel: "9", variant: "digit" },
    { token: "del", label: "DEL", ariaLabel: "1文字消去", variant: "danger" },

    { token: "digit:4", label: "4", ariaLabel: "4", variant: "digit" },
    { token: "digit:5", label: "5", ariaLabel: "5", variant: "digit" },
    { token: "digit:6", label: "6", ariaLabel: "6", variant: "digit" },
    { token: "ac", label: "AC", ariaLabel: "この項目を消去", variant: "danger" },

    { token: "digit:1", label: "1", ariaLabel: "1", variant: "digit" },
    { token: "digit:2", label: "2", ariaLabel: "2", variant: "digit" },
    { token: "digit:3", label: "3", ariaLabel: "3", variant: "digit" },
    { token: "k", label: "K", ariaLabel: "千", variant: "operator" },

    { token: "digit:0", label: "0", ariaLabel: "0", variant: "digit" },
    { token: "zeros3", label: "000", ariaLabel: "3桁のゼロ", variant: "digit" },
    { token: "m", label: "M", ariaLabel: "百万", variant: "operator" },
    { token: "g", label: "G", ariaLabel: "十億", variant: "operator" },
  ],
};

/**
 * 型面。9 つの型を左 3 列に置き、DEL と AC は数字面と同じ位置に置く。
 * **余った 5 セルにはボタンを置かない**——恒久の空きであり、S1 の予約
 * スロット(「ここに何か来る」)とは別物である(設計書 §2)。
 */
const TYPES: KeypadSection<DataScaleKeyToken> = {
  ariaLabel: "データ型のキー",
  columns: 4,
  height: "square",
  keys: [
    { token: "dtype:int8", label: "int8", ariaLabel: "int8", variant: "function" },
    { token: "dtype:uint8", label: "uint8", ariaLabel: "uint8", variant: "function" },
    { token: "dtype:int16", label: "int16", ariaLabel: "int16", variant: "function" },
    { token: "del", label: "DEL", ariaLabel: "1文字消去", variant: "danger" },

    { token: "dtype:float16", label: "float16", ariaLabel: "float16", variant: "function" },
    { token: "dtype:bfloat16", label: "bfloat16", ariaLabel: "bfloat16", variant: "function" },
    { token: "dtype:int32", label: "int32", ariaLabel: "int32", variant: "function" },
    { token: "ac", label: "AC", ariaLabel: "この項目を消去", variant: "danger" },

    { token: "dtype:float32", label: "float32", ariaLabel: "float32", variant: "function" },
    { token: "dtype:int64", label: "int64", ariaLabel: "int64", variant: "function" },
    { token: "dtype:float64", label: "float64", ariaLabel: "float64", variant: "function" },
  ],
};

export const DATA_SCALE_SECTIONS: KeypadSection<DataScaleKeyToken>[] = [
  FIELDS,
  PAD,
];
export const TYPE_SECTION = TYPES;
```

**キーの文字**: 型名は長いので、型面だけ文字を小さくする（`dataScale` の
パネル CSS で区画名を狙い撃つ。L で「ボーナス」に対してやったのと同じ手）。

- [ ] **Step 3: 緑を確認してコミット**

Run: `cd web && pnpm test --run src/ui/Keypad/dataScale && pnpm typecheck && pnpm lint`

```bash
test "$(git branch --show-current)" = feature/data-scale-calculator-ui || exit 1
git add web/src
git commit  # 件名の趣旨:「2 つの面を同じ枠に載せ、DEL と AC を動かさない」
```

---

### Task 3: パネルの書き換え

**Files:**
- Modify: `web/src/ui/DataScale/DataScalePanel.tsx`（全面）
- Modify: `web/src/ui/DataScale/DataScalePanel.module.css`
- Modify: `web/src/ui/DataScale/DataScalePanel.test.tsx`

- [ ] **Step 1: テストを書く**（現行 8 ケースの意味を電卓に写す）

**保つ意味**（spec §10）: 中立表示・`null` 行の非表示・エラー表示。
**新しく固定する**:

```tsx
  it("types into the active field and shows it in the echo", async () => {
    await renderPanel();
    await press(["件数を入力", "1", "0", "0", "M"]);
    expect(echo()).toHaveTextContent("件数 100M");
  });

  it("computes the headline case", async () => {
    const calc = await renderPanel();
    await press(["件数を入力", "1", "0", "0", "M", "次元数を入力", "7", "6", "8"]);
    await waitFor(() => {
      expect(main()).toHaveTextContent("307.2 GB");
    });
    // コアへ渡るのは展開後の素の数字列(base-spec §26)。
    expect(calc.compute).toHaveBeenLastCalledWith("100000000", "768", "float32");
  });

  it("swaps the keypad face when the type field is active", async () => {
    await renderPanel();
    expect(screen.getByRole("group", { name: "数字と単位のキー" })).toBeInTheDocument();
    await press(["データ型を選ぶ"]);
    expect(screen.queryByRole("group", { name: "数字と単位のキー" })).toBeNull();
    expect(screen.getByRole("group", { name: "データ型のキー" })).toBeInTheDocument();
  });

  it("starts on float32 and marks the chosen type", async () => {
    await renderPanel();
    await press(["データ型を選ぶ"]);
    expect(screen.getByRole("button", { name: "float32" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await press(["int64"]);
    expect(screen.getByRole("button", { name: "int64" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(echo()).toHaveTextContent("データ型 int64");
  });

  it("names the primary system and the active field in the status line", async () => {
    await renderPanel();
    expect(screen.getByTestId("datascale-primary")).toHaveTextContent(
      "10 進を主表示",
    );
    expect(screen.getByTestId("datascale-field")).toHaveTextContent(
      "件数を入力中",
    );
    await press(["データ型を選ぶ"]);
    expect(screen.getByTestId("datascale-field")).toHaveTextContent(
      "データ型を入力中",
    );
  });

  it("has nothing for DEL to delete on the type face", async () => {
    await renderPanel();
    await press(["データ型を選ぶ"]);
    expect(screen.getByRole("button", { name: "1文字消去" })).toBeDisabled();
  });

  it("returns the type to its default with AC", async () => {
    await renderPanel();
    await press(["データ型を選ぶ", "int64", "この項目を消去"]);
    expect(screen.getByRole("button", { name: "float32" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("closes the unit keys until a digit is there, and after a smaller unit", async () => {
    await renderPanel();
    await press(["件数を入力"]);
    expect(screen.getByRole("button", { name: "百万" })).toBeDisabled();
    await press(["1", "0", "0"]);
    expect(screen.getByRole("button", { name: "百万" })).toBeEnabled();
    await press(["M"]);
    expect(screen.getByRole("button", { name: "十億" })).toBeDisabled();
  });
```

- [ ] **Step 2: 実装**

- 状態: `active`（`count`/`dimensions`/`dtype`）、`count`/`dimensions` は
  `Entry`、`dtype` は `DataTypeToken`（**初期値 `float32`**。spec §5）。
- `sections` は `active === "dtype"` のとき `[FIELDS, TYPE_SECTION]`、
  それ以外は `DATA_SCALE_SECTIONS`。**高さは同じ枠**なので画面は動かない。
- `disabled` 述語: 型面では `del` を無効（消すものが無い。spec §5）。
  単位キーは `canPushUnit` が偽なら無効。
- `pressed` 述語: 項目タブ、そして型面の選択中の型。**数字は `undefined`**。
- 計算は導出（`count` と `dimensions` が埋まっているときだけ `compute`）。
- **`Readout` に渡すもの**（spec §7）: `echo` は「項目名 + 打った通りの値」
  （型の項目では選んでいる型: `データ型 float32`）、`main` は主表示の結果、
  `status` は 2 つ——`datascale-primary`（`10 進を主表示`）と
  `datascale-field`（`件数を入力中`）。桁区切りは main と結果領域だけに付け、
  echo には付けない（打鍵と画面を 1 対 1 に保つ）。

- [ ] **Step 3: 緑を確認してコミット**

---

### Task 4: 主表示のトグルと結果領域

**Files:**
- Modify: `web/src/ui/DataScale/DataScalePanel.tsx`
- Modify: `web/src/ui/DataScale/DataScalePanel.module.css`
- Modify: `web/src/ui/DataScale/DataScalePanel.test.tsx`（追記）

- [ ] **Step 1: テストを書く**

```tsx
  it("shows both unit systems, one of them larger", async () => {
    // base-spec §17 は「両方表示する」。トグルが変えるのは**強調**だけ
    // (設計書 §6)。
    await renderPanel();
    await fillHeadline();
    await waitFor(() => expect(main()).toHaveTextContent("307.2 GB"));
    const result = screen.getByTestId("datascale-result");
    expect(result).toHaveTextContent("307,200,000,000 bytes");
    expect(result).toHaveTextContent("286.1 GiB");
  });

  it("changes only which system is primary", async () => {
    const calc = await renderPanel();
    await fillHeadline();
    await waitFor(() => expect(main()).toHaveTextContent("307.2 GB"));
    const callsBefore = vi.mocked(calc.compute).mock.calls.length;

    await press(["2 進 (KiB) を主に"]);
    expect(main()).toHaveTextContent("286.1 GiB");
    expect(screen.getByTestId("datascale-result")).toHaveTextContent(
      "307,200,000,000 bytes",
    );
    // 表示層だけの切り替え。計算は起きない(設計書 §9-3)。
    expect(vi.mocked(calc.compute).mock.calls.length).toBe(callsBefore);
  });

  it("falls through to the other system, then to bytes", async () => {
    // 1000 bytes 未満では両方 null(既知の非対称)。main は主 → 副 → bytes
    // の順に繰り上げる(設計書 §6)。
    const calc = await renderPanel(
      stubCalc({
        compute: vi.fn().mockReturnValue({
          bytes: "999",
          bytesGrouped: "999",
          decimal: null,
          binary: null,
          error: null,
        }),
      }),
    );
    await fillHeadline();
    await waitFor(() => expect(main()).toHaveTextContent("999 bytes"));
    // 結果領域は null の行を出さない(現行のまま)。
    expect(screen.getByTestId("datascale-result")).not.toHaveTextContent("GB");
    expect(calc.compute).toHaveBeenCalled();
  });

  it("promotes the other system when the primary one is missing", async () => {
    const calc = await renderPanel(
      stubCalc({
        compute: vi.fn().mockReturnValue({
          bytes: "1000",
          bytesGrouped: "1,000",
          decimal: "1.0 KB",
          binary: null,
          error: null,
        }),
      }),
    );
    await fillHeadline();
    await press(["2 進 (KiB) を主に"]);
    // 2 進が無いので 10 進が主に繰り上がる——空の主表示を見せない。
    await waitFor(() => expect(main()).toHaveTextContent("1.0 KB"));
    expect(calc.compute).toHaveBeenCalled();
  });
```

- [ ] **Step 2: 実装**

- トグルは**結果領域の自前ボタン 2 つ**（`Keypad` の区画にしない。spec §3）。
  グループの名前は `主に表示する単位系`、ボタンは `10 進 (KB) を主に` /
  `2 進 (KiB) を主に`。`aria-pressed` と **44px**。
- main は `primary → secondary → bytes` の順に繰り上げ（spec §6 の表）。
- 結果領域（`data-testid="datascale-result"`）は `bytes`・主・副の 3 行で、
  **`null` の行は出さない**（現行の振る舞いを保つ）。

- [ ] **Step 3: 緑を確認してコミット**

---

### Task 5: E2E とフルスイープ

**Files:**
- Modify: `web/tests/e2e/data-scale.spec.ts`（約 100 行の書き換え）
- Modify: `web/tests/e2e/pwa.spec.ts`（**オフライン検査の書き換え**）
- Create: `web/tests/e2e/data-scale-keypad.spec.ts`

- [ ] **Step 1: `pwa.spec.ts` を直す（最優先）**

現行はオフライン中に `getByLabel("件数").fill(...)` で入力している。
**電卓化でラベル付き input が消えるので、ここが直撃で赤になる。**
忘れると「オフラインで計算できる」という**オフラインの中核検査**が落ちる
（spec §10 の見落とし筆頭）。キー押下に書き換える:

```ts
  // Data Scale: 基準例 100M x 768 x float32 = 307.2 GB。
  await page.getByRole("link", { name: "Data Scale", exact: true }).click();
  const panel = page.getByRole("region", { name: "データスケール計算" });
  for (const name of ["件数を入力", "1", "0", "0", "M", "次元数を入力", "7", "6", "8"]) {
    await panel.getByRole("button", { name, exact: true }).click();
  }
  await expect(page.getByTestId("display-main")).toHaveText("307.2 GB");
```

- [ ] **Step 2: `data-scale.spec.ts` を書き換える**

**流用**: ナビ・ディープリンク・戻る（1〜78 行）。
**書き換え**: 基準例・39 桁・2^128 の Overflow・単位未満・中立・
リスナ非漏洩。**期待値は golden 由来なので変えない**
（307.2 GB / 286.1 GiB、340,282,366,920,938,463,463,374,607,431,768,211,454 bytes）。

- [ ] **Step 3: 盤面の E2E を書く**

`data-scale-keypad.spec.ts`（`loan-keypad.spec.ts` と同型）:
44px の両側、K/M/G の可否（数字なし・逆順）、項目タブで echo が入れ替わる、
**面を入れ替えても格子の高さと DEL/AC の位置が変わらない**、
型面の DEL 無効、AC で既定へ、主表示トグルが `bytes` を変えないこと。

```ts
test("the two faces keep the same frame", async ({ page }) => {
  // 入れ替えで画面が伸び縮みすると、押そうとした位置がずれる(設計書 §2)。
  const pad = panel(page).getByRole("group", { name: "数字と単位のキー" });
  const before = await pad.boundingBox();
  const delBefore = await panel(page)
    .getByRole("button", { name: "1文字消去" })
    .boundingBox();

  await press(page, ["データ型を選ぶ"]);
  const types = panel(page).getByRole("group", { name: "データ型のキー" });
  const after = await types.boundingBox();
  const delAfter = await panel(page)
    .getByRole("button", { name: "1文字消去" })
    .boundingBox();

  expect(after?.height).toBeCloseTo(before?.height ?? 0, 0);
  expect(delAfter?.x).toBeCloseTo(delBefore?.x ?? 0, 0);
  expect(delAfter?.y).toBeCloseTo(delBefore?.y ?? 0, 0);
});
```

- [ ] **Step 4: フルスイープ**

**4173 を掴んでいる `vite preview` が居ないか先に確認する**
（`ss -ltnp | grep 4173`）。

```bash
cargo test --workspace      # 変更ゼロの確認込み
cd web && pnpm typecheck && pnpm lint && pnpm test && pnpm exec vite build && pnpm check:sw && pnpm e2e
```
`git diff --stat 255d24b -- crates/ testdata/` が空であることを報告に書く。
wasm と Python は回さない（トークンを増やさないため。tiering）。

- [ ] **Step 5: 実機ビルドを撮って見る**

`vite preview` → Playwright で 390×844 のスクリーンショット 3 枚
（数字面・型面・結果あり）→ **目で確認** → **preview を落とし、
`ss -ltnp | grep 4173` で解放を確かめる**（撮ったあとの確認までが手順。
L の前に 1 度、落としたつもりで残っていた）。
型名の折り返し・面の入れ替えでのズレ・トグルの押下の見え方を見る。

- [ ] **Step 6: コミット**

---

# 進捗の見取り図

| タスク | 成果物 | 検証段 | spec |
|---|---|---|---|
| 1 | `units/entry.ts` への引き上げ（Loan 無改修） | vitest | §4 |
| 2 | キー集合 2 面（枠と DEL/AC 固定） | vitest | §2/§5 |
| 3 | パネル（アクティブ項目・型面） | vitest | §2/§5/§7 |
| 4 | 主表示トグルと 3 段の繰り上げ | vitest | §6/§7 |
| 5 | E2E（pwa 含む）+ フルスイープ + 実機確認 | 全レイヤー（wasm/Python 以外） | §10/§12 |

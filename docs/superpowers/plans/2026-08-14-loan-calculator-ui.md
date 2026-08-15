# Loan の電卓化（L）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Loan をフォームから電卓の体裁へ作り替える。数字キーパッド + 万/億、アクティブ項目、上部表示 —— 計算コアは 1 行も変えない。

**Architecture:** S1 の `Keypad`/`Key` をトークン型でジェネリックにし（`pressed`/`disabled` の述語を足す）、Scientific は無改修のまま Loan が 2 人目の利用者になる。万/億の文法は `web/src/loan/entry.ts` の純関数（React も WASM も知らない）で、確定済みセグメントの列 + 入力中の数字から値・表示・DEL を導く。

**Tech Stack:** React 19 + TypeScript、CSS Modules、vitest、Playwright。

## Global Constraints

- **`crates/` の差分ゼロ**。完了時に `git diff --stat 90a9e7d -- crates/` が空であること（spec §11-2）。
- **`web/src/loan/index.ts` は「型変換と初期化だけ」を保つ**。入力の解釈は `entry.ts` に置く（spec §5）。
- **コアへ渡すのは素の数字列**（カンマ・符号・小数点なし。`parse_yen` が拒否する。base-spec §26）。
- **アクセシブルネームは日本語**。区画名は spec §3 の 3 つ（`求めるもの` / `入力する項目` / `数字と単位のキー`）から動かさない——E2E のセレクタである。
- **44px**: 数字と単位の区画は縦横 44px 以上、半高の 2 区画は横 44px 以上・縦 44px 未満。理由を spec とテストの両方に書く（spec §8）。
- 既存製品の意匠は複製しない。参考にするのは配置慣習と操作感まで。
- コミットはブランチガード付き（`test "$(git branch --show-current)" = feature/loan-calculator-ui || exit 1`）。**`git push` と PR 作成は行わない**。Co-Authored-By を付ける。
- ベースライン（S3 完了時点）: Rust 192 / wasm 16 / vitest 81 / e2e 63 / Python 30。

---

### Task 1: キーパッドをトークン型でジェネリックにする

**Files:**
- Modify: `web/src/ui/Keypad/types.ts`
- Modify: `web/src/ui/Keypad/Keypad.tsx`
- Modify: `web/src/ui/Key/Key.tsx`
- Modify: `web/src/ui/Keypad/Keypad.test.tsx`（汎用の検査だけ残す）
- Create: `web/src/ui/Keypad/scientific.test.ts`（Scientific のキー集合の検査を移す）

**Interfaces:**
- Produces（Task 3 が使う）:
  - `KeyDef<T>` / `ShiftFace<T>` / `KeypadSection<T>`
  - `Keypad<T>({ sections, onPress, pressed?, disabled? })`
  - `Key<T>({ token, label, ariaLabel, variant?, pressed?, disabled?, onPress, onActivate? })`

- [ ] **Step 1: 失敗するテストを書く**

`Keypad.test.tsx` を**汎用の検査に絞る**。Scientific のキー集合に依存しない
小さな fixture を使い、ジェネリックであること自体を固定する。

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Keypad } from "./Keypad";
import type { KeypadSection } from "./types";

type Demo = "a" | "b";

const SECTIONS: KeypadSection<Demo>[] = [
  {
    ariaLabel: "テストの区画",
    columns: 2,
    height: "square",
    keys: [
      { token: "a", label: "A", ariaLabel: "エー", variant: "digit" },
      { token: "b", label: "B", ariaLabel: "ビー", variant: "digit" },
      { token: null, label: "—", ariaLabel: "予約", variant: "function" },
    ],
  },
];

describe("Keypad（汎用）", () => {
  it("returns whatever token type it was given", async () => {
    const onPress = vi.fn<(token: Demo) => void>();
    render(<Keypad sections={SECTIONS} onPress={onPress} />);
    await userEvent.click(screen.getByRole("button", { name: "エー" }));
    expect(onPress).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("draws a section per group, with its own column count", () => {
    render(<Keypad sections={SECTIONS} onPress={vi.fn()} />);
    expect(
      screen.getByRole("group", { name: "テストの区画" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("sends nothing from a reserved slot", async () => {
    const onPress = vi.fn();
    render(<Keypad sections={SECTIONS} onPress={onPress} />);
    const reserved = screen.getByRole("button", { name: "予約" });
    expect(reserved).toBeDisabled();
    await userEvent.click(reserved);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("lets the caller decide which keys are toggles, and which are not", () => {
    // モード行・項目行は「画面全体の状態」で押下が決まる(設計書 §4)。
    // **undefined を返したキーには aria-pressed を付けない**——数字キーに
    // "false" が付くと、読み上げが全キーをトグルボタンとして扱う。
    render(
      <Keypad
        sections={SECTIONS}
        onPress={vi.fn()}
        pressed={(token) => (token === "b" ? true : undefined)}
      />,
    );
    expect(screen.getByRole("button", { name: "ビー" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "エー" })).not.toHaveAttribute(
      "aria-pressed",
    );
  });

  it("lets the caller disable keys that exist but cannot be pressed now", async () => {
    // 予約スロット(恒久の空き)とは由来が違う無効(設計書 §4)。
    const onPress = vi.fn();
    render(
      <Keypad
        sections={SECTIONS}
        onPress={onPress}
        disabled={(token) => token === "a"}
      />,
    );
    const a = screen.getByRole("button", { name: "エー" });
    expect(a).toBeDisabled();
    await userEvent.click(a);
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "ビー" })).toBeEnabled();
  });

  it("says nothing about pressed state when the caller does not ask", () => {
    // Scientific は述語を渡さない。aria-pressed が勝手に付くと、押せる
    // だけのキーがトグルに見える。
    render(<Keypad sections={SECTIONS} onPress={vi.fn()} />);
    expect(screen.getByRole("button", { name: "エー" })).not.toHaveAttribute(
      "aria-pressed",
    );
  });
});
```

Scientific のキー集合の検査は `web/src/ui/Keypad/scientific.test.ts` へ移す
（**描画を伴わないので `.ts`**）。移すのは現行 `Keypad.test.tsx` の
「`KEY_TOKENS` を過不足なく網羅」「予約スロットは第 1 面に無い」
「アクセシブルネームがある」「5×5 の並び」「関数列の並び」の 5 本。
Shift の 4 本は描画が要るので `Keypad.test.tsx` に残し、`SCIENTIFIC_SECTIONS`
を import して使う（**Scientific は Keypad の実利用者として検査し続ける**）。

- [ ] **Step 2: 赤を確認**

Run: `cd web && pnpm test --run src/ui/Keypad`
Expected: FAIL（`KeypadSection<Demo>` が型引数を取らない、`pressed`/`disabled`
が無い）。

- [ ] **Step 3: 型をジェネリックにする**

`types.ts`:

```ts
import type { KeyVariant } from "../Key/Key";

/** Shift の第 2 面で差し替わる内容。 */
export interface ShiftFace<T> {
  token: T | null;
  label: string;
  ariaLabel: string;
  variant: KeyVariant;
}

export interface KeyDef<T> {
  /** 押したときに送るトークン。予約スロットは null(何も送らない)。 */
  token: T | null;
  label: string;
  ariaLabel: string;
  variant: KeyVariant;
  shift?: ShiftFace<T>;
  kind?: "shift";
}

export interface KeypadSection<T> {
  ariaLabel: string;
  columns: number;
  /** 行の高さ。square = 正方、half = 半高(設計書 §4)。 */
  height: "square" | "half";
  keys: KeyDef<T>[];
}
```

`KeyToken` の import は消える——**キーパッドは calc の語彙を知らなくなる**。

- [ ] **Step 4: `Key` をジェネリックにし、状態依存の無効を足す**

```tsx
export interface KeyProps<T> {
  /** 押したときに送るトークン。null は予約スロット(恒久の空き)。 */
  token: T | null;
  label: string;
  ariaLabel?: string;
  variant?: KeyVariant;
  /** トグルキーの押下状態。渡さなければ aria-pressed は付かない。 */
  pressed?: boolean;
  /**
   * 今は押せない(状態依存)。予約スロットとは由来が違う——あちらは
   * 「ここに何か来る」永続的な空きで、こちらは条件が変われば押せる。
   */
  disabled?: boolean;
  onPress: (token: T) => void;
  onActivate?: () => void;
}

export function Key<T>({
  token,
  label,
  ariaLabel,
  variant = "digit",
  pressed,
  disabled,
  onPress,
  onActivate,
}: KeyProps<T>) {
  const reserved = token === null && !onActivate;
  const off = reserved || disabled === true;
  return (
    <button
      type="button"
      className={`${styles.key} ${styles[variant]}`}
      aria-label={ariaLabel ?? label}
      aria-pressed={pressed}
      data-token={token === null ? undefined : String(token)}
      disabled={off}
      aria-disabled={off || undefined}
      onClick={() => {
        if (onActivate) {
          onActivate();
          return;
        }
        if (token !== null) onPress(token);
      }}
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 5: `Keypad` をジェネリックにする**

```tsx
export interface KeypadProps<T> {
  sections: KeypadSection<T>[];
  onPress: (token: T) => void;
  /**
   * 押下状態を呼び出し側が決める(モード行・項目行。設計書 §4)。
   * **`undefined` は「トグルではない」**——`aria-pressed` を付けない。
   * 数字キーに `aria-pressed="false"` が付くと、読み上げが全キーを
   * トグルボタンとして扱う(base-spec §43 の意味論の退行)。
   */
  pressed?: (token: T) => boolean | undefined;
  /** 今は押せない(状態依存)。省略時はすべて押せる。 */
  disabled?: (token: T) => boolean;
}

export function Keypad<T>({
  sections,
  onPress,
  pressed,
  disabled,
}: KeypadProps<T>) {
  const [shifted, setShifted] = useState(false);
  // …区画のループは現行のまま。各 Key に次を渡す:
  //   pressed={key.token === null ? undefined : pressed?.(face.token)}
  //   disabled={face.token !== null && disabled?.(face.token)}
}
```

**`pressed` を渡さない呼び出しでは `undefined` のままにする**（`aria-pressed`
が付かない）。Shift キーだけは従来どおり内部 state を渡す。

- [ ] **Step 6: 緑を確認**

Run: `cd web && pnpm test --run && pnpm typecheck && pnpm lint`
Expected: PASS。**Scientific 側のファイルを 1 つも変えずに緑**であること
（`git status` で `scientific.ts`・`ScientificPanel.tsx` に差分が無いこと）。
これが spec §11-7 の実体である。

- [ ] **Step 7: コミット**

```bash
test "$(git branch --show-current)" = feature/loan-calculator-ui || exit 1
git add web/src/ui
git commit  # 件名の趣旨:「キーパッドはトークンの意味を知らなくてよい」
```

---

### Task 2: 万・億の入力（`entry.ts`）

**Files:**
- Create: `web/src/loan/entry.ts`
- Create: `web/src/loan/entry.test.ts`（jsdom 不要の素の vitest）

**Interfaces:**
- Produces（Task 3-4 が使う）:
  - `type Unit = { label: string; scale: bigint }`、`MAN`、`OKU`
  - `type Entry`（不変値）、`EMPTY: Entry`
  - `pushDigit(entry, digit: string): Entry`
  - `pushUnit(entry, unit): Entry | null`（**null は文法違反**）
  - `canPushUnit(entry, unit): boolean`
  - `backspace(entry): Entry`
  - `isEmpty(entry): boolean`
  - `text(entry): string`（打った通り）
  - `digits(entry): string`（コアへ渡す素の数字列。空なら `""`）
  - `grouped(amount: string): string`（表示の桁区切り）

- [ ] **Step 1: 失敗するテストを書く**

`web/src/loan/entry.test.ts`。**設計書 §5 の表がそのままケース**である。

```ts
import { describe, expect, it } from "vitest";
import {
  backspace,
  canPushUnit,
  digits,
  EMPTY,
  grouped,
  MAN,
  OKU,
  pushDigit,
  pushUnit,
  text,
} from "./entry";
import type { Entry } from "./entry";

/** 打鍵列をそのまま流す。"万"/"億" は単位キー、それ以外は数字。 */
function press(keys: string): Entry {
  let entry = EMPTY;
  for (const key of keys) {
    if (key === "万" || key === "億") {
      const next = pushUnit(entry, key === "万" ? MAN : OKU);
      if (next === null) throw new Error(`文法違反: ${keys}`);
      entry = next;
    } else {
      entry = pushDigit(entry, key);
    }
  }
  return entry;
}

describe("万・億の入力", () => {
  it("commits the digits at the position the unit names", () => {
    expect(digits(press("3000万"))).toBe("30000000");
    expect(text(press("3000万"))).toBe("3000万");
  });

  it("adds the segments together", () => {
    expect(digits(press("1億2000万"))).toBe("120000000");
    expect(text(press("1億2000万"))).toBe("1億2000万");
    // 口語の「1 億 2000 万」を 12000 万と打っても同じ値になる。
    expect(digits(press("12000万"))).toBe("120000000");
  });

  it("keeps typing after the last unit as plain ones", () => {
    expect(digits(press("1億2000万500"))).toBe("120000500");
    expect(text(press("1億2000万500"))).toBe("1億2000万500");
  });

  it("refuses a unit that does not go down", () => {
    // 3000万 のあとの 億 は「3000 万億」で意味が無い(設計書 §5)。
    const after = press("3000万");
    expect(canPushUnit(after, OKU)).toBe(false);
    expect(pushUnit(after, OKU)).toBeNull();
    // 同じ単位の重ねも不可。
    expect(canPushUnit(after, MAN)).toBe(false);
  });

  it("refuses a unit with no digits in front of it", () => {
    expect(canPushUnit(EMPTY, MAN)).toBe(false);
    expect(pushUnit(EMPTY, MAN)).toBeNull();
    // 単位の直後も同じ(1億億 を防ぐ)。
    expect(canPushUnit(press("1億"), MAN)).toBe(true); // 億 → 万 は下るので可
    expect(canPushUnit(press("1億"), OKU)).toBe(false);
  });

  it("walks back one stage at a time", () => {
    // 入力中の数字があれば 1 文字。無ければ直前のセグメントを解いて戻す。
    expect(text(backspace(press("1億2000")))).toBe("1億200");
    expect(text(backspace(press("1億")))).toBe("1");
    expect(digits(backspace(press("1億")))).toBe("1");
    expect(text(backspace(press("1")))).toBe("");
    expect(text(backspace(EMPTY))).toBe("");
  });

  it("gives the core plain digits, never separators", () => {
    // parse_yen はカンマ・符号・小数点を拒否する(base-spec §26)。
    expect(digits(press("1億2000万500"))).toMatch(/^\d+$/);
    expect(digits(EMPTY)).toBe("");
  });

  it("drops a leading zero the way a calculator does", () => {
    expect(text(press("007"))).toBe("7");
    expect(text(press("0"))).toBe("0");
  });

  it("groups digits for display only", () => {
    expect(grouped("38579007")).toBe("38,579,007");
    expect(grouped("0")).toBe("0");
  });
});
```

- [ ] **Step 2: 赤を確認**

Run: `cd web && pnpm test --run src/loan/entry`
Expected: FAIL（`./entry` が無い）。

- [ ] **Step 3: 実装**

```ts
/**
 * 金額の打鍵を解釈する純関数。**React も WASM も知らない**——`types.ts` と
 * 同じ層である(`index.ts` は型変換と初期化だけを持つ)。
 *
 * 構造は「確定済みセグメントの列 + 入力中の数字」(設計書 §5)。累計を持たず、
 * 値・表示・DEL のすべてをこの 1 つの構造から導く。
 */

/** 位取りの単位。scale は 10 の冪。 */
export interface Unit {
  label: string;
  scale: bigint;
}

export const MAN: Unit = { label: "万", scale: 10n ** 4n };
export const OKU: Unit = { label: "億", scale: 10n ** 8n };

interface Segment {
  digits: string;
  unit: Unit;
}

export interface Entry {
  segments: Segment[];
  /** まだ単位が付いていない、入力中の数字。 */
  digits: string;
}

export const EMPTY: Entry = { segments: [], digits: "" };

/** 入力欄に打てる 1 セグメントの最大桁数。u64 の 10 進 20 桁に合わせる。 */
const MAX_DIGITS = 20;

export function pushDigit(entry: Entry, digit: string): Entry {
  if (!/^\d$/.test(digit)) return entry;
  if (entry.digits.length >= MAX_DIGITS) return entry;
  // 先頭の 0 は次の数字で置き換える("0" -> "5" であって "05" ではない)。
  const head = entry.digits === "0" ? "" : entry.digits;
  return { ...entry, digits: head + digit };
}

/**
 * 単位キー。**下る単位しか受けない**（万 のあとに 億 は無い）。
 * 文法違反は null——盤面は `canPushUnit` でそのキーを押せなくするので、
 * ここに来るのは盤面を通らない経路（別の UI、テスト）だけである。
 */
export function pushUnit(entry: Entry, unit: Unit): Entry | null {
  if (entry.digits === "") return null;
  const last = entry.segments.at(-1);
  if (last && last.unit.scale <= unit.scale) return null;
  return {
    segments: [...entry.segments, { digits: entry.digits, unit }],
    digits: "",
  };
}

export function canPushUnit(entry: Entry, unit: Unit): boolean {
  // 規則を 2 か所に書かない。押せるかどうかは「押せた結果があるか」である。
  return pushUnit(entry, unit) !== null;
}

/** DEL 1 回。入力中の数字があれば 1 文字、無ければ直前のセグメントを解く。 */
/** 何も打たれていないか。可否の判定で何度も要る。 */
export function isEmpty(entry: Entry): boolean {
  return entry.segments.length === 0 && entry.digits === "";
}

export function backspace(entry: Entry): Entry {
  if (entry.digits !== "") {
    return { ...entry, digits: entry.digits.slice(0, -1) };
  }
  const last = entry.segments.at(-1);
  if (!last) return entry;
  return { segments: entry.segments.slice(0, -1), digits: last.digits };
}

/** 打った通りの文字列。桁区切りは入れない(打鍵と画面を 1 対 1 に保つ)。 */
export function text(entry: Entry): string {
  const head = entry.segments.map((s) => `${s.digits}${s.unit.label}`).join("");
  return head + entry.digits;
}

/** コアへ渡す素の数字列。空の入力は空文字。 */
export function digits(entry: Entry): string {
  if (entry.segments.length === 0) return entry.digits;
  const total = entry.segments.reduce(
    (sum, s) => sum + BigInt(s.digits) * s.unit.scale,
    entry.digits === "" ? 0n : BigInt(entry.digits),
  );
  return total.toString();
}

/** 表示のための桁区切り。金額は number に収まらないので文字列のまま加工する。 */
export function grouped(amount: string): string {
  return amount.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
```

- [ ] **Step 4: 緑を確認**

Run: `cd web && pnpm test --run src/loan/entry && pnpm typecheck && pnpm lint`

- [ ] **Step 5: 赤確認（規則を壊して見る）**

`pushUnit` の `last.unit.scale <= unit.scale` を `<` に変え、
**同じ単位の重ね（`3000万` のあとの `万`）が通ってしまう**ことを
`refuses a unit that does not go down` が捕まえることを確認して戻す。
**実出力を報告に貼る。**

- [ ] **Step 6: コミット**

```bash
test "$(git branch --show-current)" = feature/loan-calculator-ui || exit 1
git add web/src/loan
git commit  # 件名の趣旨:「万と億は、確定したセグメントの列である」
```

---

### Task 3: 盤面とアクティブ項目

**Files:**
- Create: `web/src/ui/Keypad/loan.ts`（Loan のキー集合）
- Create: `web/src/ui/Keypad/loan.test.ts`
- Modify: `web/src/ui/Loan/LoanPanel.tsx`（骨格の入れ替え）
- Modify: `web/src/ui/Loan/LoanPanel.module.css`
- Modify: `web/src/ui/Loan/LoanPanel.test.tsx`

**Interfaces:**
- Consumes: Task 1 の `Keypad<T>`、Task 2 の `entry.ts`
- Produces:
  - `LoanKeyToken`（union）、`LOAN_SECTIONS: KeypadSection<LoanKeyToken>[]`
  - `LoanField = "principal" | "rate" | "months" | "payment" | "residual" | "bonus"`

- [ ] **Step 1: キー集合のテストを書く**

`web/src/ui/Keypad/loan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LOAN_SECTIONS } from "./loan";

function section(ariaLabel: string) {
  const found = LOAN_SECTIONS.find((s) => s.ariaLabel === ariaLabel);
  if (!found) throw new Error(`no section named ${ariaLabel}`);
  return found;
}

describe("Loan のキー集合", () => {
  it("names its sections the way the design fixed them", () => {
    // 区画名は E2E のセレクタである(設計書 §3)。勝手に変えない。
    expect(LOAN_SECTIONS.map((s) => s.ariaLabel)).toEqual([
      "求めるもの",
      "入力する項目",
      "数字と単位のキー",
    ]);
  });

  it("lays the number pad out four by four", () => {
    const pad = section("数字と単位のキー");
    expect(pad.columns).toBe(4);
    expect(pad.height).toBe("square");
    expect(pad.keys.map((k) => k.label)).toEqual([
      "7", "8", "9", "DEL",
      "4", "5", "6", "AC",
      "1", "2", "3", "万",
      "0", "000", ".", "億",
    ]);
  });

  it("keeps the mode and field rows half height", () => {
    expect(section("求めるもの").height).toBe("half");
    expect(section("入力する項目").height).toBe("half");
    expect(section("求めるもの").keys).toHaveLength(3);
    expect(section("入力する項目").keys).toHaveLength(6);
  });

  it("gives every key an accessible name", () => {
    for (const s of LOAN_SECTIONS) {
      for (const key of s.keys) {
        expect(key.ariaLabel.length).toBeGreaterThan(0);
      }
    }
  });
});
```

- [ ] **Step 2: 赤を確認 → キー集合を書く**

Run: `cd web && pnpm test --run src/ui/Keypad/loan`（FAIL）。

`web/src/ui/Keypad/loan.ts`:

```ts
import type { KeypadSection } from "./types";

/**
 * Loan のキー集合。
 *
 * 日本の電卓の**配置慣習と操作感まで**を参考にしている。意匠は複製していない
 * (base-spec §3、§12)。制御(DEL・AC)は右上、単位(万・億)は右下——金額を
 * 打った直後に押すキーなので数字の近くに置く(設計書 §2)。
 */
export type LoanKeyToken =
  | "digit:0" | "digit:1" | "digit:2" | "digit:3" | "digit:4"
  | "digit:5" | "digit:6" | "digit:7" | "digit:8" | "digit:9"
  | "zeros3"
  | "dot"
  | "man"
  | "oku"
  | "del"
  | "ac"
  | `mode:payment` | `mode:principal` | `mode:term`
  | `field:principal` | `field:rate` | `field:months`
  | `field:payment` | `field:bonus` | `field:residual`;

const MODES: KeypadSection<LoanKeyToken> = {
  ariaLabel: "求めるもの",
  columns: 3,
  height: "half",
  keys: [
    { token: "mode:payment", label: "月々の返済額", ariaLabel: "月々の返済額を求める", variant: "function" },
    { token: "mode:principal", label: "借入可能額", ariaLabel: "借入可能額を求める", variant: "function" },
    { token: "mode:term", label: "返済期間", ariaLabel: "返済期間を求める", variant: "function" },
  ],
};

const FIELDS: KeypadSection<LoanKeyToken> = {
  ariaLabel: "入力する項目",
  columns: 6,
  height: "half",
  keys: [
    { token: "field:principal", label: "借入額", ariaLabel: "借入額を入力", variant: "function" },
    { token: "field:rate", label: "年利", ariaLabel: "年利を入力", variant: "function" },
    { token: "field:months", label: "期間", ariaLabel: "返済期間を入力", variant: "function" },
    // 月々の返済額は、月額モードでは答だが他の 2 モードでは入力である
    // (設計書 §6)。タブは常に置き、モードで無効にする。
    { token: "field:payment", label: "月額", ariaLabel: "月々の返済額を入力", variant: "function" },
    { token: "field:residual", label: "残価", ariaLabel: "残価を入力", variant: "function" },
    // ボーナスはモードで意味が変わる。ラベルは Panel が差し替える(設計書 §6)。
    { token: "field:bonus", label: "ボーナス", ariaLabel: "ボーナス返済分（元本）を入力", variant: "function" },
  ],
};

const PAD: KeypadSection<LoanKeyToken> = {
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
    { token: "man", label: "万", ariaLabel: "万", variant: "operator" },

    { token: "digit:0", label: "0", ariaLabel: "0", variant: "digit" },
    { token: "zeros3", label: "000", ariaLabel: "3桁のゼロ", variant: "digit" },
    { token: "dot", label: ".", ariaLabel: "小数点", variant: "digit" },
    { token: "oku", label: "億", ariaLabel: "億", variant: "operator" },
  ],
};

export const LOAN_SECTIONS: KeypadSection<LoanKeyToken>[] = [MODES, FIELDS, PAD];
```

- [ ] **Step 3: パネルの骨格テストを書く**

`LoanPanel.test.tsx` を電卓の体裁に書き換える。**vi.mock の境界は現行のまま**
（`../../loan` を差し替える）。

```tsx
  it("types into the active field and shows it in the echo", async () => {
    const calc = await renderPanel();
    await press(["借入額を入力", "3", "0", "0", "0", "万"]);
    expect(screen.getByTestId("display-echo")).toHaveTextContent("借入額 3000万円");
  });

  it("keeps each field's entry when the active field changes", async () => {
    await renderPanel();
    await press(["借入額を入力", "3", "0", "0", "0", "万", "年利を入力", "1", ".", "5"]);
    expect(screen.getByTestId("display-echo")).toHaveTextContent("年利 1.5%");
    // 項目を戻すと、その項目に入っている値が echo に出る(設計書 §7)。
    await press(["借入額を入力"]);
    expect(screen.getByTestId("display-echo")).toHaveTextContent("借入額 3000万円");
  });

  it("computes once the fields the mode needs are filled", async () => {
    const calc = await renderPanel();
    await press([
      "借入額を入力", "3", "0", "0", "0", "万",
      "年利を入力", "1", ".", "5",
      "返済期間を入力", "4", "2", "0",
    ]);
    await waitFor(() => {
      expect(screen.getByTestId("display-main")).toHaveTextContent("91,855 円");
    });
    // コアへ渡るのは素の数字列(カンマも単位も無い)。
    expect(calc.forward).toHaveBeenLastCalledWith("30000000", "1.5", 420, "0");
  });

  it("closes the keys a field cannot take", async () => {
    await renderPanel();
    await press(["年利を入力"]);
    expect(screen.getByRole("button", { name: "万" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "3桁のゼロ" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "小数点" })).toBeEnabled();

    await press(["借入額を入力"]);
    expect(screen.getByRole("button", { name: "小数点" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "3桁のゼロ" })).toBeEnabled();
  });

  it("closes the unit keys until a digit is there, and after a smaller unit", async () => {
    await renderPanel();
    await press(["借入額を入力"]);
    expect(screen.getByRole("button", { name: "万" })).toBeDisabled();
    await press(["3", "0", "0", "0"]);
    expect(screen.getByRole("button", { name: "万" })).toBeEnabled();
    await press(["万"]);
    // 万 のあとに 億 は無い(設計書 §5)。押せない。
    expect(screen.getByRole("button", { name: "億" })).toBeDisabled();
  });

  it("marks the mode and the active field as pressed", async () => {
    await renderPanel();
    expect(
      screen.getByRole("button", { name: "月々の返済額を求める" }),
    ).toHaveAttribute("aria-pressed", "true");
    await press(["借入可能額を求める"]);
    expect(
      screen.getByRole("button", { name: "借入可能額を求める" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("closes the field the mode is solving for", async () => {
    await renderPanel();
    // 月額モードでは月々の返済額が答なので、項目としては押せない。
    expect(
      screen.getByRole("button", { name: /月々の返済額を入力/ }),
    ).toBeDisabled();
  });

  it("keeps the bonus meanings apart", async () => {
    // モードで意味が変わる欄。値を混ぜない(設計書 §6)。
    const calc = await renderPanel();
    await press(["ボーナス返済分（元本）を入力", "6", "0", "0", "万"]);
    await press(["借入可能額を求める"]);
    // 借入可能額モードのボーナスは「回の返済額」で、まだ空。
    expect(screen.getByTestId("display-echo")).toHaveTextContent("ボーナス回の返済額");
    expect(screen.getByTestId("display-echo")).not.toHaveTextContent("600万");
  });

  it("does not let a residual from another mode block the bonus", async () => {
    // 排他は月額モードだけ(設計書 §6)。借入可能額モードでは残価は計算に
    // 使われないので、残っている値でボーナスタブを塞がない。現行実装の
    // 規則をそのまま守る——ここが退行すると、モードを行き来した人だけが
    // ボーナスを打てなくなる。
    await renderPanel();
    await press(["残価を入力", "1", "2", "0", "0", "万"]);
    expect(
      screen.getByRole("button", { name: /ボーナス.*を入力/ }),
    ).toBeDisabled();

    await press(["借入可能額を求める"]);
    expect(
      screen.getByRole("button", { name: "ボーナス回の返済額を入力" }),
    ).toBeEnabled();
  });

  it("clears only the active field with AC", async () => {
    await renderPanel();
    await press(["借入額を入力", "3", "0", "0", "0", "万", "年利を入力", "1", ".", "5", "この項目を消去"]);
    expect(screen.getByTestId("display-echo")).toHaveTextContent("年利");
    await press(["借入額を入力"]);
    expect(screen.getByTestId("display-echo")).toHaveTextContent("3000万");
  });
```

`press` は `for (const name of names) await userEvent.click(screen.getByRole("button", { name }))`
のヘルパ（`exact` は既定で部分一致なので、**アクセシブルネームを完全一致で
引く**ようにする）。

- [ ] **Step 4: パネルを書き換える**

- 状態: `mode`、`activeField`、**項目ごとの `Entry`**（`Record<LoanField, Entry>`）。
  ボーナスは `bonusPrincipal` と `bonusPayment` の 2 つを持つ（設計書 §6）。
- `onPress` は 1 つの `switch`。`digit:*`/`zeros3`/`dot` は `entry.ts` へ、
  `man`/`oku` は `pushUnit`（**押せるときしか来ない**）、`del`/`ac` は項目に効く。
- `disabled` 述語（設計書 §6 の可否表）。**規則が散らばると読めなくなる**ので
  1 か所に集める:

```ts
const MONEY_FIELDS: LoanField[] = ["principal", "payment", "residual", "bonus"];

function keyDisabled(token: LoanKeyToken): boolean {
  // 項目タブ: 求める値の項目と、モードが受けない項目は押せない。
  if (token.startsWith("field:")) {
    const field = token.slice("field:".length) as LoanField;
    return !fieldEnabled(field);
  }
  if (token.startsWith("mode:")) return false;

  const money = MONEY_FIELDS.includes(active);
  switch (token) {
    // 小数点は年利だけ(parse_yen は小数点を拒否し、期間は整数月)。
    case "dot":
      return active !== "rate";
    // 000 は年利で無効(0.000 の誤入力を誘うだけ)。
    case "zeros3":
      return active === "rate";
    // 単位は金額だけ。さらに「いまの入力が受けられるか」が重なる(設計書 §5)。
    case "man":
      return !money || !canPushUnit(entries[active], MAN);
    case "oku":
      return !money || !canPushUnit(entries[active], OKU);
    default:
      return false; // 数字・DEL・AC はいつでも押せる
  }
}

/** モードが受ける項目か(求める値の項目は入力できない。残価×ボーナスは排他)。 */
function fieldEnabled(field: LoanField): boolean {
  if (field === solvedFor[mode]) return false;
  if (field === "residual") {
    // 残価は月額モードのみ(設計書 §6)。同じモードのボーナス(元本)と排他。
    return mode === "payment" && isEmpty(entries.bonusPrincipal);
  }
  if (field === "bonus") {
    if (mode === "term") return false;
    // **排他が効くのは月額モードだけ。** 借入可能額モードでは残価は計算に
    // 使われないので、そこに残っている値でボーナスを塞がない——現行実装の
    // 規則(`!(mode === "payment" && residual !== "")`)をそのまま守る。
    return mode !== "payment" || isEmpty(entries.residual);
  }
  return true;
}
```

  `solvedFor` は `{ payment: "payment", principal: "principal", term: "months" }`。
  **空判定を 2 か所に書かない**よう、`isEmpty(entry)` を `entry.ts` から
  export して使う（`segments.length === 0 && digits === ""`）。
- `pressed` 述語: **モードとアクティブ項目だけが `boolean`**、それ以外は
  `undefined` を返す（数字キーをトグルにしない）。
- **計算は導出**（現行の規律を維持）。必要な項目が揃ったときだけ `calc` を呼ぶ。
- 年利は小数を含むので `entry.ts` を通さず**素の文字列**で持つ（`.` と数字だけ）。
  **`entry.ts` は金額のためのもの**であることをコメントに書く。

- [ ] **Step 5: 緑を確認 → コミット**

Run: `cd web && pnpm test --run && pnpm typecheck && pnpm lint`

```bash
test "$(git branch --show-current)" = feature/loan-calculator-ui || exit 1
git add web/src
git commit  # 件名の趣旨:「打ち込む先を選ぶ盤面にする」
```

---

### Task 4: 表示（Readout と結果領域）

**Files:**
- Modify: `web/src/ui/Loan/LoanPanel.tsx`
- Modify: `web/src/ui/Loan/LoanPanel.module.css`
- Modify: `web/src/ui/Loan/LoanPanel.test.tsx`（追記）

- [ ] **Step 1: テストを足す**

```tsx
  it("puts the answer on the main line and the breakdown below", async () => {
    await renderPanel();
    await fillHousingExample(); // 3000万 / 1.5 / 420
    await waitFor(() => {
      expect(screen.getByTestId("display-main")).toHaveTextContent("91,855 円");
    });
    const breakdown = screen.getByTestId("loan-breakdown");
    expect(breakdown).toHaveTextContent("総支払額");
    expect(breakdown).toHaveTextContent("38,579,007 円");
    expect(breakdown).toHaveTextContent("総利息");
    // 主表示は 1 本(内訳は下)。
    expect(screen.getByTestId("display-main")).not.toHaveTextContent("総支払額");
  });

  it("stays neutral until the mode has what it needs", async () => {
    const calc = await renderPanel();
    await press(["借入額を入力", "3", "0", "0", "0", "万"]);
    expect(screen.getByTestId("display-main")).toBeEmptyDOMElement();
    expect(calc.forward).not.toHaveBeenCalled();
  });

  it("names the mode and the active field in the status line", async () => {
    await renderPanel();
    expect(screen.getByTestId("loan-mode")).toHaveTextContent("月額を求める");
    expect(screen.getByTestId("loan-field")).toHaveTextContent("借入額を入力中");
  });

  it("keeps the disclaimer on screen and off the alert channel", async () => {
    await renderPanel();
    expect(screen.getByText(/金融機関の計算方法により異なります/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an error from the core on the main line", async () => {
    const calc = await renderPanel(stubCalc({ term: vi.fn().mockReturnValue({ months: null, totalPayment: null, totalInterest: null, finalPayment: null, error: "SyntaxError" }) }));
    await press(["返済期間を求める"]);
    await fillDivergingTerm();
    await waitFor(() => {
      expect(screen.getByTestId("display-main")).toHaveTextContent("Math ERROR");
    });
    expect(screen.getByTestId("display-main")).toHaveAttribute("data-error", "SyntaxError");
  });
```

- [ ] **Step 2: 配線する**

- `Readout` に渡す: `echo`（`${項目名} ${text(entry)}${単位}`）、`main`
  （求めた値 or 空）、`error`、`status`（`loan-mode` と `loan-field`）。
- 結果領域は `data-testid="loan-breakdown"` の `<div>`。総支払額・総利息、
  残価があれば最終回。**`Readout` の外**に置く（設計書 §7）。
- 免責は現行の `<p>` を残す。

- [ ] **Step 3: 緑を確認 → コミット**

Run: `cd web && pnpm test --run && pnpm typecheck && pnpm lint`

```bash
test "$(git branch --show-current)" = feature/loan-calculator-ui || exit 1
git add web/src
git commit  # 件名の趣旨:「主表示は答え 1 本、内訳はその下」
```

---

### Task 5: E2E とフルスイープ

**Files:**
- Modify: `web/tests/e2e/loan.spec.ts`（約 130 行の書き換え）
- Create: `web/tests/e2e/loan-keypad.spec.ts`（盤面の検査）

- [ ] **Step 1: 既存 E2E を電卓の操作に読み替える**

**流用するもの**: ナビ 3 タブ・ディープリンク・免責・エラー表示・
リスナ非漏洩（末尾）。**書き換えるもの**: `getByLabel(...).fill(...)` を
キー押下の列に。**期待値は `finance.json` 由来なので 1 つも変えない**
（住宅基準例 91,855 / 38,579,007、車例 37,536 / 1,200,000、
借入可能額 27,761,211、期間 420）。

- [ ] **Step 2: 盤面の E2E を書く**

`loan-keypad.spec.ts`（`keypad-shell.spec.ts` と同型）:

```ts
const panel = (page: Page) => page.getByRole("region", { name: "ローン計算" });

test("the number pad keeps 44px touch targets", async ({ page }) => {
  // 44px はタッチの推奨最小(base-spec §43)。誤爆が金額を壊す数字と単位では
  // 守る。モードと項目は押し直せば戻るので縦だけ詰める——設計書 §8 の
  // 「誤爆の実害に比例させる」。緩めた理由をここに書いておかないと、次に
  // 読む人が「うっかり緩めた」と読む。
  const pad = panel(page).getByRole("group", { name: "数字と単位のキー" });
  for (const button of await pad.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("the mode and field rows are half height but wide enough", async ({ page }) => {
  for (const name of ["求めるもの", "入力する項目"]) {
    const row = panel(page).getByRole("group", { name });
    for (const button of await row.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeLessThan(44);
    }
  }
});
```

さらに: **万/億の入力**（`3000` `万` → echo `3000万円`、結果が golden と一致）、
**単位キーが押せない条件**（数字なし・逆順）、**項目タブで echo が入れ替わる**、
**モードが求める項目のタブが無効**、**残価×ボーナスの排他**、
**AC はアクティブ項目だけ消す**。

- [ ] **Step 3: フルスイープ**

**4173 を掴んでいる `vite preview` が居ないか先に確認する**
（`ss -ltnp | grep 4173`）。

```bash
cargo test --workspace           # 変更ゼロの確認込み
cd web && pnpm typecheck && pnpm lint && pnpm test && pnpm exec vite build && pnpm check:sw && pnpm e2e
```
`git diff --stat 90a9e7d -- crates/` が空であることを報告に書く。
wasm と Python は回さない（触らないため。tiering）。

- [ ] **Step 4: 実機ビルドを撮って見る**

`pnpm exec vite preview --port 4173` → Playwright で 390×844 のスクリーン
ショット（3 枚: 初期・入力中・結果あり）→ **目で確認** →
**preview を必ず落とす**（落とさないと次の `pnpm e2e` が古いビルドに当たる）。
見え方の欠け（押せる場所に見えない・重なり・溢れ）を見つけたら、
**computed style を読む E2E** で固定してから直す。

- [ ] **Step 5: コミット**

```bash
test "$(git branch --show-current)" = feature/loan-calculator-ui || exit 1
git add web/tests
git commit  # 件名の趣旨:「電卓になった Loan を実ブラウザで固定する」
```

---

# 進捗の見取り図

| タスク | 成果物 | 検証段 | spec |
|---|---|---|---|
| 1 | `Keypad<T>` と述語 2 つ（Scientific 無改修） | vitest | §4 |
| 2 | `entry.ts`（万・億） | vitest（+ 赤確認） | §5 |
| 3 | 盤面・アクティブ項目・可否 | vitest | §2/§3/§6 |
| 4 | Readout 配線と結果領域 | vitest | §7 |
| 5 | E2E 書き換え + 盤面検査 + フルスイープ | 全レイヤー（wasm/Python 以外） | §8/§9 |

# Scientific 外装（S1）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scientific のキーパッドを日本の電卓の配置慣習に寄せた 5×5 + 半高の関数列に作り替え、Shift の第 2 面と予約スロットを備え、キーパッドと表示を L/D が再利用できる部品にする。

**Architecture:** キー集合（`KeyDef[]` を束ねた `KeypadSection[]`）と描画（`Keypad`）を分離し、Shift は Keypad が持つ UI 状態としてトークンとラベルを差し替える。engine には一切触れない。表示は汎用の `Readout`（echo 行 + main + ステータス）に切り出し、`Display` を `DisplayState` からの薄い変換に落とす。

**Tech Stack:** React 19 + TypeScript、CSS Modules、vitest + Testing Library、Playwright。

## Global Constraints

- **Rust の変更はゼロ**。完了時に `git diff --stat crates/` が空であること（spec §9-5）。
- `web/src/calc/` に React を import しない（既存の境界。今回は触らない）。
- **メイングリッドの全キーは 44px 以上**。関数列は縦のみ 44px を割る（約 34px）が、**横は 44px 以上**（7 列で約 45px）。理由は spec §4 にあり、**テストにも同じ理由を書く**。
- 予約スロット（`000`・`Exp`・第 2 面の空き）は `disabled` + `aria-disabled="true"`。押しても何も送らない。
- アクセシブルネームは日本語（base-spec §43）。記号キーには必ず与える。
- 既存製品の意匠は複製しない。参考にするのは配置慣習と操作感まで（spec §2）。
- コミットはブランチガード付き（`test "$(git branch --show-current)" = feature/scientific-shell || exit 1`）。**`git push` と PR 作成は行わない**。Co-Authored-By を付ける。
- ベースライン: Rust 185 / wasm 15 / vitest 59 / e2e 41 / Python 30。

---

### Task 1: キー集合の型と新しい配置

**Files:**
- Create: `web/src/ui/Keypad/types.ts`（キー集合の型。モジュール共通）
- Create: `web/src/ui/Keypad/scientific.ts`（Scientific のキー集合）
- Delete: `web/src/ui/Keypad/layout.ts`（上の 2 つに分ける。設計書 §6 の
  「キー集合の定義と部品を分ける」）
- Modify: `web/src/ui/Key/Key.tsx`（予約スロットの `disabled` 対応）
- Modify: `web/src/ui/Keypad/Keypad.tsx`（セクション描画）
- Modify: `web/src/ui/ScientificPanel.tsx`（新しい props を渡す）
- Modify: `web/src/ui/Keypad/Keypad.module.css`（セクションごとの列数と行高）
- Modify: `web/src/ui/Keypad/Keypad.test.tsx`

**Interfaces:**
- Produces（Task 2 以降が使う）:
  - `KeyDef { token: KeyToken | null; label: string; ariaLabel: string; variant: KeyVariant; shift?: ShiftFace; kind?: "shift" }`
  - `ShiftFace { token: KeyToken | null; label: string; ariaLabel: string; variant: KeyVariant }`
  - `KeypadSection { ariaLabel: string; columns: number; height: "square" | "half"; keys: KeyDef[] }`
  - `SCIENTIFIC_SECTIONS: KeypadSection[]`（関数列 → メイングリッドの順）
  - `Keypad({ sections, onPress })`

- [ ] **Step 1: 失敗するテストを書く**

`web/src/ui/Keypad/Keypad.test.tsx` を次に置き換える。

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KEY_TOKENS } from "../../calc";
import { Keypad } from "./Keypad";
import { SCIENTIFIC_SECTIONS } from "./scientific";

const allKeys = SCIENTIFIC_SECTIONS.flatMap((s) => s.keys);

describe("Keypad", () => {
  it("offers every key the core accepts, exactly once", () => {
    // レイアウトから漏れたキーは押しようがない。網羅をテストで固定する。
    // 第 1 面と第 2 面のどちらに出るかは問わない（π は Shift 面にある）。
    const laidOut = allKeys
      .flatMap((k) => [k.token, k.shift?.token ?? null])
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .sort();
    expect(laidOut).toEqual([...KEY_TOKENS].sort());
  });

  it("reserves the slots S2 fills, carrying no token", () => {
    // 000 と Exp は場所だけ確保する（設計書 §5）。押しても何も起きない。
    const reserved = allKeys.filter((k) => k.token === null);
    expect(reserved.map((k) => k.label).sort()).toEqual(["000", "Exp"]);
  });

  it("gives every key an accessible label", () => {
    for (const key of allKeys) {
      expect(key.ariaLabel.length).toBeGreaterThan(0);
      if (key.shift) expect(key.shift.ariaLabel.length).toBeGreaterThan(0);
    }
  });

  it("lays the main grid out five by five", () => {
    const main = SCIENTIFIC_SECTIONS[1];
    expect(main.columns).toBe(5);
    expect(main.keys).toHaveLength(25);
    // 先頭行と最終行だけ固定する（配置の意図が壊れたら気づく）。
    expect(main.keys.slice(0, 5).map((k) => k.label)).toEqual([
      "(",
      ")",
      "+/−",
      "DEL",
      "AC",
    ]);
    expect(main.keys.slice(20, 25).map((k) => k.label)).toEqual([
      "0",
      "000",
      ".",
      "+",
      "=",
    ]);
  });

  it("puts the function row above, half height, with DRG at its end", () => {
    const functions = SCIENTIFIC_SECTIONS[0];
    expect(functions.height).toBe("half");
    expect(functions.keys.map((k) => k.label)).toEqual([
      "Shift",
      "sin",
      "cos",
      "tan",
      "√",
      "x²",
      "DRG",
    ]);
  });

  it("renders a button per key and reports the token pressed", async () => {
    const onPress = vi.fn();
    render(<Keypad sections={SCIENTIFIC_SECTIONS} onPress={onPress} />);
    expect(screen.getAllByRole("button")).toHaveLength(allKeys.length);
    await userEvent.click(screen.getByRole("button", { name: "虚数単位" }));
    expect(onPress).toHaveBeenCalledExactlyOnceWith("j");
  });

  it("does not send anything from a reserved slot", async () => {
    const onPress = vi.fn();
    render(<Keypad sections={SCIENTIFIC_SECTIONS} onPress={onPress} />);
    const reserved = screen.getByRole("button", { name: "3桁のゼロ（準備中）" });
    expect(reserved).toBeDisabled();
    expect(reserved).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(reserved);
    expect(onPress).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 赤を確認**

Run: `cd web && pnpm test --run src/ui/Keypad`
Expected: FAIL（`SCIENTIFIC_SECTIONS` が存在しない）。

- [ ] **Step 3: `types.ts` にキー集合の型を置く**

`web/src/ui/Keypad/types.ts`（モジュールをまたいで共有する型だけを置く）:

```ts
import type { KeyToken } from "../../calc";
import type { KeyVariant } from "../Key/Key";

/** Shift の第 2 面で差し替わる内容。 */
export interface ShiftFace {
  token: KeyToken | null;
  label: string;
  ariaLabel: string;
  variant: KeyVariant;
}

export interface KeyDef {
  /** 押したときに送るトークン。予約スロットは null（何も送らない）。 */
  token: KeyToken | null;
  /** 画面に出す文字。 */
  label: string;
  /** 読み上げ用の名前。記号キーには必須(base-spec §43)。 */
  ariaLabel: string;
  variant: KeyVariant;
  /** Shift 面での差し替え。無ければ面によらず同じ。 */
  shift?: ShiftFace;
  /** 面を切り替えるキー自身。 */
  kind?: "shift";
}

export interface KeypadSection {
  ariaLabel: string;
  columns: number;
  /** 行の高さ。square = 正方、half = 半高（設計書 §4）。 */
  height: "square" | "half";
  keys: KeyDef[];
}
```

- [ ] **Step 3b: `scientific.ts` に Scientific のキー集合を置く**

`web/src/ui/Keypad/scientific.ts`（Loan / Data Scale は隣に自分のファイルを
足す。部品は共有し、キー集合は共有しない）:

```ts
import type { KeypadSection } from "./types";

// Scientific のキー集合。
//
// 日本の電卓の**配置慣習と操作感まで**を参考にしている。意匠(配色・ボタン
// 形状・書体・ロゴ・製品名)は複製していない(base-spec §3 Non-goals、§12)。
//
// 関数列は上段の半高、メイングリッドは 5×5 でちょうど 25 キー。複素数まわり
// (j・▸∠)は右端の列、四則はその左、制御(AC・DEL)は右上。

/** 第 2 面の空きスロット。押しても何も起きない(設計書 §3)。 */
const EMPTY_FACE = {
  token: null,
  label: "—",
  ariaLabel: "第2面（準備中）",
  variant: "function",
} as const;

const FUNCTION_ROW: KeypadSection = {
  ariaLabel: "関数キー",
  columns: 7,
  height: "half",
  keys: [
    {
      token: null,
      label: "Shift",
      ariaLabel: "第2面に切り替え",
      variant: "function",
      kind: "shift",
    },
    // 第 2 面は今回ほぼ空である(設計書 §3)。本命の asin/acos/atan は M3
    // 後半に入る。空きスロットは無効表示で「そこに何か来る」ことだけ示す。
    { token: "sin", label: "sin", ariaLabel: "サイン", variant: "function", shift: EMPTY_FACE },
    { token: "cos", label: "cos", ariaLabel: "コサイン", variant: "function", shift: EMPTY_FACE },
    { token: "tan", label: "tan", ariaLabel: "タンジェント", variant: "function", shift: EMPTY_FACE },
    { token: "sqrt", label: "√", ariaLabel: "平方根", variant: "function" },
    { token: "sqr", label: "x²", ariaLabel: "2乗", variant: "function" },
    {
      token: "angle_toggle",
      label: "DRG",
      ariaLabel: "角度の単位を切り替え",
      variant: "function",
    },
  ],
};

const MAIN_GRID: KeypadSection = {
  ariaLabel: "数字と演算のキー",
  columns: 5,
  height: "square",
  keys: [
    { token: "lparen", label: "(", ariaLabel: "開き括弧", variant: "function" },
    { token: "rparen", label: ")", ariaLabel: "閉じ括弧", variant: "function" },
    { token: "neg", label: "+/−", ariaLabel: "符号を反転", variant: "function" },
    { token: "del", label: "DEL", ariaLabel: "1文字消去", variant: "danger" },
    { token: "ac", label: "AC", ariaLabel: "全消去", variant: "danger" },

    { token: "7", label: "7", ariaLabel: "7", variant: "digit" },
    { token: "8", label: "8", ariaLabel: "8", variant: "digit" },
    { token: "9", label: "9", ariaLabel: "9", variant: "digit" },
    { token: "div", label: "÷", ariaLabel: "割る", variant: "operator" },
    { token: "j", label: "j", ariaLabel: "虚数単位", variant: "function" },

    { token: "4", label: "4", ariaLabel: "4", variant: "digit" },
    { token: "5", label: "5", ariaLabel: "5", variant: "digit" },
    { token: "6", label: "6", ariaLabel: "6", variant: "digit" },
    { token: "mul", label: "×", ariaLabel: "掛ける", variant: "operator" },
    {
      token: "polar_toggle",
      label: "▸∠",
      ariaLabel: "極形式と直交形式を切り替え",
      variant: "function",
    },

    { token: "1", label: "1", ariaLabel: "1", variant: "digit" },
    { token: "2", label: "2", ariaLabel: "2", variant: "digit" },
    { token: "3", label: "3", ariaLabel: "3", variant: "digit" },
    { token: "sub", label: "−", ariaLabel: "引く", variant: "operator" },
    // 第 1 面は Exp(S2 で有効化)、第 2 面が π。S1 のあいだ π は Shift 経由
    // でのみ押せる(設計書 §5 の記録)。
    {
      token: null,
      label: "Exp",
      ariaLabel: "指数入力（準備中）",
      variant: "function",
      shift: {
        token: "pi",
        label: "π",
        ariaLabel: "円周率",
        variant: "function",
      },
    },

    { token: "0", label: "0", ariaLabel: "0", variant: "digit" },
    {
      token: null,
      label: "000",
      ariaLabel: "3桁のゼロ（準備中）",
      variant: "digit",
    },
    { token: "dot", label: ".", ariaLabel: "小数点", variant: "digit" },
    { token: "add", label: "+", ariaLabel: "足す", variant: "operator" },
    { token: "eq", label: "=", ariaLabel: "計算する", variant: "operator" },
  ],
};

export const SCIENTIFIC_SECTIONS: KeypadSection[] = [FUNCTION_ROW, MAIN_GRID];
```

- [ ] **Step 4: `Key.tsx` に予約スロットを教える**

`KeyProps` の `token` を `KeyToken | null` にし、`disabled` を足す。

```tsx
export interface KeyProps {
  /** calcarc-core に渡すトークン。null は予約スロット(何も送らない)。 */
  token: KeyToken | null;
  label: string;
  ariaLabel?: string;
  variant?: KeyVariant;
  onPress: (token: KeyToken) => void;
}

export function Key({
  token,
  label,
  ariaLabel,
  variant = "digit",
  onPress,
}: KeyProps) {
  const reserved = token === null;
  return (
    <button
      type="button"
      className={`${styles.key} ${styles[variant]}`}
      aria-label={ariaLabel ?? label}
      data-token={token ?? undefined}
      disabled={reserved}
      aria-disabled={reserved || undefined}
      onClick={() => {
        if (token !== null) onPress(token);
      }}
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 5: `Keypad.tsx` をセクション描画にする**

Shift の状態は Task 2 で足す。ここでは第 1 面だけを描く。

```tsx
import type { KeyToken } from "../../calc";
import { Key } from "../Key/Key";
import styles from "./Keypad.module.css";
import type { KeypadSection } from "./types";

export interface KeypadProps {
  sections: KeypadSection[];
  onPress: (token: KeyToken) => void;
}

export function Keypad({ sections, onPress }: KeypadProps) {
  return (
    <div className={styles.keypad}>
      {sections.map((section) => (
        <fieldset
          key={section.ariaLabel}
          className={`${styles.section} ${styles[section.height]}`}
          aria-label={section.ariaLabel}
          style={{ "--keypad-columns": section.columns } as React.CSSProperties}
        >
          {section.keys.map((key) => (
            <Key
              key={key.label}
              token={key.token}
              label={key.label}
              ariaLabel={key.ariaLabel}
              variant={key.variant}
              onPress={onPress}
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: `Keypad.module.css` を列数可変にする**

```css
.keypad {
  display: flex;
  flex-direction: column;
  gap: var(--key-gap);
}

.section {
  display: grid;
  grid-template-columns: repeat(var(--keypad-columns), 1fr);
  gap: var(--key-gap);
  /* <fieldset> の既定枠線・余白を打ち消す。role=group な <div> だと
     WAI-ARIA の推奨要素チェックに引っかかるため、意味の合う <fieldset>
     を使い、見た目だけリセットする。 */
  margin: 0;
  padding: 0;
  border: none;
}

/* 正方のキー(メイングリッド)。 */
.square > button {
  aspect-ratio: 1 / 1;
}

/* 半高の関数列。縦だけ詰め、横は 44px 以上を保つ(設計書 §4)。 */
.half > button {
  height: 34px;
  min-height: 34px;
}
```

- [ ] **Step 7: 呼び出し側を直す**

`web/src/ui/ScientificPanel.tsx` の `<Keypad onPress={press} />` を
`<Keypad sections={SCIENTIFIC_SECTIONS} onPress={press} />` にし、
`import { SCIENTIFIC_SECTIONS } from "./Keypad/scientific";` を足す。

- [ ] **Step 8: 緑を確認**

Run: `cd web && pnpm test --run src/ui/Keypad && pnpm typecheck && pnpm lint`
Expected: PASS。件数は実測して報告に書く。

- [ ] **Step 9: コミット**

```bash
test "$(git branch --show-current)" = feature/scientific-shell || exit 1
git add web/src/ui
git commit  # 件名の趣旨:「キー集合をセクションに分け、盤面を 5×5 に組み直す」
```

---

### Task 2: Shift の第 2 面

**Files:**
- Modify: `web/src/ui/Keypad/Keypad.tsx`
- Modify: `web/src/ui/Keypad/Keypad.test.tsx`（追記）
- Modify: `web/src/ui/Key/Key.tsx`（`pressed` を受ける）

**Interfaces:**
- Consumes: Task 1 の `KeypadSection` / `KeyDef.shift` / `KeyDef.kind`
- Produces: Keypad 内部の面状態（外に出さない。engine は面を知らない）

- [ ] **Step 1: 失敗するテストを書く**

`Keypad.test.tsx` に追記する。

```tsx
describe("Keypad の Shift", () => {
  it("swaps the second face on, and back after one key", async () => {
    // ワンショット(設計書 §3): 1 キー押したら第 1 面へ自動で戻る。
    const onPress = vi.fn();
    render(<Keypad sections={SCIENTIFIC_SECTIONS} onPress={onPress} />);
    const shift = screen.getByRole("button", { name: "第2面に切り替え" });
    expect(shift).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(shift);
    expect(shift).toHaveAttribute("aria-pressed", "true");

    // 第 1 面の Exp が π に変わっている。
    expect(screen.queryByRole("button", { name: "指数入力（準備中）" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "円周率" }));
    expect(onPress).toHaveBeenCalledExactlyOnceWith("pi");

    // 1 キーで戻る。
    expect(shift).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "指数入力（準備中）" })).toBeDisabled();
  });

  it("releases the face when Shift is pressed twice, sending nothing", async () => {
    const onPress = vi.fn();
    render(<Keypad sections={SCIENTIFIC_SECTIONS} onPress={onPress} />);
    const shift = screen.getByRole("button", { name: "第2面に切り替え" });
    await userEvent.click(shift);
    await userEvent.click(shift);
    expect(shift).toHaveAttribute("aria-pressed", "false");
    expect(onPress).not.toHaveBeenCalled();
  });

  it("shows the empty second-face slots as reserved", async () => {
    // 第 2 面は今回ほぼ空(設計書 §3)。空きスロットは場所だけ示す。
    render(<Keypad sections={SCIENTIFIC_SECTIONS} onPress={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "第2面に切り替え" }));
    const empty = screen.getAllByRole("button", { name: "第2面（準備中）" });
    expect(empty).toHaveLength(3); // sin / cos / tan の裏
    for (const slot of empty) expect(slot).toBeDisabled();
  });

  it("keeps keys without a second face unchanged", async () => {
    const onPress = vi.fn();
    render(<Keypad sections={SCIENTIFIC_SECTIONS} onPress={onPress} />);
    await userEvent.click(screen.getByRole("button", { name: "第2面に切り替え" }));
    await userEvent.click(screen.getByRole("button", { name: "7" }));
    expect(onPress).toHaveBeenCalledExactlyOnceWith("7");
  });
});
```

- [ ] **Step 2: 赤を確認**

Run: `cd web && pnpm test --run src/ui/Keypad`
Expected: FAIL（`aria-pressed` が無い / π が出ない）。

- [ ] **Step 3: `Key.tsx` に `pressed` を足す**

```tsx
export interface KeyProps {
  token: KeyToken | null;
  label: string;
  ariaLabel?: string;
  variant?: KeyVariant;
  /** トグルキー(Shift)の押下状態。通常のキーは渡さない。 */
  pressed?: boolean;
  onPress: (token: KeyToken) => void;
  /** トークンを送らない特別なキー(Shift)。 */
  onActivate?: () => void;
}
```

`button` に `aria-pressed={pressed}` を足し、`onClick` を
「`onActivate` があればそれを呼ぶ。無ければトークンを送る」に変える。

```tsx
      aria-pressed={pressed}
      onClick={() => {
        if (onActivate) {
          onActivate();
          return;
        }
        if (token !== null) onPress(token);
      }}
```

- [ ] **Step 4: `Keypad.tsx` に面の状態を持たせる**

```tsx
export function Keypad({ sections, onPress }: KeypadProps) {
  // Shift は UI 層の状態である。engine には面の概念を持ち込まない
  // (設計書 §3)。engine から見れば従来どおり単一トークンの列である。
  const [shifted, setShifted] = useState(false);

  return (
    <div className={styles.keypad}>
      {sections.map((section) => (
        <fieldset /* …Task 1 と同じ… */>
          {section.keys.map((key) => {
            if (key.kind === "shift") {
              return (
                <Key
                  key={key.label}
                  token={null}
                  label={key.label}
                  ariaLabel={key.ariaLabel}
                  variant={key.variant}
                  pressed={shifted}
                  onPress={onPress}
                  onActivate={() => setShifted((on) => !on)}
                />
              );
            }
            const face = shifted && key.shift ? key.shift : key;
            return (
              <Key
                key={key.label}
                token={face.token}
                label={face.label}
                ariaLabel={face.ariaLabel}
                variant={face.variant}
                onPress={(token) => {
                  onPress(token);
                  // ワンショット: 1 キーで第 1 面へ戻る。
                  setShifted(false);
                }}
              />
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
```

`key={key.label}` は第 1 面のラベルで固定する（面で変えると React が別要素と
みなし、フォーカスが落ちる）。上のコードは `key.label`（第 1 面）を使っている。

- [ ] **Step 5: 緑を確認**

Run: `cd web && pnpm test --run src/ui/Keypad && pnpm typecheck && pnpm lint`
Expected: PASS。

- [ ] **Step 6: 赤確認（新設検査を壊して見る）**

ワンショットの復帰（`setShifted(false)`）を一時的に外し、
`swaps the second face on, and back after one key` が赤になることを確認して
戻す。**実出力を報告に貼る。**

- [ ] **Step 7: コミット**

```bash
test "$(git branch --show-current)" = feature/scientific-shell || exit 1
git add web/src/ui
git commit  # 件名の趣旨:「Shift はワンショットで、engine は面を知らない」
```

---

### Task 3: 寸法とタイポグラフィ

**Files:**
- Modify: `web/src/ui/tokens.css`
- Modify: `web/src/ui/Key/Key.module.css`
- Modify: `web/src/ui/Keypad/Keypad.module.css`（Task 1 で作った `.half` の調整）

- [ ] **Step 1: トークンを足す**

`tokens.css` の `:root` に足す。既存の `--key-font-size` は上げる。

```css
  /* キーの文字。要件 7 で 1.125rem から拡大した。 */
  --key-font-size: 1.375rem;
  /* 関数列は半高なので、文字も一段小さい。 */
  --key-font-size-function: 0.9375rem;
  /* 関数列の高さ。44px を割る唯一の場所(設計書 §4 に理由)。 */
  --function-row-height: 34px;
```

- [ ] **Step 2: 関数列に専用の文字サイズを効かせる**

`Keypad.module.css`:

```css
.half > button {
  height: var(--function-row-height);
  min-height: var(--function-row-height);
  font-size: var(--key-font-size-function);
}
```

`Key.module.css` の `.key` は `min-height: var(--touch-target-min)` を持つ。
半高の指定に負けるので、`.half > button` 側で `min-height` を上書きする
（上の CSS が既にそうしている）。**メイングリッドは `--touch-target-min` の
ままにする**。

- [ ] **Step 3: 目で確かめる**

Run: `cd web && pnpm dev` を開き、390px 幅で
「関数列が薄く、メイングリッドが正方、文字が読める」ことを確認する。
数値の保証は Task 5 の E2E が持つ。

- [ ] **Step 4: 回帰が無いことを確認**

Run: `cd web && pnpm test --run && pnpm typecheck && pnpm lint`
Expected: PASS。件数は実測。

- [ ] **Step 5: コミット**

```bash
test "$(git branch --show-current)" = feature/scientific-shell || exit 1
git add web/src/ui
git commit  # 件名の趣旨:「文字を大きくし、関数列だけ縦を詰める」
```

---

### Task 4: 表示部の部品化と echo 行の場所

**Files:**
- Create: `web/src/ui/Readout/Readout.tsx`
- Create: `web/src/ui/Readout/Readout.module.css`
- Create: `web/src/ui/Readout/Readout.test.tsx`
- Modify: `web/src/ui/Display/Display.tsx`（`Readout` への薄い変換に落とす）
- Modify: `web/src/ui/Display/Display.module.css`（`Readout` に移した分を削る）

**Interfaces:**
- Produces（L/D と S2 が使う）:
  - `Readout({ echo, main, error, status })`
    - `echo: string`（S1 では常に `""`。空なら行は場所だけ残して何も出さない）
    - `main: string`
    - `error?: string | null`（`data-error` に載る）
    - `status: { testId: string; ariaLabel: string; text: string; live?: "polite" | "off" }[]`

- [ ] **Step 1: 失敗するテストを書く**

`web/src/ui/Readout/Readout.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Readout } from "./Readout";

const status = [
  { testId: "display-angle", ariaLabel: "角度の単位", text: "DEG" },
];

describe("Readout", () => {
  it("shows the main value and the status items", () => {
    render(<Readout echo="" main="42" status={status} />);
    expect(screen.getByTestId("display-main")).toHaveTextContent("42");
    expect(screen.getByRole("status", { name: "角度の単位" })).toHaveTextContent(
      "DEG",
    );
  });

  it("keeps the echo line as a place even when empty", () => {
    // S1 では常に空。S2 が中身を入れる(設計書 §5)。場所が先に決まって
    // いれば、S2 は「無効を有効にする」だけで済む。
    render(<Readout echo="" main="0" status={status} />);
    const echo = screen.getByTestId("display-echo");
    expect(echo).toBeEmptyDOMElement();
  });

  it("shows the echo when it is given one", () => {
    render(<Readout echo="3 + 4 ×" main="4" status={status} />);
    expect(screen.getByTestId("display-echo")).toHaveTextContent("3 + 4 ×");
  });

  it("marks an error on the main value", () => {
    render(<Readout echo="" main="Math ERROR" error="DivisionByZero" status={status} />);
    expect(screen.getByTestId("display-main")).toHaveAttribute(
      "data-error",
      "DivisionByZero",
    );
  });
});
```

- [ ] **Step 2: 赤を確認**

Run: `cd web && pnpm test --run src/ui/Readout`
Expected: FAIL（`Readout` が無い）。

- [ ] **Step 3: `Readout.tsx` を書く**

```tsx
import styles from "./Readout.module.css";

export interface ReadoutStatus {
  testId: string;
  ariaLabel: string;
  text: string;
  live?: "polite" | "off";
}

export interface ReadoutProps {
  /** 上部の式エコー。空なら行は場所だけ残る(設計書 §5)。 */
  echo: string;
  main: string;
  error?: string | null;
  status: ReadoutStatus[];
}

/**
 * 上部表示。**計算コアに依存しない**——文字列だけを受け取る。
 * Scientific / Loan / Data Scale が同じ部品を使う(設計書 §6)。
 */
export function Readout({ echo, main, error, status }: ReadoutProps) {
  return (
    <section className={styles.readout}>
      <div className={styles.echo} data-testid="display-echo">
        {echo}
      </div>
      <div className={styles.status}>
        {status.map((item) => (
          <span
            key={item.testId}
            data-testid={item.testId}
            role="status"
            aria-label={item.ariaLabel}
            aria-live={item.live ?? "off"}
          >
            {item.text}
          </span>
        ))}
      </div>
      <output
        className={styles.main}
        data-testid="display-main"
        aria-live="polite"
        {...(error ? { "data-error": error } : {})}
      >
        {main}
      </output>
    </section>
  );
}
```

- [ ] **Step 4: `Readout.module.css` を書く**

`Display.module.css` の `.display` / `.status` / `.main` をそのまま移し、
`.echo` を足す。

```css
.echo {
  min-height: var(--display-size-status);
  color: var(--display-status-fg);
  font-family: var(--display-font);
  font-size: var(--display-size-status);
  text-align: right;
  /* 長い式は右端(いま打っている側)を見せる。 */
  overflow-x: auto;
  white-space: nowrap;
}
```

- [ ] **Step 5: `Display.tsx` を薄い変換にする**

`DisplayState` → `Readout` の props に写すだけにする。ロジック（`OP_SYMBOL`、
`pending` の組み立て）はここに残す——それは Scientific 固有の意味だからである。

```tsx
export function Display({ display }: DisplayProps) {
  const pending = `${"(".repeat(display.pendingDepth)}${
    display.pendingOp ? OP_SYMBOL[display.pendingOp] : ""
  }`;

  return (
    <Readout
      // S1 では常に空。S2 が DisplayState から中身を渡す(設計書 §5)。
      echo=""
      main={display.main}
      error={display.error}
      status={[
        {
          testId: "display-angle",
          ariaLabel: "角度の単位",
          text: display.angle === "Deg" ? "DEG" : "RAD",
          live: "polite",
        },
        {
          testId: "display-pending",
          ariaLabel: "計算の途中経過",
          text: pending,
        },
        {
          testId: "display-form",
          ariaLabel: "表示形式",
          text: display.form === "Polar" ? "∠" : "",
        },
      ]}
    />
  );
}
```

- [ ] **Step 6: 緑を確認**

Run: `cd web && pnpm test --run && pnpm typecheck && pnpm lint`
Expected: PASS。**既存の `Display.test.tsx` が緑のままであること**が、
変換に落としても振る舞いが変わっていないことの証拠になる。

- [ ] **Step 7: コミット**

```bash
test "$(git branch --show-current)" = feature/scientific-shell || exit 1
git add web/src/ui
git commit  # 件名の趣旨:「表示を文字列だけ受ける部品にし、エコー行の場所を作る」
```

---

### Task 5: E2E とフルスイープ

**Files:**
- Modify: `web/tests/e2e/vertical-slice.spec.ts`（配置依存とタッチターゲットの検査）
- Create: `web/tests/e2e/keypad-shell.spec.ts`

- [ ] **Step 1: 既存 E2E の配置依存を洗う**

Run: `cd web && grep -n "getByRole(\"button\"\|touch\|44" tests/e2e/*.spec.ts`
配置に依存する箇所（座標・並び順の仮定）があればアクセシブルネーム基準に直す。
**キーの名前は変えていない**ので、多くはそのまま通るはずである——通らない
ものだけを直す。

- [ ] **Step 2: 新しい E2E を書く**

`web/tests/e2e/keypad-shell.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

test("the main grid keeps 44px touch targets", async ({ page }) => {
  // 44px はタッチの推奨最小(base-spec §43)。誤爆が計算そのものを壊す
  // メイングリッドでは守る。関数列は縦だけ割る——設計書 §4 の判断で、
  // 誤爆しても DEL で戻せる軽さに見合わせている。緩めた理由をここに
  // 書いておかないと、次に読む人が「うっかり緩めた」と読む。
  const main = page.getByRole("group", { name: "数字と演算のキー" });
  for (const button of await main.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("the function row is half height but still 44px wide", async ({ page }) => {
  const functions = page.getByRole("group", { name: "関数キー" });
  for (const button of await functions.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeLessThan(44);
  }
});

test("pi is reachable through the Shift face and reaches the core", async ({
  page,
}) => {
  // メイングリッドのキーが第 2 面を持つことの検査(設計書 §3)。
  await page.getByRole("button", { name: "指数入力（準備中）" }).isDisabled();
  await page.getByRole("button", { name: "第2面に切り替え" }).click();
  await page.getByRole("button", { name: "円周率" }).click();
  await expect(page.getByTestId("display-main")).toHaveText("3.141592654");
  // ワンショット: 面は戻っている。
  await expect(
    page.getByRole("button", { name: "指数入力（準備中）" }),
  ).toBeDisabled();
});

test("the reserved slots do nothing when pressed", async ({ page }) => {
  const zeros = page.getByRole("button", { name: "3桁のゼロ（準備中）" });
  await expect(zeros).toBeDisabled();
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

test("the echo line is present and empty", async ({ page }) => {
  // S2 が埋める場所。S1 では空であること自体を固定する(設計書 §5)。
  await expect(page.getByTestId("display-echo")).toBeEmpty();
});

test("the board still computes after the rearrangement", async ({ page }) => {
  // 配置を変えただけで意味は変えていない。代表列で確かめる。
  for (const name of ["3", "足す", "虚数単位", "4", "計算する"]) {
    await page.getByRole("button", { name, exact: true }).click();
  }
  await expect(page.getByTestId("display-main")).toHaveText("3+j4");
});
```

- [ ] **Step 3: E2E を走らせる**

Run: `cd web && pnpm e2e`
**先に 4173 を掴んでいる `vite preview` が居ないか確認する**（居ると
Playwright がそれを再利用し、古いビルドに対して走る。M6 で 11 件の偽の赤を
踏んだ）。確認: `ss -ltnp | grep 4173`

- [ ] **Step 4: フルスイープ**

Run:
```bash
cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
cd web && pnpm typecheck && pnpm lint && pnpm test && pnpm exec vite build && pnpm check:sw && pnpm e2e
```
**`git diff --stat crates/` が空であること**（spec §9-5）を確認して報告に書く。
Rust を触っていないので `wasm-pack test` と Python は回さない（tiering）。

- [ ] **Step 5: コミット**

```bash
test "$(git branch --show-current)" = feature/scientific-shell || exit 1
git add web/tests
git commit  # 件名の趣旨:「新しい盤面を実ブラウザで固定する」
```

---

# 進捗の見取り図

| タスク | 成果物 | 検証段 | spec |
|---|---|---|---|
| 1 | セクション型 + 5×5 の配置 + 予約スロット | vitest | §2/§5 |
| 2 | Shift のワンショットと第 2 面 | vitest（+ 赤確認） | §3 |
| 3 | 文字サイズと関数列の高さ | vitest（回帰のみ） | §4 |
| 4 | `Readout`（echo 行の場所つき） | vitest | §5/§6 |
| 5 | E2E とフルスイープ | 全レイヤー（Rust 変更ゼロの確認込み） | §7/§9 |

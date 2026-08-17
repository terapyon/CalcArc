# 設定の永続化（P-1）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3 タブの**設定だけ**を `localStorage` に保存し、リロードとタブ往復をまたいで復元する。打ちかけの式は保存しない。

**Architecture:** React に依存しない純粋モジュール `web/src/settings/`（読み書きと項目ごとの白リスト検証）に、薄い React の糊 `web/src/ui/useSetting.ts` を載せる。Scientific の復元は `EngineState` に触らず、トグルキーを最大 3 回 `dispatch` して届かせる。Rust の変更は enum に `ALL` を足すことだけ。

**Tech Stack:** TypeScript / React / vitest / Playwright / Rust（`serde` と `serde_json`）

**設計書:** `docs/superpowers/specs/2026-08-17-state-persistence-design.md`（承認済み、2026-08-17）

## Global Constraints

- **計算に 1 行も触らない。** `calcarc-core` の変更は enum への `ALL` 追加だけ
- **`EngineState` の不透明さを壊さない。** TS 側は中身を読み書きしない（`web/src/calc/types.ts:93`）
- **`web/src/settings/` に React を import しない。** `web/src/calc/` と同じ境界（CLAUDE.md）
- **保存できなくても計算は 1 つも損なわれない。** 読み書きの例外は飲む。通知も出さない
- **入力した数値を 1 バイトも保存しない**
- **`KEY_TOKENS` の綴りを変えない。足すこともしない**
- **キーの綴りは `angle_toggle` / `polar_toggle` / `eng`。** 盤面のラベル（`DRG` / `▸∠` / `ENG`）とは別物
- **`STATE_SCHEMA`（= 6）は使わない。** 保存側は独自の `v`（= 1）を持つ
- **移行関数は 1 つも書かない**
- **コミット前に `cargo fmt` と `pnpm format` を実行する。** `--check` は直さない
- **許容誤差をテストコードに書かない**（この計画には数値比較が無いので該当しないが、規約として）

---

## File Structure

| ファイル | 責務 |
|---|---|
| `web/src/calc/types.ts`（変更） | Rust の enum の写しを**実行時に列挙できる配列**にする。union 型はそこから派生させる |
| `web/src/calc/index.ts`（変更） | 上の 3 配列を再輸出する |
| `crates/calcarc-core/src/numeric/angle.rs`（変更） | `AngleMode::ALL` |
| `crates/calcarc-core/src/engine/state.rs`（変更） | `DisplayForm::ALL` / `Notation::ALL` |
| `crates/calcarc-wasm/tests/token_parity.rs`（変更） | serde の綴りと TS の配列を突き合わせる 3 件 |
| `crates/calcarc-wasm/Cargo.toml`（変更） | `serde_json` を dev-dependency に足す |
| `web/src/settings/types.ts`（新規） | `Settings` 型・初期値・白リスト。UI のみの列挙（`PANEL_MODES` ほか）もここが持つ |
| `web/src/settings/index.ts`（新規） | `readSettings(storage)` / `writeSettings(storage, next)` |
| `web/src/settings/index.test.ts`（新規） | 上の vitest |
| `web/src/ui/useSetting.ts`（新規） | React の糊。`localStorage` を掴むのはここだけ |
| `web/src/ui/ScientificPanel.tsx`（変更） | 復元（トグル replay）と保存 |
| `web/src/ui/DataScale/DataScalePanel.tsx`（変更） | 復元（`useState` 初期値）と保存 |
| `web/src/ui/Finance/FinancePanel.tsx`（変更） | 同上。`PanelMode` の定義を `settings` へ移す |
| `web/tests/e2e/settings-persistence.spec.ts`（新規） | 残ること・**残らないこと**・タブ往復 |
| `docs/base-spec.md`（変更） | §40 に実装した範囲を追記 |

---

### Task 1: Rust の enum の写しを配列にし、parity で守る

**Files:**
- Modify: `web/src/calc/types.ts:1-8`
- Modify: `web/src/calc/index.ts:14-22`
- Modify: `crates/calcarc-core/src/numeric/angle.rs:5-9`
- Modify: `crates/calcarc-core/src/engine/state.rs`（`DisplayForm` と `Notation` の定義の直後）
- Modify: `crates/calcarc-wasm/Cargo.toml:24-26`
- Test: `crates/calcarc-wasm/tests/token_parity.rs`

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces: `ANGLE_MODES: readonly ["Deg","Rad"]`、`DISPLAY_FORMS: readonly ["Rect","Polar"]`、`NOTATIONS: readonly ["Normal","Eng"]`（`web/src/calc` から輸出）。型 `AngleMode` / `DisplayForm` / `Notation` は**これらから派生**し、綴りは変わらない。Rust 側に `AngleMode::ALL` / `DisplayForm::ALL` / `Notation::ALL`

**なぜ配列にするのか:** 白リストは実行時に値を列挙する必要がある。いまは TS 側が型の union だけなので列挙できない。`DATA_TYPE_TOKENS` が既に採っている形（配列を宣言して型を派生させる）に揃える。

- [ ] **Step 1: `web/src/calc/types.ts` の 3 つの union を配列に置き換える**

`web/src/calc/types.ts` の 1〜8 行目を、次で置き換える:

```ts
/**
 * calcarc-core の numeric::angle::AngleMode に対応。
 *
 * **配列が本体で、型はそこから派生する**(DATA_TYPE_TOKENS と同型)。
 * 設定の永続化が「取り得る値の列挙」を実行時に必要とするため
 * (P-1 設計書 §5)。綴りは Rust の serde の出力そのもので、
 * token_parity.rs が対応を守る。
 */
export const ANGLE_MODES = ["Deg", "Rad"] as const;
export type AngleMode = (typeof ANGLE_MODES)[number];

/** calcarc-core の engine::state::DisplayForm に対応。 */
export const DISPLAY_FORMS = ["Rect", "Polar"] as const;
export type DisplayForm = (typeof DISPLAY_FORMS)[number];

/** calcarc-core の engine::state::Notation に対応。 */
export const NOTATIONS = ["Normal", "Eng"] as const;
export type Notation = (typeof NOTATIONS)[number];
```

- [ ] **Step 2: `web/src/calc/index.ts` から再輸出する**

`web/src/calc/index.ts:14-22` を次で置き換える:

```ts
export type {
  AngleMode,
  BinOpName,
  DisplayForm,
  DisplayState,
  EngineState,
  KeyToken,
  Notation,
  Step,
} from "./types";
export { ANGLE_MODES, DISPLAY_FORMS, KEY_TOKENS, NOTATIONS } from "./types";
```

- [ ] **Step 3: 型検査が通ることを確認する**

Run: `cd web && pnpm typecheck`
Expected: PASS（union の綴りは変えていないので、既存の利用箇所は影響を受けない）

- [ ] **Step 4: 失敗する parity テストを書く**

`crates/calcarc-wasm/tests/token_parity.rs` の末尾に足す。ファイル冒頭の `use` にも追記する:

```rust
use calcarc_core::AngleMode;
use calcarc_core::engine::state::{DisplayForm, Notation};
```

```rust
/// serde が書く綴りを取り出す。
///
/// **手で書かない。** 保存される文字列は DisplayState 経由で TS へ渡った
/// serde の出力そのものなので(P-1 設計書 §8)、ここで serde に書かせると
/// 「実際に渡る綴り」と「白リストが受け付ける綴り」を直接突き合わせる
/// ことになる。手で並べると、その 2 つが一致している保証が消える。
fn serde_names<T: serde::Serialize>(values: &[T]) -> Vec<String> {
    values
        .iter()
        .map(|v| match serde_json::to_value(v) {
            Ok(serde_json::Value::String(s)) => s,
            other => panic!("unit variant は文字列になるはず: {other:?}"),
        })
        .collect()
}

#[test]
fn angle_modes_match_between_typescript_and_rust() {
    let src = include_str!("../../../web/src/calc/types.ts");
    let ts = tokens_in_ts_array(src, "export const ANGLE_MODES = [");
    assert_eq!(
        ts,
        serde_names(&AngleMode::ALL),
        "web/src/calc/types.ts の ANGLE_MODES と AngleMode::ALL が食い違っている"
    );
}

#[test]
fn display_forms_match_between_typescript_and_rust() {
    let src = include_str!("../../../web/src/calc/types.ts");
    let ts = tokens_in_ts_array(src, "export const DISPLAY_FORMS = [");
    assert_eq!(
        ts,
        serde_names(&DisplayForm::ALL),
        "web/src/calc/types.ts の DISPLAY_FORMS と DisplayForm::ALL が食い違っている"
    );
}

#[test]
fn notations_match_between_typescript_and_rust() {
    let src = include_str!("../../../web/src/calc/types.ts");
    let ts = tokens_in_ts_array(src, "export const NOTATIONS = [");
    assert_eq!(
        ts,
        serde_names(&Notation::ALL),
        "web/src/calc/types.ts の NOTATIONS と Notation::ALL が食い違っている"
    );
}
```

- [ ] **Step 5: `serde_json` を dev-dependency に足す**

`crates/calcarc-wasm/Cargo.toml` の `[dev-dependencies]` に 1 行足す:

```toml
[dev-dependencies]
js-sys = "0.3"
serde_json = { workspace = true }
wasm-bindgen-test = "0.3"
```

- [ ] **Step 6: テストが落ちることを確認する**

Run: `cargo test -p calcarc-wasm --test token_parity`
Expected: FAIL（`AngleMode::ALL` が存在しないのでコンパイルエラー）

- [ ] **Step 7: Rust 側に `ALL` を足す**

`crates/calcarc-core/src/numeric/angle.rs` の `impl AngleMode` の先頭に:

```rust
    /// 全列挙(`Key::ALL` と同型)。TypeScript の ANGLE_MODES と
    /// crates/calcarc-wasm/tests/token_parity.rs が対応を守る。
    pub const ALL: [AngleMode; 2] = [AngleMode::Deg, AngleMode::Rad];
```

`crates/calcarc-core/src/engine/state.rs` の `impl DisplayForm` の先頭に:

```rust
    /// 全列挙。TypeScript の DISPLAY_FORMS と token_parity.rs が対応を守る。
    pub const ALL: [DisplayForm; 2] = [DisplayForm::Rect, DisplayForm::Polar];
```

同じく `impl Notation` の先頭に:

```rust
    /// 全列挙。TypeScript の NOTATIONS と token_parity.rs が対応を守る。
    pub const ALL: [Notation; 2] = [Notation::Normal, Notation::Eng];
```

- [ ] **Step 8: テストが通ることを確認する**

Run: `cargo test -p calcarc-wasm --test token_parity`
Expected: PASS（5 件。既存 2 件 + 新規 3 件）

- [ ] **Step 9: 赤確認 — 配列を 1 つ壊すと落ちること**

`web/src/calc/types.ts` の `NOTATIONS` を一時的に `["Normal", "Engg"]` に変える。

Run: `cargo test -p calcarc-wasm --test token_parity`
Expected: FAIL（`notations_match_between_typescript_and_rust`）

**確認したら再編集で戻す**（`git checkout` はこのファイルの他の変更も巻き戻す）。

- [ ] **Step 10: 整形して全体を確認する**

```bash
cargo fmt
cd web && pnpm format && pnpm typecheck && pnpm lint
cd .. && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings
```
Expected: 全段緑

- [ ] **Step 11: コミット**

```bash
git add web/src/calc/types.ts web/src/calc/index.ts \
  crates/calcarc-core/src/numeric/angle.rs crates/calcarc-core/src/engine/state.rs \
  crates/calcarc-wasm/Cargo.toml crates/calcarc-wasm/tests/token_parity.rs
git commit -m "$(cat <<'EOF'
Make the mirrored enums something you can actually enumerate

角度・極形式・記法の 3 つは TS 側が型の union だけで、実行時に値を
列挙できなかった。設定の白リストは「取り得る値」を列挙する必要がある。

DATA_TYPE_TOKENS と同じ形にした——配列が本体で、型はそこから派生する。
綴りは変えていないので既存の利用箇所は動かない。

parity の Rust 側は serde に書かせる。保存される文字列は DisplayState
経由で TS へ渡った serde の出力そのものなので、手で並べると「実際に
渡る綴り」と「検査する綴り」が一致している保証が消える。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 純粋モジュール `web/src/settings/`

**Files:**
- Create: `web/src/settings/types.ts`
- Create: `web/src/settings/index.ts`
- Test: `web/src/settings/index.test.ts`

**Interfaces:**
- Consumes: Task 1 の `ANGLE_MODES` / `DISPLAY_FORMS` / `NOTATIONS`（`../calc` から）、既存の `DATA_TYPE_TOKENS`（`../datascale/types`）、既存の `LOAN_MODES`（`../finance/loan/types`）
- Produces:
  - `interface Settings`（`scientific` / `dataScale` / `finance` の 3 節）
  - `defaultSettings(): Settings` — **毎回新しいオブジェクトを返す**
  - `interface SettingsStorage { getItem(k: string): string | null; setItem(k: string, v: string): void }`
  - `readSettings(storage: SettingsStorage): Settings`
  - `writeSettings(storage: SettingsStorage, next: Settings): void`
  - `PANEL_MODES` / `PanelMode` / `PRIMARY_UNITS` / `Primary` / `PERIODS_PER_YEAR` / `PeriodsPerYear`
  - `SETTINGS_KEY = "calcarc.settings"` / `SETTINGS_VERSION = 1`

- [ ] **Step 1: 型と白リストを書く**

Create `web/src/settings/types.ts`:

```ts
/**
 * 保存する設定の型と、取り得る値の列挙。
 *
 * **React を import しない**(CLAUDE.md の境界)。localStorage も掴まない
 * ——掴むのは web/src/ui/useSetting.ts だけである。
 */

import {
  ANGLE_MODES,
  type AngleMode,
  DISPLAY_FORMS,
  type DisplayForm,
  NOTATIONS,
  type Notation,
} from "../calc";
import { DATA_TYPE_TOKENS, type DataTypeToken } from "../datascale/types";
import { LOAN_MODES } from "../finance/loan/types";

/** 主に表示する単位系。UI だけの概念で、Rust に対応物が無い。 */
export const PRIMARY_UNITS = ["decimal", "binary"] as const;
export type Primary = (typeof PRIMARY_UNITS)[number];

/**
 * Finance が何を求めるか。**UI だけの概念**で、Rust に対応物が無い
 * ——LoanMode の 3 つに複利の 3 つを足した合成である。
 *
 * ここに置くのは、React に依存しない層が持つべきだからである。
 * FinancePanel はここから import する(逆向きにすると、設定モジュールが
 * .tsx を参照することになる)。
 */
export const PANEL_MODES = [
  ...LOAN_MODES,
  "compound",
  "deposit-for",
  "periods-for",
] as const;
export type PanelMode = (typeof PANEL_MODES)[number];

/** 年あたりの期数。 */
export const PERIODS_PER_YEAR = [1, 2, 12] as const;
export type PeriodsPerYear = (typeof PERIODS_PER_YEAR)[number];

export interface ScientificSettings {
  angle: AngleMode;
  form: DisplayForm;
  notation: Notation;
}

export interface DataScaleSettings {
  dtype: DataTypeToken;
  primary: Primary;
}

export interface FinanceSettings {
  mode: PanelMode;
  periodsPerYear: PeriodsPerYear;
  withholding: boolean;
}

/**
 * 保存する設定。**打鍵中の値は 1 つも含まない**(P-1 設計書 §3)。
 * 式・途中の数字・答・active・sexagesimal_view・error・履歴は保存しない。
 */
export interface Settings {
  scientific: ScientificSettings;
  dataScale: DataScaleSettings;
  finance: FinanceSettings;
}

/**
 * 初期値。**毎回新しいオブジェクトを返す**——共有した定数を返すと、
 * 呼び出し側の書き換えが次の呼び出しに漏れる。
 *
 * ここの値は各パネルの useState の初期値と一致していなければならない
 * (Task 3〜5 でパネル側をこちらに寄せる)。
 */
export function defaultSettings(): Settings {
  return {
    scientific: { angle: "Deg", form: "Rect", notation: "Normal" },
    dataScale: { dtype: "float32", primary: "decimal" },
    finance: { mode: "payment", periodsPerYear: 12, withholding: false },
  };
}

/** 検証に使う白リスト。**型ではなく取り得る値**で見る(P-1 設計書 §5)。 */
export const ALLOWED = {
  angle: ANGLE_MODES,
  form: DISPLAY_FORMS,
  notation: NOTATIONS,
  dtype: DATA_TYPE_TOKENS,
  primary: PRIMARY_UNITS,
  mode: PANEL_MODES,
  periodsPerYear: PERIODS_PER_YEAR,
} as const;
```

- [ ] **Step 2: 失敗するテストを書く**

Create `web/src/settings/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  defaultSettings,
  readSettings,
  SETTINGS_KEY,
  type SettingsStorage,
  writeSettings,
} from "./index";

/** localStorage の代わり。**jsdom を要らなくするために引数で渡す。** */
function fakeStorage(initial?: string): SettingsStorage & { saved: string | null } {
  return {
    saved: initial ?? null,
    getItem() {
      return this.saved;
    },
    setItem(_key: string, value: string) {
      this.saved = value;
    },
  };
}

/** 読み書きのどちらも投げる Storage(プライベートモード・容量超過)。 */
const throwingStorage: SettingsStorage = {
  getItem() {
    throw new Error("storage is not available");
  },
  setItem() {
    throw new Error("quota exceeded");
  },
};

describe("readSettings", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(readSettings(fakeStorage())).toEqual(defaultSettings());
  });

  it("keeps the fields it can read and drops only the ones it cannot", () => {
    // **これが「項目ごとに検査する」の本体**(P-1 設計書 §1-2)。
    // notation が壊れていても angle は生き残る。
    const storage = fakeStorage(
      JSON.stringify({ v: 1, scientific: { angle: "Rad", notation: "Zzz" } }),
    );
    const read = readSettings(storage);
    expect(read.scientific.angle).toBe("Rad");
    expect(read.scientific.notation).toBe("Normal");
  });

  it("survives a version it does not know", () => {
    // v は移行の仕組みではない(設計書 §5)。綴りが有効なら通す。
    const storage = fakeStorage(
      JSON.stringify({ v: 999, scientific: { angle: "Rad" } }),
    );
    expect(readSettings(storage).scientific.angle).toBe("Rad");
  });

  it("falls back to the defaults when the JSON is broken", () => {
    expect(readSettings(fakeStorage("{not json"))).toEqual(defaultSettings());
  });

  it("falls back to the defaults when the stored value is not an object", () => {
    expect(readSettings(fakeStorage("42"))).toEqual(defaultSettings());
  });

  it("does not throw when the storage itself throws", () => {
    // **保存できなくても計算は続く**(設計書 §6)。
    expect(readSettings(throwingStorage)).toEqual(defaultSettings());
  });

  it("ignores a section it does not know", () => {
    const storage = fakeStorage(
      JSON.stringify({ v: 1, convert: { length: "m" }, finance: { mode: "compound" } }),
    );
    const read = readSettings(storage);
    expect(read.finance.mode).toBe("compound");
    expect(read).toEqual({
      ...defaultSettings(),
      finance: { ...defaultSettings().finance, mode: "compound" },
    });
  });

  it("rejects a number that is not one of the allowed periods", () => {
    const storage = fakeStorage(JSON.stringify({ v: 1, finance: { periodsPerYear: 7 } }));
    expect(readSettings(storage).finance.periodsPerYear).toBe(12);
  });

  it("rejects a non-boolean withholding", () => {
    const storage = fakeStorage(JSON.stringify({ v: 1, finance: { withholding: "yes" } }));
    expect(readSettings(storage).finance.withholding).toBe(false);
  });
});

describe("writeSettings", () => {
  it("omits the fields that equal the defaults", () => {
    // 初期値と同じ項目は書かない(設計書 §3)。
    const storage = fakeStorage();
    const next = defaultSettings();
    next.scientific.angle = "Rad";
    writeSettings(storage, next);
    expect(JSON.parse(storage.saved as string)).toEqual({
      v: 1,
      scientific: { angle: "Rad" },
    });
  });

  it("writes only the version when nothing differs from the defaults", () => {
    const storage = fakeStorage();
    writeSettings(storage, defaultSettings());
    expect(JSON.parse(storage.saved as string)).toEqual({ v: 1 });
  });

  it("does not throw when the storage refuses to write", () => {
    expect(() => writeSettings(throwingStorage, defaultSettings())).not.toThrow();
  });

  it("round-trips every field", () => {
    // **全項目を 1 度は往復させる。** 1 項目でも配線を忘れると落ちる。
    const storage = fakeStorage();
    const next: ReturnType<typeof defaultSettings> = {
      scientific: { angle: "Rad", form: "Polar", notation: "Eng" },
      dataScale: { dtype: "int8", primary: "binary" },
      finance: { mode: "compound", periodsPerYear: 1, withholding: true },
    };
    writeSettings(storage, next);
    expect(readSettings(storage)).toEqual(next);
  });

  it("stores under the documented key", () => {
    const storage = fakeStorage();
    let usedKey = "";
    writeSettings(
      {
        getItem: () => null,
        setItem: (key) => {
          usedKey = key;
        },
      },
      defaultSettings(),
    );
    expect(usedKey).toBe(SETTINGS_KEY);
    expect(storage.saved).toBeNull();
  });
});
```

- [ ] **Step 3: テストが落ちることを確認する**

Run: `cd web && pnpm test settings`
Expected: FAIL（`./index` が存在しない）

- [ ] **Step 4: 読み書きを実装する**

Create `web/src/settings/index.ts`:

```ts
/**
 * 設定の読み書き。
 *
 * **Storage を引数で受ける**——localStorage を直接掴まない(P-1 設計書 §6)。
 * 壊れた JSON・知らない値・例外を投げる Storage の分岐が、すべて React の
 * 外で試せる。
 */

import { ALLOWED, defaultSettings, type Settings } from "./types";

export type {
  DataScaleSettings,
  FinanceSettings,
  PanelMode,
  PeriodsPerYear,
  Primary,
  ScientificSettings,
  Settings,
} from "./types";
export {
  defaultSettings,
  PANEL_MODES,
  PERIODS_PER_YEAR,
  PRIMARY_UNITS,
} from "./types";

export const SETTINGS_KEY = "calcarc.settings";

/**
 * 保存側の版。**STATE_SCHEMA(= 6)とは別物**である——あれは保存しない
 * EngineState の版である(P-1 設計書 §5)。
 *
 * **これは移行の仕組みではない。** 意味が変わったらキーの綴りを変える
 * ——綴りが変われば白リストが知らない値として落とす。v を残しているのは、
 * いつか「この版より古い保存は丸ごと捨てる」が必要になったときの唯一の
 * 手掛かりとしてである。
 */
export const SETTINGS_VERSION = 1;

/** localStorage と同じ形。テストから素のオブジェクトを渡せるようにする。 */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 白リストに載っていれば採り、載っていなければ初期値に倒す。 */
function pick<T>(allowed: readonly T[], value: unknown, fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

/** 節を取り出す。節が無い・オブジェクトでないなら空として扱う。 */
function section(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function parse(raw: string): Settings {
  const fallback = defaultSettings();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (typeof json !== "object" || json === null) return fallback;

  const root = json as Record<string, unknown>;
  const sci = section(root.scientific);
  const ds = section(root.dataScale);
  const fin = section(root.finance);

  return {
    scientific: {
      angle: pick(ALLOWED.angle, sci.angle, fallback.scientific.angle),
      form: pick(ALLOWED.form, sci.form, fallback.scientific.form),
      notation: pick(ALLOWED.notation, sci.notation, fallback.scientific.notation),
    },
    dataScale: {
      dtype: pick(ALLOWED.dtype, ds.dtype, fallback.dataScale.dtype),
      primary: pick(ALLOWED.primary, ds.primary, fallback.dataScale.primary),
    },
    finance: {
      mode: pick(ALLOWED.mode, fin.mode, fallback.finance.mode),
      periodsPerYear: pick(
        ALLOWED.periodsPerYear,
        fin.periodsPerYear,
        fallback.finance.periodsPerYear,
      ),
      withholding:
        typeof fin.withholding === "boolean"
          ? fin.withholding
          : fallback.finance.withholding,
    },
  };
}

export function readSettings(storage: SettingsStorage): Settings {
  let raw: string | null;
  try {
    raw = storage.getItem(SETTINGS_KEY);
  } catch {
    // Storage が使えなくても計算は続く(設計書 §6)。
    return defaultSettings();
  }
  return raw === null ? defaultSettings() : parse(raw);
}

/** 初期値と違う項目だけを残す。節が空になったらその節ごと落とす。 */
function pruned<T extends object>(actual: T, fallback: T): Partial<T> | null {
  const out: Partial<T> = {};
  let kept = false;
  for (const key of Object.keys(actual) as (keyof T)[]) {
    if (actual[key] !== fallback[key]) {
      out[key] = actual[key];
      kept = true;
    }
  }
  return kept ? out : null;
}

export function writeSettings(storage: SettingsStorage, next: Settings): void {
  const fallback = defaultSettings();
  const body: Record<string, unknown> = { v: SETTINGS_VERSION };
  const scientific = pruned(next.scientific, fallback.scientific);
  const dataScale = pruned(next.dataScale, fallback.dataScale);
  const finance = pruned(next.finance, fallback.finance);
  if (scientific) body.scientific = scientific;
  if (dataScale) body.dataScale = dataScale;
  if (finance) body.finance = finance;

  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(body));
  } catch {
    // 保存できないことは利用者に伝えない(設計書 §6)。設定が残らない
    // という副次的な不便のために、計算画面に警告を出すのは割に合わない。
  }
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `cd web && pnpm test settings`
Expected: PASS（13 件）

- [ ] **Step 6: 赤確認 — 白リストを緩めると落ちること**

`web/src/settings/index.ts` の `pick` を一時的に `return value as T;` に変える。

Run: `cd web && pnpm test settings`
Expected: FAIL（`keeps the fields it can read...` ほか）

**確認したら再編集で戻す。**

- [ ] **Step 7: 整形して確認する**

```bash
cd web && pnpm format && pnpm typecheck && pnpm lint && pnpm test
```
Expected: 全段緑

- [ ] **Step 8: コミット**

```bash
git add web/src/settings/
git commit -m "$(cat <<'EOF'
Read settings back one field at a time, not all or nothing

保存された設定が読めないとき、塊ごと捨てると版を上げるたびに利用者の
設定が全部消える。項目ごとに白リストで見て、読めるものだけ使う。

白リストは型ではなく取り得る値の列挙である。"Rad" は通り "Zzz" は落ちる
——型で見ると、綴りだけ違う値が通ってしまう。

Storage は引数で受ける。壊れた JSON・知らない値・例外を投げる Storage
の分岐が、React も jsdom も無しで試せる。

初期値と同じ項目は書かない。「一度も触っていない設定」と「初期値に
戻した設定」を区別しないと決めたということでもある。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: React の糊と Scientific への適用

**Files:**
- Create: `web/src/ui/useSetting.ts`
- Modify: `web/src/ui/ScientificPanel.tsx:20-38`（`useEffect` の中）
- Test: `web/src/ui/ScientificPanel.test.tsx`（既存に追記）

**Interfaces:**
- Consumes: Task 2 の `readSettings` / `writeSettings` / `Settings` / `defaultSettings`
- Produces:
  - `loadSettings(): Settings` — `localStorage` から読む（使えなければ初期値）
  - `saveSettings(next: Settings): void`
  - `updateSettings(patch: (current: Settings) => Settings): void` — 読んで変えて書く

**なぜ Scientific だけ経路が違うのか:** `EngineState` は TS 側で不透明（`web/src/calc/types.ts:93`）なので、`angle` を直接書き込めない。`AngleToggle` / `PolarToggle` / `EngToggle` はどれも自分の欄だけを入れ替えるトグル（`engine/mod.rs:387`）なので、**空の初期状態にキーを最大 3 回送れば届く**。

- [ ] **Step 1: React の糊を書く**

Create `web/src/ui/useSetting.ts`:

```ts
/**
 * 設定の読み書きを localStorage につなぐ。
 *
 * **localStorage を掴むのはこのファイルだけ**である(P-1 設計書 §6)。
 * web/src/settings/ は Storage を引数で受け取る純粋なモジュールで、
 * ここがその引数を埋める。
 *
 * hook ではないが ui 層に置く——localStorage はブラウザの持ち物で、
 * web/src/settings/ が掴むと jsdom 無しに試せなくなる。
 */

import {
  defaultSettings,
  readSettings,
  type Settings,
  type SettingsStorage,
  writeSettings,
} from "../settings";

/**
 * localStorage を返す。**参照そのものが投げることがある**
 * ——Safari のプライベートモードや、ストレージを無効にした設定である。
 */
function browserStorage(): SettingsStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSettings(): Settings {
  const storage = browserStorage();
  return storage === null ? defaultSettings() : readSettings(storage);
}

export function saveSettings(next: Settings): void {
  const storage = browserStorage();
  if (storage !== null) writeSettings(storage, next);
}

/** 読んで、変えて、書く。パネルが 1 項目だけ変えるときに使う。 */
export function updateSettings(patch: (current: Settings) => Settings): void {
  saveSettings(patch(loadSettings()));
}
```

- [ ] **Step 2: 失敗するテストを書く**

`web/src/ui/ScientificPanel.test.tsx` の末尾に追記する（既存の import に合わせること。`render` / `screen` / `userEvent` は既存ファイルの流儀を使う）:

```tsx
describe("設定の永続化", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("restores the angle mode from the stored settings", async () => {
    // **初回描画から復元後の値である**——パネルは WASM 待ちで描画を
    // 止めているので、Deg が一瞬見える瞬間は無い(P-1 設計書 §2)。
    window.localStorage.setItem(
      "calcarc.settings",
      JSON.stringify({ v: 1, scientific: { angle: "Rad" } }),
    );
    render(<ScientificPanel />);
    expect(await screen.findByText("RAD")).toBeInTheDocument();
  });

  it("stores the angle mode when the user switches it", async () => {
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(screen.getByRole("button", { name: "角度の単位を切り替え" }));
    await screen.findByText("RAD");
    const saved = JSON.parse(window.localStorage.getItem("calcarc.settings") as string);
    expect(saved.scientific.angle).toBe("Rad");
  });

  it("does not store anything the user typed", async () => {
    // **範囲の境界を検査で持つ**(P-1 設計書 §1-1)。
    //
    // **描画して、打鍵して、そのあとで保存された物を読む。** 自分で
    // localStorage に書いた文字列を読み直して "buffer" を含まないと
    // 言うだけでは、**何も検査していない**——writeSettings が何を書いても
    // 緑のままになる(この計画の初版がそう書いており、レビューで
    // 見つかった)。
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(screen.getByRole("button", { name: "角度の単位を切り替え" }));
    await screen.findByText("RAD");
    for (const digit of ["1", "2", "3"]) {
      await userEvent.click(screen.getByRole("button", { name: digit }));
    }
    // 打鍵が画面に届いていることを先に確かめる——届いていなければ
    // 「保存されていない」は何も言っていない。
    expect(screen.getByTestId("display-main")).toHaveTextContent("123");

    const raw = window.localStorage.getItem("calcarc.settings") as string;
    expect(raw).toContain("Rad");
    expect(raw).not.toContain("123");
    expect(raw).not.toContain("buffer");
    expect(raw).not.toContain("operands");
  });

  it("restores every scientific setting at once", async () => {
    // **replay は 1 つ前の結果の state を次へ渡す**(設計書 §4)。1 つだけ
    // 復元するテストでは、3 つとも initial().state に対して送る実装
    // ——最後の 1 つしか残らない——も緑のままになる。
    window.localStorage.setItem(
      "calcarc.settings",
      JSON.stringify({
        v: 1,
        scientific: { angle: "Rad", form: "Polar", notation: "Eng" },
      }),
    );
    render(<ScientificPanel />);
    expect(await screen.findByText("RAD")).toBeInTheDocument();
    expect(screen.getByTestId("display-form")).toHaveTextContent("∠");
    expect(screen.getByTestId("display-notation")).toHaveTextContent("ENG");
  });
});
```

**テスト用の `Calc` の偽物は、渡された `state` から次を作ること。** 累積を
クロージャの変数に持つと `dispatch` が `state` 引数を無視していても結果が
正しく見え、**上の replay のテストが実装の誤りを見逃す**（偽物のほうが本物より
寛容だと、何を書いても緑になる）。`EngineState` は不透明なので中身は読まず、
state の同一性を鍵にした `WeakMap` に表示を持たせる。

- [ ] **Step 3: テストが落ちることを確認する**

Run: `cd web && pnpm test ScientificPanel`
Expected: FAIL（`restores the angle mode...` が `RAD` を見つけられない）

- [ ] **Step 4: `ScientificPanel.tsx` に復元と保存を足す**

`import` に足す:

```tsx
import { loadSettings, updateSettings } from "./useSetting";
```

`useEffect`（20〜38 行目）の `initCalc().then` の成功側を、次で置き換える:

```tsx
      (loaded) => {
        if (cancelled) return;
        calcRef.current = loaded;
        setCalc(loaded);
        // **設定を復元する。** EngineState には触らない——角度・極形式・
        // 記法はどれも自分の欄だけを入れ替えるトグルなので、初期状態に
        // キーを送れば届く(P-1 設計書 §4)。復元後の状態は定義上
        // 「利用者が押して到達できる状態」になる。
        const wanted = loadSettings().scientific;
        let restored = loaded.initial();
        if (restored.display.angle !== wanted.angle) {
          restored = loaded.dispatch(restored.state, "angle_toggle");
        }
        if (restored.display.form !== wanted.form) {
          restored = loaded.dispatch(restored.state, "polar_toggle");
        }
        if (restored.display.notation !== wanted.notation) {
          restored = loaded.dispatch(restored.state, "eng");
        }
        setStep(restored);
      },
```

**`press` は変更しない。** 書き戻しは `useEffect` で行う。`press` の定義
（42〜48 行目）の直後に、次を足す:

```tsx
  // **書き戻しは effect に置く。** setStep の更新関数の中に副作用を書くと、
  // StrictMode(main.tsx で有効)が更新関数を 2 度呼ぶので書き込みも 2 度
  // 走る。値が同じなので実害は出ないが、副作用の置き場所として正しくない
  // ——React は更新関数を純粋なものとして扱う。
  //
  // ref に直前の署名を持ち、**変わったときだけ書く**。打鍵のたびに書くと、
  // 保存しないと決めた入力の変化にも反応することになる。
  const savedScientific = useRef<string | null>(null);
  useEffect(() => {
    if (!step) return;
    const { angle, form, notation } = step.display;
    const signature = `${angle}/${form}/${notation}`;
    // **復元直後の 1 回目は書かない。** 読んだ物をそのまま書き戻すことに
    // なり、一度も設定を触っていない利用者にも保存キーが生まれる。
    if (savedScientific.current === null) {
      savedScientific.current = signature;
      return;
    }
    if (savedScientific.current === signature) return;
    savedScientific.current = signature;
    updateSettings((current) => ({
      ...current,
      scientific: { angle, form, notation },
    }));
  }, [step]);
```

`useRef` は既に import されている（1 行目）。`useEffect` も同様。

- [ ] **Step 5: テストが通ることを確認する**

Run: `cd web && pnpm test ScientificPanel`
Expected: PASS

- [ ] **Step 6: 整形して web 全体を確認する**

```bash
cd web && pnpm format && pnpm typecheck && pnpm lint && pnpm test
```
Expected: 全段緑（159 件 + 新規 3 件）

- [ ] **Step 7: コミット**

```bash
git add web/src/ui/useSetting.ts web/src/ui/ScientificPanel.tsx web/src/ui/ScientificPanel.test.tsx
git commit -m "$(cat <<'EOF'
Restore the scientific settings by pressing the keys, not by writing state

EngineState は TS 側で不透明なので、angle を直接書き込めない。書き込む
必要も無かった——角度・極形式・記法はどれも自分の欄だけを入れ替える
トグルなので、初期状態にキーを最大 3 回送れば届く。

復元後の状態は定義上「利用者が押して到達できる状態」になる。engine が
知らない状態が生まれる余地が無い。Rust も WASM の輸出も変わらない。

書き戻すのは設定が変わったときだけにした。打鍵のたびに書くと、保存
しないと決めた入力の変化にも反応することになる。

localStorage を掴むのは useSetting.ts だけである。web/src/settings/ は
Storage を引数で受け取ったままにする。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Data Scale への適用

**Files:**
- Modify: `web/src/ui/DataScale/DataScalePanel.tsx:32,44,55-59`
- Test: `web/src/ui/DataScale/DataScalePanel.test.tsx`（既存に追記）

**Interfaces:**
- Consumes: Task 2 の `Primary` / `PRIMARY_UNITS`、Task 3 の `loadSettings` / `updateSettings`
- Produces: なし（パネル内で閉じる）

- [ ] **Step 1: 失敗するテストを書く**

`web/src/ui/DataScale/DataScalePanel.test.tsx` の末尾に追記する:

```tsx
describe("設定の永続化", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("restores the primary unit system from the stored settings", async () => {
    window.localStorage.setItem(
      "calcarc.settings",
      JSON.stringify({ v: 1, dataScale: { primary: "binary" } }),
    );
    render(<DataScalePanel />);
    expect(await screen.findByText("2 進を主表示")).toBeInTheDocument();
  });

  it("restores the data type from the stored settings", async () => {
    window.localStorage.setItem(
      "calcarc.settings",
      JSON.stringify({ v: 1, dataScale: { dtype: "int8" } }),
    );
    render(<DataScalePanel />);
    expect(
      await screen.findByRole("button", { name: "int8", pressed: true }),
    ).toBeInTheDocument();
  });

  it("stores the primary unit system when the user switches it", async () => {
    render(<DataScalePanel />);
    await screen.findByText("10 進を主表示");
    await userEvent.click(screen.getByRole("button", { name: /2 進.*主に/ }));
    const saved = JSON.parse(window.localStorage.getItem("calcarc.settings") as string);
    expect(saved.dataScale.primary).toBe("binary");
  });
});
```

**注意:** 上のセレクタは既存のテストが使っている名前に合わせること。`DataScalePanel.test.tsx` の既存の記述を読み、主表示トグルと型ボタンの実際のアクセシブルネームを使う。**名前が違えば 0 件マッチで緑になる**ので、必ず実行して赤を確認する。

- [ ] **Step 2: テストが落ちることを確認する**

Run: `cd web && pnpm test DataScalePanel`
Expected: FAIL（3 件）

- [ ] **Step 3: `Primary` の定義を `settings` へ移し、復元と保存を足す**

`web/src/ui/DataScale/DataScalePanel.tsx` の 44 行目の `type Primary = "decimal" | "binary";` を削除し、import に足す:

```tsx
import { type Primary } from "../../settings";
import { loadSettings, updateSettings } from "../useSetting";
```

55〜59 行目の `useState` を次で置き換える:

```tsx
  const [active, setActive] = useState<DataScaleField>("count");
  const [count, setCount] = useState<Entry>(EMPTY);
  const [dimensions, setDimensions] = useState<Entry>(EMPTY);
  // **設定は保存から起こす**(P-1 設計書 §4)。打鍵中の値(count /
  // dimensions)は保存しないので、上の 3 つは初期値のままである。
  const [dtype, setDtype] = useState<DataTypeToken>(
    () => loadSettings().dataScale.dtype,
  );
  const [primary, setPrimary] = useState<Primary>(
    () => loadSettings().dataScale.primary,
  );
```

`setDtype` と `setPrimary` を呼んでいる箇所を探し（`grep -n "setDtype\|setPrimary" web/src/ui/DataScale/DataScalePanel.tsx`）、それぞれの直後に書き戻しを足す。**新しい値を使うこと**（state の更新は非同期なので、直後に `dtype` を読むと古い値が入る）:

```tsx
  function chooseDtype(next: DataTypeToken): void {
    setDtype(next);
    updateSettings((current) => ({
      ...current,
      dataScale: { ...current.dataScale, dtype: next },
    }));
  }

  function choosePrimary(next: Primary): void {
    setPrimary(next);
    updateSettings((current) => ({
      ...current,
      dataScale: { ...current.dataScale, primary: next },
    }));
  }
```

呼び出し側を `setDtype(...)` → `chooseDtype(...)`、`setPrimary(...)` → `choosePrimary(...)` に置き換える。

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd web && pnpm test DataScalePanel`
Expected: PASS

- [ ] **Step 5: 整形して確認する**

```bash
cd web && pnpm format && pnpm typecheck && pnpm lint && pnpm test
```
Expected: 全段緑

- [ ] **Step 6: コミット**

```bash
git add web/src/ui/DataScale/DataScalePanel.tsx web/src/ui/DataScale/DataScalePanel.test.tsx
git commit -m "$(cat <<'EOF'
Bring back the data type and the unit system, not the numbers

Data Scale の設定は 2 つ(データ型と主表示の単位系)。どちらも useState の
初期値として保存から起こす。パネルは WASM 待ちで描画を止めているので、
初回描画から復元後の値になる。

打鍵中の count と dimensions は初期値のままである——保存しないと決めた
側なので、ここが変わっていたら範囲がずれている。

書き戻しは setter の新しい値を使う。state の更新は非同期なので、直後に
読むと 1 つ前の値を保存することになる。

Primary の定義は web/src/settings へ移した。React に依存しない層が持つ
べきもので、逆向きにすると設定モジュールが .tsx を参照する。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Finance への適用

**Files:**
- Modify: `web/src/ui/Finance/FinancePanel.tsx:107,225-229`
- Test: `web/src/ui/Finance/FinancePanel.test.tsx`（既存に追記）

**Interfaces:**
- Consumes: Task 2 の `PanelMode` / `PeriodsPerYear`、Task 3 の `loadSettings` / `updateSettings`
- Produces: なし

**注意:** `PanelMode` は `FinancePanel.tsx:107` で定義され、**同ファイル内の 8 箇所**（109 / 121 / 152 / 211 / 225 / 327 / 420 / 819 / 833 行目）で使われている。定義を `settings` へ移して import に切り替えると、利用箇所は変更不要。

- [ ] **Step 1: 失敗するテストを書く**

`web/src/ui/Finance/FinancePanel.test.tsx` の末尾に追記する:

```tsx
describe("設定の永続化", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("restores the mode from the stored settings", async () => {
    window.localStorage.setItem(
      "calcarc.settings",
      JSON.stringify({ v: 1, finance: { mode: "compound" } }),
    );
    render(<FinancePanel />);
    // モードの表示名は MODE_STATUS が持つ。既存テストが使っている
    // 文字列に合わせること。
    expect(await screen.findByText(/複利/)).toBeInTheDocument();
  });

  it("restores the withholding switch", async () => {
    window.localStorage.setItem(
      "calcarc.settings",
      JSON.stringify({ v: 1, finance: { mode: "compound", withholding: true } }),
    );
    render(<FinancePanel />);
    expect(
      await screen.findByRole("button", { name: /源泉/, pressed: true }),
    ).toBeInTheDocument();
  });

  it("does not restore the amounts", async () => {
    // **範囲の境界**(P-1 設計書 §1-1)。モードは戻るが金額は戻らない。
    window.localStorage.setItem(
      "calcarc.settings",
      JSON.stringify({ v: 1, finance: { mode: "compound" }, amounts: { principal: "999" } }),
    );
    render(<FinancePanel />);
    await screen.findByText(/複利/);
    expect(screen.queryByText("999")).not.toBeInTheDocument();
  });
});
```

**注意:** 上のセレクタは既存の `FinancePanel.test.tsx` が使っている名前に合わせること。**名前が違えば 0 件マッチで緑になる**ので、必ず実行して赤を確認する。

- [ ] **Step 2: テストが落ちることを確認する**

Run: `cd web && pnpm test FinancePanel`
Expected: FAIL（`restores the mode...` と `restores the withholding...`。3 件目は最初から緑でよい——**あれは「壊れていないこと」の番人**である）

- [ ] **Step 3: `PanelMode` を `settings` から取り、復元と保存を足す**

107 行目の `export type PanelMode = LoanMode | "compound" | "deposit-for" | "periods-for";` を削除し、import に足す:

```tsx
import {
  type PanelMode,
  type PeriodsPerYear,
} from "../../settings";
import { loadSettings, updateSettings } from "../useSetting";
```

`PanelMode` を他ファイルが import していないことは確認済み（同ファイル内でのみ使用）。同ファイルからの再輸出は不要。

225〜229 行目を次で置き換える:

```tsx
  // **設定は保存から起こす**(P-1 設計書 §4)。amounts は保存しないので
  // 初期値のままである。
  const [mode, setMode] = useState<PanelMode>(() => loadSettings().finance.mode);
  // 周期と税は選択。**計算に入るので盤面の中**にある(設計書 §7)。
  const [periodsPerYear, setPeriodsPerYear] = useState<PeriodsPerYear>(
    () => loadSettings().finance.periodsPerYear,
  );
  const [withholding, setWithholding] = useState(
    () => loadSettings().finance.withholding,
  );
  const [active, setActive] = useState<FinanceField>("principal");
```

書き戻しの関数を、`useState` 群の直後に足す:

```tsx
  /** 設定を 1 項目だけ書き戻す。**新しい値を使う**——state の更新は
      非同期なので、直後に読むと 1 つ前の値を保存することになる。 */
  function rememberFinance(patch: {
    mode?: PanelMode;
    periodsPerYear?: PeriodsPerYear;
    withholding?: boolean;
  }): void {
    updateSettings((current) => ({
      ...current,
      finance: { ...current.finance, ...patch },
    }));
  }
```

`setMode` / `setPeriodsPerYear` / `setWithholding` を呼んでいる箇所を探し（`grep -n "setMode\|setPeriodsPerYear\|setWithholding" web/src/ui/Finance/FinancePanel.tsx`）、それぞれの直後に対応する `rememberFinance({ ... })` を足す。420 行目の例:

```tsx
      const next = token.slice("mode:".length) as PanelMode;
      setMode(next);
      rememberFinance({ mode: next });
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd web && pnpm test FinancePanel`
Expected: PASS

- [ ] **Step 5: 整形して確認する**

```bash
cd web && pnpm format && pnpm typecheck && pnpm lint && pnpm test
```
Expected: 全段緑

- [ ] **Step 6: コミット**

```bash
git add web/src/ui/Finance/FinancePanel.tsx web/src/ui/Finance/FinancePanel.test.tsx
git commit -m "$(cat <<'EOF'
Come back to the calculation you were doing, with the fields empty

Finance の設定は 3 つ(計算の種類・期数・源泉徴収)。復元すると、前回の
モードで全項目が空という状態から始まる。前回と違うモードの初期画面から
始めるよりは近い、という判断である(設計書 §3、ユーザー承認済み)。

金額は保存しない。それを検査でも持つ——保存された JSON に amounts を
混ぜても画面に出ないことを見る。範囲が広がったらここが赤くなる。

PanelMode の定義は web/src/settings へ移した。UI だけの概念だが、React に
依存しない層が持つべきものである。同ファイル内でしか使われていないので
利用箇所は変わらない。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: E2E と文書

**Files:**
- Create: `web/tests/e2e/settings-persistence.spec.ts`
- Modify: `docs/base-spec.md:988-1004`（§40）

**Interfaces:**
- Consumes: Task 3〜5 の実装
- Produces: なし（最後のタスク）

- [ ] **Step 1: E2E を書く**

Create `web/tests/e2e/settings-persistence.spec.ts`:

```ts
import { expect, type Page, test } from "@playwright/test";

// **設定は残り、打った式は残らない。**
//
// 「設定が残る」だけを測ると、うっかり全部保存してしまった実装も緑に
// なる(P-1 設計書 §8)。範囲の裁定は「設定だけ」なので、**残らない側にも
// 番人を置く**。

const main = (page: Page) => page.getByTestId("display-main");

const nav = (page: Page, name: string) =>
  page.getByRole("link", { name, exact: true });

async function press(page: Page, labels: string[]): Promise<void> {
  for (const label of labels) {
    await page.getByRole("button", { name: label, exact: true }).click();
  }
}

test("the angle mode survives a reload", async ({ page }) => {
  await page.goto("/#scientific");
  await expect(page.getByText("DEG")).toBeVisible();

  await press(page, ["角度の単位を切り替え"]);
  await expect(page.getByText("RAD")).toBeVisible();

  await page.reload();
  await expect(page.getByText("RAD")).toBeVisible();
});

test("what you typed does not survive a reload", async ({ page }) => {
  // **これが範囲の境界である。** 式まで戻ってきたら、保存する物が
  // 増えている。
  await page.goto("/#scientific");
  await expect(main(page)).toHaveText("0");

  await press(page, ["1", "2", "3"]);
  await expect(main(page)).toHaveText("123");

  await page.reload();
  await expect(main(page)).toHaveText("0");
});

test("the angle mode survives moving between tabs", async ({ page }) => {
  // タブを移るとパネルは unmount する(App.tsx の条件描画)。リロードとは
  // 別の失われ方なので、別に測る。
  await page.goto("/#scientific");
  await press(page, ["角度の単位を切り替え"]);
  await expect(page.getByText("RAD")).toBeVisible();

  await nav(page, "Finance").click();
  await expect(page.getByTestId("display-main")).toBeVisible();
  await nav(page, "Scientific").click();

  await expect(page.getByText("RAD")).toBeVisible();
});

test("the finance mode survives a reload but the amounts do not", async ({
  page,
}) => {
  await page.goto("/#finance");
  await expect(page.getByTestId("display-main")).toBeVisible();

  await press(page, ["借入額を入力", "3"]);
  await expect(page.getByTestId("display-echo")).toContainText("3");

  await page.reload();
  await expect(page.getByTestId("display-main")).toBeVisible();
  await expect(page.getByTestId("display-echo")).not.toContainText("3");
});

test("nothing that was typed is written to storage", async ({ page }) => {
  // **保存された物そのものを見る。** 画面に出ないことと、保存されて
  // いないことは別の主張である。
  await page.goto("/#scientific");
  await press(page, ["角度の単位を切り替え", "1", "2", "3"]);

  const raw = await page.evaluate(() =>
    window.localStorage.getItem("calcarc.settings"),
  );
  expect(raw).not.toBeNull();
  expect(raw).toContain("Rad");
  expect(raw).not.toContain("123");
  expect(raw).not.toContain("buffer");
  expect(raw).not.toContain("operands");
});
```

**注意:** `display-echo` の testid と Finance の項目ボタン名は、既存の `loan.spec.ts` が使っている名前に合わせること。違えば 0 件マッチで緑になる。

- [ ] **Step 2: E2E が通ることを確認する**

Run: `cd web && pnpm e2e settings-persistence`
Expected: PASS（5 件）

- [ ] **Step 3: 赤確認 — 書き込みを外すと落ちること**

`web/src/ui/useSetting.ts` の `saveSettings` の本体を一時的に空（`return;`）にする。

Run: `cd web && pnpm e2e settings-persistence`
Expected: FAIL（`the angle mode survives a reload` ほか。**`what you typed does not survive a reload` は緑のまま**であるべき——あれは保存しないことの番人なので、保存を止めても落ちない）

**確認したら再編集で戻す。**

- [ ] **Step 4: base-spec §40 に実装した範囲を追記する**

`docs/base-spec.md` の §40（988 行目から）の本文の末尾に足す:

```markdown
## 実装した範囲（0.2.1、2026-08-17）

**設定だけを `localStorage` に保存している。** 保存するのは角度の単位・
極形式・記法（Scientific）、データ型・主表示の単位系（Data Scale）、
計算の種類・期数・源泉徴収（Finance）の 8 項目である。

**Calculator State（打ちかけの式・途中の数字・答）は保存していない。**
`STATE_SCHEMA` は受け皿として在るが、まだ使っていない。

**履歴も未着手である。** 「利用者が無効化できる設計」は、履歴を作る
ときに設計する——設定だけなら無効化する必要が無い（保存されるのは
利用者が選んだ表示の好みだけで、計算した内容は 1 バイトも含まれない）。

設計と裁定は `docs/superpowers/specs/2026-08-17-state-persistence-design.md`。
```

- [ ] **Step 5: フルスイープを回す**

**ブランチの末尾で 1 度だけ回す**（`docs/definition-of-done.md` の表と同じ並び）:

```bash
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
wasm-pack test --headless --firefox crates/calcarc-wasm
cd web && pnpm typecheck && pnpm lint && pnpm test
pnpm exec vite build && pnpm check:sw && pnpm check:version
pnpm e2e
cd ../reference && uv run --no-config ruff check . && uv run --no-config pytest
```

Expected: 全段緑。**`--headless --chrome` は手元で落ちる**（ChromeDriver と Chrome の版ずれ。環境要因）ので firefox を使う。

**`uv` には `--no-config` を付ける**（CLAUDE.md の「踏んだ罠」）。付けないと手元の
`~/.config/uv/uv.toml` の `exclude-newer` が `uv.lock` に書き込まれ、CI の
`uv sync --locked` が落ちる。**この計画は当初それを書き忘れており、Task 6 の
実装者が実際に踏んで `uv.lock` を戻した。**

- [ ] **Step 6: コミット**

```bash
git add web/tests/e2e/settings-persistence.spec.ts docs/base-spec.md
git commit -m "$(cat <<'EOF'
Test that the settings come back and that the expression does not

「設定が残る」だけを測ると、うっかり全部保存してしまった実装も緑に
なる。範囲の裁定は「設定だけ」なので、残らない側にも番人を置いた。

保存された文字列そのものも見る。画面に出ないことと、保存されていない
ことは別の主張である。

タブ往復も別に測る。App.tsx は条件描画なのでパネルは unmount し、
リロードとは別の失われ方をする。

base-spec §40 には「実装した範囲」を書いた。設定は実装済み、Calculator
State と履歴は未着手、と書き分ける——§40 の本文は 4 つを並べて書いた
ままなので、どれが在るのか読めなかった。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**

| spec の節 | 実装するタスク |
|---|---|
| §3 保存する項目（8 件） | Task 2（型）、Task 3〜5（配線） |
| §3 保存しない物 | Task 3〜5 で触らない。Task 5 と 6 の検査が境界を守る |
| §3 キー 1 本・`v`・初期値と同じ項目は書かない | Task 2 |
| §3 `localStorage` を選ぶ | Task 3（`useSetting.ts`） |
| §4 Scientific のトグル replay | Task 3 |
| §4 Data Scale / Finance の `useState` 初期値 | Task 4、Task 5 |
| §5 項目ごとの白リスト | Task 2 |
| §5 配列の新設（3 件） | Task 1 |
| §5 `v` は移行の仕組みではない | Task 2（コメントと `survives a version it does not know`） |
| §5 知らないキーは捨てる | Task 2（`ignores a section it does not know`） |
| §6 書き込みの契機 | Task 3〜5 |
| §6 失敗を飲む・通知しない | Task 2（`throwingStorage`）、Task 3（`browserStorage`） |
| §6 `Storage` を引数で受ける | Task 2 |
| §7 base-spec §40 への追記 | Task 6 |
| §8 vitest（純粋） | Task 2 |
| §8 vitest（パネル） | Task 3、4、5 |
| §8 parity 3 件 | Task 1 |
| §8 E2E（残る・残らない・タブ往復） | Task 6 |
| §8 赤確認 2 件 | Task 1 Step 9、Task 2 Step 6、Task 6 Step 3 |

**漏れ無し。**

**Placeholder scan:** 「適切に」「必要に応じて」「同様に」だけで済ませた手順は無い。セレクタが既存テスト依存の箇所（Task 4 Step 1、Task 5 Step 1、Task 6 Step 1）には、**名前を確認せよという注意と、外れると 0 件マッチで緑になるという理由**を書いてある。

**Type consistency:** `Settings` / `defaultSettings()` / `SettingsStorage` / `readSettings` / `writeSettings` / `loadSettings` / `saveSettings` / `updateSettings` / `PanelMode` / `PeriodsPerYear` / `Primary` の綴りは Task 2〜5 で一致。Rust 側は `AngleMode::ALL` / `DisplayForm::ALL` / `Notation::ALL` で一致。

## 順序と依存

Task 1 → 2 → 3 → （4 と 5 は独立、順不同）→ 6。

Task 3 が `useSetting.ts` を作るので、4 と 5 はそれに依存する。

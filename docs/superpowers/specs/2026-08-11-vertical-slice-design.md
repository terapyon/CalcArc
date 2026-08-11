# CalcArc Vertical Slice 設計書

対象: Milestone 0 〜 3（プロジェクト骨格 / 計算コア / WASM / 最初の UI）
前提文書: [docs/base-spec.md](../../base-spec.md)
作成日: 2026-08-11

---

## 1. 目的とスコープ

base-spec §52 が定める最初の Vertical Slice を成立させる。

```
3 + j4  →  TypeScript  →  WASM  →  calcarc-core  →  5 ∠ 53.13010235
                                                    ↑
                                        Python Reference Validation
```

この 1 本が Rust・WASM・Web・Python 検証・CI まで通った時点で、本プロジェクトの基本アーキテクチャが成立したと判断する。

### スコープに含むもの

- Rust workspace、web プロジェクト、Python reference プロジェクト、CI の骨格
- 複素数と Rect ⇄ Polar 変換を含む計算コア
- 即時実行方式の電卓状態機械
- WASM 境界
- スマートフォン縦持ちを第一とした電卓 UI（キーパッド + ディスプレイ）
- デザイントークンによるテーマ基盤と、§43 の最低限のアクセシビリティ（物理キーボード入力、`aria-label`、フォーカス表示、タッチターゲット）
- Golden ファイルによる Python Reference Validation

### スコープに含まないもの

- PWA 化（Milestone 5）
- Data Scale Calculator（Milestone 4）
- Loan Calculator（Milestone 6）
- `xʸ` `exp` `ln` `log10` `asin` `acos` `atan`（Milestone 3 後半）
- **状態および計算履歴の `localStorage` への永続化**。`EngineState` はシリアライズ可能かつバージョン付きに設計するが、本スライスでは保存も復元も実装しない（§40 は Milestone 5 以降で扱う）

---

## 2. 決定事項サマリ

| # | 論点 | 決定 | 根拠 |
|---|---|---|---|
| D1 | UI Framework | React + Vite | OSS として外部コントリビュータの母数が最大（§8, §44） |
| D2 | パッケージ管理 | pnpm / uv (Python 3.14) | 利用者指定 |
| D3 | 検証方式 | Golden ファイル方式 | 期待値をバージョン管理し、丸め規則を差分としてレビュー可能にする（§37） |
| D4 | 複素数の入力 | `j` キー方式（複素数を 1 つの値として扱う） | 複素数演算が式中で成立する。§47 の複素数要件を満たす |
| D5 | 変換操作 | `▸∠` は表示形式のトグルのみ。計算ではない | 丸めた値が次段に流れない（§26） |
| D6 | 関数の入力順 | 後置・即時実行（`30` `sin` → `0.5`） | 利用者指定（旧 CASIO 準拠） |
| D7 | 状態機械の配置 | calcarc-core に純粋 reducer として置く | 計算ロジックの Rust 集約（§4.3）と状態の永続化（§40）を両立 |
| D8 | 値の内部表現 | すべて複素数。実数は虚部 0 | 内部表現の統一（§10）と型分岐の排除 |
| D9 | 演算子優先順位 | 代数方式（`2 + 3 × 4 = 14`） | CASIO 準拠 |
| D10 | プロジェクト名 | CalcArc（正式決定） | §46 を解決 |
| D11 | ライセンス | Apache-2.0 | §44 の有力候補 |
| D12 | 公開先 | Cloudflare Pages | 利用者指定 |
| D13 | スタイリング | CSS Modules + CSS カスタムプロパティ | 追加依存ゼロ。ハイコントラストとタッチターゲットをトークン差し替えで満たせる（§43） |

---

## 3. アーキテクチャ

### 3.1 状態機械を Rust に置く

CASIO 準拠・即時実行方式の電卓には「入力バッファ / 保留中の演算子 / アキュムレータ / 角度モード / 表示形式」からなる状態機械が必要になる。これを **calcarc-core に純粋な reducer として置く**。

```
reduce(state, key) → { state, display }
```

Rust は状態を保持しない。TypeScript が状態を持ち、キーが押されるたびに現在の状態とキーを渡して、新しい状態と表示内容を受け取る。

理由:

1. **§4.3 を満たす。** 演算子の優先順位、保留演算の扱い、エラー後の復帰は「電卓の挙動」そのものであり計算ロジックである。TypeScript に置くと、最重要原則「計算仕様が明確であること」（§51.1）の検証が Rust テストの外に漏れる。
2. **§40 と噛み合う。** 状態が TypeScript 側のシリアライズ可能な値なので、`localStorage` への保存・復元がそのまま成立する。Rust が状態を抱える設計では取り出し口を別途設ける必要がある。
3. **React と自然に合う。** `useReducer` にそのまま載る。状態が不変値なので、履歴は配列に積むだけで済む。

キーストロークごとに WASM 境界を越えるが、人間の打鍵速度では性能上の問題にならない。

### 3.2 レイヤ構成

```
crates/calcarc-core/        Rust のみ。WASM 非依存
  ├── numeric/              丸め・表示フォーマット・許容誤差の定義
  ├── complex/              複素数と Rect ⇄ Polar
  ├── scientific/           単項関数（√, x², sin, cos, tan）
  └── engine/               即時実行の状態機械（reduce）

crates/calcarc-wasm/        wasm-bindgen。計算ロジックを持たない
  └── 型変換と export のみ

web/src/calc/               TypeScript。UI Framework 非依存
  └── WASM ロード、型定義、dispatch ラッパー

web/src/ui/                 React
  └── キーパッド、ディスプレイ、モードインジケータ
```

`web/src/calc/` を挟むことで §4.3 の「Calculation Core を UI Framework に依存させない」が構造として保証される。React を差し替えても `calc/` はそのまま動く。

### 3.3 データフロー

```
ボタン押下
   → KeyEvent              web/src/ui
   → dispatch(state, key)  web/src/calc
   → reduce(state, key)    calcarc-wasm
   → engine::reduce(...)   calcarc-core
        └→ complex / scientific
   ← EngineState + DisplayState
   → React 再描画
```

### 3.4 UI のスタイリングとデザイントークン

**CSS Modules（Vite 標準機能）+ CSS カスタムプロパティ**を用いる。スタイリングのための追加依存は導入しない。

UI は電卓という特注の一品物であり、汎用ユーティリティやコンポーネントライブラリの出番が乏しい。一方 §43 が求めるタッチターゲットの最小サイズ、フォーカス表示、ハイコントラストは、いずれも「値を 1 か所で定義して全体に効かせる」性質を持つ。これはカスタムプロパティが直接表現できる形である。

#### デザイントークン

`web/src/ui/tokens.css` の `:root` に集約する。

```css
:root {
  /* タッチターゲットとレイアウト（§43） */
  --touch-target-min: 44px;
  --key-gap: 8px;

  /* 配色 */
  --surface-bg;      --display-bg;    --display-fg;
  --key-bg;          --key-fg;
  --key-accent-bg;   /* 演算子キー */
  --key-danger-bg;   /* AC */
  --error-fg;

  /* タイポグラフィ */
  --display-font: ui-monospace, SFMono-Regular, Menlo, monospace;
  --display-size-main;   --display-size-status;

  /* フォーカス（§43） */
  --focus-ring;
}
```

テーマの切り替えは **トークンの差し替えのみ** で行い、コンポーネント側の CSS は書き換えない。

- `prefers-color-scheme: dark` — ダークテーマ
- `prefers-contrast: more` — ハイコントラスト（§43）
- `[data-theme]` — 利用者による明示指定（設定 UI は本スライス外）

#### コンポーネント

CSS Modules をコンポーネント単位で置く。ローカルクラス名は JS 側からのアクセスに合わせて lowerCamelCase とする。

```
web/src/ui/
  tokens.css
  Display/Display.module.css
  Keypad/Keypad.module.css
  Key/Key.module.css
```

キーパッドは CSS Grid で組む。各キーは `min-width` / `min-height` に `--touch-target-min` を敷く。

#### アクセシビリティ（§43）

- キーは `<button type="button">` とする。`div` にクリックハンドラを付けない。
- 記号キーには読み上げ用の `aria-label` を与える（`▸∠` → 「極形式に切り替え」、`√` → 「平方根」、`j` → 「虚数単位」）。
- メイン表示は `aria-live="polite"` とし、結果の変化を読み上げる。
- フォーカスリングは `:focus-visible` で表示する。マウス操作時には出さない。
- **物理キーボード入力に対応する。** `0`–`9` `.` `+` `-` `*` `/` `Enter` `Backspace` `Escape` を `Key` enum に写像する。押下経路がクリックとキーボードの 2 つになるだけで、写像先は同一の `Key` 値であり、`reduce` から見た挙動は変わらない。§50 が Desktop での利用可能性を求めているため本スライスに含める。

---

## 4. 計算コアの仕様

### 4.1 値の内部表現

すべての値を複素数として保持する。実数は虚部が `0.0` の複素数として扱い、表示のときだけ実数として描画する。

```rust
pub struct Value {
    re: f64,
    im: f64,
}
```

§10 が要求する「内部表現の統一」への回答である。実数型と複素数型を分けると、あらゆる演算に「実数 × 実数」「実数 × 複素数」…の分岐が生じ、その分岐がバグの温床になる。統一すれば分岐は生じない。

副作用として、**`√` の負数がエラーにならない**。`4` `+/−` `√` は `j2` を返す。従来機が `Math ERROR` を返す入力に、本プロジェクトは自然な答えを返す。

### 4.2 キー体系

| 群 | キー |
|---|---|
| 数値 | `0`–`9` `.` `π` |
| 演算 | `+` `−` `×` `÷` `=` `(` `)` |
| 複素数 | `j` `▸∠` |
| 関数（後置） | `√` `x²` `sin` `cos` `tan` `+/−` |
| 制御 | `AC` `DEL` `Deg/Rad` |

`xʸ` `exp` `ln` `log10` `asin` `acos` `atan` は Milestone 3 後半に回す。三角関数を本スライスに含めるのは、Deg/Rad モードが存在する以上それを検証できるキーが必要なためである。

キーは Rust 側で enum として定義し、境界では文字列トークンで表現する。

```rust
pub enum Key {
    Digit(u8), Dot, Pi,
    Add, Sub, Mul, Div, Eq, LParen, RParen,
    J, PolarToggle,
    Sqrt, Sqr, Sin, Cos, Tan, Neg,
    Ac, Del, AngleToggle,
}
```

### 4.3 入力の意味論

- **関数は後置・即時実行。** `30` `sin` で表示が即座に `0.5` になる。式には積まれない。
- **二項演算子は保留式。** `3` `+` で `3` が確定し `+` が保留され、`4` `=` で `7`。
- **優先順位は代数方式。** `2` `+` `3` `×` `4` `=` は `14`（左から順の `20` ではない）。
- **`j` は虚数入力の開始マーカー。** `3` `+` `j` `4` `=` → `3+j4`。`j` の直後に数字が続かない場合は `j1` と解釈する。
- **`▸∠` は表示形式のトグルのみで、計算ではない。** `EngineState.form` を `Rect ⇄ Polar` で入れ替えるだけで、保持している `Value` は変化しない。これにより §26 の「表示上の丸め値を次の計算入力として強制使用しない」が構造的に保証される。`▸∠` を偶数回押した状態は初期状態と一致する（冪等性はテストで固定する）。
- **`=` 連打による演算繰り返しは実装しない。** 挙動が機種ごとに割れており、仕様の明確さを優先する。
- **二項演算子を続けて押したときは、直前の演算子を差し替える。** `3` `+` `×` `4` `=` は `12`。押し直しは打ち間違いの訂正であり、計算をもう一度行う指示ではない。ただし `3` `+` `=` は `6`（右辺を繰り返す従来機の挙動）で、これとは別に扱う。

### 4.4 状態

```rust
pub struct EngineState {
    entry:   Entry,          // 入力中バッファ（未確定）
    acc:     Option<Value>,  // アキュムレータ
    pending: Vec<Frame>,     // 保留演算子と括弧のスタック
    angle:   AngleMode,      // Deg | Rad
    form:    DisplayForm,    // Rect | Polar
    error:   Option<CalcError>,
}

pub struct DisplayState {
    main:          String,          // "5 ∠ 53.13010235" / "3+j4"
    angle:         AngleMode,
    form:          DisplayForm,
    pending_op:    Option<Key>,
    pending_depth: usize,
    error:         Option<CalcError>,
}
```

`EngineState` は serde でシリアライズ可能とし、スキーマバージョンを持たせる。バージョンが一致しない状態を渡された場合は初期状態に落とす。

これは §40 の永続化に備えた設計上の準備であり、**本スライスでは保存も復元も実装しない**。状態は React のメモリ上にのみ存在する。

### 4.5 表示

```
┌──────────────────────────────┐
│ DEG   (1   +              ∠  │   モード・保留状態インジケータ
│                              │
│             5 ∠ 53.13010235 │   メイン表示
└──────────────────────────────┘
```

- 有効数字 **10 桁**。
- 丸めは **round-half-to-even**（Rust の標準書式化に一致させ、テストで固定する）。
- `|x| ≥ 1e10` または `0 < |x| < 1e−9` で指数表記に切り替える。
- Polar 表示の θ は Deg/Rad モードに従い、`atan2` により四象限を正しく返す（§33）。
- 内部値と表示値は分離する。表示のための丸めは `DisplayState` の生成時にのみ行い、`EngineState` に書き戻さない（§26）。

base-spec §26 と §52 は表示例として `53.130102`（8 桁）を挙げているが、これは例示として扱い、本設計では有効数字 10 桁の `53.13010235` を正とする。§26 の趣旨は桁数の指定ではなく内部値と表示値の分離にあり、桁数は CASIO 準拠の 10 桁に揃えるほうが一貫する。

### 4.6 エラー処理

`reduce` は **決して panic せず、常に有効な状態を返す**。エラーは `EngineState.error` に載り、表示は `Math ERROR` 相当になる。`AC` で復帰する。

| エラー | 発生条件 |
|---|---|
| `DivisionByZero` | `÷ 0` |
| `Overflow` | 結果が f64 の有限範囲を超える |
| `TrigPole` | Deg モードの `tan(90 + 180n)` など極での評価 |
| `SyntaxError` | 対応しない `)`、`.` の重複入力など |

`TrigPole` を明示的に立てるのは、f64 の `tan(π/2)` が無限大ではなく `1.633e16` のような巨大な有限値を返すためである。放置すると無意味な値が表示される。

計算コア内部では原則として `Result` を用いる（§27）。`engine::reduce` はその `Result` を状態へ畳み込み、呼び出し側には常に成功を返す。

---

## 5. WASM 境界

`calcarc-wasm` は計算ロジックを持たず、型変換と export のみを担う。`serde-wasm-bindgen` により構造体を JS オブジェクトとして受け渡す。

```rust
#[wasm_bindgen]
pub fn initial_state() -> JsValue;

#[wasm_bindgen]
pub fn reduce(state: JsValue, key: &str) -> JsValue;   // { state, display }

#[wasm_bindgen]
pub fn core_version() -> String;
```

**JavaScript 例外を投げない**（§27）。計算エラーは戻り値の一部である。`state` のデシリアライズに失敗した場合やスキーマバージョンが不一致の場合も例外にせず、初期状態を返す。

Rust の panic は「バグ」としてのみ扱う。開発ビルドでは `console_error_panic_hook` により可視化する。

`web/src/calc/` は上記 export を包み、TypeScript の型定義と、WASM モジュールの初期化（`vite-plugin-wasm` + `vite-plugin-top-level-await`）を提供する。

---

## 6. リポジトリ構成

```
CalcArc/
├── README.md
├── LICENSE                          Apache-2.0
├── CONTRIBUTING.md
├── Cargo.toml                       Rust workspace
├── .github/workflows/ci.yml
├── docs/
│   ├── base-spec.md
│   ├── numerical-policy.md
│   └── superpowers/specs/
├── crates/
│   ├── calcarc-core/
│   │   └── src/{numeric,complex,scientific,engine}/
│   └── calcarc-wasm/
├── web/                             pnpm + Vite + React + TypeScript
│   ├── public/
│   │   ├── _headers
│   │   └── _redirects
│   ├── src/calc/                    Framework 非依存
│   ├── src/ui/                      React + CSS Modules
│   │   ├── tokens.css               デザイントークン
│   │   ├── Display/
│   │   ├── Keypad/
│   │   └── Key/
│   └── tests/e2e/                   Playwright
├── reference/                       uv + Python 3.14
│   ├── pyproject.toml
│   ├── src/calcarc_reference/
│   ├── scripts/generate.py
│   └── tests/
└── testdata/
    ├── complex.json
    └── scientific.json
```

---

## 7. Python Reference Validation

### 7.1 Golden ファイル方式

Python が入力と期待値を `testdata/*.json` に生成し、リポジトリにコミットする。Rust テストはそれを読み、許容誤差内かを検証する。CI には別ジョブで「再生成して差分が出ないか」のチェックを置く。

この方式を採る決め手は §37 の「丸め方法そのものを仕様として固定する」という要求である。期待値がバージョン管理された成果物として存在しなければ成立しない。副次的な利点として、Rust だけ触りたい外部コントリビュータが Python 環境を用意せずに済む。

### 7.2 ファイル形式

```json
{
  "schema": 1,
  "generated_by": "sympy 1.13.x / mpmath 1.3.x, Python 3.14",
  "tolerance": { "abs": 1e-12, "rel": 1e-12 },
  "cases": [
    {
      "id": "rect_to_polar/3+j4",
      "input":  { "re": 3, "im": 4 },
      "expect": { "r": 5.0, "theta_deg": 53.13010235415598 }
    }
  ]
}
```

**tolerance はファイルの meta に置く**（§36 の「集中管理」）。ケース単位での上書きも許すが、Rust テストコード側には一切ハードコードしない。

### 7.3 実装の独立性

§30 に従い、Rust と Python は同一アルゴリズムの写経にしない。

| | Rust | Python |
|---|---|---|
| Rect → Polar | `f64::hypot` と `f64::atan2` を直接使用 | SymPy の `sqrt` / `atan2` で厳密式を構成し、mpmath で 50 桁に評価してから f64 へ丸める |
| 三角関数 | `f64::sin` 等（libm） | mpmath の任意精度実装 |

これにより、同じ実装バグが双方に混入する可能性を下げる。

### 7.4 テストケースの網羅

§33 に従い、以下を必ず含める。

- ゼロ、負数、四象限すべて
- 実軸上・虚軸上（θ = 0, ±90°, 180°）
- 極めて大きい値・極めて小さい値
- π、±180°、±π の境界

---

## 8. テスト戦略

| Layer | 対象 | 手段 |
|---|---|---|
| 1 | `complex` / `scientific` の個別関数 | Rust unit test（known-answer） |
| 2 | `engine` の状態機械 | Rust テーブル駆動テスト：**キー列 → 表示文字列** |
| 3 | 変換の不変性 | `proptest`：rect → polar → rect の往復が許容誤差内 |
| 4 | 数値の正しさ | Rust が `testdata/*.json` を読んで検証 |
| 5 | WASM 境界 | `wasm-bindgen-test`（ヘッドレス Chrome） |
| 6 | E2E | Playwright：`3` `+` `j` `4` `=` `▸∠` → `5 ∠ 53.13010235` |

Layer 2 が本スライスの要である。

```
["3", "+", "j", "4", "=", "▸∠"]  →  "5 ∠ 53.13010235"
```

この形の表がそのまま電卓の挙動仕様書になる。演算子の優先順位、エラーからの復帰、`▸∠` の冪等性もここで固定する。

Python 自身は Layer 4 の期待値を **生成する側** であり、Rust の CI からは参照されない。Python 側には SymPy の使い方が正しいかを確かめる独自のテストを置く。

---

## 9. CI

GitHub Actions。ジョブは以下の 5 本。

| ジョブ | 内容 |
|---|---|
| `rust` | `cargo fmt --check`、`cargo clippy -D warnings`、`cargo test`（Layer 1–4） |
| `wasm` | `wasm-pack build`、`wasm-pack test --headless`（Layer 5） |
| `web` | `pnpm install --frozen-lockfile`、型検査、lint、`vitest`、`build` |
| `e2e` | Playwright（Layer 6） |
| `reference` | `uv sync`、`ruff`、`pytest`、golden 差分チェック |

golden 差分チェックは以下で行う。期待値の再生成忘れがここで落ちる。

```bash
uv run python scripts/generate.py
git diff --exit-code testdata/
```

Python が必要なのは `reference` ジョブのみである。

---

## 10. デプロイ

公開先は **Cloudflare Pages**。環境構築は本スライス完了後に行う。

ルート配信のため Vite の `base` は `/` のままでよい。Service Worker のスコープ制約（Milestone 5 の §38）も生じない。

`web/public/` に以下を置く。

`_headers`:

```
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

`_redirects`（Calculator Module が増えてクライアントルーティングを持つ段階に備える）:

```
/*    /index.html   200
```

ビルド出力は `web/dist`。Cloudflare Pages の Git 連携を用いる想定だが、接続設定は利用者が行う。本スライスでは CI でビルドが通ることまでを担保する。

---

## 11. 完了条件

1. スマートフォンのブラウザで電卓が操作でき、`3` `+` `j` `4` `=` `▸∠` が `5 ∠ 53.13010235` を表示する
2. 上記が Rust → WASM → TypeScript → React を実際に経由している
3. デスクトップで物理キーボードからも同じ計算が行える
4. すべてのキーが `<button>` であり、記号キーに `aria-label` が付いている
5. Layer 1–6 のテストがすべて CI で通る
6. `testdata/*.json` が Python によって生成され、Rust がそれを検証している
7. `docs/numerical-policy.md` に丸め規則と許容誤差が記述されている
8. `README.md` にプロジェクト概要と Numerical Policy への導線がある
9. `LICENSE` に Apache-2.0 が明記されている

---

## 12. リスクと確認事項

| 項目 | 内容 | 対応 |
|---|---|---|
| Python 3.14 対応 | SymPy / mpmath が Python 3.14 で動作するか | Milestone 0 の最初に `uv sync` の疎通を確認する。駄目なら 3.13 に退避する |
| WASM のバンドル | `vite-plugin-wasm` と `wasm-pack` 出力の噛み合わせ | Milestone 2 で最小構成の疎通を先に通す |
| 表示丸めの一致 | Rust の書式化と期待値の丸めがずれる可能性 | Layer 2 のテーブルテストで表示文字列を直接固定する |
| 状態のスキーマ変更 | 永続化を始めた後に旧スキーマが残る | `EngineState` に最初からバージョンを持たせ、不一致なら初期状態に落とす。本スライスで作り込んでおく |

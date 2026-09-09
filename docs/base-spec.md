# Web Calculator Platform 仕様書

## 1. 概要

本プロジェクトは、スマートフォン、タブレット、PCのWebブラウザ上で利用できる、インストール可能な計算ツール群を提供するOSSプロジェクトである。

計算処理は可能な限りクライアント側で完結させ、Rustで実装した計算コアをWebAssembly（WASM）としてブラウザから利用する。

また、計算結果の正当性をRust実装だけに依存させず、Pythonによる独立したReference Implementationを用意し、自動テストによって検証する。

初期段階では、以下の3種類の計算ツールを対象とする。

1. Scientific / Engineering Calculator
2. Data Scale Calculator
3. Loan Calculator / Simulator

将来的には、他分野の計算ツールを追加できるプラットフォームとして設計する。

---

# 2. プロジェクトの目的

## 2.1 主目的

以下を満たす計算環境を構築する。

- Webブラウザだけで利用可能
- スマートフォン、タブレット、PCに対応
- PWAとしてインストール可能
- 基本的な計算はオフラインでも利用可能
- サーバへの計算データ送信を必要としない
- Rust/WASMによる計算コア
- 数値精度・丸め規則を明示
- Pythonによる独立検証
- OSSとして再利用可能
- 将来、新しいCalculator Moduleを追加可能

---

# 3. Non-goals

初期段階では、以下を目的としない。

- CAS（Computer Algebra System）の完全実装
- Mathematica、MATLAB、SymPy等の代替
- CASIO等の既存関数電卓の完全なエミュレーション
- 既存製品の外観、キー配置、意匠の完全な複製
- 金融機関が提供する個別ローン商品の完全再現
- サーバサイド計算サービス
- ユーザーアカウント管理
- クラウド同期
- 大規模なデータ保存
- AIによる計算結果生成

計算結果は原則として決定論的な数値処理によって生成する。

---

# 4. 基本コンセプト

本プロジェクトの基本原則を以下とする。

## 4.1 Local First

計算処理は原則としてブラウザ内で完結させる。

ユーザーが入力した、

- 金額
- ローン条件
- 数値
- 計算履歴

などを、計算目的で外部サーバへ送信しない。

---

## 4.2 Installable Web Application

Webアプリとして公開しつつ、PWAとしてインストール可能にする。

想定利用方法：

- 通常のWebサイトとしてアクセス
- スマートフォンのホーム画面に追加
- タブレットにインストール
- デスクトップOSで独立したアプリとして起動

---

## 4.3 Calculation Core Separation

UIと計算処理を分離する。

```text
Web UI
   │
   ▼
TypeScript Application Layer
   │
   ▼
WASM Interface
   │
   ▼
Rust Calculation Core
```

計算ロジックは可能な限りRust Calculation Coreに集約する。

---

## 4.4 Independent Validation

Rust実装の正しさをRust自身のテストだけでは保証しない。

Pythonによる独立したReference Implementationを用意する。

```text
Production

Rust
  ↓
WASM
  ↓
Web

Validation

Python
  ↓
SymPy / Decimal / mpmath
```

RustとPythonでは、可能な限り異なる実装方法を使用する。

同一ロジックを単純に移植するだけのReference Implementationにはしない。

---

# 5. 想定アーキテクチャ

```text
calculator-platform/
│
├── README.md
├── LICENSE
├── CONTRIBUTING.md
│
├── docs/
│   ├── specification.md
│   ├── numerical-policy.md
│   ├── architecture.md
│   ├── scientific-calculator.md
│   ├── data-scale-calculator.md
│   └── loan-calculator.md
│
├── crates/
│   ├── calc-core/
│   └── calc-wasm/
│
├── web/
│
├── reference/
│   ├── pyproject.toml
│   ├── src/
│   └── tests/
│
└── testdata/
```

---

# 6. Rust側構成

## 6.1 calc-core

Rustのみで構成する計算ライブラリ。

WASMやWebに依存しない。

想定Module：

```text
calc-core
├── scientific
├── complex
├── units
├── data_scale
├── finance
└── numeric
```

**【訂正 2026-08-15】** `finance` の枠は埋まった。`finance::{compound, tax, loan}`
であり、ローンは `finance::loan` の下に居る
（[B 設計](superpowers/specs/2026-08-15-loan-under-finance-design.md)）。
web も同じ木で、`web/src/finance/{entry.ts, loan/}` と `web/src/ui/Finance/`
である（[web 移動の計画](superpowers/plans/2026-08-15-finance-web-move.md)）。

可能な限り、

```rust
calc-core
```

単体でテスト可能にする。

---

## 6.2 calc-wasm

`calc-core` をWebAssemblyから利用するためのadapter layer。

責務：

- JavaScript / TypeScriptとのデータ変換
- WASM export
- エラー形式の変換

計算ロジックそのものは持たせない。

---

# 7. Web側構成

Web UIはTypeScriptを基本とする。

UI Frameworkは実装開始時に選択する。

候補：

- React

ただしCalculation CoreはUI Frameworkに依存させない。

---

# 8. Calculator Module

各Calculatorは独立Moduleとして実装する。

```text
Calculator Platform

├── Scientific / Engineering
├── Convert
├── Scale
│   └── Data Scale
├── Loan / Finance
└── Future Modules
```

**【訂正 2026-08-15】** **UI のタブ表記は `Finance`、ハッシュは `#finance`**
（[F0 設計](superpowers/specs/2026-08-14-finance-rename-design.md)）。
ローンは Finance の中の 1 機能であり、§20〜§22 の仕様は変わらない。
旧 `#loan` の互換は作っていない。

**【訂正 2026-08-19】** タブに `Convert` と `Scale` を足した。ハッシュは
`#<系統>[/<カテゴリ>]` の 2 段になり、Data Scale は `Scale` の下の
カテゴリとして `#scale/data-scale` に移った。旧 `#data-scale` の互換は
作っていない。開くと Scientific が出る。クローズドβで飛び先を失う人が
ごく少ないことを理由に、`#loan` のときと同じ判断をした。

共通UI、履歴、数値表示、設定などはPlatform側で提供する。

---

# 9. Scientific / Engineering Calculator

## 9.1 目的

一般的な関数電卓機能に加えて、電気・電子・工学分野で利用しやすい計算機を提供する。

特に複素数と極座標表現を重要機能とする。

---

## 9.2 MVP機能

基本演算：

- 加算
- 減算
- 乗算
- 除算
- 括弧
- 符号反転

数学関数：

- sqrt
- x²
- xʸ
- exp
- ln
- log10

三角関数：

- sin
- cos
- tan
- asin
- acos
- atan

定数：

- π
- e

角度：

- Degree
- Radian

定義域について（S-1、2026-08-16）：

**関数は実数に閉じる。** 実数の答が一意に決まらない入力（`sqrt(-4)`、`ln(0)`、
`asin(2)`、`(-2)^0.5` など）はエラーを返す。定義域の一覧は
[docs/numerical-policy.md](numerical-policy.md) の「関数の定義域」にある。

これは §10（複素数）や §11（Rectangular / Polar）と矛盾しない。
**複素数は入力と四則と表示の機能であって、関数の値域ではない。**
`3 + 4j` は打てるし、`(3+4j) × (1+2j)` も極形式への変換も今までどおり動く。
落としたのは「関数が複素数を返す」経路だけである。

`xʸ` は**右結合**である（`2^3^2 = 512`）。このエンジンで右結合なのは
これだけで、四則は左結合のままである。

MVP 外の追加機能（S-3、2026-08-16。ユーザー発意）：

- `n!`（階乗）
- `nPr`（順列）
- `nCr`（組合せ）

3 つとも**非負整数の上でしか定義しない**（`2.5!` はガンマ関数だが入れない）。
優先順位は `× ÷` より先、`xʸ` より後で、**左結合**。盤面では数字 `7` `8` `9` の
第 2 面に置く。

**【訂正 2026-08-16】** **置き場所は `(` `)` `+/−` の第 2 面に移した**
（0.2.0 設計書 §9）。数字キーの裏に置くと、Shift が立っている間 `7` `8` `9` が
打てなくなる——数え上げを裏に置く見返りとしては高い。`(` `)` `+/−` は 3 つとも
裏が空いていて隣り合っており、S-3 の「隣り合わせに置ける場所が他に無い」は
事実として誤りだった。**優先順位・結合・定義域は変えていない。**

60 進表記（S-4、2026-08-16。ユーザー発意）：

`°'"` キーで、**経過時間と角度の両方**を 60 進で入出力する。

- **入力**: 数を打つ途中に区切りとして押す。`1 °'" 30 °'"` は `1.5`
- **表示**: 確定値に押すと `3.75` → `3°45'0"`。**押したときだけ**で、
  次に何か押すと十進に戻る

**値は 10 進の実数のままである。** 60 進は入力と表示の形式にすぎないので、
**四則演算は 1 つも足していない**——`1:30 + 2:45` は `1.5 + 2.75` である。
同じ形式が時間とも角度とも読め、**度分秒で入れた角度をそのまま `sin` に渡せる**
（§9.1 の電気・電子分野の用途と噛み合う）。

**時刻ではない。** `13:45` の 3 時間後は求められない——時点と期間を区別する型が
要るので、必要になったら別 spec にする。24 時間で割らないのも同じ理由である
（経過時間の計算では `30:00:00` が要る）。

---

# 10. 複素数

以下をサポートする。

```text
a + jb
```

または

```text
a + ib
```

内部表現については、一つに統一する。

UI上ではEngineering用途を考慮し、

```text
j
```

を標準表示候補とする。

---

# 11. Rectangular / Polar Conversion

重要な基本機能とする。

> **【変更 2026-08-25、0.4.0】`j` は数の後ろに置く。**
> 0.3.x までは前に置いていた（`3+j4` / `j2`）が、**`3+4j` / `2j` に変えた**
> （ユーザー指示）。**打っている途中の表示も同じ**——`3` `j` は `3j` と出る。
> 数そのものは変わっておらず、変わったのは書き方だけである。

Rectangular：

```text
x + yj
```

Polar：

```text
r ∠ θ
```

相互変換を可能にする。

例：

```text
3 + 4j
```

↓

```text
5 ∠ 53.130102...
```

逆変換も可能とする。

---

# 12. 極座標UI

操作感として一般的な工学向け関数電卓を参考にする。

ただし既存製品の外観やキー配置をコピーするのではなく、

- 入力方法
- 計算フロー
- 工学分野での使いやすさ

を参考に独自UIとして設計する。

---

# 13. Engineering Functions

将来候補として以下を想定する。

- SI prefix
- dB
- dBm
- impedance
- reactance
- RC
- RL
- RLC
- frequency / period
- angular frequency
- phase

これらはMVP必須とはしない。

---

# 14. Data Scale Calculator

## 14.1 目的

データ量や計算規模を直感的に把握する。

特に以下を対象とする。

- Database
- Vector Search
- Embedding
- Machine Learning
- Images
- Storage

---

# 15. Vector Size Calculator

基本式：

```text
count × dimensions × bytes_per_element
```

入力例：

```text
Vectors      100,000,000
Dimensions   768
Type         float32
```

出力：

```text
Bytes
GB
GiB
TB
TiB
```

この列挙は候補単位の集合である。MVP は各系（10 進・2 進）から、値が
1 以上になる最大の単位を 1 行ずつ自動選択する（Milestone 4 の例と整合。
規則は docs/superpowers/specs/2026-08-11-data-scale-design.md §3）。

---

# 16. Data Types

最低限以下を扱う。

- int8
- uint8
- int16
- float16
- bfloat16
- int32
- float32
- int64
- float64

必要に応じて追加する。

---

# 17. Decimal / Binary Units

両方表示する。

Decimal：

```text
1 KB = 1000 bytes
1 MB = 1000² bytes
1 GB = 1000³ bytes
```

Binary：

```text
1 KiB = 1024 bytes
1 MiB = 1024² bytes
1 GiB = 1024³ bytes
```

両者を混同しない。

---

# 18. Replication / Overhead

将来的に、

```text
Raw size
× replication
+ overhead
```

を計算可能にする。

例：

```text
Raw             286 GiB
Replication     × 3
Overhead        20%
```

↓

```text
Approx. 1.0 TiB
```

---

# 19. AI / Vector Search拡張候補

将来、以下を追加可能とする。

- HNSW memory estimate
- IVF index estimate
- Quantization comparison
- float32 vs float16 vs int8
- Embedding API transfer size
- Parameter count × precision
- Transformer model size
- ANN candidate count
- Distance calculation count

ただしこれらは初期MVPに含めない。

---

# 20. Loan Calculator

## 20.1 目的

住宅ローンなどを中心とした借入計算を行う。

初期段階では単純な返済計算を対象とし、将来的には複数Scenarioを比較可能なSimulation Toolに発展させる。

---

# 21. Loan MVP

入力：

- Principal
- Annual interest rate
- Term
- Payment frequency

最低限、

```text
元利均等返済
```

をサポートする。

出力：

- Monthly payment
- Total payment
- Total interest

---

# 22. Loan Simulation

将来的に以下を追加する。

- 元金均等返済
- 繰上返済
- ボーナス返済
- 金利変更
- 固定金利
- 変動金利
- 複数ローン比較

さらに、

```text
Buy
vs
Rent + Investment
```

などのシミュレーションへ発展可能とする。

---

# 23. Numerical Policy

数値計算の方針を用途ごとに分ける。

単純に、

> WASMなので高精度

とは扱わない。

---

# 24. 数値の分類

## Exact Integer

整数で完全に表現可能なもの。

例：

- byte count
- vector count
- dimensions
- number of elements

可能な限り整数演算を使用する。

---

## Exact Rational

分数として正確に表現可能なものについて、必要に応じて有理数表現を検討する。

---

## Floating Point

以下は浮動小数点演算を使用する。

- sin
- cos
- tan
- logarithm
- exponential
- complex number
- polar conversion

結果には数値誤差が存在することを前提とする。

---

## Decimal / Financial

金額計算ではbinary floating pointだけに依存しない。

金融計算では、

- 金額
- 金利
- 丸め
- 端数処理

を明示する。

---

# 25. Overflow Policy

Data Scale Calculatorでは巨大な値を扱う可能性がある。

例：

```text
1,000,000,000
×
65,536
×
8
```

など。

Rust側でoverflowを暗黙に発生させない。

必要に応じて以下を検討する。

- u128
- Big Integer

MVPではu128を第一候補とする。

---

# 26. Precision Policy

UI表示桁数と内部計算精度を分離する。

例：

```text
internal:
53.13010235415598...

display:
53.130102°
```

表示上の丸め値を次の計算入力として強制使用しない。

内部値を保持する。

---

# 27. Error Handling

最低限以下を明示的に扱う。

- division by zero
- invalid domain
- overflow
- underflow
- NaN
- Infinity
- invalid input

UIにpanicやJavaScript exceptionを直接露出させない。

Rust側では原則としてResult型を使用する。

---

# 28. Python Reference Implementation

PythonはProduction Runtimeとしては利用しない。

用途は、

> Rust/WASM Calculation Coreの検証

である。

---

# 29. Python Libraries

用途ごとに以下を利用候補とする。

数学：

```text
SymPy
mpmath
```

金融：

```text
decimal.Decimal
```

整数：

```text
Python built-in int
```

Pythonの任意精度整数をReferenceとして利用する。

---

# 30. Reference Implementation Policy

RustコードとPythonコードを同一アルゴリズムで逐語的に実装しない。

可能な限り既存の数学ライブラリや別手法を利用する。

例：

Rust：

```text
独自rectangular → polar
```

Python：

```text
SymPy sqrt
SymPy atan2
```

こうすることで、同じ実装バグが双方に混入する可能性を減らす。

---

# 31. Testing Strategy

テストを複数Layerに分ける。

```text
Layer 1
Rust Unit Test

Layer 2
Rust Property Test

Layer 3
WASM Integration Test

Layer 4
Python Reference Validation

Layer 5
Browser E2E Test

Layer 6
Heavy Verification Corpus (browser, corpus/ 配下、通常の CI では実行しない)
```

---

# 32. Rust Unit Tests

各関数について基本的なknown-answer testを行う。

例：

```text
3 + 4j
→ magnitude = 5
```

---

# 33. Boundary Tests

以下を重点的にテストする。

- zero
- negative numbers
- very large integers
- very small floating values
- angle boundaries
- π
- ±180°
- ±π
- quadrants

特にatan2を使う変換は四象限を必ず検証する。

---

# 34. Property-based Testing

可能であればproperty-based testを導入する。

例：

```text
rectangular
→ polar
→ rectangular
```

の往復で、元の値と所定の誤差内で一致することを確認する。

---

# 35. Cross-language Validation

共通Test Vectorを使用する。

```text
testdata/
    scientific.json
    complex.json
    data_scale.json
    finance.json
```

RustとPythonが同じ入力データを読み込む。

PythonでReference Resultを生成し、Rust結果との差を確認する。

---

# 36. Test Tolerance

Floating Pointでは単純な完全一致を要求しない。

計算の種類ごとに、

- absolute tolerance
- relative tolerance

を定義する。

Toleranceはテストコード内に散在させず、可能な限り集中管理する。

---

# 37. Financial Validation

ローン計算は単純な数式結果だけではなく、

- 毎月の丸め
- 最終月調整
- 総支払額
- 利息

をReference Implementationと比較する。

丸め方法そのものを仕様として固定する。

---

# 38. PWA Requirements

最低限以下を提供する。

- Web App Manifest
- Application Icon
- Standalone Display
- Service Worker
- Static Asset Cache
- WASM Cache

---

# 39. Offline

一度正常にロードされた後は、

- Scientific Calculator
- Data Scale Calculator
- Loan Calculator

の基本機能をネットワークなしで利用可能とする。

---

# 40. Local Storage

初期段階では、

- 設定
- 表示モード
- Calculator State
- 必要に応じて履歴

をブラウザ側に保存可能とする。

候補：

- localStorage
- IndexedDB

履歴保存はユーザーが無効化できる設計を検討する。

## 実装した範囲（0.2.1、2026-08-17）

**設定だけを `localStorage` に保存している。** 保存するのは角度の単位・
極形式・記法（Scientific）、データ型・主表示の単位系（Data Scale）、
計算の種類・期数・源泉徴収（Finance）の 8 項目である。
**【この 8 項目は 0.4.0 で 7 項目になった。下の「訂正」を見よ。】**

**Calculator State（打ちかけの式・途中の数字・答）は保存していない。**
`STATE_SCHEMA` は**保存には**使っていない——保存側は独自の版
（`SETTINGS_VERSION`）を持つ。ただし**遊んでいるわけではない**:
`engine::reduce` が入口で `is_valid()` を呼んでおり
（`crates/calcarc-core/src/engine/mod.rs`）、版の違う状態が WASM 境界を
渡ってきたときに初期状態へ倒す門になっている。

**履歴が入った**（設計書 `docs/superpowers/specs/2026-09-03-history-design.md`）。
**この段落を書いている時点で出荷済みの最新版は 0.7.0 であり、履歴を含む版は
まだタグを打っていない**——確定した版数が分かり次第、この 1 文だけ直す。
**ここで初めて、計算した内容そのものが端末に残る**——Scientific で `=` を
押した式と答と角度モードを、`localStorage` に 50 件まで貯める。**だから
`1017` 行の「無効化できる設計」がここで要る**: 既定は入で、履歴の画面
（`Shift` → `hist`）で切れる（切る＝これから記録しない。既に貯まった分は
残る）。消すのは別の操作で、同じ画面から行う（1 件ずつ／全消し）。
**`AC` では消えない。**

**端末から出ないことは変わらない**——「計算履歴」を含む一覧のあとの
「…を計算目的で外部サーバへ送信しない。」（4.1 Local First。一覧の
「計算履歴」はいま `docs/base-spec.md:72`、文はいま `:74`）と、
「計算処理のために入力値をサーバへ送信しない。」（いま
`docs/base-spec.md:1085`）は、履歴にもそのまま効く。**変わったのは
「保存されるのは表示の好みだけ」のほうである。**

設計と裁定は `docs/superpowers/specs/2026-08-17-state-persistence-design.md`。

## 訂正（0.4.0、2026-08-25）——保存する設定は 7 項目になった

**上の「8 項目」のうち、記法（`notation`）は保存しなくなった。**
上の記述は 0.2.1 時点の記録として残してある。

**なぜ外したか**: 0.4.0 で ENG がモードではなくなり、**ENG 以外のどのキーを
押しても通常表記に戻る**ようになった。**保存しても、復元した瞬間の次の
1 打鍵で消える**——**保存できるのは打鍵をまたいで残る設定だけ**である。

**綴りは変えていない。** 古い保存に残る `notation` は、読み手が白リストで
組み立て直す側なので黙って落ちる。同じ綴りが別の意味を持つわけではないので、
`SETTINGS_VERSION` を上げる場面ではない。

**いま保存しているのは 7 項目**——角度の単位・極形式（Scientific）、
データ型・主表示の単位系（Data Scale）、計算の種類・期数・源泉徴収
（Finance）。数えた先は `web/src/settings/index.ts` の `parse`、外した理由は
`web/src/settings/types.ts` の `notation` の註に在る。

**「0.4.0 で外れた」の根拠**は `6858f41`（2026-08-25、"Make ENG a key you
peek with, not a mode you are in"）である。**`v0.4.0` に在り、`v0.3.1` には
無い。** その差分の削除行が、`parse` の
`notation: pick(ALLOWED.notation, …)`・型の `notation: Notation`・既定値・
白リストの `notation: NOTATIONS` を落としている。**「いま 7 である」は現物を
数えれば分かるが、「昔は保存していた」はこの削除行でしか確かめられない**
——過去形の主張は、消えた側を指さないと裏が取れない。

---

# 41. Privacy

基本方針：

> Calculation data stays on the user's device.

計算処理のために入力値をサーバへ送信しない。

Analyticsを導入する場合でも、入力した数値そのものを収集しない。

## なぜ通信しても Privacy と両立するのか（0.3.1、2026-08-20）

> **`0.3.1` はこの機能が載る版で、まだ出ていない。** 出荷済みの 0.3.0 は通信しない
> ——**`Cargo.toml` を見て `0.3.0` とあっても、この節と食い違ってはいない。**
> 版数は `main` へ取り込むときに上げる。

**為替換算（Convert / 通貨）だけは外部へ通信する。** それでも上の基本方針は
破れていない——**落としてくるのはレート表 1 枚**であり、**入力した金額は
1 バイトも外へ出ない**。換算の掛け算はこの端末（`calcarc-core`）で行う。

**両立の根拠は「送っていないこと」であって、「相手を信用していること」では
ない。** 具体的には次の 4 つで成り立っている。

1. **形が GET のレート表だけである。** 取得先は
   `https://open.er-api.com/v6/latest/{BASE}` で、**リクエストに金額を入れる
   場所が無い**。「金額を送って換算結果を受け取る」形の API は、プロバイダを
   選ぶ段階で落としている。
2. **API キーもトークンも持たない。** URL に秘密が無く、端末を識別する値も
   送らない（`credentials: "omit"`。Cookie も送らない）。
3. **起動時には通信しない。** ネットワークに出るのは**利用者が Convert の
   通貨カテゴリを開いたあと**で、他の 7 カテゴリを見ているあいだは
   `fetch` も IndexedDB も触らない。
4. **取ってきたレートは端末に置くだけ。** IndexedDB に 1 枚だけ保存し、
   **多くとも 1 日 1 回**しか取りに行かない。**どこへも配らない。**

   > **【訂正 2026-08-20】ここには「1 日 1 回しか取りに行かない」と書いていたが、
   > 実装より強い主張だった。** 実物は **1 セッションに 1 回、かつ前回の取得から
   > 24 時間を過ぎているとき**である。取得に失敗した場合は保存を更新しないので、
   > **再読み込みのたびに 1 回ずつ**出る（プロバイダは「1 時間に 1 回でも制限に
   > かからない」と明記しているので実害は無い）。**上限としての「1 日 1 回」は
   > 正しく、下限としては正しくない。**

**この 4 つを守ることが「通信してよい」の条件である。** ここを読んだ人が
為替以外で通信を足すときは、**同じ 4 つを満たせるかを先に確かめること**
——満たせないなら、それは Privacy の方針を変える相談であって、実装の話では
ない。**とくに「金額を送って結果を受け取る」形の API への差し替えは、
たとえ結果が同じでもこの方針を破る。**

見張っているもの:
`web/tests/e2e/convert.spec.ts` の
"reaches the provider only after Currency is open"（起動時に取りに行かない）、
`web/src/ui/Convert/UnitPanel.test.tsx` の
"touches neither the network nor the cache from the other seven categories"。
設計と裁定は `docs/superpowers/specs/2026-08-19-currency-design.md` の §0.0・§6。

---

# 42. UI Design

スマートフォンを第一に考える。

対応優先順位：

1. Smartphone
2. Tablet
3. Desktop

ただしEngineering Calculatorについては、タブレットでの操作性も重視する。

---

# 43. Accessibility

最低限以下を考慮する。

- Keyboard input
- Focus handling
- Button labels
- Screen reader friendly labels
- High contrast
- Touch target size

## 追記（2026-09-04）——タッチ標的の 44px は、この節では決めていない

**上の一覧に数字は無い。** 「Touch target size を考慮する」までが要求であり、
**44px はこのプロジェクトが選んだ値である。**

- **値は `web/src/ui/tokens.css` の `--touch-target-min` が 1 か所で持つ。**
  CSS の宣言として `44px` を書いてよいのはそこだけで、`tools/check-boundary.mjs`
  が毎回の CI で見張る。
- **守っているのは E2E** である（各盤面の検査と `web/tests/e2e/viewport-budget.spec.ts`）。
  jsdom はレイアウトを組まないので、vitest では測れない。
- **例外が 2 つある**（関数列の高さ 34px、フッタのリンク）。どちらも理由つきで
  `docs/definition-of-done.md` に在る。

**44 という数字の出どころは、リポジトリのどこにも書かれていない**——2026-09-04 に
追跡下の全ファイルを検索して確認した。参照実装の `独立:` の言い方に倣えば
**未確認**である。44 は WCAG 2.5.5 Target Size (Enhanced) の 44×44 CSS px と、
Apple の Human Interface Guidelines の 44pt が共通して挙げる値だが、
**どちらを見て決めたのかという記録は無い。**

**この節を指す註が 51 件ある。** そのうち**この節が数字を定めているように
読めるもの**だけを、ここを指す形に直した（`docs/definition-of-done.md`、
`web/src/ui/UpdateToast/UpdateToast.module.css`、
`docs/superpowers/specs/2026-08-16-eng-notation-design.md` §7.1）。
残りは「§43 が求めるタッチ標的に対して採った 44px」と読めるので触っていない
——**51 件の機械的な書き換えは、それ自体が新しい誤りの入り口である。**

---

# 44. OSS Policy

OSSとして公開する。

ライセンス候補：

```text
MIT
Apache License 2.0
```

初期段階ではApache-2.0を有力候補とする。

理由：

- 商用利用可能
- 改変可能
- 特許条項が明確
- 企業利用しやすい

最終決定はリポジトリ作成時に行う。

---

# 45. Repository Ownership

初期段階では個人GitHubアカウントで開始することを想定する。

将来的に必要であれば、

- Company Organization
- Research / Lab Organization

へ移管可能な構成にする。

特定組織固有の依存をCalculation Coreへ持ち込まない。

---

# 46. Branding

初期プロジェクト名は仮称として扱う。

候補となる概念：

- Calculator
- Engineering
- Precision
- Web
- Local
- WASM

正式名称はMVP実装後に決定してもよい。

**【訂正 2026-08-16】** **正式名称は `CalcArc` に確定した。** リポジトリ名・
PWA の manifest（`name` / `short_name`）・画面のフッタ表記が同じ綴りで揃っている。
公開先は https://calc.terapyon.net/ である。

---

# 47. MVP Scope

最初のMVPでは以下に集中する。

## Scientific Calculator

- 四則演算
- sqrt
- power
- sin/cos/tan
- Degree/Radian
- 複素数
- Rectangular/Polar

## Data Scale Calculator

- count
- dimensions
- datatype
- bytes
- KB/MB/GB/TB
- KiB/MiB/GiB/TiB

## Loan Calculator

- principal
- annual interest
- term
- monthly payment
- total payment
- total interest

## Platform

- Rust calculation core
- WASM
- TypeScript UI
- PWA
- offline support
- Python validation
- CI

---

# 48. MVPでは実装しないもの

以下はVersion 1以降へ送る。

- CAS
- equation solver
- graph plotting
- HNSW memory calculator
- IVF calculator
- RLC専用Calculator
- advanced financial simulation
- account
- cloud sync
- server-side calculation
- AI assistant

---

# 49. Initial Development Milestones

## Milestone 0 — Project Skeleton

- Repository作成
- LICENSE
- README
- Rust workspace
- Web project
- Python reference project
- CI

---

## Milestone 1 — Calculation Core

以下をWeb UIなしで実装する。

```text
add
subtract
multiply
divide

sin
cos
tan

rect_to_polar
polar_to_rect

data_size

loan_payment
```

Rust Unit TestとPython Reference Testを先に整備する。

---

## Milestone 2 — WASM

Calculation CoreをWASM経由でTypeScriptから呼び出す。

ここではUI品質より、

```text
Browser
→ WASM
→ Rust
→ Result
```

が安定して動作することを優先する。

---

## Milestone 3 — First UI

Scientific Calculatorを最初のUIとする。

最低限、

```text
3 + 4j
```

から、

```text
5 ∠ 53.130102°
```

を表示可能にする。

この機能を最初のEnd-to-End vertical sliceとする。

---

## Milestone 4 — Data Scale

以下を実装する。

```text
100M
×
768
×
float32
```

↓

```text
307.2 GB
286.1 GiB
```

---

## Milestone 5 — PWA

- Installable
- Offline
- Icons
- Manifest
- Service Worker

を完成させる。

---

## Milestone 6 — Loan

基本ローン計算を追加する。

金融計算についてはNumerical PolicyとReference Testを先に確定してから実装する。

---

# 50. Definition of Done — MVP

以下を満たした時点を最初の公開可能版とする。

- Smartphoneで利用可能
- Tabletで利用可能
- Desktopで利用可能
- PWAとしてインストール可能
- Offlineで基本計算可能
- Rust/WASMで計算
- Scientific Calculator動作
- Polar / Rectangular変換動作
- Data Scale Calculator動作
- Loan Calculator動作
- Python Reference Validationあり
- CIですべてのテストが成功
- READMEにNumerical Policyを説明
- OSS License明記

---

# 51. 設計上の最重要原則

このプロジェクトでは、UIの多機能化よりも以下を優先する。

1. 計算仕様が明確であること
2. 数値表現が明確であること
3. 丸め規則が明確であること
4. 計算コアがUIから独立していること
5. Pythonによる独立検証が可能であること
6. ブラウザ内で計算が完結すること
7. 新しいCalculatorを追加しやすいこと

---

# 52. 最初に実装するVertical Slice

開発開始時には、全Calculatorを並行して作らない。

最初の動作目標を以下とする。

```text
Input

3 + 4j

        ↓

TypeScript

        ↓

WASM

        ↓

Rust calc-core

        ↓

Result

5 ∠ 53.130102°

        ↓

Python Reference Validation

SymPyによる結果と比較
```

この1本を、

- Rust
- WASM
- Web
- Python validation
- CI

まで通す。

これが完成した時点で、本プロジェクトの基本Architectureが成立したと判断する。

その後、Scientific Calculatorの機能追加とData Scale Calculatorへ展開する。
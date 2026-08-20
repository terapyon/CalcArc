# U-2 Convert のカテゴリ（Area / Volume / Speed / Data Size） 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** U-1 の単位換算エンジンに 4 カテゴリ（面積・体積・速さ・データ量）の表を足し、Convert を 7 カテゴリにする。

**Architecture:** **エンジンに 1 行も足さない**（spec §0.0-1）。足すのは `Unit` の 42 バリアントと
`Category` の 4 つ、参照実装の表、golden のケース、単位面のラベルだけである。
アフィン変換・基準単位経由・厳密有理数・表示規則はすべて U-1 が決めており、検証済みである。

**Tech Stack:** Rust（`calcarc-core` / `calcarc-wasm`）、Python 3（`fractions.Fraction`）、TypeScript + React、Playwright / vitest / pytest。

**Spec:** `docs/superpowers/specs/2026-08-19-convert-categories-design.md`（**ユーザー承認済み**）

## Global Constraints

- **エンジンに 1 行も足さない**（spec §0.0-1）。`to_base` / `from_base` / `convert` / `format_rational` を変えない。
- **係数は定義値**（spec §0.0-2）。測定値・慣用値を定義値のふりをさせない。
- **基準が 1 つに定まらない単位は、名前に基準を書く**（spec §0.0-3、§3.2）。
- **参照実装を Rust の移植にしない。** 係数は **spec §3 の表**から書き起こす。**`convert/mod.rs` を開かない。**
- **`testdata/convert.json` は追記のみ。U-1 の 31 件を 1 件も変えない**（spec §5）。
- **トークンは ASCII の小文字**（U-1 の裁定 1）。**`Unit::ALL` の並びは契約**（`token_parity.rs` が順序込みで見る）。
- **`calcarc-core` は panic しない。** **WASM 境界は例外を投げない。**
- **許容誤差をテストコードに書かない。** `convert.json` は `tolerance` を持たない。
- **コミット前に `cargo fmt --all`。`uv` は必ず `--no-config`。**
- コミットメッセージ末尾: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **`git push` と PR 作成は行わない。**
- **共有ワークツリー**: 複数セッションが 1 ワークツリー。`checkout` / `rebase` / `amend` / **`reset`** / ブランチ切り替えを行わない。
  他ブランチの作業は `git worktree add`。**赤確認の戻しは再編集。** コミット前に `git branch --show-current` を確認。
- **preview の港**: 4173 / 4179 は E2E が掴む。他セッションが 4180 前後を使う。**使ったら落とす。**

---

## §0.0-4 の訂正（**この計画がいちばん先に片付けること**）

**spec §0.0-4 は「1 カテゴリの単位は 16 個以内（4 × 4 の面に載る）」と書いているが、実物と違う。**
しかも**危険な方向に違う**——実物の容量は **16 より小さい**。

**実測（`web/src/ui/Keypad/convert.ts` の `unitFace()` を読んで確認）**:

```text
枠は 5 列 × 5 行（CSS が `grid-template-rows: repeat(5,1fr)` と `aspect-ratio: 1/1` で保つ）
DEL と AC は 1 行目の 4・5 列目
単位は**左 3 列**に詰める（4・5 列目は恒久の空き）
→ 単位に使えるのは **3 列 × 5 行 = 15 スロット**
```

`unitFace()` の行数は**単位数で決まる**（`do...while` で単位が尽きるまで行を足す）。
**16 個入れると 6 行目ができ、CSS が保つ 5 行を超える。**

**そして Volume はちょうど 15 個で、容量いっぱいである**（spec §2 の表）。
**headroom はゼロ。** spec §3.4 が「米国法定カップ 240 mL は入れない。3 つ目を足すと面が埋まる」と
書いているのは正しく、**実際には「埋まる」ではなく「あふれる」**である。

**訂正の文面が守ること**（Task 1）:
- 「16 個以内」→ **「15 個以内」**。理由は **4 × 4 ではなく 5 × 5 の枠で、DEL/AC が 1 行目の 2 セルを取り、
  単位は左 3 列にしか置かない**から
- **枠の限界であって選んだスコープではない**——S-0 が否定した「4 × 4」の前提を継いでいたので、
  そこも同時に直す（**U-1 の引き継ぎが約束した訂正印**）
- **単位の増減はしない**（約束事項）。Volume の 15 個はそのまま
- **Volume は容量いっぱいであることを書く**——次に単位を足そうとする人が、面があふれることを知らずに足さないように

---

## File Structure

| ファイル | 責務 |
|---|---|
| `docs/superpowers/specs/2026-08-19-convert-categories-design.md` | §0.0-4 に訂正印（Task 1）、§4 に【実測】（Task 7） |
| `reference/src/calcarc_reference/convert_ref.py` | `CATEGORIES` に 4 カテゴリ **42 単位**を追記 |
| `reference/tests/test_convert_ref.py` | 名指しケースの健全性テストを追記 |
| `reference/src/calcarc_reference/cases.py` | `CONVERT_INPUTS` に**追記のみ** |
| `testdata/convert.json` | 再生成（**U-1 の 31 件は 1 件も変わらないこと**を確かめる） |
| `crates/calcarc-core/src/convert/mod.rs` | `Category` に 4、`Unit` に 42、`affine()` に 42 行。**関数は 1 つも変えない** |
| `crates/calcarc-core/tests/convert_golden.rs` | 件数の下限を上げるだけ |
| `web/src/convert/types.ts` | `CONVERT_CATEGORY_TOKENS` と `CONVERT_UNIT_TOKENS` を伸ばす |
| `web/src/route.ts` | `CONVERT_CATEGORIES` は `convert/types.ts` から来るので**変更不要**（確認すること） |
| `web/src/ui/Keypad/convert.ts` | `UNIT_LABELS` / 読み上げ名 / `CATEGORY_LABELS` / `unitsOf` の割り当てを伸ばす |
| `web/tests/e2e/convert.spec.ts` | 面が枠に収まる検査を 4 カテゴリに広げる（**1 本だけ**。spec §5） |

**新しいファイルは 1 つも作らない。** U-2 は表の追加である。

---

### Task 1: §0.0-4 の訂正印と、畳の出典の確認

**Files:**
- Modify: `docs/superpowers/specs/2026-08-19-convert-categories-design.md`（§0.0-4、§3.2）

**このタスクは 2 つの門番である。どちらも通らなければ後続が書けない。**

- [ ] **Step 1: 枠の容量を実測する**

**訂正印に書く数を、実物で確かめてから書くこと。** 読むもの:
`web/src/ui/Keypad/convert.ts` の `unitFace()`、`web/src/ui/Convert/UnitPanel.module.css` の
`fieldset[aria-label="単位のキー"]`、`web/tests/e2e/convert.spec.ts` の枠の検査。

**16 個入れると何が起きるかを実際に見ること。** 使い捨てで `unitsOf` が 16 個返すように変異させ、
`pnpm e2e convert.spec.ts` の枠の検査が**赤くなるか**を実測する（**リポジトリに残さない**）。
- 赤くなるなら「16 は入らない」が実物で裏づけられる
- **赤くならないなら、訂正印の数を書き直すこと**——15 という数はこの計画の推論であって、実測ではない

- [ ] **Step 2: 畳の出典を一次情報で確認する**

**spec §3.2 が【実装時の義務】として課している。**

> **この出典は一次情報で確認してから landing する。** 規約の条番号と版を導出記録に書く。
> **確認できなければ畳を入れない**——出典の曖昧な係数を「定義値」の表に混ぜることは、
> この spec がいちばんやってはいけないことである。

**確認すること**: 「不動産の表示に関する公正競争規約」（および施行規則）が、**広告における 1 畳あたりの
下限を 1.62 m² と定めているか**。**条番号と版（改正年）を記録する。**

**確認できたら**: spec §3.2 に条番号と版を追記する。
**確認できなかったら**: **畳を入れない。** Area は 10 単位になる。
**spec §3.2 と §3.3（坪 ≠ 2 畳）と §5 の名指しケース（`1 坪 = 2.040608101 畳`）を、
畳が無い前提に書き換えること**——**§3.3 は畳が無ければ主張そのものが消える。**
**この判断は報告に明記し、監視役の確認を受けてから次に進むこと。**

- [ ] **Step 3: 訂正印を書く**

§0.0-4 に【訂正 2026-08-20】として、上の「§0.0-4 の訂正」節の内容を書く。
**数は Step 1 の実測に合わせること。**

- [ ] **Step 4: コミット**

```bash
git add docs && git commit   # 例: "Fifteen, not sixteen, and the frame is five by five"
```

---

### Task 2: Python 参照に 4 カテゴリの表を足す

**Files:**
- Modify: `reference/src/calcarc_reference/convert_ref.py`
- Modify: `reference/tests/test_convert_ref.py`

**Interfaces:**
- Produces: `CATEGORIES` に `"area"` / `"volume"` / `"speed"` / `"data-size"` の 4 キー
- Consumes: U-1 の `to_base` / `from_base` / `convert_value` / `format_rational` / `compute`（**1 行も変えない**）

**【必読】`crates/calcarc-core/src/convert/mod.rs` を開かないこと。** 係数は **spec §3 の表**から書き起こす。

**トークンの綴り（この計画の裁定 1）**——ASCII 小文字。**U-1 の 21 個と衝突しないことを確認済み**:

| カテゴリ | トークン |
|---|---|
| area | `mm2` `cm2` `m2` `km2` `ha` `in2` `ft2` `yd2` `ac` `tsubo` `jo` |
| volume | `ml` `cl` `dl` `l` `m3` `gal_us` `gal_imp` `floz_us` `floz_imp` `pt_us` `pt_imp` `qt_us` `qt_imp` `cup_us` `cup_jp` |
| speed | `mps` `kmh` `mph` `kn` |
| data-size | `bit` `byte` `kb` `mb` `gb` `tb` `pb` `kib` `mib` `gib` `tib` `pib` |

**カテゴリのトークンは `area` / `volume` / `speed` / `data-size`**（hash に出る。spec §4）。

**なぜ `_` を使うか**: `gal(US)` の括弧は URL の hash にも JSON のキーにも使いにくい。
**ラベルが括弧を持ち、トークンは持たない**——U-1 の `degc` / `°C` と同じ分け方である。

- [ ] **Step 1: 失敗するテストを書く**

`reference/tests/test_convert_ref.py` に追記。**spec §5 の「名指しで置くケース」の表をそのまま写す**:

```python
def test_a_tsubo_is_not_exactly_two_tatami() -> None:
    # spec §3.3: 慣用では「1 坪 = 2 畳」だが、**出自が違うので厳密には一致しない**。
    # 坪は尺から、畳は不動産の規約から来ている。**丸めて 2 に見せない。**
    assert convert_value(Fraction(1), "area", "tsubo", "jo") == Fraction(20000, 9801)


def test_the_two_gallons_are_not_the_same() -> None:
    assert convert_value(Fraction(1), "volume", "gal_us", "l") == Fraction(473176473, 125000000)
    assert convert_value(Fraction(1), "volume", "gal_imp", "l") == Fraction(454609, 100000)


def test_the_two_cups_are_not_the_same() -> None:
    # 米国慣用の 8 fl oz と、日本の計量カップ 200 mL は別物（spec §3.4）。
    assert convert_value(Fraction(1), "volume", "cup_us", "ml") == Fraction(2365882365, 10000000)
    assert convert_value(Fraction(1), "volume", "cup_jp", "ml") == Fraction(200)


def test_si_and_iec_are_separate() -> None:
    # 設計書 §6 の例。`GB` と `GiB` を曖昧にしない。
    assert convert_value(Fraction(1), "data-size", "gb", "mib") == Fraction(10**9, 2**20)


def test_a_bit_is_an_eighth_of_a_byte() -> None:
    # **1/8 である。** 有理数なので 0.125 が厳密に出る（f64 なら偶然合う）。
    assert convert_value(Fraction(1), "data-size", "bit", "byte") == Fraction(1, 8)


def test_the_acre_is_the_yard_pound_stack() -> None:
    assert convert_value(Fraction(1), "area", "ac", "m2") == Fraction(316160658, 78125)


def test_the_knot_keeps_the_nautical_mile() -> None:
    assert convert_value(Fraction(1), "speed", "kn", "kmh") == Fraction(1852, 1000)


def test_the_new_categories_have_the_unit_counts_the_spec_says() -> None:
    # **数え間違いは表の写し落としである。** 件数を固定する。
    assert len(CATEGORIES["area"]) == 11
    assert len(CATEGORIES["volume"]) == 15
    assert len(CATEGORIES["speed"]) == 4
    assert len(CATEGORIES["data-size"]) == 12


def test_no_token_is_used_twice_across_categories() -> None:
    # **トークンは flat な名前空間である**（Rust の `Unit` が 1 つの enum）。
    seen: list[str] = []
    for table in CATEGORIES.values():
        seen.extend(table)
    assert len(seen) == len(set(seen)), "トークンが 2 つのカテゴリで衝突している"
    assert len(seen) == 21 + 42
```

**畳を入れないと決めた場合**は、`tsubo → jo` のテストと件数（11 → 10）をその判断に合わせること。

- [ ] **Step 2〜4: 赤 → 実装 → 緑**

```bash
cd reference && uv run --no-config pytest tests/test_convert_ref.py -q
cd reference && uv run --no-config pytest -q      # 既存を壊していないこと
cd reference && uv run --no-config ruff check . && uv run --no-config ruff format --check .
```

**係数は spec §3 の表から書く。導出のある行（`ft²` = 144 × `in²` など）は、
spec の書き方に従うこと**（U-1 の Task 1 で、plan の literal より **spec の書き方が優先**と決めた）。

- [ ] **Step 5: コミット**

---

### Task 3: 名指しケースと golden の追記

**Files:**
- Modify: `reference/src/calcarc_reference/cases.py`（`CONVERT_INPUTS` に**追記のみ**）
- Modify: `testdata/convert.json`（再生成）

**Interfaces:** Consumes Task 2 の表。Produces Task 5 の下限が数える件数。

- [ ] **Step 1: ケースを追記する**

**spec §5 の表を 1 行ずつ写す**（U-1 の Task 3 と同じ流儀。**なぜ置くかをコメントに残す**）。
加えて **4 カテゴリの全 42 単位が 1 度以上現れること**——**現れない単位の係数は、言語間で一度も突き合わされない**
（U-1 の Task 3 で `mg`・`g`・`t` が漏れていた実例がある）。

- [ ] **Step 2: 生成して、U-1 の 31 件が 1 件も変わっていないことを確かめる**

```bash
cd reference && uv run --no-config python scripts/generate.py
cd .. && git diff testdata/convert.json | grep -c '^-'   # **削除行が 0 であること**
```
**`-` で始まる行が出たら、U-1 のケースを壊している**（spec §5 が「1 件も変えない」と書いている）。
**`id` の重複検査**（`build_convert` に既に在る）が発火しないことも確認する。

- [ ] **Step 3: 目で見る**

```bash
python3 -c "
import json; d=json.load(open('testdata/convert.json'))
print('cases', len(d['cases']), 'has tolerance:', 'tolerance' in d)
for c in d['cases']:
    if c['input']['category'] in ('area','volume','speed','data-size'): print(' ', c['id'], '->', c['expect'])
"
```
**確かめること**: `1 坪 → 畳` が **`2.040608101`**（`2` に丸まっていたら訂正印の意味が消える）／
`1 gal(US) → L` が `3.785411784`、`1 gal(Imp) → L` が `4.54609`／`1 GB → MiB` が `953.6743164`／
`1 bit → byte` が `0.125`／`1 ac → m²` が `4046.8564224`／`1 kn → km/h` が `1.852`／**`tolerance` が無いこと**

- [ ] **Step 4: コミット**

---

### Task 4: Rust に表を足す

**Files:**
- Modify: `crates/calcarc-core/src/convert/mod.rs`（**表だけ。関数は 1 つも変えない**）

**Interfaces:**
- Produces: `Category::ALL` が 7 個、`Unit::ALL` が **63 個**、`affine()` が 63 腕
- Consumes: U-1 の `to_base` / `from_base` / `convert`（**変えない**）

**【必読】`reference/src/calcarc_reference/convert_ref.py` を開かないこと。** 係数は **spec §3 の表**から書き起こす。

**`Unit::ALL` の並び**: U-1 の 21 個の**後ろに**、`area` 11 → `volume` 15 → `speed` 4 → `data-size` 12 の順で足す。
**`Category::ALL` も同じ順**（`length` `mass` `temperature` の後ろに 4 つ）。
**既存の 21 個の並びを 1 つも動かさないこと**——動かすと `token_parity` が赤くなり、golden の意味も変わる。

**`Category::units()` は `static UNITS: [Unit; N] = Unit::ALL;` のスライスである。**
`LENGTH_COUNT` などの定数を伸ばすこと。**和が `Unit::ALL` の長さと一致しなければ型で落ちる**（U-1 の設計）。

- [ ] **Step 1: 失敗するテストを書く**

U-1 の `every_token_round_trips` と `every_unit_belongs_to_exactly_one_category_and_that_category_lists_it` は
**そのまま新しい単位も覆う**（`Unit::ALL` を回している）。**足すのは表の中身を主張するテスト**:

```rust
#[test]
fn a_tsubo_is_not_exactly_two_tatami() {
    // spec §3.3: **慣用に寄せない。** 20000/9801 = 2.040608101…
    assert_eq!(convert("1", Category::Area, Unit::Tsubo, Unit::Jo), Ok(r(20000, 9801)));
}

#[test]
fn the_two_gallons_are_not_the_same() { /* gal_us / gal_imp */ }

#[test]
fn the_two_cups_are_not_the_same() { /* cup_us / cup_jp */ }

#[test]
fn si_and_iec_are_separate() { /* 1 GB = 10^9 / 2^20 MiB */ }

#[test]
fn a_bit_is_an_eighth_of_a_byte() { /* 1/8 */ }

#[test]
fn the_unit_counts_match_the_spec() {
    // U-1 の同名テストを伸ばす。**数え間違いは表の写し落としである。**
    assert_eq!(Category::Area.units().len(), 11);
    assert_eq!(Category::Volume.units().len(), 15);
    assert_eq!(Category::Speed.units().len(), 4);
    assert_eq!(Category::DataSize.units().len(), 12);
}

#[test]
fn crossing_the_new_categories_is_not_a_conversion() {
    assert_eq!(
        convert("1", Category::Area, Unit::M2, Unit::L),
        Err(CalcError::SyntaxError)
    );
}
```

- [ ] **Step 2〜4: 赤 → 実装 → 緑**

```bash
cargo test -p calcarc-core convert::
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all
git diff --stat    # convert/mod.rs だけ。format.rs も expr/ も出てこないこと
```

- [ ] **Step 5: 赤確認（spec §5 の 4 件。実出力を報告に貼る）**

| # | 変異 | 期待 |
|---|---|---|
| 1 | `gal_imp` の係数を `gal_us` の値にする | 赤。**赤にならなければ Imperial のケースを 1 件も置いていない** |
| 2 | `jo` を `tsubo/2` にする（慣用に寄せる） | 赤。**慣用に寄せた瞬間に赤くなることを実物で見る** |
| 3 | `bit` の factor を `8` にする（逆数の取り違え） | 赤 |
| 4 | `kib` を `1000` にする | 赤（SI と IEC の分離） |

- [ ] **Step 6: コミット**

---

### Task 5: golden の下限と、境界のトークン一致

**Files:**
- Modify: `crates/calcarc-core/tests/convert_golden.rs`（**件数の下限だけ**）
- Modify: `web/src/convert/types.ts`（`CONVERT_CATEGORY_TOKENS` と `CONVERT_UNIT_TOKENS` を伸ばす）

**Interfaces:** Consumes Task 3 の golden、Task 4 の `Unit::ALL` / `Category::ALL`。

**`crates/calcarc-wasm/src/lib.rs` は変更不要**（`convert` / `convert_units` はトークン文字列で受けるので、
表が伸びれば自動で新カテゴリを返す）。**変更が要ると思ったら、まず理由を報告すること。**

- [ ] **Step 1: TS 側のトークンを伸ばす**

`web/src/convert/types.ts` の 2 つの配列に、**Rust と同じ並びで**追記する。
**綴りは `crates/calcarc-core/src/convert/mod.rs` の `token()` の実物から起こすこと**（手で写さない）。

- [ ] **Step 2: `token_parity` を走らせる**

```bash
cargo test -p calcarc-wasm --test token_parity
```
**赤くなったら並びか綴りがずれている。** U-1 の検査がそのまま新しい単位も覆う。

- [ ] **Step 3: 件数の下限を実測で埋める**

```bash
python3 -c "
import json; d=json.load(open('testdata/convert.json'))
ok=sum(1 for c in d['cases'] if 'error' not in c['expect'])
print('ok', ok, 'errors', len(d['cases'])-ok, 'total', len(d['cases']))"
```
出た数を `convert_golden.rs` の `assert!` に書く（**実測ちょうどを下限にする**。「だいたい」で書かない）。

- [ ] **Step 4: 赤確認（実出力を報告に貼る）**

**`web/src/convert/types.ts` の新しいトークンを 1 つ綴り違いにする** → `convert_unit_tokens_match…` が赤。
**`Unit::ALL` に足した並びを 2 つ入れ替える** → 同じテストが赤（**順序も契約**）。

- [ ] **Step 5: 走らせてコミット**

```bash
cargo test --workspace && wasm-pack test --headless --firefox crates/calcarc-wasm
cd web && pnpm typecheck && pnpm lint
```

---

### Task 6: 単位面（ラベル・読み上げ・カテゴリ）

**Files:**
- Modify: `web/src/ui/Keypad/convert.ts`
- Modify: `web/src/ui/Keypad/convert.test.ts`

**Interfaces:** Consumes Task 5 の `CONVERT_UNIT_TOKENS`。Produces Task 7 が測る面。

**`web/src/route.ts` は変更不要**（`CONVERT_CATEGORIES` は `convert/types.ts` から import している。
U-1 の Task 9 でそう決めた——**直書きすると誰も検査しない写しができる**）。**確認だけすること。**

**ラベル（spec §3）**——**トークンは記号を持たず、ラベルが持つ**（U-1 の裁定 1）:

| トークン | ラベル | | トークン | ラベル |
|---|---|---|---|---|
| `mm2` `cm2` `m2` `km2` | `mm²` `cm²` `m²` `km²` | | `gal_us` `gal_imp` | `gal(US)` `gal(Imp)` |
| `in2` `ft2` `yd2` | `in²` `ft²` `yd²` | | `floz_us` `floz_imp` | `fl oz(US)` `fl oz(Imp)` |
| `ha` `ac` | `ha` `ac` | | `pt_us` `pt_imp` | `pt(US)` `pt(Imp)` |
| `tsubo` | `坪` | | `qt_us` `qt_imp` | `qt(US)` `qt(Imp)` |
| `jo` | **`畳(1.62㎡)`** | | `cup_us` | `cup(US)` |
| `m3` | `m³` | | `cup_jp` | **`カップ(200mL)`** |
| `mps` `kmh` `mph` `kn` | `m/s` `km/h` `mph` `kn` | | `bit` `byte` | `bit` `byte` |

**カテゴリのラベル**: `面積` / `体積` / `速さ` / `データ量`。

**読み上げ名は日本語**（U-1 の Task 10 の判断）。`m²` を「エムに」と読ませない。
**21 + 42 = 63 件すべて相異なることを、既存のテストが見張る**（`gives every unit key a spoken name of its own`）。

- [ ] **Step 1: 失敗するテストを書く**

既存の 11 本は `CONVERT_UNIT_TOKENS` を回すので**そのまま新単位も覆う**。**足すのは 3 本**:

```ts
it("writes the basis into the name where the unit has more than one", () => {
  // spec §0.0-3・§3.2・§3.4: **基準が 1 つに定まらない単位は、名前に基準を書く。**
  expect(UNIT_LABELS.jo).toContain("1.62");
  expect(UNIT_LABELS.cup_jp).toContain("200");
  for (const t of ["gal_us", "floz_us", "pt_us", "qt_us", "cup_us"] as const) {
    expect(UNIT_LABELS[t]).toContain("US");
  }
  for (const t of ["gal_imp", "floz_imp", "pt_imp", "qt_imp"] as const) {
    expect(UNIT_LABELS[t]).toContain("Imp");
  }
});

it("never shows a bare cup or gallon", () => {
  // **裸の名前を使わない**（spec §3.4）。どの系か分からない表示を作らない。
  for (const label of Object.values(UNIT_LABELS)) {
    expect(label).not.toBe("cup");
    expect(label).not.toBe("gal");
    expect(label).not.toBe("畳");
  }
});

it("fits every category inside the frame", () => {
  // **単位に使えるのは左 3 列 × 5 行 = 15 スロット**（spec §0.0-4 の【訂正 2026-08-20】）。
  // **Volume はちょうど 15 で、容量いっぱいである。**
  for (const category of CONVERT_CATEGORY_TOKENS) {
    const rows = Math.ceil(unitsOf(category).length / 3);
    expect(rows, `${category} が 5 行に収まらない`).toBeLessThanOrEqual(5);
  }
});
```

- [ ] **Step 2〜4: 赤 → 実装 → 緑**

```bash
cd web && pnpm test convert && pnpm test && pnpm typecheck && pnpm lint
```

- [ ] **Step 5: 赤確認**

**Volume に 16 個目を足す**（使い捨て） → `fits every category inside the frame` が赤。
**これが赤にならなければ、訂正印が守るものが誰にも見張られていない。**

- [ ] **Step 6: コミット**

---

### Task 7: 実測、E2E、フルスイープ

**Files:**
- Modify: `web/tests/e2e/convert.spec.ts`（**1 本だけ広げる**。spec §5）
- Modify: `docs/superpowers/specs/2026-08-19-convert-categories-design.md`（§4 に【実測】）

- [ ] **Step 1: E2E を 4 カテゴリに広げる**

**spec §5 は「`pnpm e2e` は『面が枠に収まっているか』を見る 1 本だけ」と書いている**
——ロールの意味論は U-1 で固定済みで、ここは同じ機構の反復である。

既存の `swapping faces moves neither the frame nor DEL and AC`（**枠からの相対座標**版）の
`FACES` を **7 カテゴリ**に広げること。**番兵は 3 つとも維持**（`UNMEASURED` の印を使う。
**相対座標では `-1` は番兵に使えない**）。件数の下限も更新する。

- [ ] **Step 2: ラベルが長い単位を測る**

**spec §4 が要求している**:
> **ラベルが長い単位がある**（`fl oz(Imp)`、`カップ(200mL)`、`畳(1.62㎡)`）。
> **44px の高さは譲らず、面の中で文字を縮める**。実測して spec に追記する
> （U-0 §4 と同じ順序: まず gap、次に font-size）。

390×844 と 360×640 で、**Volume（15 単位・5 行）の面**を測る:
- **キーの最小辺が 44px を割っていないか**
- **ラベルがはみ出す / 折り返して 2 行になっていないか**
- 縮める必要があるなら **まず gap、次に font-size**（U-0 §4 の順序）

**撮って目で見ること**（`Read` ツールで画像を読める）。**リポジトリにコミットしない。撮ったら preview を落とす。**

- [ ] **Step 3: 数を書く**

spec §4 に【実測 2026-08-20】として、測った値と、縮めたなら何をどう縮めたかを残す。
**縦の予算も測る**（`#convert/volume` の 390×844 と 360×640）——`docs/definition-of-done.md` の
表に Convert の行が既に在るので、**7 カテゴリで最も重いものが表の値と変わるなら書き換える**。

- [ ] **Step 4: フルスイープ（ブランチ末尾の 1 回）**

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
wasm-pack test --headless --firefox crates/calcarc-wasm
cd reference && uv run --no-config pytest
cd reference && uv run --no-config python scripts/generate.py && cd .. && git diff --exit-code testdata/
cd web && pnpm test && pnpm typecheck && pnpm lint && pnpm e2e
```
完了記録に **「ローカル wasm = Firefox / CI = Chrome」** の 1 行。

- [ ] **Step 5: コミット**

---

## Self-Review（計画作成時に実施済み）

**1. spec の網羅**

| spec の節 | どのタスク |
|---|---|
| §0.0-1 エンジンに 1 行も足さない | Task 4（表だけ。`git diff --stat` で確認）、Task 5（wasm は変更不要） |
| §0.0-2 係数は定義値 | Task 2・4（両方が spec §3 の表から独立に書く） |
| §0.0-3 基準を名前に書く | Task 6（`writes the basis into the name…` / `never shows a bare cup or gallon`） |
| §0.0-4 16 個以内 | **Task 1 で訂正**（実物は 15。実測してから書く） |
| §1 坪と畳の両方 | Task 2・4。**畳は Task 1 の出典確認が通ってから** |
| §2 カテゴリと単位数 | Task 2・4（件数を `toBe` で固定）、Task 6（`fits every category inside the frame`） |
| §3.1〜§3.6 表 | Task 2・4 |
| §3.2 畳の基準 | **Task 1（一次情報の確認が門番）**、Task 6（ラベルに `1.62`） |
| §3.3 坪 ≠ 2 畳 | Task 2・3・4（`20000/9801`。**丸めて 2 に見せない**）、赤確認 2 |
| §4 盤面・長いラベル | Task 6・7（**実測して spec に追記**） |
| §5 golden の名指しケース | Task 3（表を 1 行ずつ写す） |
| §5 赤確認 4 件 | Task 4 |
| §5 段付け（e2e は 1 本だけ） | Task 7 |
| §6 スコープ外 | どのタスクにも登場しない（第 2 段階・240 mL カップ・畳の地域差・`bbl`/`石`/`合`） |

**2. この計画が自分で決めたこと**（実装者は変えてよいが、変えたら報告に書くこと）

- **裁定 1**: トークンは ASCII 小文字、系は `_us` / `_imp` の接尾辞（`gal_us`）。**括弧はラベルだけが持つ**
- **`Unit::ALL` は U-1 の 21 個の後ろに足す**（既存の並びを 1 つも動かさない）
- **`web/src/route.ts` と `crates/calcarc-wasm/src/lib.rs` は変更不要**（確認だけ）
- **畳が入らなかった場合、§3.3 は主張そのものが消える**——spec の書き換えまで Task 1 の範囲

**3. 型の一貫性**

`Category::{Area, Volume, Speed, DataSize}`、`Unit::{Mm2, …, Pib}`（Rust）、
`CATEGORIES["area"|"volume"|"speed"|"data-size"]`（Python）、
`CONVERT_UNIT_TOKENS` / `CONVERT_CATEGORY_TOKENS` / `UNIT_LABELS` / `CATEGORY_LABELS` / `unitsOf`（TS）
——Task 2 → 3 → 4 → 5 → 6 → 7 の消費側で綴りが一致していることを確認した。

**4. U-1 から引き継いだ検査の作法**（この計画にも効く）

- **plan の逐語コードより spec が優先**（U-1 Ruling 1）
- **「値」ではなく「テストに書かれている式そのもの」を評価する**（U-1 Ruling 2）
- **名指しケースの値を打つのに要るキーを 1 文字ずつ数える**（U-1 Ruling 10）
  ——**U-2 の名指し値はすべて既存のキーで打てる**（数字・`.` のみ。新しいキーは要らない）ことを確認済み
- **赤確認は「どの検査が赤くしたか」まで見る**（U-1 Ruling 8）

# 金融とデータスケールを検証する（段階 F）設計

2026-08-17

前提: [重量級検証コーパス（Layer 6）設計](2026-08-15-heavy-corpus-e2e-design.md)。

## 1. なぜやるか

**このコーパスは電卓の 3 領域のうち 1 つしか見ていない。**

| 領域 | 公開関数 | いまの被覆 |
|---|---|---:|
| `scientific` | 三角・逆三角・対数・冪・組合せほか | 12000 件 |
| `data_scale` | `size_in_bytes` `format_binary` `format_decimal` `parse_count` | **0** |
| `finance` | `grow` `deposit_for` `periods_for` `monthly_payment` `run_schedule` `term_for` `principal_for` `withholding` ほか | **0** |

レポートの判定表は、この事実をいま `検証していない` として出している。
**「正しい」でも「間違っている」でもなく、何も言えていない。**

**金融がいちばん大きく間違いうる。** 桁が大きく（円単位で数億まで）、丸めの慣行があり、
反復計算があり、逆算（二分探索）がある。**「桁あふれで全然違う数値」が出るとすれば
まずここである。**

## 2. 使えるものが既にある（コードから確認、2026-08-17）

**独立実装は書く必要がない。存在する。**

| 参照実装 | 入口 | 数の持ち方 |
|---|---|---|
| `reference/src/calcarc_reference/compound_ref.py` | `compute(op, params) -> dict` | **Python の整数**と `Decimal` |
| `reference/src/calcarc_reference/loan_ref.py` | `compute(op, params) -> dict` | 同上 |
| `reference/src/calcarc_reference/data_scale_ref.py` | `compute(count, dimensions, dtype) -> dict` | 同上 |

**これらは Rust の移植ではない。** Rust 側は f64 と u64 で計算するが、参照側は
Python の任意精度整数と `Decimal` で計算する。`compound_ref` には
`closed_form`（`Decimal` の閉じた式）と `check_against_closed_form` があり、
**反復と閉じた式の 2 通りで自分を検算している。**

wasm 境界も揃っている（`crates/calcarc-wasm/src/lib.rs`）:
`data_scale` / `loan_forward` / `loan_principal` / `loan_term` /
`loan_bonus_forward` / `loan_bonus_principal` / `compound_grow` /
`compound_deposit_for` / `compound_periods_for`。

**足りないのはコーパスと、それを流す経路だけである。**

## 3. 設計

### 3.1 ケースの形が科学計算と違う

科学計算のケースは「キー列 → 表示」だが、こちらは **「関数と引数 → 構造体」**である。

```json
{
  "kind": "call",
  "id": "fin-000000",
  "op": "compound_grow",
  "params": {"principal": "1000000", "deposit": "30000", "rate": "0.5",
             "periods": 120, "periods_per_year": 12, "taxed": true},
  "expect": {"final": "4703216", "interest": "103216", "tax": "20955"}
}
```

- `kind` に **`call`** を新設する（既存は `value` と `equivalence`）
- `params` と `expect` は**文字列と整数の辞書**。浮動小数を持たない
- **期待値は厳密一致で比べる。** 円もバイト数も整数なので、許容誤差の出る幕がない

### 3.2 厳密一致であることが、この領域の判定を強くする

科学計算の判定は「表示 10 桁が一致するか」で、`rel = 5e-10` より細かい差は
**主張できない**。この領域にはその制約が無い——**1 円違えば違うと言える。**

したがって判定の階梯もこの領域では単純になる:

| 判定 | 条件 |
|---|---|
| **完全に正しい** | 全件が厳密に一致 |
| **間違っている** | 1 件でも違う |

**中間が無い。** 「ある程度正しい」は表示分解能の話なので、整数の領域には存在しない。
`多少疑問がある` も同様。**これは階梯を弱めるのではなく、強める。**

### 3.3 UI を通さない。まず計算コアを見る

wasm の関数を直接呼ぶ。ボタン操作は段階 4（UI 経路）の主題で、そちらは別に立てる。
**この段階が答えるのは「計算が合っているか」だけ**である。

`web/src/heavy-harness.ts` を拡張して、`data_scale` / `loan_*` / `compound_*` を
呼べるようにする。**`web/src/calc/` は触らない**——あれは UI が使う境界で、
検証専用の入口を開けると本番の面が広がる。harness はこのブランチ自身のファイルである。

### 3.4 エラーもケースとして持つ

金融は**入力の検証が仕事の一部**である（`parse_yen` が桁を弾く、金利が範囲外、
期間が 0、元本より残価が大きい…）。参照実装は `CompoundError` / `LoanError` を投げ、
Rust 側は構造体の `error` フィールドに名前を返す。

**エラーになること自体が仕様なので、期待値として持つ。**

```json
{"kind": "call", "id": "fin-000123", "op": "loan_term",
 "params": {...}, "expect": {"error": "DoesNotClear"}}
```

これは科学計算の段階 3b-E（エラー経路）で `expect` の拡張が要ると書いた話と同じ
問題だが、**こちらは最初からそう作る**。後から足すより安い。

### 3.5 生成の分布は、実際に人が入れる値から決める

乱択の帯を「f64 が壊れるところ」に寄せない。**金融の入力には現実的な範囲がある**——
元本は数十万〜数億円、金利は 0〜20%、期間は 1〜480 か月。
**その帯を主にし、境界（0 円、上限桁、金利 0%、期間 1）を別に必ず入れる。**

境界は乱択に任せない。**名指しで列挙して全部入れる**——乱択は境界をほぼ引かない
（別セッションが「無作為抽出は中心二項係数を取りこぼす」と実測している）。

## 4. やらないこと

- **UI を通らない**（§3.3）。段階 4 の主題
- **参照実装を書き直さない。** 既にあるものを使う。書き直せば移植の危険が生まれる
- **`web/src/calc/` を触らない**（§3.3）
- **科学計算のシャードに手を入れない**

## 5. 要件

- **R1** `kind: "call"` を新設し、`op` / `params` / `expect` を持つ
- **R2** 期待値は `compound_ref` / `loan_ref` / `data_scale_ref` の `compute` から取る。
  **Rust の実装を読んで書かない**
- **R3** 比較は**厳密一致**。許容誤差を使わない
- **R4** エラーを期待値として持つ（`expect.error` に名前）
- **R5** 生成の帯は現実的な入力範囲。**境界は名指しで列挙して全部入れる**
- **R6** `web/src/heavy-harness.ts` だけを拡張する。`web/src/calc/` を触らない
- **R7** レポートの判定表で `finance` と `data_scale` が
  `検証していない` から実際の判定に変わる
- **R8** 再生成一致ゲートの対象に含める

## 6. リスク

- **`expect` の形が op ごとに違う。** `compound_grow` は `{final, interest, tax}`、
  `loan_term` は `{months, total}` のように、返る構造体が違う。
  **op ごとに形を決め打ちせず、参照実装が返した辞書をそのまま持つ**のが安全。
  比較も辞書ごと行う
- **Rust と Python で辞書のキー名が違う可能性。** wasm が返す JSON のキーが
  参照実装のキーと一致する保証はない。**実装の最初に 1 件流して見比べる。**
  食い違ったら、対応表を harness 側に置く（参照側を Rust に合わせて書き換えない）
- **境界の列挙が漏れる。** 「全部入れた」は grep で確かめられない類の主張である。
  参照実装が投げるエラーの種類を数え上げ、**各種類が少なくとも 1 件出ている**ことを
  テストで固定する（段階 3b-A で `OutOfShard` の文言を数え上げたのと同じ作法）

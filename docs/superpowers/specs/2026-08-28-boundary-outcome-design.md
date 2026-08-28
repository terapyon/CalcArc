# WASM 境界の結果型を 2 択にする（設計書）

対象: `crates/calcarc-wasm` が返す**結果型**と、それを受ける `web/src/*/types.ts`。

**訂正印（2026-08-28）: 「10 個」は誤り。実際は 12 個である**（`error: Option<…>` を持つ
struct を grep で数え直した——Loan 5 / Compound 2 / DataScale / Llm / Expr / Convert /
ConvertUnits。`CurrencyUnitsResult` は `error` を持たないので対象外）。
**私が数えずに書いた。** 実装役が段階 2 の途中で「spec は 10、計画の表は 9 行、実際は 12」と
突き合わせて見つけた。**表や本文の数を根拠に使わないこと——現物を grep すること。**
測ったのは `origin/main` = `3f2affe`（v0.5.0）。

**base-spec §27 の原則「計算エラーは戻り値の一部」は変わらない。** 変えるのはその**形**である。

## §0 いま何が起きているか

境界の結果型は 10 個あるが、**10 種類ではない。1 種類 × 10 通りの中身**である。
すべてが「N 個の payload `Option` ＋ `error: Option<CalcError>`」の形をしている。

```rust
struct LoanBonusForwardResult {
    monthly_payment: Option<String>,   bonus_payment: Option<String>,
    bonus_rows: Option<u32>,           total_payment: Option<String>,
    total_interest: Option<String>,    monthly_final_payment: Option<String>,
    bonus_final_payment: Option<String>,
    error: Option<CalcError>,
}
```

**この型が「ありうる」と言っている状態は 256 通り。実際に起きるのは 2 通り**——成功
（payload が全部在って error なし）か、失敗（payload が全部 null で error あり）。
**残り 254 通りは無意味だが、型は許す。**

### 無効な状態が生まれる場所は 1 箇所だけ

```rust
let outcome: CalcResult<String> = (|| { ... })();   // ← ここまでは 2 択。正しい
let result = match outcome {
    Ok(text) => ConvertResult { text: Some(text), error: None },
    Err(e)   => ConvertResult { text: None,       error: Some(e) },
};                                                  // ← ここで潰している
```

**正しい形（`Result`）はすぐ上に在って、境界を渡るためだけに潰されている。**

### それが消費側に及ぼしていること

`FinancePanel.tsx` は**値とエラーを別々の場所で読んでいる**。

```ts
// :594  値を取る
function settle(field: FinanceField): string | null {
  if (field === "rate") return expr.percent(typed).value;   // ← .error を見ていない
  return expr.integer(typed, max, unitSet).value;
}
// :651  エラーは別の場所でまとめて集める
let error = orderFor(mode).filter(...).map(f => settleResult(f).error).find(e => e != null) ?? null;
```

`settle()` は `.value` だけを取り、`.error` を一度も見ない。「エラーは 651 行目で別に
集めているから大丈夫」という**前提の上に立っている**。その前提はいま正しいが、
**型は何も保証していない**。651 行目のフィルタが 1 つ取りこぼせば、
`settle()` は**失敗した計算の値をそのまま返す**。

**`.value` を読むのに `.error` を確かめる義務が、型に無い。**

## §1 決めたこと（ユーザー裁定 2026-08-28）

| # | 決定 |
|---|---|
| **①** | **総称を 1 つ置く。** ただし**名前は 10 個そのまま残す**（総称の実体化に名前を付ける） |
| **②** | **内側 tag。** `{kind:"ok", ...payload}` / `{kind:"error", code:"…"}` |
| **③** | **spike で serde の挙動を確かめてから**、payload がいちばん広いものから着手 |
| **④** | **エラーの絞りに番人を付ける**（下記 §5） |

**対象は計算結果の 10 個だけ。`DisplayState` は触らない**（§6）。

## §2 spike の結果（2026-08-28、実測）

**①②とも通る。代案は要らない。** 実ブラウザの `serde_wasm_bindgen` が吐いた実物:

```
{"kind":"ok","monthlyPayment":"85000","bonusPayment":"120000","bonusRows":40,
 "totalPayment":"36000000","totalInterest":"6000000",
 "monthlyFinalPayment":"84999","bonusFinalPayment":"119998"}

{"kind":"error","code":"Overflow"}
```

| 問い | 答え |
|---|---|
| いまの `JsValue` 化 | `serde_wasm_bindgen::Serializer` + `serialize_missing_as_null(true)`（0.6） |
| 総称 enum はコンパイルを通るか | **通る。`T: Serialize` だけで足りる** |
| 内側 tag ＋ newtype variant が平らに並ぶか | **並ぶ。`#[serde(flatten)]` は要らない** |
| payload 7 フィールドで詰まらないか | **詰まらない** |
| `CalcError` は `"Overflow"` の形で出るか | **出る。いまの `error` フィールドと同じ綴り** |

**2 段階で測ってある**——`serde_json` のデータモデルで形を確かめ、そのうえで
**本番の `serde_wasm_bindgen` が同じ文字列を吐くことを実ブラウザで assert** した。
**「serde が吐く形」と「wasm 境界が吐く形」は別の問い**である。
assert が噛むことも確認済み（期待値を `"OVERFLOW"` にすると落ちる）。

隣接 tag（`{"kind":"ok","data":{…}}`）も測ったが、**②が通ったので使わない。**

## §3 型の形

### Rust

```rust
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Outcome<T> {
    Ok(T),
    Error { code: CalcError },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]     // ← §4 の落とし穴。payload 側にも要る
struct LoanBonusForward {
    monthly_payment: String,           // ← Option ではない
    bonus_payment: String,
    bonus_rows: u32,
    /* … */
}
```

**payload の `Option` が消えるのは、それが「失敗したから無い」を表していた場合だけである。**
**本当に任意のフィールドが在れば `Option` のまま残す**——実測して、
残すものが在るなら段階 1 の報告に挙げること。いまの 10 個は
**すべて潰しのために `Option` になっている**と読めるが、確かめていない。

**境界の 10 個の `match` が、総称 1 つの変換に畳まれる**（`From<CalcResult<T>> for Outcome<T>` を 1 つ書く）。

```rust
// 変更前: 10 個それぞれに match が在った
// 変更後:
let result: Outcome<LoanBonusForward> = outcome.into();
```

### TypeScript

```ts
export type Outcome<T, E> = ({ kind: "ok" } & T) | { kind: "error"; code: E };

// 名前は 10 個そのまま残る
export type LoanBonusForwardResult = Outcome<
  { monthlyPayment: string; bonusPayment: string; bonusRows: number; /* … */ },
  LoanErrorCode
>;
export type ConvertResult = Outcome<{ text: string }, Extract<CalcErrorCode, "SyntaxError">>;
```

**規約は 1 箇所、名前は 10 個。** 読む側は `LoanBonusForwardResult` を今までどおり使えて、
**「ok なら payload が全部揃っている」という不変条件は 1 回しか書かれていない。**

**10 個を手で書かないのは、11 個目を書く人が写し間違えられるからである。**

### 消費側がどう変わるか

```ts
// 変更前
return expr.integer(typed, max, unitSet).value;      // .error を見ないまま書ける

// 変更後
const r = expr.integer(typed, max, unitSet);
if (r.kind === "error") return null;
return r.value;                                      // ここでは value が必ず string
```

**「エラーを確かめ忘れる」が書けなくなる。** そして成功側では `| null` が消えるので、
`?? ""` のような防御も要らなくなる。

## §4 落とし穴: `rename_all` は 2 か所が別々に効かせている

**spike で判明した（実測）。**

- enum の `rename_all` が決めるのは **tag の値**（`Ok` → `"ok"`）
- **payload のフィールド名**（`monthlyPayment`）を決めているのは **payload 構造体自身の `rename_all`**

**「enum に付ければ payload まで揃う」ではない。** いまの 10 個の構造体はすべて
`#[serde(rename_all = "camelCase")]` を持っているのでそのまま効くが、
**新しい payload を足す人が構造体側を忘れると `monthly_payment` のまま出る。**

**これは「宣言されているが機械が見ていない」の新しい 1 件になりうる。**
**番人を置く**——payload 構造体が `camelCase` を宣言していることを、
wasm のテストが実際の JSON で見る（§5 の番人と同じ場所でよい）。

## §5 ④ エラーの絞りに番人を付ける

TS 側は**関数ごとにエラーを絞っている**が、**Rust 側は全部 `CalcError` で絞っていない。**

```ts
error: Extract<CalcErrorCode, "SyntaxError"> | null                  // convert
error: Extract<CalcErrorCode, "Overflow" | "SyntaxError"> | null     // datascale
```

**「この関数は SyntaxError しか返さない」は TS 側の手書きの主張**で、Rust は何も
保証していない。**Rust が別のエラーを返し始めても、TS の型は嘘をついたまま通る。**

**Rust に関数ごとのエラー型を持たせるのは重い**（core まで波及）。**TS の絞りをやめる**
のは情報を捨てる。**採るのは 3 つ目**——

**各関数が実際に返しうるエラーを列挙し、TS の `Extract<…>` と突き合わせる番人を置く。**
`token_parity.rs` が `KEY_TOKENS` と `Key::ALL` に対してやっているのと同じ形。

## §6 触らないもの

**`web/src/calc/types.ts` の `DisplayState`。** あれは「結果」ではなく**表示の状態**で、
`echo` `main` `angle` `form` `notation` `pendingOp` `pendingDepth` `error` が並ぶ。
**`Math ERROR` のとき `main` に文字列が入り、同時に `error` も立つ**——両方が意味を持つ。
**判別可能 union にすると、かえって嘘になる。**

**日付の付いた過去の spec と plan。** `api-cleanup`（2026-08-12）ほかは**記録**であり、
**この設計書から参照するだけで、書き換えない**（ユーザー裁定 2026-08-28）。
書き換えるのは日付の無い文書（`base-spec.md` の §27 の**形**の記述）だけで、
**原則の文言は変えない。**

## §7 段階の切り方

**spike が通ったので、payload がいちばん広いものから。**

1. **`LoanBonusForward`（payload 7）** — 総称と番人をここで確立する。
   **7 で通れば残りは確実に通る**
2. **残り 9** — 同じ変換の繰り返し

**1 つ目で「思ったより厄介だ」と分かったら、そこで止められる。**

## §8 テストの当て方

- **境界の JSON を実ブラウザで固定する**（`wasm-pack test`）。spike と同じ形で、
  **成功と失敗の両方**の実物の文字列を assert する
- **消費側**: 「`kind` を見ずに payload を読むコードが書けない」ことは**型が保証する**ので、
  テストで主張する必要はない。**テストが主張するのは、両方の枝が実際に通ること**
- **§4 の番人**: payload 構造体の `camelCase` 宣言漏れを、実際の JSON で捕まえる
- **§5 の番人**: 各関数が返しうるエラーと TS の `Extract<…>` の一致
- **赤確認**: 総称の `Ok`/`Error` を取り違える変異、`rename_all` を外す変異、
  絞りを 1 つ広げる変異——**それぞれが別のテストを落とすこと**

## §9 完了条件

1. **12 個**すべてが `Outcome<T>` になり、**payload の `Option` のうち
   「失敗したから無い」を表していたものが消えている**

   **訂正印（2026-08-28）**: 元の文言は「payload から `Option` が消えている」だった。
   **loan 系 5 個だけを見て書いた文言で、誤り。** `Compound`/`CompoundInverse` の
   税 3 フィールド（税 OFF のとき無い）と `ByteLines` の `decimal`/`binary`
   （1000/1024 bytes 未満に単位が無い）は**本当に任意**で、消すと嘘になる。**§3 が優先。**

   **そして本当の完了条件は、残した `Option` が「いつ null になるか」を機械が見ていること**である
   ——実装役が `web.rs` に「税ありなら null は 1 つも出ない／税なしならこの 3 つだけ」
   「1 / 1000 / 1024 bytes の 3 点で `decimal` と `binary` の境目が別々」を名指しで固定した。
   **曖昧な規則を、検査できる主張に変えてある。**
2. **境界の `match` が 10 個から総称 1 つに畳まれている**
3. TS 側の 10 個の名前が残り、**`| null` が payload から消えている**
4. §4 と §5 の番人が在り、**それぞれ赤確認が取れている**
5. `DisplayState` が変わっていない
6. 既存のテストが全層で緑（`cargo` / `wasm-pack` / `vitest` / `pytest` / E2E / heavy）

## §10 この設計書が言えないこと

**消費側の書き換え量を測っていない。** `kind` の判定を足す箇所が何か所になるかは、
段階 1 を通してから数える。**§7 の「1 つ目で止められる」はそのためにある。**

**`Outcome<T>` が読みにくくなるかも測っていない。** TS の交差型
（`{kind:"ok"} & T`）はエラーメッセージが読みにくくなることがある。
**段階 1 で実際に書いてみて、耐えられなければ ① に戻る。**

# Heavy corpus 改善 A — 欠陥注入の測定基盤

改善指示書（2026-08-17 受領、全 12 節）のうち **§4 全体**を担う。指示書は 3 分割の
1 本目として実装する（A / B+C / D+E）。

- **A（この設計書）** — §4。測定の土台。
- **B+C** — §5 Finance コーパスの層別再生成、§9 再現性、§6 Finance 変異 10 種。
- **D+E** — §7.5〜7.7 と §8 Heavy UI、§3.2/3.4/3.6 レポート。

A を先に置くのは、**いま「緑の意味」が保証されていない唯一の箇所**だからである。
B〜E が足す測定はすべて A の判定の上に乗る。

## 1. 何が壊れているか（実測）

基準は `b223bde`（指示書の基準 `796f522` の後、PR #54 が入った状態）。

`web/scripts/detection-power.mjs` の `measure()` は `pnpm heavy` の **stdout を
正規表現で舐めている**。

```js
const pattern =
  /every (?:case|call|display) in ([\w.-]+) matches the reference[\s\S]{0,400}?(\d+) of (\d+) (?:cases|calls|displays) disagree/g;
```

この 1 本の正規表現から、次の 3 つが**同じ結果に潰れる**。

| 実際に起きたこと | `measure()` が返すもの |
|---|---|
| 変異が入ったが、どのシャードも気づかなかった | `{}` |
| wasm のビルドが失敗し、テストが 1 本も走らなかった | `{}` |
| ブラウザが起動せず、Playwright が即座に落ちた | `{}` |

`verdictFor` は `expectation === "nothing"` のとき `shards.length === 0` だけを見る
（`detection-power.mjs:127`）。したがって **ビルド失敗は「何も検出されなかった」
として緑になる**。指示書 §4.2 が名指しで禁じている誤成功である。

同じ理由で、**落ちなかったシャードは存在すら見えない**。不一致件数は失敗
メッセージからしか出てこないので、「期待したシャードがそもそも読み込まれたか」を
測る材料が無い。

さらに `every value shard` の判定は `shards.length >= 3`（`detection-power.mjs:207`）
である。最後に記録された実測（`web/detection-power.json`、2026-08-17 17:10）では
`display-digits` に **10 枚**が反応しているが、その内訳は次のとおりで、

- 値シャード **8 枚**（angle-mode / combinatorics / complex / elementary /
  inverse-trig / precedence / scientific / typed）
- 表示シャード **2 枚**（complex-display / display）
- **反応しなかった値シャード 1 枚**（cancellation）

「値シャードすべて」という名前と実物が一致していない。`>= 3` はこの食い違いを
一度も見ていない。

`try/finally` による原状回復（バイト一致つき）は既にあるが、`finally` が包んで
いるのは `measure()` だけで、**判定 `verdictFor` はその外にある**
（`detection-power.mjs:243-253`）。判定側で例外が出た場合の復元はテストされて
いない。指示書 §4.5 が求める 3 つのテストは 1 つも無い。

## 2. 目的

1. **測定が失敗したことを、検出が無かったことと区別する**（指示書 §4.1、§4.2）。
2. **どのシャードが反応すべきかを名指しし、完全一致で検査する**（§4.3）。
3. **検出の量に下限を置き、静かな劣化を赤くする**（§4.4）。
4. **原状回復を、成功・失敗・解析例外のすべてで保証し、テストで見張る**（§4.5）。

## 3. 非目標

- 変異の一覧を増やさない。Finance の 10 種は B+C の担当である。
- レポート（`heavy-report.md`）の本文を書き換えない。§3 は D+E の担当。
  ただし本設計が新設する `heavy-run.json` は、D+E がレポートの材料として使う。
- 許容誤差・判定名・コーパスの中身を変えない。
- `heavy:power` を CI の必須ゲートにしない（指示書 §2）。

## 4. 設計

### 4.1 走行を 3 段に分解する

`pnpm heavy` は `pnpm wasm && playwright test --config playwright.heavy.config.ts`
の合成である。合成のまま呼ぶ限り、**ビルド失敗とテスト失敗は同じ非ゼロ終了**に
なる。`detection-power.mjs` は 2 つを別々に呼ぶ。

1. **ビルド段** — `pnpm wasm`。非ゼロ終了なら `buildOk = false`。
   この段で止まったら、以降の判定は一切行わず**測定失敗**として赤くする。
2. **走行段** — `playwright test --config playwright.heavy.config.ts`。
   終了コードをそのまま保持する（`playwrightExitCode`）。
   ブラウザ起動失敗はここで非ゼロ、かつテスト 0 本という形で現れる。
3. **読み取り段** — `web/heavy-run.json` を読む。

### 4.2 `heavy-run.json` — 走行 1 回ぶんの機械可読な要約

`report.ts` は既に `web/.heavy-summaries/` に **1 シャード = 1 枚**の JSON を
書いている（`record()`）。`globalSetup` の `resetRun()` が走行のたびに消して
作り直すので、**走行後にそこにある枚数が、実際に読み込まれたシャードである**。

しかしこれは `report.ts` の内部形式であり、測定側から直接読むと結合が生まれる。
`globalTeardown` が `heavy-report.md` を書くのと**同じ場所で**、機械可読な 1 枚を
書き足す。

```jsonc
{
  "schema": 1,
  "ranTests": true,          // シャードの集計が 1 枚でも書かれたか
  "shards": [
    {
      "name": "elementary-000.json (values)",  // summaryName() の出力
      "total": 2000,
      "mismatches": 1210
    }
    // …実際に走ったシャードだけが並ぶ
  ]
}
```

- **名前は `summaryName()` が組み立てたものをそのまま使う。** 種別（values /
  equivalences / calls / displays）まで含んだ文字列が、このプロジェクトにおける
  シャードの同一性である。測定側が `.json` の素の名前へ落とし直すと、
  「名前を 2 か所で組み立てる」という既に踏んだ壊れ方に戻る（`report.ts:186`
  のコメントが記録している F9）。
- **`mismatches` は件数（数）にする。** 全文は `.heavy-summaries/` にある。
- `globalTeardown` は**テストが落ちても必ず 1 度だけ走る**。したがって
  「`heavy-run.json` が無い」＝ **レポート生成にすら到達しなかった**、という
  一意な意味を持つ（指示書 §4.1 の「レポート生成失敗の区別」）。

### 4.3 `measure()` が返すもの

```ts
{
  buildOk: boolean,            // §4.1 の 1 段目
  playwrightExitCode: number,  // §4.1 の 2 段目（走らなかったときは null）
  runJsonFound: boolean,       // §4.1 の 3 段目
  ranTests: boolean,           // heavy-run.json の ranTests
  shardsSeen: string[],        // 実際に読み込まれたシャード（summaryName 形式）
  mismatchesByShard: Record<string, number>,  // 0 件のシャードも載る
}
```

**`mismatchesByShard` には不一致 0 のシャードも入れる。** いまは「落ちたシャード
だけが見える」ので、0 件と未実行が区別できない。この 1 点が §4.2 の誤成功の根である。

### 4.4 変異の宣言

`MUTATIONS` の各項目に、文字列の `expect` に代えて次を持たせる。

```js
{
  id: "ncr-multiply-first",
  what: "…",
  file: "…", from: "…", to: "…",
  // **反応すべきシャードの集合。完全一致で照合する。**
  expectShards: ["combinatorics-000.json (values)"],
  // シャードごとの検出率の下限。分母は heavy-run.json の total。
  minRate: { "combinatorics-000.json (values)": 0.0025 },
}
```

- `expectShards: []` が「どこも反応しないはず」を表す（現在の `"nothing"`）。
- **`minRate` に載っていない期待シャードは、暗黙に「最低 1 件」**とする。
  率が 0 に近い薄い帯（`ncr-multiply-first` の 10/2000 = 0.5%）を率だけで
  縛ると、丸めの都合で 0 件が通ってしまう。

**全変異が、全シャードの読み込みを要求する。** 変異ごとの宣言ではなく、
`ALL_SHARDS`（15 枚の `summaryName()` 文字列）を 1 か所に置き、すべての変異で
`shardsSeen === ALL_SHARDS` を検査する。

理由——**「反応すべき集合の完全一致」は、反応しないはずのシャードが実際に
読み込まれて初めて意味を持つ**。1 枚も読み込まれなかった走行では
`precedence-collapse` の照合が「空集合 === 空集合」ではなく「期待 1 枚に対して
実測 0 枚」で赤くなるが、`associativity-flip` は空同士で緑になる。逆に
14 枚だけ読み込まれた走行では、欠けた 1 枚が反応していたかどうかを誰も知らない
まま `precedence only` が緑になる。**読み込みの検査を変異ごとの都合にすると、
この穴が変異の数だけ空く。**

### 4.5 判定

`verdictFor` を次の順で評価する。**先に測定の健全性を見て、そのあとで検出を見る。**

1. `buildOk` が false → **測定失敗**（赤）。「検出なし」とは書かない。
2. `runJsonFound` が false → **測定失敗**（赤）。レポート生成に到達していない。
3. `ranTests` が false → **測定失敗**（赤）。テストが 1 本も走っていない。
4. `shardsSeen !== ALL_SHARDS`（順序を無視した完全一致）→ **測定失敗**（赤）。
   **これはすべての変異に等しく掛かる**（§4.4 の後半を見よ）。読み込まれて
   いないシャードがある走行は、検出の有無を語る資格がない。
5. `expectShards` が空（`nothing` 期待）:
   - `playwrightExitCode === 0` かつ全シャードの不一致合計が 0 → 緑。
   - それ以外 → 赤。**この場合だけ、赤の理由は「レポートの主張が嘘だった」**
     である（1〜4 の赤とは意味が違うので、文言を分ける）。
6. 実際に不一致を出したシャードの集合 `=== expectShards`（順序を無視した完全一致）。
   一致しなければ赤。過剰反応も不足も同じ重さで扱う。
7. 各期待シャードについて `mismatches >= max(1, ceil(total * minRate))`。
   満たさなければ赤。

判定名（`ok` / `NG`）と `detection-power.json` の形は保つが、**失敗の理由に
`kind` を持たせる**: `"measurement-failed"` / `"claim-was-false"` /
`"shard-set-mismatch"` / `"below-min-rate"` / `"caught-nothing"`。
D+E がレポートに出すときに、この 5 つを区別できる必要がある。

### 4.6 `expectShards` と `minRate` の初期値

**下は 2026-08-17 17:10 の走行（`web/detection-power.json`）の実測である。**
`minRate` は実測率の半分を初期値とし、実装時に**再測定して確定する**。
（この記録はコーパス最終形の直前に取られた可能性がある。実装の最初の作業は
`pnpm heavy:power` を 1 回回して現在値を取り直すことである。）

| 変異 | 反応したシャード | 検出 / 件数 | 実測率 | `minRate` 初期値 |
|---|---|---|---|---|
| `display-digits` | angle-mode (values) | 1017 / 2000 | 50.85% | 0.254 |
| | combinatorics (values) | 1187 / 2000 | 59.35% | 0.296 |
| | complex (values) | 381 / 2000 | 19.05% | 0.095 |
| | elementary (values) | 1210 / 2000 | 60.50% | 0.302 |
| | inverse-trig (values) | 732 / 2000 | 36.60% | 0.183 |
| | precedence (values) | 978 / 2000 | 48.90% | 0.244 |
| | scientific (values) | 796 / 2000 | 39.80% | 0.199 |
| | typed (values) | 889 / 2000 | 44.45% | 0.222 |
| | complex-display (displays) | 334 / 2001 | 16.69% | 0.083 |
| | display (displays) | 415 / 2000 | 20.75% | 0.103 |
| `precedence-collapse` | precedence (values) | 1099 / 2000 | 54.95% | 0.274 |
| `ncr-multiply-first` | combinatorics (values) | 10 / 2000 | 0.50% | 0.0025 |
| `eng-exponent-toward-zero` | display (displays) | 96 / 2000 | 4.80% | 0.024 |
| `sexagesimal-no-carry` | display (displays) | 10 / 2000 | 0.50% | 0.0025 |
| `complex-multiply-sign` | complex (values) | 147 / 2000 | 7.35% | 0.036 |
| `polar-angle-flipped` | complex-display (displays) | 661 / 2001 | 33.03% | 0.165 |
| `associativity-flip` | （無し） | 0 | — | — |

**`display-digits` の期待集合は 10 枚であって「値シャードすべて」ではない。**
`cancellation-000.json (values)` は値シャードだが反応していない。この事実は
`expectShards` に**書かない**ことで固定される——書けば赤くなる。なぜ反応しない
かは実装時に確かめ、設計書のこの節に追記する（現時点の推測は書かない）。

`associativity-flip` の `expectShards` は空だが、§4.4 の `ALL_SHARDS` 検査は
他の変異と同じく掛かる。「結合方向を反転しても、どのシャードも気づかない」と
いう主張は、**全部が読み込まれた走行でしか成り立たない**。

なお `associativity-flip` の期待は **D+E で `nothing` から対象シャードへ反転する**
（指示書 §7.7）。A ではその形を作るだけで、期待そのものは動かさない。

### 4.7 原状回復とテスト可能性

`detection-power.mjs` はトップレベルで走り切る 1 本のスクリプトで、単体テストが
書けない。次の 3 つを export に切り出す。

- `MUTATIONS`
- `verdictFor(mutation, measurement)` — 純関数。I/O を持たない。
- `runOneMutation(mutation, { measure })` — 変異の適用・`measure` の呼び出し・
  判定・**復元**を 1 まとまりにする。`measure` を差し替え可能にすることで、
  例外を投げる `measure` を渡してテストできる。

**`try/finally` の範囲を判定まで広げる。** いまは `measure()` だけを包んでいる。
`runOneMutation` の `finally` で復元し、バイト一致を確かめる。

（実装時追記、Task 6）旧 `main()` の実測では判定(`verdictFor`)の呼び出しは
`finally` を**抜けたあと**にあり復元は判定より前に必ず終わっていたので、
ここでの `finally` の拡張は既知の欠陥の修正ではなく、将来の並べ替えに対して
壊れない構造への固定である。

エントリポイント（`MUTATIONS` を回して JSON を書き、wasm を作り直す部分）は
`import.meta.url` のガードの下に置き、テストから import しても走らないようにする。

## 5. 変更するファイル

| ファイル | 変更 |
|---|---|
| `web/tests/heavy/report.ts` | `heavy-run.json` を書く関数を追加。`writeReport()` と同じ材料（`.heavy-summaries/` の読み出し）を使う |
| `web/tests/heavy/global-teardown.ts` | `writeReport()` に加えて `writeRunJson()` を呼ぶ |
| `web/tests/heavy/report.spec.ts` | `heavy-run.json` の形と内容のテスト |
| `web/scripts/detection-power.mjs` | §4.1〜4.7 のすべて |
| `web/scripts/detection-power.test.ts` | 新規。§4.5 の 3 テストと `verdictFor` の判定表 |
| `.gitignore` | `web/heavy-run.json` を無視（`web/detection-power.json` と同じ扱い。18 行目の隣） |
| `docs/corpus-measurements.md` | 再測定した `minRate` の実測を記録 |

`crates/` は変更しない。**A は Rust に一切触れない。**

## 6. テスト計画

段付けは `test-tiering-policy` に従う。A の影響範囲は web のスクリプトと heavy の
集計に閉じている。

**単体（vitest、`pnpm test`）**

1. `verdictFor` の判定表 — 上の 1〜7 の各分岐について、入力（measurement）と
   期待する `kind` を並べた表。**特に「ビルド失敗 + 不一致 0」が緑にならないこと**。
   これが指示書 §4.2 の核心であり、いまの実装が落ちる唯一のテストである。
2. 期待集合の完全一致 — 過剰反応（期待外のシャードが 1 枚増える）と不足
   （期待シャードが 1 枚欠ける）の両方が赤。
2b. `ALL_SHARDS` の検査 — **`shardsSeen` が 14 枚しかない走行が、`expectShards`
   と一致していても赤**。`expectShards: []` の変異で `shardsSeen` が空のとき、
   緑ではなく測定失敗として赤。
3. 検出率の下限 — `total` が変わっても率が同じなら緑、率が半分になったら赤。
   **コーパスを 2,000 → 4,000 に増やしても書き換えが要らない**ことを、この
   テストが担保する（B+C の前提）。
4. `runOneMutation` の復元 — (a) `measure` が throw、(b) 判定が throw、
   (c) 変異元が見つからない、の 3 つ。(a)(b) では原文がバイト一致で戻ること、
   (c) では明示的に失敗すること。
5. `heavy-run.json` の内容 — 不一致 0 のシャードも `shards` に載ること。
   **1 枚も無いときに `ranTests: false` になること。**

**赤確認**

`red-check-procedure` に従い、変異を入れる前に一時コミットする。最低限、
次の 2 つは「直す前のコードで赤くなること」を実測する。

- テスト 1 の「ビルド失敗 + 不一致 0」を現在の `verdictFor` に通すと**緑になる**
  （＝いまの誤成功が実在する）
- テスト 2 の過剰反応を現在の `shards.length >= 3` に通すと**緑になる**

**実走（1 回、ブランチの末尾）**

`pnpm heavy:power` を 1 回。8 変異すべてが期待どおりで、`minRate` の再測定値が
表と一致すること。所要は実測で 1 変異あたり約 34 秒（wasm 3.7 秒 + heavy 26.3 秒）、
8 変異で約 5 分。

## 7. 完了条件

指示書 §10 のうち、A が担うもの。

- [ ] mutation 実行自体の失敗が成功扱いにならない
- [ ] 期待シャード集合が完全一致で検査される
- [ ] 各変異に最低検出数（率）があり、下回ると赤くなる
- [ ] 原状回復が成功・失敗・解析例外のすべてでテストされている
- [ ] 変異元不在が明示的に失敗する（テストつき）
- [ ] `cargo fmt --check` / `clippy` / `cargo test --workspace` — **A では変更が
      無いので、ブランチ末尾の 1 回で足りる**
- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm heavy` / `pnpm heavy:power`

`pnpm heavy:ui` は A の変更範囲外（UI を触らない）。ブランチ末尾のフルスイープで
1 回だけ回す。

## 8. 次の spec に送るもの

- **`heavy-run.json` をレポートの材料にする** — D+E（§3.2/3.4）。A は書くだけで、
  読むのはレポート側の仕事である。
- **Finance 変異 10 種の `expectShards` と `minRate`** — B+C。層が決まるまで
  最低検出数を決められない（指示書 §6 が「反応すべき／してはならないシャード」を
  求めているのは、層が存在することを前提にしている）。
- **`associativity-flip` の期待反転** — D+E（§7.7）。A では形だけ用意する。
- **`cancellation-000.json` が `display-digits` に反応しない理由** — 実装時に
  確かめて §4.6 に追記する。

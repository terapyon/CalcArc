# U-4 Currency（為替換算） — 設計

日付: 2026-08-19
対象: `web/src/currency/`（新設: Provider / Cache / 更新方針）、
`web/src/ui/Convert/`（カテゴリ追加）、`crates/calcarc-core/src/convert/`
（**通貨は表を持たない**。§3）、`crates/calcarc-wasm/src/lib.rs`（追加のみ）、
`docs/deploy.md`（接続先の記録）。
前提: **U-1 / U-2 の上に積む。** 換算エンジン（厳密有理数・基準単位経由・表示規則）は
U-1 が決めている。
状態: **設計中。未実装。** ユーザー裁定は §1 に反映済み。

## §0.0 この spec が守ること

**新しい節を書くときは、全節を読み直さず、この 6 行とだけ突き合わせる。**

1. **金額を外へ送らない。** 落とすのはレート表で、換算はこの端末で行う
2. **起動時に通信しない。** ネットワークは Currency を開いたあとの話である
3. **古いレートを隠さない。** いつのレートかを必ず画面に出す
4. **レートが無くても、他の 7 カテゴリは 1 つも壊れない**（**【訂正 2026-08-20】U-2 で Convert は 7 カテゴリになった。当初は 6 と書いていた**）
5. **換算の算術は `calcarc-core`。** web が持つのは取得と保存だけである
6. **API キーを持たない。** クライアントに秘密は置けない

**破っているものは無い。**

## §1 裁定（ユーザー、2026-08-19）

**キー不要の公開プロバイダを 1 つ選ぶ。**

**この spec は具体的なサービス名を書かない。** 私が記憶からサービス名・エンドポイント・
レート制限を書けば、**それ自体が陳腐化する主張**になる（S-0 でモデル諸元表を持たないと
決めたのと同じ理由）。書くのは **`CurrencyProvider` の契約**であり、
**どのサービスを繋ぐかは実装時に一次情報で確かめて決める**（§2.1）。

## §2 構え

```text
      ┌──────────────┐
      │ Rate Provider │  web/src/currency/provider.ts   ← 取得（I/O）
      └───────┬──────┘
              ▼
      ┌──────────────┐
      │ Rate Cache    │  web/src/currency/cache.ts      ← 保存（IndexedDB）
      └───────┬──────┘
              ▼
      ┌──────────────┐
      │ convert       │  calcarc-core                    ← 換算（算術）
      └──────────────┘
```

**取得と保存は web、換算は core。** これは CLAUDE.md の「計算ロジックは
`calcarc-core` に置く」と矛盾しない——`fetch` と IndexedDB はブラウザの持ち物で
計算ではなく、**レートを factor として受け取ったあとの掛け算が計算**である。

### 2.1 プロバイダの契約

```typescript
interface CurrencyProvider {
  getLatestRates(): Promise<CurrencyRateSet>
}

interface CurrencyRateSet {
  baseCurrency: string              // 例 "EUR"
  date: string                      // レートの日付 "2026-08-14"
  fetchedAt: string                 // 取得時刻（ISO 8601）
  rates: Record<string, string>     // ★ number ではなく string
  provider: string                  // 出どころの識別子
}
```

**`rates` の値は文字列である**（設計書 §9 は `number` と書いているが採らない）。
理由は §3——**10 進の文字列のままなら厳密な有理数にできる**が、`number` を経由すると
そこで誤差が入る。JSON の数値をパースする時点で `f64` になるので、**受け取った
生の文字列を保つ**。

**【実装時の義務】選ぶサービスは、次の 4 点を一次情報で確認してから landing する。**

1. **API キーが不要であること**（§0.0-6）
2. **利用規約が、この使い方（PWA からの取得・端末へのキャッシュ）を許すこと**
3. **商用・非商用の別と、表示が要る帰属表示（attribution）の有無**
4. **レート制限**——1 日 1 回の更新に足りること

**「金額を送って換算結果を受け取る」形の API は、この段階で落とす**（§0.0-1）。

**【プロバイダの確認 2026-08-20】ExchangeRate-API の Open Access エンドポイントを選ぶ。
4 点とも一次情報で確認できた。**

- **サービス名**: ExchangeRate-API（Open Access / 無キー版）。運営は AYR Tech (Pty) Ltd
- **エンドポイントの形**: `https://open.er-api.com/v6/latest/{BASE}`
  （例: `.../v6/latest/USD`）。**キーもトークンも URL に無い。**
  **金額はどこにも乗らない**——落とすのはレート表だけで、換算はこの端末で行う（§0.0-1）
- **一次情報**:
  - ドキュメント <https://www.exchangerate-api.com/docs/free>
  - 利用規約 <https://www.exchangerate-api.com/terms>
  - **どちらもレスポンス自身が `documentation` / `terms_of_use` フィールドで指している**
    （出どころの裏取りが応答の中で完結する）
- **取得日**: 2026-08-20（実測。応答の `time_last_update_utc` は
  `Thu, 20 Aug 2026 00:02:31 +0000`、`time_next_update_utc` は
  `Fri, 21 Aug 2026 00:11:41 +0000`、`time_eol_unix` は `0`＝廃止予定なし）

**4 点それぞれの根拠（原文）:**

1. **API キーが不要**（§0.0-6）——ドキュメントの見出しが
   *「Open Access, No Key Required」*、比較表が *「Open API / **No API Key** /
   Attribution Required / Updates Once Per Day / Rate Limited」*。

   > If you want a free exchange rates API with no API key requirement for a small
   > project then this is what you're looking for!

2. **この使い方（PWA からの取得・端末へのキャッシュ）を許す**——

   > You're welcome to cache the data we respond with and to use it for either personal
   > or commercial currency conversion purposes. You are, however, not allowed to
   > re-distribute it.

   規約の Data Caching Policy も同じことを言う。

   > Users are given permission to store & re-use any data retrieved from our API.
   > Users are, however, strongly reminded of the terms in the LICENSE section above
   > specifying that data gathered from our API cannot be re-distributed - caching is
   > for customer end-use only.

   **CalcArc の使い方はこの「end-use」側である。** IndexedDB に置くのは**この端末の
   換算のためだけ**で、他へ配らない。規約が禁じているのは再配布と、
   *「any product or service that offers programmatic or automatic access to exchange
   rate data」*——**レートを API として他へ出す形**であり、CalcArc はそれをしない
   （§9 が複数プロバイダも履歴レートも外している）。
3. **商用・非商用の別と帰属表示**——**商用・非商用のどちらでもよい。帰属表示は要る。**

   > This license does not restrict Free Plan accounts differently to paid accounts, so
   > both Free Plan and paid ExchangeRate-API accounts are suitable for either commercial
   > or personal use.

   > This open access API is subject to our Terms and requires attribution.

   **出す文言はドキュメントが指定している**（これをそのまま置く）:

   ```html
   <a href="https://www.exchangerate-api.com">Rates By Exchange Rate API</a>
   ```

   > We require attribution on the pages you're using these rates with the link below

   > You're also welcome to make the attribution link discreet and in keeping with how the
   > rest of your application looks - we leave this up to you.

   **したがって §7 が予約した置き場を使う**——レート日付の行の隣に、この文言とリンクを出す。
   見た目は他に合わせてよいが、**出さない選択肢は無い。**
4. **レート制限**——**1 日 1 回の更新には十分**（§4.2 の 24 時間の境とちょうど噛み合う）。

   > • If you only request once every 24 hours you won't need to read any more of this
   > section. Easy!
   > • If you can't keep a cached response for that long, you could still request once
   > every hour and never get rate limited.

   > Rate limited IP's will receive HTTP code 429 responses. After 20 minutes the rate
   > limit will finish and new requests will be allowed through.

   **429 は §5 の「失敗」として扱えばよい**——古いキャッシュで換算が続く（§0.0-3 で
   日付は出したまま）。

**「金額を送って換算結果を受け取る」形ではない**（§0.0-1）。GET するのはレート表 1 枚で、
**リクエストに金額を入れる場所が無い。**

**実測（2026-08-20、`curl` に `Origin:` を付けて確認）:**

- `access-control-allow-origin: *`——**ブラウザから直接引ける**（プロキシを立てなくてよい）
- `cache-control: public, max-age=3600`
- **§3.1 の 16 通貨がすべて `rates` に載っていた**（応答は 166 通貨）。
  **`TWD` と `VND` が要るので ECB 由来のプロバイダは採れない**——ECB の参照レートは
  この 2 つを公表しておらず、実測でも Frankfurter（ECB 由来）の応答 29 通貨に
  `TWD` `VND` が無かった。**16 面のうち 2 つが常に押せないのは §7 の意図ではない。**

**`CurrencyRateSet`（§2.1）への対応づけ:**

| §2.1 | 応答の何から作るか |
|---|---|
| `baseCurrency` | `base_code`（要求した通貨。例 `"USD"`） |
| `date` | **そのままは無い。** `time_last_update_utc`（RFC 1123。例 `"Thu, 20 Aug 2026 00:02:31 +0000"`）から `YYYY-MM-DD` を作る |
| `fetchedAt` | こちらで打つ（応答には無い） |
| `rates` | `rates`（**下記の注意**） |
| `provider` | `provider`（`"https://www.exchangerate-api.com"`）を識別子にできる |

**【Task 5 への申し送り】`rates` の値は JSON の数値である**（`"JPY": 158.548543` のように
引用符が無い）。**spec は「文字列で保つ」と決めている**（§2.1）ので、
**`JSON.parse` の戻り値から取ると、そこで `f64` を一度通ってしまう。**
**受け取った生のテキストから、その通貨の数値リテラルの綴りを取り出す工夫が要る。**
**「`parseFloat` して文字列に戻す」は駄目である**——それは `f64` を通したのと同じで、
§3 が禁じていることそのものになる。

## §3 換算は U-1 のエンジンに乗る

**通貨は「factor が動的な単位」である。**

```text
value → 基準通貨 → 目的通貨
```

これは U-1 §3.1 の「必ず基準単位を経由する」と**同じ形**で、基準がメートルから
プロバイダの `baseCurrency` に変わっただけである。N × N のレート表は持たない。

**レートは厳密な有理数にする。** `"155.23"` は `15523/100` である。
`f64` を経由しない（§2.1）。**U-1 の `Rational` がそのまま使える。**

**通貨に `offset` は無い**（すべて倍率のみ）。したがって U-1 のアフィン機構に
**1 行も足さずに乗る**。core が持つのは「値とレート 2 つを受け取って換算する関数」
だけで、**通貨の表は core に置かない**——レートは外から来るデータであって定義値では
ないからである。

### 3.1 表示は通貨ごとに桁が違う

U-1 の表示規則（有効数字 10 桁）をそのまま使うと、`100 USD` の答が
**`17,120.34483`** のような**長すぎる小数**になる。通貨は**小数桁が通貨ごとに
決まっている**ので、ここだけ規則を足す。

（当初この節は「`17,120.00000` のような答が出る」と書いていた。**そうはならない**
——numerical-policy の規則は末尾のゼロを詰めないので、出るのは長い小数のほうである。
**規則は正しく、例が間違っていた。**）

**典拠は ISO 4217 の minor unit である。** これは為替レートと違い、**陳腐化しない
定義**である——だから §1 でサービス名を書かないと決めたのと**条件が逆**で、
**ここには表を書く。**

| 通貨 | 小数桁 | | 通貨 | 小数桁 |
|---|---|---|---|---|
| `JPY` | **0** | | `THB` | 2 |
| `KRW` | **0** | | `SGD` | 2 |
| `VND` | **0** | | `HKD` | 2 |
| `USD` | 2 | | `TWD` | 2 |
| `EUR` | 2 | | `AUD` | 2 |
| `GBP` | 2 | | `CAD` | 2 |
| `CHF` | 2 | | `INR` | 2 |
| `CNY` | 2 | | `BRL` | 2 |

**これが §7 の「固定 16 通貨」の中身である**（面の並びもこの順）。

**小数桁 3 の通貨（`KWD` `BHD` `JOD` `OMR` など）は入れない。** 入れると
「0 か 2 のどちらか」という単純さが崩れ、桁数の表が別の形になる。**入れないと
決めたことを書いておく。**

**【実装時の義務】この 16 行を ISO 4217 の一次情報で確認してから landing する。**
私は記憶で書いている。**畳の出典（U-2 §3.2）と同じ扱いである。**

**【ISO 4217 の確認 2026-08-20】16 行すべて確認できた。落とした通貨は無い。**

- **テーブル**: ISO 4217 **「List One: Current Currency & Funds Codes」**（`list-one.xml`）
- **版**: XML のルート要素が `<ISO_4217 Pblshd="2026-01-01">`。
  発効中の最新改訂は **Amendment 180（2026 年 1 月 1 日発効**、ブルガリアのユーロ導入
  = `BGN` を List Three へ、`EUR` を List One のブルガリア行へ）。**この 16 通貨に
  Amendment 180 が触れた行は `EUR` だけで、minor unit は 2 のまま**（改訂文自身が
  `Bulgaria / Euro / EUR / 978 / 2` と書いている）
- **維持機関**（同ページの原文）:

  > SIX is the official Maintenance Agency of these currency codes under ISO 4217 and as
  > such the only recognized, authoritative source on currency code designations.

- **出典**: SIX Group「Data Standards」ページと、そこから直リンクされる XML
  - <https://www.six-group.com/en/products-services/financial-information/data-standards.html>
  - <https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml>
  - Amendment 180: <https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/amendments/dl-currency-iso-amendment-180.pdf>
  - （`iso-currrency` の `r` が 3 つなのは**先方の URL がそうなっている**。誤記ではない）
- **確認のしかた**: XML を取得し、`<CcyNtry>` を全 280 件走査して `<Ccy>` ごとの
  `<CcyMnrUnts>` を**集合**にした。**同じ通貨コードが複数国に現れても値が割れないこと**を
  同時に見ている（`USD` は 19 か国、`EUR` は 37 か国、`GBP` は 4 か国に現れるが、
  minor unit はいずれも 1 通り）。

| 通貨 | 数字コード | `CcyMnrUnts` | spec の表 | |
|---|---|---|---|---|
| `JPY` | 392 | **0** | 0 | 一致 |
| `KRW` | 410 | **0** | 0 | 一致 |
| `VND` | 704 | **0** | 0 | 一致 |
| `USD` | 840 | 2 | 2 | 一致 |
| `EUR` | 978 | 2 | 2 | 一致 |
| `GBP` | 826 | 2 | 2 | 一致 |
| `CHF` | 756 | 2 | 2 | 一致 |
| `CNY` | 156 | 2 | 2 | 一致 |
| `THB` | 764 | 2 | 2 | 一致 |
| `SGD` | 702 | 2 | 2 | 一致 |
| `HKD` | 344 | 2 | 2 | 一致 |
| `TWD` | 901 | 2 | 2 | 一致 |
| `AUD` | 036 | 2 | 2 | 一致 |
| `CAD` | 124 | 2 | 2 | 一致 |
| `INR` | 356 | 2 | 2 | 一致 |
| `BRL` | 986 | 2 | 2 | 一致 |

**16 行とも一致したので、§3.1 の表・§7 の「固定 16 通貨」・§8 の golden ケースは
書き換えない。**

**ついでに確認した**（同じ XML）: §3.1 が「入れない」と名指しした `KWD` `BHD` `JOD`
`OMR` は**いずれも 3**。**`TND` も 3、`CLF` と `UYW` は 4** で、**「0 か 2 のどちらか」が
崩れるという §3.1 の判断は正しい。** 貴金属（`XAU` など）の minor unit は `N.A.` である。

**版で動く。引くときは版を添えること**（U-2 §3.2 の教訓）。**`list-one.xml` は同じ URL の
まま中身が差し替わる**——**版は URL ではなく `Pblshd` 属性と Amendment 番号が持つ。**
**「定義値だから陳腐化しない」は「変わらない」の意味ではなく、「変わるときは改訂番号が
付く」の意味である**（Amendment 180 が現に List One を書き換えている）。**引き直すときは
`Pblshd` を見て、この記録の `2026-01-01` と比べること。**

**整数部のカンマは U-1 と同じ**（`numerical-policy.md` の表示節）。
**丸めは round-half-to-even**——プロジェクトの中で丸め方向を 2 つ持たない。

**暗号資産は入れない**（設計書 §14 が「初期バージョンでは法定通貨のみを推奨」と
書いている）。桁数の規則が別物になるためでもある。

## §4 キャッシュと更新

### 4.1 どこに保存するか

**レートは IndexedDB、設定は既存の `localStorage`。**

**使い分けの基準を書いておく**——**構造化されていて件数が伸びるもの（レート表。
通貨の数だけ行がある）は IndexedDB、単一の設定値は `localStorage`**。
0.2.1 で入れた `web/src/settings/` は後者のままで、**この spec は触らない。**

**`localStorage` を掴むのは `useSetting.ts` だけ**という既存の約束（P-1 §6）と同様に、
**IndexedDB を掴むのは `currency/cache.ts` だけ**にする。

### 4.2 いつ取りに行くか（設計書 §11）

```text
キャッシュが無い  → オンラインなら取得。オフラインなら §5 の案内
キャッシュがある  → まず画面に出す（ここで通信を待たない）
                   24 時間以内   → そのまま
                   24 時間超    → 背後で更新を試みる。失敗しても古いまま使う
```

**起動時には通信しない**（§0.0-2）。**Currency を開いた時点でキャッシュを先に描く**
（設計書 §34）。**UI をネットワーク待ちにしない。**

**`date` が変わっていなければ書き戻さない**（設計書 §11.1）。`fetchedAt` だけが
動く書き込みを毎回するのは無駄である。

### 4.3 取得したものを信用しない

**`rates` はネットワーク由来の入力である。** 形が正しい保証は無い。
**既存の設定の復元（P-1 §5）と同じ流儀**——**項目ごとに検査し、読めるものだけ使う**:

- **通貨 1 つのレートが 10 進として読めない** → **その通貨だけ落とす**。
  面ではそのキーを押せなくする（§7）。他の 15 通貨は生き残る
- **`baseCurrency` か `date` が読めない** → **セット全体を捨てる**。
  基準通貨が無ければ、どのレートも意味を持たない
- **知らない通貨が入っている** → 捨てる（面に無いものは使わない）

### 4.4 キャッシュの版（設計書 §10）

**保存するものに `schemaVersion` を持たせる**（設計書 §10 が保存項目に挙げている）。

**版が違う・壊れている・読めないときは、捨てて「キャッシュ無し」に倒す**
——移行は書かない。**レートは捨てても取り直せる**（設定と違い、利用者が作った値では
ない）。`web/src/settings/` の `v` が「移行の仕組みではない」と決めたのと同じ立場である。

## §5 オフラインと失敗（設計書 §12・§35）

**画面には常に `Rate: 2026-08-14` の形で日付を出す。** キャッシュが新しくても
古くても、**同じ場所に同じ形で出す**——古いときだけ出すと、**出ていないことが
「新しい」の意味になり、読み手がそれを学習しなければならない**。

- **オフラインで、キャッシュがある**: そのまま換算する。`Offline` と日付を出す
- **取得に失敗し、キャッシュがある**: 致命的にしない。黙って古いレートを使い、
  日付を出す（設計書 §35）
- **キャッシュが無い**: 換算できない。**エラーではなく案内**を出す——
  「為替レートがありません。インターネットに接続して取得してください。」
  **このとき Convert の他の 7 カテゴリは 1 つも壊れない**（§0.0-4。**U-2 で 7 になった**）

## §6 プライバシーと接続先

**Privacy（base-spec §41）は守られる。** 落とすのはレート表であり、**入力した金額は
1 バイトも外へ出ない**（§0.0-1）。**この理由づけを `docs/base-spec.md` §41 の隣に
書く**——「通信するようになった」ことだけが伝わって、**なぜ §41 と両立するのかが
伝わらない**と、あとから誰かが金額を送る API に差し替えても気づけない。

**CSP は現在存在しない**（実測: `web/public/_headers` にあるのは `Cache-Control`
だけ）。したがって**広げるべき `connect-src` が無い。**

**この spec で CSP を新設しない。** 新設すると Currency 以外のすべての経路
（WASM・Service Worker・フォント・画像）の検証が要り、範囲が膨らむ。代わりに
**`docs/deploy.md` に「CSP を入れるときは為替レートの取得先を `connect-src` に
足すこと」を記録する**——**将来やることを、やる人が読む場所に置く。**

**Service Worker は関与しない。** `runtimeCaching` は設定されておらず
（`vite.config.ts` は `navigateFallback` のみ）、他オリジンへの `fetch` は
precache の対象外である。**レートのキャッシュは SW ではなく §4 が持つ。**

## §7 盤面

Convert の 8 番目のカテゴリ（`#convert/currency`）。**項目行・単位面・Swap・
数字面は U-1 のまま**で、増えるのは**レート日付の 1 行**だけである。

**通貨の面は固定 16 通貨**とし、レート表にその通貨が無ければ**そのキーを押せなくする**
（`disabled`）。面の並びがレートの中身で動くと、**同じ位置に違う通貨が来る**。

**帰属表示（attribution）が要るプロバイダなら、レート日付の行の隣に置く。**
実装時義務 3（§2.1）で「要る」と分かった場合の置き場を、**ここで予約しておく**
——盤面の裁定を実装の途中で開かないためである。

**押せないキーは押せないように見せる**——0.2.0 の予約スロットの穴（有効なキーと
同じ見た目で無反応）を繰り返さない。**computed style を読む E2E で固定する。**

## §8 検証

**段付け**: 換算の算術は core なので `cargo test --workspace` と golden。
取得・保存・更新方針は **vitest**（`Provider` と `Cache` を差し替えて回す）。
**`pnpm e2e` は必須**——押せないキーの見え方と、レート日付が常に出ることを見る。

**golden**（`testdata/currency.json`、厳密一致）: **レートは入力である。**
プロバイダを叩かない。`155.23` のような 10 進文字列を与えて、換算と丸めが
仕様どおりかだけを見る。

| 名指しで置くケース | 何を守る |
|---|---|
| `100 USD → JPY`（レート 2 つ経由） | 基準通貨を経由すること |
| `JPY` の答が**小数点を持たない** | §3.1 の桁数 |
| `USD` の答が**ちょうど 2 桁** | 同上 |
| **half-even の tie を踏む 1 件**（**赤確認 4 と同一のケースにする**） | 丸め方向。厳密有理数では境にちょうど乗り、`f64` では反対側に落ちる値を選ぶ |
| 桁区切りが入る 1 件 | U-1 の表示規則との一致 |

**vitest で守るもの**（Provider をスタブに差し替えて）:

- **24 時間の境**——23:59 では取りに行かず、24:01 では行く
- **`date` が同じなら書き戻さない**
- **取得失敗でも古いキャッシュで換算が続く**
- **キャッシュが無くオフラインなら §5 の案内が出る**
- **起動時に `fetch` が 1 回も呼ばれない**（§0.0-2。**スパイで数える**）

**赤確認**（変異前に一時コミット、戻すのは変異箇所の再編集）:

1. **レート日付の表示を消す**——§0.0-3 が赤。**古いレートを黙って使う状態**に
   なることを実物で見る
2. **24 時間の判定を 24 秒にする**——境のテストが赤
3. **取得失敗時にキャッシュを捨てる**——「失敗を致命的にしない」が赤
4. **レートを `f64` で持つ**（文字列から `parseFloat`）——**厳密一致の golden が
   赤になるか**。

   **ここは素朴にやると空振りする。** 出力は 0〜2 桁に丸めるので、`f64` の誤差は
   **ほとんど常に吸収される**。赤にするには「**厳密有理数では half-even の tie に
   ちょうど乗るが、`f64` では境の反対側に落ちる**」ケースが要る。

   **golden の tie ケースと、この赤確認のケースを同一にする。** そのうえで、
   **`f64` 側の値が実際に境を割ることを実測し、導出記録に数で残す**。
   **判別力は実測でしか信じない**——「たぶん赤になる」で通さない
5. **起動時に取得を呼ぶ**——スパイの数え上げが赤

**コーパス影響の宣言**: **無し**（U-1 / U-2 と同じ理由）。

## §9 スコープ外

- **暗号資産**（§3.1）
- **履歴レート・チャート**（設計書は「最新」しか要求していない）
- **CSP の新設**（§6。`deploy.md` に送る）
- **§36 Favorite / Recent**、**§32 の URL state**
- **手入力のレート**（プロバイダが無いときの代替。**入れない**——
  「どこから来た数か」が画面から消えるため）
- **複数プロバイダの自動切り替え**（契約は差し替え可能にするが、選ぶのは 1 つ）

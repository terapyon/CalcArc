# U-0 ナビゲーション再編 — 設計

日付: 2026-08-19
対象: `web/src/App.tsx`、`web/src/ui/Nav/`、`web/src/ui/Convert/`（新設）、
E2E 6 本と vitest 2 本、`docs/base-spec.md` §8、版数 5 箇所。
前提: **`origin/main`（`b223bde` = `v0.2.1`）から。**
状態: **設計中。未実装。** ユーザー裁定は §1 に反映済み。

## §0.0 この spec が守ること

**新しい節を書くときは、全節を読み直さず、この 5 行とだけ突き合わせる。**

1. **計算に 1 行も触らない。** `crates/` の差分は 0 行
2. **`KEY_TOKENS` と `engine_table.rs` を動かさない。** コーパスは無傷
3. **既存 3 タブの中身を 1 つも変えない。** 移すのは入口だけである
4. **押せて何も起きない面を作らない。** Convert タブは押せて、画面が変わる
5. **縦の予算を悪化させない。** Nav の高さは 4 タブでも変わらない

**破っているものは無い。**

## §0 位置づけ

`docs/unit-convert-scale-spec.md`（43 節）が起点である。全体を 5 つに分解した:

| | 中身 | 外部依存 |
|---|---|---|
| **U-0** | ナビゲーション再編（この spec） | なし |
| **Scale 刷新** | 次元数の選択式／手入力、LLM モデル、Transfer | なし |
| **U-1** | Unit Engine ＋ Length / Mass / Temperature | なし |
| **U-2** | 残りの Convert カテゴリ | なし |
| **U-4** | Currency | **あり** |

**縦積みで 0.3.0 としてまとめて出す。** ただし U-0 は単独で main に入り、その間だけ
配信物のナビが 4 タブで Convert が空、という状態になる。**そのため版数はここで
0.3.0 に上げる**（§6）。

U-0 でやるのは**器だけ**である。Convert の中身は U-1、Scale の中身は次の spec が持つ。

## §1 裁定（ユーザー、2026-08-19）

1. **器の形は「4 系統タブ + パネル内カテゴリ選択」。** 上段に出るのは系統だけで、
   カテゴリ（Length / Vector など）はパネルの中で選ぶ
2. **Convert タブは「準備中」で出す。** 中身が入るのを待たない
3. **既存 Data Scale の名前は据え置く。** 着地は `Scale > Data Scale`、
   hash は `#scale/data-scale`
4. **旧 `#data-scale` の互換リダイレクトは作らない。** 理由はクローズドβで、
   飛び先を失う人がごく少ないこと
5. **版数は U-0 で 0.3.0 に上げる**
6. 順序は **U-0 → Scale 刷新 → U-1 → U-2 → U-4**

## §2 いま在るもの

**ルーティングは 1 段の hash である**（`App.tsx:18-22`）。`#data-scale` と `#finance`
だけを見て、それ以外は `scientific` に倒す。リンクの `href` がハッシュを変え、
`hashchange` の購読が React の state に反映するだけで、クリックハンドラは無い
（`App.tsx:31-36`）。**この形は変えない。**

**Nav は 3 リンクである**（`Nav.tsx:9-13`）。寸法は次のとおり:

| | |
|---|---|
| `.nav` | `display: flex` / `gap: var(--key-gap)` = 8px / `padding: 12px` / `max-width: 480px` |
| `.tab` | `flex: 1` / `min-height: var(--touch-target-min)` = 44px / `padding: 8px` / `font-size: var(--nav-font-size)` = 1rem / **`white-space: nowrap`** |

`white-space: nowrap` は **0.2.0 設計書 §7 が意図して置いたもの**である（折り返しを
構造で禁じ、ラベルが伸びたときに 2 段に戻らないようにした）。**折り返さない以上、
入らなければはみ出す。** §4 はここに効く。

**`#data-scale` のリテラルは 13 箇所**（実測）:

| 場所 | 件数 |
|---|---|
| `App.tsx:19` / `App.test.tsx:53` / `Nav.tsx:11` / `Nav.test.tsx:24` | 4 |
| `footer.spec.ts:6` / `viewport-budget.spec.ts:9` | 2 |
| `data-scale.spec.ts`（40, 53, 57, 61, 65, 82） | 6 |
| `data-scale-keypad.spec.ts:19` | 1 |

**コーパスへの影響は無い。** `heavy:ui` は `/heavy-harness.html` に直接 goto しており
（`web/tests/heavy/harness.ts:29`）、アプリのナビを一度も通らない。`corpus.ts` に
現れる `data-scale` は**シャードの領域名**であって URL ではない
（`corpus.ts:301` の `CALL_SHARD_PATTERN`）。**ナビを変えてもコーパスは無傷である。**

**設定の永続化はタブを保存していない。** `web/src/settings/types.ts:62` が
「式・途中の数字・答・`active`・`sexagesimal_view`・`error`・履歴は保存しない」と
明記しており、route も保存対象に無い。**hash を 2 段にしても保存データには触らない。**

**縦の予算は 390×844 しか測っていない**（`viewport-budget.spec.ts`）。360×640 では
3 タブとも 1 画面に収まっていないことが 0.2.1 の調査で分かっているが
（`docs/definition-of-done.md`）、**U-0 の管轄ではない**（§9）。

## §3 ルーティング

**hash を 2 段にする。** 先頭セグメントが系統、2 番目がカテゴリである。

```text
#<module>[/<category>]
```

| hash | 出るもの |
|---|---|
| `#scientific` | Scientific（据え置き） |
| `#finance` | Finance（据え置き） |
| `#scale/data-scale` | 既存の Data Scale パネル |
| `#convert` | 準備中パネル（§5） |
| 上記以外・空・**旧 `#data-scale`** | `#scientific` に倒す |

倒す規則は既存のまま維持する。**旧 `#data-scale` は「知らない hash」として既定に
落ちる**——`#loan` のときと同じ扱いで、互換分岐は作らない（§1-4）。

型はこうする:

```ts
export type ModuleId = "scientific" | "convert" | "scale" | "finance";
export type Route = { module: ModuleId; category: string | null };
```

**タブの `href` は既定カテゴリまで書く**——Scale タブは `#scale` ではなく
**`#scale/data-scale`** を指す。どちらでも転落規則で同じ画面が出るが、`#scale` に
すると**同じ画面に 2 つの URL** ができ、E2E の `toHaveURL` 期待と `Nav.test.tsx` の
href 表がその曖昧さを引き継ぐ。押した後の URL と深いリンクの URL を一致させる。

`routeFromHash` は 2 段に分けて読む。**カテゴリが無い・知らないときは、その系統の
既定カテゴリに倒す**（`scale` の既定は `data-scale`。U-0 ではそれしか無い）。この
規則があるので、U-1 が `#convert/length` を足すときに `routeFromHash` の形は変わらない。

**§32 の URL state（`?vectors=1000000&dims=768`）は U-0 のスコープ外である**（§9）。
クエリ文字列は hash とは別の機構なので、後段で足しても 2 段 hash と衝突しない。

## §4 盤面（Nav）

タブは 4 枚。ラベルは英語のまま（`Scientific` / `Convert` / `Scale` / `Finance`）、
`<nav>` の `aria-label="計算機の切り替え"` と `aria-current="page"` の流儀も据え置く。

**幅が問題になる。** 現在の算術は:

| 幅 | 3 タブ | 4 タブ |
|---|---|---|
| 360px | (360 − 24 − 16) ÷ 3 ≈ **107px** | (360 − 24 − 24) ÷ 4 = **78px** |
| 480px 以上（`--shell-max-width`） | ≈ 147px | 108px |

**360px で 1 枚 78px に `Scientific` が入るとは考えにくい**（`padding: 8px` × 2 を
引くと文字に使えるのは 62px）。入らなければ `white-space: nowrap` によって
**横にはみ出す**——0.2.1 で直したのと同じ壊れ方である。

**譲る順序を決めておく**（0.2.1 の 360px 修正と同じ順）:

1. **まず `gap`** を詰める（0.2.1 の先例。3 つの隙間で最大 24px が浮く）
2. 足りなければ **`--nav-font-size`** を下げる
3. **ラベルの短縮は最後**（`Sci` / `Fin` は読み手に説明が要る）
4. **`min-height: 44px` は譲らない**（base-spec §43）

**どれを採ったかは、実測値と一緒に実装時に spec へ追記する。** 算術で予測はできるが、
文字幅はフォントで決まるので測るまで確定しない。

**【実測 2026-08-19】どの段も採らずに済んだ。** `nav.spec.ts` に足した 360px の
3 件（1 行に収まる・44px を保つ・横にはみ出さない）は無変更で緑。実機ビルド
（`vite build` + `pnpm preview`）で 360px と 390px の実測値を取ったところ:

| タブ | 幅（360px） | 幅（390px） | 高さ（両方） |
|---|---|---|---|
| Scientific | 89.67px | 89.67px | 44.00px |
| Convert | 75.05px | 75.05px | 44.00px |
| Scale | 55.94px | 55.94px | 44.00px |
| Finance | 74.41px | 74.41px | 44.00px |
| `scrollWidth − innerWidth`（横のはみ出し） | 0 | 0 | — |

**「1 枚 78px」という予測は外れた——ただし外れ方が良い方に外れた。** `.tab` は
`flex: 1`（`flex-basis: 0`）なので、4 枚が等分されるのではなく、各タブの
min-content 幅（ラベル文字数で決まる）に余白を等しく足す形で確定する。結果として
`Scientific` は 89.67px（予測の 78px より広い）、`Scale` は 55.94px（78px より
狭い）と、タブごとに幅が違う。**それでも `white-space: nowrap` は破られず、
360px と 390px で数値が完全に一致した。**

**一致する理由は `--shell-max-width` ではない**（480px なので 360/390 のどちらでも
効かない）。**`.nav` の `margin: 0 auto` が伸長を止めている**——flexbox は交差軸の
マージンが `auto` のとき `align-items: stretch` を適用しないので、**nav は内容幅の
まま中央寄せになる**。したがって幅は viewport ではなく**ラベルの文字数で決まる**。
実測した nav 幅は **343.06px**。内訳は タブ合計 295.07 ＋ gap 24 ＋ padding 24 で、
**足すと 343.07px になる**——**差の 0.01px は、上の表の 4 つの幅を小数 2 桁に丸めて
から足したことによる**（どちらの数も正しい。丸めの前後を混ぜて書くと、この 1 桁が
矛盾に見える）。360px との差 **16.94px**（実測値からの引き算）が余白として残っている。

**これは「いまは通る」の理由であって、「これからも通る」の保証ではない。**
ラベルを 1 文字でも伸ばせば nav も伸びる。360px で使える余白は 17px しかない
——`nav.spec.ts` の 360px 3 件が見張っているのはここである。**4 タブに増やしても
`gap` / `--nav-font-size` / ラベルのどれも譲らずに収まった。**

**【訂正 2026-08-19】** ここには当初「0.2.1 の 360px 修正では 3 タブでも `gap` を
詰める必要があったのに対し」「3 タブ時よりラベルの文字数の合計が有利だった」と
書いていた。**どちらも事実ではない。**

- 0.2.1 の 360px 修正（5ce18be「Let the gap give way so 44px does not, at 360px」）が
  `gap` を詰めたのは **Keypad の関数列**である（7 列 × 44px ＋ gap 8px × 6 = 356px が
  336px に入らず 8px 溢れた）。**nav は 1 行も触っていない**——diff は
  `docs/definition-of-done.md` / `docs/superpowers/specs/2026-08-13-scientific-shell-design.md` /
  `web/src/ui/Keypad/Keypad.module.css` / `web/tests/e2e/viewport-budget.spec.ts` の
  4 ファイルで、CSS は Keypad だけである。**nav は 3 タブ時代から何も譲らずに
  収まっていた。**
- 文字数も逆である。3 タブは `Scientific` / `Data Scale` / `Finance` の 27 文字、
  4 タブは `Scientific` / `Convert` / `Scale` / `Finance` の 29 文字で、gap も 1 つ
  増えている。**3 タブ時代の nav 幅は実測していない**ので、この spec は 3 タブとの
  比較を主張しない。

**測って言えるのは「4 タブ・343.06px・360px との余白 16.94px」だけ**である。

## §5 Convert の準備中

**リンクは生かす。** `#convert` に遷移し、パネルが「準備中」と言う。

**0.2.0 で踏んだ穴を繰り返さないための形である。** あのときは予約スロット
（`000` / `Exp`）が有効なキーと同じ見た目で、押しても何も起きなかった。
`disabled` と `aria-pressed` は正しく出ていたのに、**「押せる場所に見えるか」を
誰も見ていなかった**。今回は**押せば画面が変わる**ので、その穴ではない。

パネルは `<section aria-label="単位変換（準備中）">` とし、本文は 2 行:

```text
単位変換は準備中です。
長さ・重さ・温度・通貨などの変換をここに置きます。
```

**見え方は自動検査では捕まらない。** 0.2.0 の更新トーストは、role も 44px も
フォーカス非奪取もすべて緑のまま、**白地に白のボタン**だった。よって:

- **computed style を読む E2E** で、本文の文字色が背景色と異なること、
  `opacity` が 1 未満でないことを固定する
- **390×844 と 360×640 で撮って目で見る**（`pnpm preview` は 4179、撮り終えたら
  `fuser -k 4179/tcp` で解放する）

## §6 版数 0.3.0

**5 箇所を揃える。** CLAUDE.md が挙げる 4 箇所に CHANGELOG が加わる:

1. `Cargo.toml`（workspace）
2. `web/package.json`
3. `README.md` の「現在の版」
4. `README.en.md` の「Current version」
5. `CHANGELOG.md` に `## 0.3.0` の節（日付は出荷時に確定する）

`pnpm check:version` が見るのは 1 と 2 の不一致だけで、**どちらの README も
CHANGELOG も見ない**。画面のフッタは `web/package.json` からビルド時に埋まる。

CHANGELOG に書くのは**利用者から見えた変更**である（そのファイルの冒頭が自分で
そう宣言している）。U-0 で利用者から見えるのは 3 つ:

- タブが 4 つになった（`Convert` が増えた。中身はまだ無い）
- Data Scale が Scale の下に入った
- **`#data-scale` のブックマークは効かなくなった**（開くと Scientific が出る）

## §7 docs の更新

`docs/base-spec.md` §8 のモジュール木に `Convert` と `Scale` を足し、**ハッシュが
2 段になったこと**を書く。置き場は §8 の【訂正 2026-08-15】（`#loan` の互換を
作らなかった記録）の隣で、様式もそれに倣う——**旧 `#data-scale` の互換を作らな
かったことと、その理由（クローズドβ）を同じ形で残す。**

## §8 検証

**段付け:** `cargo test` は不要（`crates/` を触らないため。**差分 0 行を実測で
示す**）。**`pnpm test`（vitest）と `pnpm e2e` は必須**——リンクのロール意味論と
`aria-current` に触るので、jsdom では守れない（CLAUDE.md の罠）。

**変えるもの:**

| ファイル | 何を |
|---|---|
| `Nav.test.tsx` | リンク 3 → 4、`href` の表、`aria-current` の対象 |
| `App.test.tsx` | `routeFromHash` の表（2 段・既定への転落・旧 hash が Scientific に落ちること） |
| `data-scale.spec.ts` / `data-scale-keypad.spec.ts` | hash を `#scale/data-scale` へ |
| `footer.spec.ts` / `viewport-budget.spec.ts` | hash の置換に加え、**ループに `#convert` を足す**——フッタ表示と縦の予算を新しいパネルにも回す。準備中パネルは短いので通るはずで、**通らなければそれ自体が発見である** |
| `nav.spec.ts` | 4 タブ、押下で系統が変わること |

**足すもの:** Convert の準備中を見る E2E 1 本（遷移・アクセシブルネーム・
computed style の色差）。

**赤確認**（変異を当てる前に一時コミットを置き、戻すのは変異箇所の再編集）:

1. `routeFromHash` の `scale` の分岐を落とす → `#scale/data-scale` が Scientific に
   落ちて E2E が赤
2. 準備中パネルの文字色を背景と同じ値にする → computed style の E2E が赤。
   **ここが赤にならなければ、その検査は 0.2.0 のトーストを捕まえられない**

**撮る:** 390×844 と 360×640 の**2 つの幅**で、`#scientific` と `#convert` の
**2 つの画面**を撮る——**2 つの幅 × 2 画面 = 4 枚**
【訂正 2026-08-19: 元は「390×844 と 360×640 の 2 枚」と書いていたが、
「2」は幅の数であって枚数ではなかった。4 タブがはみ出していないこと（§4）と
準備中が読めることを両方の幅で確かめるには、画面も掛け合わせて 4 枚要る】。
4 タブがはみ出していないことと、準備中が読めることを目で見る。

## §9 スコープ外

- **§32 の URL state（クエリ文字列）。** 2 段 hash とは別機構で、後段で足せる
- **Convert の中身**（U-1）と **Scale の入力方式・LLM**（次の spec）
- **旧 `#data-scale` の互換**（§1-4 で作らないと決めた）
- **縦が短い端末で 1 画面に収まらない問題。** 0.2.1 が見つけて未解決のまま
  （`definition-of-done.md`）。U-0 は**悪化させないことだけ**守る——Nav は横に
  分割するだけで高さが変わらないので、悪化しない
- **パネル内のカテゴリ選択 UI。** §1-1 は「カテゴリはパネルの中で選ぶ」と決めたが、
  U-0 時点の Scale はカテゴリが 1 つしか無いので選択 UI は要らない。**器の形の裁定で
  あって、U-0 の作業ではない**——各系統の中身の spec が持つ
- **§36 Favorite / Recent、§42 のトップページのカード**

**【変更 2026-08-20】上の「パネル内のカテゴリ選択 UI」は、器の**見た目**まで
後段に預けたままだった。ユーザーが 0.3.0 を実機で見て 3 点を指摘したので、
ここで決める**（spec は起こさず、この節に追記する。ユーザー指示 2026-08-20）。

1. **デザインされていない。** 素の `<select>` が出ていた——角も配色も
   タイポグラフィも、`Nav.tsx` のタブとも `Key` とも揃っていない
2. **PC・タブレットで横一杯に広がる。** 器（`.scale` / `.convert`）に
   `max-width` が無く、**1280px の画面では select が 1280px の帯**だった（実測）
3. **横に余裕があるので、日本語だけでなく英語表記を入れる**

**決めたこと。**

- **見た目は Nav のタブに合わせる。** `--key-function-bg` / `--key-function-fg` /
  `--radius` / `--nav-font-size` / `--focus-ring`、高さは `--touch-target-min`。
  **矢印は `appearance: none` で消して器の `::after` が `currentColor` で描き直す**
  ——data URI の SVG では色を固定してしまい、明・暗・高コントラストの 3 通りに
  追従できない（3 通りとも撮って確認した）
- **幅は盤面に揃える。** 器を `--shell-max-width` で頭打ちにし、select は左右
  12px の差し込み（盤面の `padding` と同じ量）で伸ばす。**実測で select の
  左右端がキーの格子の左右端と一致する**（1280px と 768px で 456px、390px で
  366px、どちらも x 座標まで一致）
- **部品は 1 つにする。** `web/src/ui/Category/CategorySelect.tsx` を Scale と
  Convert が共有する。**見た目が揃っている必要がある器の CSS を 2 つの
  module に写すと、片方だけが動く**——写しは実際に 2 つあった

**【変更 2026-08-20】カテゴリ名は日英を併記する**（上の 3 について。ここが
カテゴリの器を決めた節なので、表記の裁定もここに置く）。

**「英語だけ」ではない。** 決め手は**盤面に出ている他の文字**である:

| どこ | いま出ている文字 |
|---|---|
| Nav のタブ | **英語**（`Scientific` / `Convert` / `Scale` / `Finance`） |
| 項目行・状態表示 | **日本語**（`変換元` / `変換先` / `値` / `帯域幅` / `層数` / `KVヘッド数`） |
| 単位のキー | **記号・ISO コード**（`km` / `°C` / `Mbps`） |

カテゴリの器は**その 2 つの層のあいだに座っている**。英語だけにすると、日本語の
項目行の真上に英語だけの行が来る。日本語だけだと、Nav が英語で名指した系統の
下でカテゴリだけが日本語になる。**併記は両方に接続する。**

**併記でなければ壊れる実例がある。** `データ量` は **Convert の `data-size`
（単位どうしの換算）と Scale の `data-scale`（規模の計算）で同じ文字列**である
（U-2 §2 が「別物である」と明記した 2 つ）。**画面上で両者を分けているのは英語だけ**
——`データ量 Data Size` と `データ量 Data Scale`。英語だけにしても分かれるが、
`データ量` という説明的な日本語を失う（`Data Scale` は訳語ではなく製品側の呼び名で、
「件数 × 次元数 × 型 → バイト数」を読み取れない）。

**幅は足りる（実測 2026-08-20）。** 併記でいちばん長いのは
`LLM のメモリ LLM Memory` の **196.9px**（16px、`system-ui`）。360px の画面で
select の文字に使えるのは **284px**（幅 336 − 左 12 − 矢印ぶん 40）なので、
**87px 余る。** 折り返しも省略も起きない。**幅が足りない語は 1 つも無い。**

英語名は spec の呼び名をそのまま使い、ここで訳し直さない——U-1 §4.2 と U-2 §2
（`Length` / `Mass` / `Temperature` / `Area` / `Volume` / `Speed` / `Data Size`）、
U-0 §1-3 の `Data Scale`、S-0 の題と §3.5 の `LLM Memory` / `Data Transfer`。

## §10 起点の設計書

**`docs/unit-convert-scale-spec.md` を追跡下に置いた**（ユーザー裁定、2026-08-19）。
この spec が参照している以上、リポジトリの外に置いたままにはできない。

**ファイル名だけ直した**——元は `unit-data-sscal-spec.md` で、`sscal` は `scale` の
打ち間違いである。**中身は 1 文字も触っていない**（43 節、1,570 行のまま）。

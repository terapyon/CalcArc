# 画面の現在地と読み上げ — 設計（**草案。裁定はまだ**）

日付: 2026-09-05
状態: **草案。§12 に利用者の裁定が要る論点が 4 件ある。** 実装には入っていない。
前提: **`origin/main` = `7070f95`**（0.7.0 出荷済み、履歴機能 `#117` はマージ済み）。
素材: `docs/superpowers/sdd/a11y-review-2026-09-03.md`（外部レビューの預かり）。
**その §7 に、この設計を書く過程で見つけた預かり自身の誤り 2 件を足してある。**

対象:

| | |
|---|---|
| `web/src/ui/screenName.ts`（新設） | 13 画面の日本語名を 1 か所で持つ（§2） |
| `web/src/App.tsx` | `document.title`・`<h1>`・切替の通知（§3・§4・§5） |
| `web/src/ui/tokens.css` | **「視覚的に隠す」の綴りを 1 か所に置く**（§4.2） |
| `web/src/ui/Keypad/Keypad.module.css` | 既存の隠し綴りをそこから引く（§4.2） |
| `web/src/ui/UpdateToast/UpdateToast.tsx` | **live 領域を常設にする**（§6。★ 途中で足された範囲） |
| `tools/check-boundary.mjs` | 隠し綴りの置き場を見張る 5 本目の規則（§4.2） |
| `web/tests/e2e/`・`web/src/**/*.test.tsx` | 番人（§10）と、**空主張になる既存の 3 本の直し**（§9） |

**`CHANGELOG.md` には触らない。** `## 0.8.0 — 未リリース` の節は
`calcarc-e6` が別の枝（`docs/changelog-history`）で起こしており、a11y のぶんは
**実装が終わってから `###` を足す**（`##` を二重に起こさない）。

---

## §0 この設計書が守ること

- **主張には現物を添える。** 下の数字・行番号は**すべて 2026-09-05 に
  `7070f95` の上で取り直した**。**預かりの行番号は使わない**——`ScientificPanel.tsx`
  は履歴機能で動いた（`:305` → `:629`）。
- **規律を書いたら番人を置く。置けないなら、置けない理由と代わりに何が守るのかを書く**
  （CLAUDE.md）。§10 がその表である。
- **jsdom はアクセシビリティツリーを組み立てない**（CLAUDE.md「踏んだ罠」）。
  **どの主張をどの層が持つかを、主張ごとに書く。**
- **「置いた」と「効く」は別。** §10 の各行には**それを破る変異**を書く。
  **実装の段で、その変異を実際に当てて赤を見ること。**

---

## §0.1 範囲

**入れる**（利用者の裁定「履歴 + a11y 優先度 1」）:

| # | 何を | 節 |
|---|---|---|
| 1 | 13 画面の日本語名を 1 か所で持つ | §2 |
| 2 | 切替時に `document.title` を更新する | §3 |
| 3 | `<main>` の中に視覚的に隠した `<h1>` を 1 つ置く | §4 |
| 4 | 切替を伝える `aria-live="polite"` の領域を 1 つ足す | §5 |
| 5 | **`UpdateToast` の live 領域を常設にする** | §6 |
| 6 | `aria-current="page"` は**変えない** | §7 |

**入れない**:

- **優先度 2（`useKeyboard` の汎用化）。** 別リリースである。**この設計書は
  触れない**——触れると範囲が滲む。
- **切替時の `main.focus()` による強制フォーカス移動**（レビュー本人が
  「やらなくてよい」としたもの）。
- **ARIA Tab パターンへの作り替え**（2026-09-03 に見送り裁定済み。理由は
  預かりの §6）。
- **画面上部に大きな見出しを足すこと**（縦を圧迫する。§4 の `<h1>` は
  視覚的には 0 である）。
- **axe などの自動 a11y 検査の導入**（預かり §4 の未決 #4。**別の軸の番人**
  であり、この 6 件とは独立に決める）。

---

## §1 現物（**2026-09-05、`7070f95`。この設計の土台**）

| 主張 | 現物 |
|---|---|
| `document.title` を触っている場所 | **0 件**（`web/src/` 全体）。`web/index.html` の `<title>CalcArc</title>` だけ |
| `toHaveTitle` を使う E2E | **0 件。** タイトルには**いま番人が 1 つも無い** |
| `<h1>`〜`<h6>` を持つソース | **1 件**（`web/src/ui/History/History.tsx:64` の `<h2>履歴</h2>`） |
| `getByRole("heading")` を使う E2E | **1 件**（`web/tests/e2e/history.spec.ts:41`） |
| `aria-current="page"` | `web/src/ui/Nav/Nav.tsx:34` |
| 「視覚的に隠す」の既存の綴り | **1 件**（`web/src/ui/Keypad/Keypad.module.css:65-75` の `.offDescription`。註は `:62-64`） |
| 全 route | **13**（scientific 1 + convert 8 + scale 3 + finance 1）。`docs/definition-of-done.md:269` と `web/tests/e2e/viewport-budget.spec.ts` の註が同じ数を持つ |

**★ `<h1>` が無いのに `<h2>` が在る。** いま `web/src` の見出しは
`History.tsx` の `<h2>履歴</h2>` **ただ 1 つ**で、その上に `<h1>` が無い。
**履歴機能がこの穴を作ったのではない**——`<h1>` はもともと 0 件だった。
だが**見出しの階層が飛んでいる状態は履歴機能で初めて生まれた**（それまで
見出しが 1 つも無かったので、飛びようが無かった）。§4 の `<h1>` はこれも直す。

### §1.1 いま在る live 領域（**実測。390×844 で列挙した**）

```
#finance      SPAN[off]:求めるもの  SPAN[off]:入力中の項目  OUTPUT[polite]:display-main
#scientific   SPAN[polite]:角度の単位  SPAN[polite]:数の表記
              SPAN[off]:計算の途中経過  SPAN[off]:表示形式  OUTPUT[polite]:display-main
履歴の面       **0 件**
```

**履歴の面には live 領域が 1 つも無い**——`Display` ごと置き換わるからである
（`ScientificPanel.tsx` の `showingHistory` 分岐）。§5 の通知領域は
`App` が持つので、**履歴の面でも在る**唯一の live 領域になる。

---

## §2 画面名 — **13 個。1 か所で持つ**

### 裁定案 2（**§12-1 で利用者の確認が要る。利用者に見える文字列である**）

| # | route | 画面名 | 綴りの出どころ |
|---|---|---|---|
| 1 | `#scientific` | 関数電卓 | **新しい綴り** |
| 2 | `#convert/length` | 長さの換算 | `CATEGORY_LABELS.length` = 「長さ」 |
| 3 | `#convert/mass` | 質量の換算 | 同 `mass` |
| 4 | `#convert/temperature` | 温度の換算 | 同 `temperature` |
| 5 | `#convert/area` | 面積の換算 | 同 `area` |
| 6 | `#convert/volume` | 体積の換算 | 同 `volume` |
| 7 | `#convert/speed` | 速さの換算 | 同 `speed` |
| 8 | `#convert/data-size` | データ量の換算 | 同 `data-size` |
| 9 | `#convert/currency` | 為替の換算 | 同 `currency` |
| 10 | `#scale/data-scale` | データ量の規模 | `ScalePanel` の `LABELS["data-scale"].ja` = 「データ量」 |
| 11 | `#scale/llm` | LLM のメモリ | 同 `llm`（**そのまま**） |
| 12 | `#scale/transfer` | データ転送 | 同 `transfer`（**そのまま**） |
| 13 | `#finance` | 金融計算 | **新しい綴り** |

**新しい綴りは 2 つだけである。** 残り 11 は**既にリポジトリに在る日本語**を
使う——`web/src/ui/Keypad/convert.ts:77` の `CATEGORY_LABELS`（8 個）と
`web/src/ui/Scale/ScalePanel.tsx:21` の `LABELS`（3 個）。**同じものの綴りを
2 つ持たない。**

**★ 「データ量」が 2 つある。** Convert の `data-size`（単位どうしの換算）と
Scale の `data-scale`（規模の計算）は**日本語のラベルが両方とも「データ量」**
である（U-2 §2、`CategorySelect.tsx:10-12` の註）。いまの画面は
**日英併記でほどいている**（`データ量 Data Size` / `データ量 Data Scale`）。
**タイトルと見出しに英語を混ぜたくない**ので、ここでは
**「データ量の換算」と「データ量の規模」**でほどく。**これは新しい語形であり、
§12-1 の確認対象である。**

### §2.1 置き場 — **`web/src/ui/screenName.ts`（新設）**

**`route.ts` には置かない。** あのファイルの註は「**React を import しない**
（`web/src/calc` と同じ境界の流儀）」と書いており、**UI 層の表示文字列を
持たせると、`ui/Keypad/convert.ts` と `ui/Scale/ScalePanel.tsx` を
`route.ts` が import することになる**——境界の向きが逆になる。
**画面名は UI 層のものである。**

```ts
// web/src/ui/screenName.ts
export const SCREEN_NAMES: {
  scientific: string;
  finance: string;
  convert: Record<ConvertCategoryId, string>;   // 8 個。1 つ抜けたら typecheck が落ちる
  scale: Record<ScaleCategory, string>;         // 3 個。同上
};
export function screenName(route: Route): string;
```

**`Record<…>` にするのは、カテゴリが増えたときに埋め忘れが typecheck で
落ちるからである**——`Nav.tsx` の `MODULES` と `ScalePanel` の `LABELS` が
既に採っている流儀に合わせる。**11 個の網羅は型が持つ**ので、数える必要が
あるのは**「11 + 2 = 13」の 2 のほう**だけになる（§10 の 1 行目）。

### §2.2 **表は手で書く。ただし出どころとの繋がりを機械が見張る**

「`${CATEGORY_LABELS[id]}の換算` と組み立てる」形も採れるが、**採らない**。
**利用者が承認するのは 13 個の綴りそのもの**であって、組み立て規則ではない
——**組み立てにすると、承認された綴りが画面のどこにも書かれていない**状態になる。

代わりに**繋がりのほうを見張る**: `convert` の 8 個は `CATEGORY_LABELS[id]` を
**含む**、`scale` の 3 個は `LABELS[id].ja` を**含む**、という検査を置く
（§10）。**`長さ` を改名した日に、画面名だけ古いまま残ることが無くなる。**

---

## §3 `document.title` — **`<画面名> | CalcArc`**

### 裁定案 3

| 論点 | 決め |
|---|---|
| 書式 | **`<画面名> \| CalcArc`**（区切りは 半角スペース・縦棒・半角スペース） |
| アプリ名の位置 | **後ろ。** 先頭に画面名を置く——タブが並んだときに読めるのは先頭だけであり、読み上げも先に画面名を言う |
| 初期表示 | **最初の描画で更新する。** `index.html` の `CalcArc` のままにしない——`/`（ハッシュ無し）は `routeFromHash` が `scientific` へ倒すので **`関数電卓 \| CalcArc`** になる |
| 知らないハッシュ | 同上。`routeFromHash` が既定へ倒した結果の画面名を使う（**互換分岐を作らない**という `route.ts` の裁定に乗る） |
| 履歴の面 | **変えない。** §8 を読むこと |
| `og:title` | **変えない。** `index.html` の静的な `CalcArc` のまま——クローラは JS を待たない |

**書き込みは `App` の effect で行う。** `route` が変わるたびに
`document.title = ...` を入れる。**`react-helmet` のような仕掛けは入れない**
——1 行で足りる。

---

## §4 `<h1>` — **`<main>` の中に 1 つ。視覚的には 0**

### 裁定案 4

- **`App.tsx` が持つ。** 各パネルではなく `<main>` の直下に置く。
  **`<h1>` がちょうど 1 つであることが、置き場所そのもので保証される**
  ——パネル側に置くと、パネルが 2 つ同時に出た日に 2 つになる。
- **文字列は §2 の画面名そのもの**（`関数電卓`）。**タイトルの前半と同じ文字列
  である**——2 つが食い違うと、見出しで確認した名前とタブの名前が違うことになる。
- **`History` の `<h2>` はそのまま。** `<h1>`（画面）→ `<h2>`（その中の面）と
  いう階層になり、いま飛んでいる段が埋まる（§1）。

### §4.1 縦の予算 — **実測で 0**

`viewport-budget.spec.ts` が **Finance で 8px 以上の余白**を要求しており、
過去にフッタの 1 行で 3.3px まで落ちた実績がある。**先に測った**
（390×844、`#finance`、隠した `<h1>` を `<main>` の先頭へ差し込んで再計測）:

```
h1 の高さ                 1px
document のはみ出し        0
横のはみ出し               0
```

**縦の予算は動かない。** ただし**測ったのは 390×844 の Finance 1 route だけ**
である——**実装の段で 13 route × 2 幅の既存検査を通すこと**（それが本番の測定である）。

### §4.2 「視覚的に隠す」の綴り — **1 か所に置き、規則で見張る**

**`display: none` と `visibility: hidden` は読み上げからも消える。**
使うのは**既にこのリポジトリに在る綴り**である——
`web/src/ui/Keypad/Keypad.module.css:65-75` の `.offDescription`（`aria-describedby`
が届くように「**在るまま画面から外す**」と註がある）:

```css
position: absolute;
width: 1px;
height: 1px;
margin: -1px;
padding: 0;
overflow: hidden;
clip-path: inset(50%);
white-space: nowrap;
border: 0;
```

**これを `web/src/ui/tokens.css` に `.visually-hidden` として置き**、
`Keypad.module.css` の `.offDescription` は
`composes: visually-hidden from global;` でそこから引く。**綴りは 1 つになる。**

**置き場の理由**: `tokens.css` は `main.tsx` が 1 度だけ import する
**唯一のグローバル CSS** であり、既に `*` と `body` のグローバル規則を持つ。
**`--touch-target-min` が `tokens.css` に 1 か所だけ在る**のと同じ形である。

**番人**: `tools/check-boundary.mjs` に **5 本目の規則**を足す——
**`clip-path: inset(50%)` を宣言として書いてよいのは `web/src/ui/tokens.css` だけ**。
**4 本目（`44px`）と同じ形の規則である**（宣言の行だけを見る／`.css` だけを見る／
註の中の綴りは違反にしない）。

### §4.3 **「本当に読み上げられる」は何が保証するか**

**保証できるのは「アクセシビリティツリーに出ていること」までである。**
**実際に読み上げソフトが喋ることを、この CI は確かめない。** そのうえで、
**取り違えの本命（`display:none` / `visibility:hidden` にしてしまう）は
機械で止まる**。**実測した**（390×844、3 通りの `<h1>` を差し込んで
Playwright の役割クエリに掛けた）:

| 隠し方 | `getByRole("heading", { level: 1, name })` |
|---|---|
| `clip-path` の綴り（上） | **1 件（見える。矩形は 1×1）** |
| `display: none` | **0 件** |
| `visibility: hidden` | **0 件** |

**したがって E2E の 1 行が番人になる**——隠し方を取り違えた日に
**その行が要素を見つけられずに赤くなる**。§10 の該当行に、この変異を書いてある。

---

## §5 切替の通知 — **`polite` の領域を 1 つ。常設**

### 裁定案 5

| 論点 | 決め |
|---|---|
| 文面 | **`<画面名>に切り替えました`**（例:「金融計算に切り替えました」） |
| `polite` か `assertive` か | **`polite`。** 画面の切替は**利用者自身が起こした**ことで、事故ではない。`assertive` は読み上げ中の発話を割り込んで捨てるので、いま読んでいる結果を消してしまう。**`UpdateToast` が同じ理由で `polite` を選んでいる**（`UpdateToast.tsx:63` の註「更新は事故ではない。読み上げを割り込ませない」） |
| 置き場 | **`App` が持つ。** `<Nav>` と `<main>` のあいだ。**`route` が何であっても在る**——履歴の面を含め、**このアプリで唯一いつでも在る live 領域**になる（§1.1） |
| 常設か | **常設。** 空の領域を先に置き、切替のときに文面を入れる。**領域と中身を同時に挿入すると鳴らない**（§6 と同じ理由。手本は `Readout.tsx:69-90`） |
| 初回の読み込み | **鳴らさない。** 「切り替えました」は嘘になるし、読み込み直後の読み上げに重なる。**effect の 1 回目を飛ばす**（`ScientificPanel` の `savedScientific` が同じ形を採っている） |
| 見た目 | **視覚的に隠す**（§4.2 の `.visually-hidden`）。画面には 1 文字も増えない |

**★ 既存の `polite` 領域と重なる。** Scientific には
`SPAN[polite]:角度の単位` `SPAN[polite]:数の表記` `OUTPUT[polite]:display-main`
が在り（§1.1）、切替の直後はそれらも新しい値で描かれる。**`polite` は順番に
読まれるので割り込みはしない**が、**読み上げが長くなる**。
**これは実測で確かめられない**（読み上げソフトを CI で走らせていない）
——**§12-4 として利用者に上げる。**

---

## §6 `UpdateToast` の live 領域 — **常設にする**（★ 途中で足された範囲）

### §6.1 現物

```
UpdateToast.tsx:56    if (!waiting) return null;
UpdateToast.tsx:59-65 <div role="status" aria-label="更新のお知らせ" aria-live="polite">
```

**更新が来るまで領域は DOM に無い。** 領域と中身が**同時に**挿入されるので、
**多くの読み上げはそのとき鳴らない**。**「在る」と「鳴る」は別**である
（預かりの表はここを混ぜていた。訂正は預かりの §7-1）。

### 裁定案 6

```
<div role="status" aria-label="更新のお知らせ" aria-live="polite">   ← 常に在る。空
  {waiting && <div className={styles.toast}> …メッセージとボタン… </div>}
</div>
```

- **常設にするのは領域だけ。** メッセージとボタンは `waiting` のときだけ描く
  ——**空のときにボタンが在ると、見えないものにフォーカスが入る。**
- **`.toast` は `position: fixed` なので**（`UpdateToast.module.css:2`）、
  外側の空の `<div>` は**通常フローで高さ 0** になる見込みである。
  **これは見立てであって実測ではない**——**実装の段で
  `viewport-budget.spec.ts` の 13 route × 2 幅を通すこと。**
- **手本に合わせる。新しい流儀を作らない。** `Readout.tsx:69-90` は
  条件付き return を持たず、空のまま領域を置く。番人も在る
  （`eng-notation.spec.ts:34,58,88` の
  `expect(getByRole("status", { name: "数の表記" })).toBeEmpty()`）。

### §6.2 **`Escape` の capture 分岐には手を触れない**

`UpdateToast.tsx:45-54` の effect は `waiting` を見て
`window.addEventListener("keydown", onKeyDown, true)` を張る。**capture であること
が必須**である——`useKeyboard` の `KEYBOARD_MAP` は `Escape: "ac"` なので、
bubble で受けると**閉じた瞬間に AC が走って計算が全部消える**。

**この分岐は `waiting` を読むので、§6 の変更で手が届く場所にある。**
**番人が在ることを実測で確かめた**（2026-09-05）:

```
変異: window.addEventListener("keydown", onKeyDown, true)  →  … onKeyDown)
結果: × UpdateToast > swallows the Escape so the calculator does not clear
      Tests  1 failed | 7 passed (8)
```

**`web/src/ui/UpdateToast/UpdateToast.test.tsx` の
「swallows the Escape so the calculator does not clear」が本物の番人である。**
**effect の中身は変えないこと。** 変える必要も無い——変えるのは
`return null` の 1 行と JSX の入れ子だけである。

---

## §7 `aria-current="page"` — **変えない**

`web/src/ui/Nav/Nav.tsx:34` に在り、`Nav.test.tsx:37-64` が見張っている
（5 つの assert）。**レビュー本人も「維持」と書いている。**
**この設計書はここに 1 文字も触れない。**

---

## §8 履歴機能との干渉 — **実測。1 件だけ、意図して残す**

**2026-09-05、`7070f95` で履歴の面を開いて測った**（Scientific → Shift → 履歴）:

```
見出し          ["H2:履歴"]
ハッシュ        #scientific（変わらない）
document.title  CalcArc（変わらない）
main の子の数    1
live 領域        0 件
```

| 干渉するか | 結論 |
|---|---|
| `<h1>` が 2 つになる | **ならない。** `History` が持つのは `<h2>` 1 つで、`<h1>` は `App` が持つ |
| 見出しの階層が飛ぶ | **いまは飛んでいる**（`<h2>` の上に `<h1>` が無い）。**§4 がこれを直す** |
| `main.firstElementChild` を見る検査 | **★ 壊れる。§9-1 を読むこと** |
| 履歴の面で `<h1>` が消える | **消えない。** `App` が持つので、パネルの中身に関わらず在る |
| 履歴の面で live 領域が無くなる | **§5 の領域だけは在る。** いまは 0 件なので、**増える方向である** |

### §8.1 **履歴の面はタイトルを変えない**（意図）

履歴の面は**ルートではない**——`showingHistory` はコンポーネントの state であり、
ハッシュは `#scientific` のままである（上の実測）。したがって
**`document.title` も `<h1>` も「関数電卓」のまま**で、見えている面は「履歴」になる。

**これは穴である。** 見出しで移動する利用者は `<h1>関数電卓` → `<h2>履歴` と
辿れるので**現在地は分かる**が、**タイトルだけを見ている利用者には切替が見えない**。

**それでも変えない。** 変えるなら履歴の面を**ルートにする**（`#scientific/history`）
のが筋であり、それは URL 設計の変更——**この設計書の範囲ではない**。
**§12-3 として利用者に上げる。**

---

## §9 ★ 既存の番人に起きること — **3 本が空主張または赤になる**

**これを書かずに実装へ渡すと、直した側は「緑だから通った」と読む。**

### §9-1. `viewport-budget.spec.ts` の余白検査が**空主張になる**

```js
// tests/e2e/viewport-budget.spec.ts:「the tallest tab still has slack inside the screen」
const main = document.querySelector("main");
const panel = main?.firstElementChild;     // ← ここ
return main.getBoundingClientRect().height - panel.getBoundingClientRect().height;
```

**`<h1>` を `<main>` の先頭に置くと、`panel` が `<h1>` になる。** 実測:

| | `main` の 1 番目の子 | 測られる「余白」 |
|---|---|---|
| いま（`#finance`） | `SECTION`（パネル） | **16.3125px**（要求は 8 以上） |
| `<h1>` を差し込んだ後 | `H1` | **742**（`main` の高さそのもの） |

**緑のまま、何も測らなくなる。** これは**この 2 週間で 2 度目の形**である
（履歴の枝で「番人を通すために既存の番人を狭めた」指摘が出ている）。

**直し方（この設計の一部として実装する）**:

1. パネルの取り方を**明示にする**——`main.querySelector(":scope > :not(h1)")` の
   ように「見出しではない子」を取る、あるいは `main.lastElementChild` にする。
2. **測ったものがパネルであることを assert する**——`panel` の高さが
   **`main` の高さの半分以上**であることを先に確かめる。
   **「1×1 の要素を測って緑になった」を二度と起こさない**ための下限である。

**この 2 つを入れずに `<h1>` を足すことを禁じる。**

### §9-2. `UpdateToast.test.tsx:23-28` は**いまと逆のことを assert している**

```js
it("says nothing until an update is waiting", … {
  expect(screen.queryByRole("status")).toBeNull();     // ← §6 でこれは偽になる
});
```

**この 1 本は書き換える。** 新しい主張は
**「領域は在る。ただし空である」**——`Readout` 側の
`eng-notation.spec.ts` の `toBeEmpty()` と同じ形にする。
**題も変える**（`says nothing` は「DOM に無い」と読めるので、
「keeps the region in place but empty until an update is waiting」のように）。

### §9-3. `UpdateToast.test.tsx:98` の待ち方が**効かなくなる**

```js
armed.needRefresh();
await screen.findByRole("status");        // ← 常設にすると即座に解決する
await userEvent.keyboard("{Escape}");
```

**領域が常設になると `findByRole("status")` は最初から在るものを返す**ので、
**トーストが描かれる前に `Escape` を打つ**ことになりうる。**待つ対象を
中身に変える**（`await screen.findByText(/新しいバージョンがあります/)`）。

**この 1 本は §6.2 の本物の番人である**（変異で赤を実測済み）。
**待ち方を直さずに常設化すると、その番人が不安定になる。**

---

## §10 番人の表 — **主張ごとに、どの層が持つか**

| # | 主張 | 層 | 番人 | **これを破る変異** |
|---|---|---|---|---|
| 1 | 画面名は **13 個**ある | vitest | `screenName.test.ts`: `1 + CONVERT_CATEGORY_IDS.length + SCALE_CATEGORIES.length + 1` と実際の件数が一致 | 1 行消す |
| 2 | 11 個の網羅 | **typecheck** | `Record<ConvertCategoryId, string>` / `Record<ScaleCategory, string>` | 1 カテゴリを消す |
| 3 | 画面名は既存のラベルと繋がっている | vitest | `screenName.test.ts`: 各 convert 名が `CATEGORY_LABELS[id]` を、各 scale 名が `LABELS[id].ja` を**含む** | `CATEGORY_LABELS.length` を「長さ」→「距離」に改名 |
| 4 | 13 route すべてでタイトルが `<画面名> \| CalcArc` になる | **E2E** | 新規 `screen-identity.spec.ts`: 13 route を巡回し `toHaveTitle` で**逐一の期待値**と突き合わせる | 書式の `\|` を `-` に変える／1 route の名前を変える |
| 5 | その 13 が全 route である | E2E | 同ファイル: 一覧の件数を `CONVERT_CATEGORY_IDS`/`SCALE_CATEGORIES` から導いた数と突き合わせる（**期待値は逐一、網羅だけを導く**） | カテゴリを足して一覧に書き忘れる |
| 6 | `<h1>` が**ちょうど 1 つ**で、名前が画面名と一致する | **E2E** | 同ファイル: `getByRole("heading", { level: 1, name })` が 1 件 | `<h1>` を `<div>` に変える |
| 7 | その `<h1>` が**アクセシビリティツリーに出ている** | **E2E** | 同上（役割クエリは `display:none` / `visibility:hidden` を見つけない。§4.3 で実測） | `.visually-hidden` を `display: none` にする |
| 8 | 隠し綴りが 1 か所にしか無い | **CI（lint 相当）** | `tools/check-boundary.mjs` の 5 本目（`clip-path: inset(50%)` は `tokens.css` だけ） | 別の `.css` に同じ綴りを書く |
| 9 | 切替の通知領域が**常に在る** | vitest | `App.test.tsx`: 初期描画で `getByRole("status", { name: … })` が在り `toBeEmpty()` | 領域を条件付きにする |
| 10 | 切替で通知の文面が入る | vitest | `App.test.tsx`: ハッシュを変えて `「金融計算に切り替えました」` | 文面を組み立てる行を消す |
| 11 | **初回は鳴らない** | vitest | `App.test.tsx`: 初期描画直後は空のまま | 1 回目を飛ばす条件を消す |
| 12 | 通知が `polite` である | vitest | `App.test.tsx`: `aria-live` 属性が `polite` | `assertive` に変える |
| 13 | `UpdateToast` の領域が**更新前から在る** | vitest | `UpdateToast.test.tsx`（§9-2 で書き換える 1 本） | `if (!waiting) return null` を戻す |
| 14 | `UpdateToast` が出たときの形 | E2E | 既存 `update-toast.spec.ts:12`（**変えない**） | — |
| 15 | `Escape` が capture で止まる | vitest | 既存 `UpdateToast.test.tsx`「swallows the Escape…」（**変異で赤を実測済み**） | `addEventListener` の `true` を外す |
| 16 | `<h1>` が縦の予算を食わない | E2E | 既存 `viewport-budget.spec.ts` 13 route × 2 幅（**§9-1 の直しが前提**） | `.visually-hidden` の `position: absolute` を外す |
| 17 | 余白の検査が**本当にパネルを測っている** | E2E | `viewport-budget.spec.ts` に足す下限（§9-1 の 2） | パネルの取り方を `firstElementChild` に戻す |

### §10.1 **番人を置けないもの**（置けない理由と、代わりに何が守るか）

| 置けない主張 | なぜ | 代わりに何が守るか |
|---|---|---|
| **読み上げソフトが実際に喋る** | CI に読み上げソフトが無い。入れる予定も無い | **#7**（ツリーに出ていること）。**「出ている」までが機械で言えることであり、「喋る」は言えない**——この差を口頭でも書面でも縮めないこと |
| **`polite` が実際に割り込まないこと** | 同上 | 無し。**`polite` を選んだ理由**（§5）が根拠のすべてである |
| **切替の文面が自然に聞こえること** | 同上 | 利用者の確認（§12-2） |
| **タイトルが「現在地として役に立つ」こと** | 主観 | 利用者の確認（§12-1） |

---

## §11 やらないこと（**再掲。範囲が滲まないように**）

- `useKeyboard` の汎用化（**優先度 2。別リリース**）
- `main.focus()`
- ARIA Tab パターン
- 画面上部の見た目の見出し
- axe の導入
- `CHANGELOG.md`（`calcarc-e6` の枝と衝突する）
- `UpdateToast` の `Escape` capture 分岐（§6.2）
- `aria-current`（§7）

---

## §12 未決 — **利用者の裁定が要る 4 件**

| # | 論点 | 私の推し |
|---|---|---|
| 1 | **13 個の画面名の綴り**（§2 の表）。**利用者に見える文字列である**。特に**新しい 2 つ**（`関数電卓` / `金融計算`）と、**新しい語形の 2 つ**（`データ量の換算` / `データ量の規模`） | 表のまま |
| 2 | 通知の文面「**〜に切り替えました**」 | このまま |
| 3 | **履歴の面がタイトルを変えないこと**（§8.1）。変えるなら履歴をルートにする話になり、URL 設計の変更である | **今回は変えない。** 別の spec で扱う |
| 4 | **切替の直後、`polite` の読み上げが長くなること**（§5）。既存の `polite` 領域（角度・記法・表示）と順番に読まれる。**CI では確かめられない** | 出してから実機で聞いて決める |

**#1 が決まらないと実装に入れない**——13 個の綴りが実装そのものだからである。
**#2〜#4 は実装しながらでも動かせる。**

---

## §13 この設計書の弱い所

- **読み上げソフトで踏んでいない。** 上の実測はすべて **DOM と
  アクセシビリティツリーの話**であり、**音を聞いていない**。
- **`§4.1` の縦の予算は 1 route（Finance、390×844）でしか測っていない。**
  13 route × 2 幅は既存の E2E が持つので、**実装の段が本番**である。
- **`§6` の「空の領域は高さ 0」は見立てである。** `.toast` が
  `position: fixed` であることから推したもので、**測っていない**。
- **W3C の Page Titled をこちらで読んでいない**（預かりの §5 と同じ。**未確認**）。

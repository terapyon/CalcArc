# staging — main にマージしたものを見る 1 本の URL

**2026-09-30。起点は `2b478f0`（= v1.0.0）。** 利用者の要望
「**main マージか PR を作ったときに確認できる URL（可能なら固定）が欲しい**」に対する設計。
**裁定は「main マージで 1 本だけ」**（2026-09-29）——**PR ごとの URL は作らない。**

---

## 1. 測って分かったこと

**この節は現物だけ。** 判断は §2 から。

### 1.1 仕組みは既に在る

`.github/workflows/deploy.yml` の配信の段:

```yaml
command: pages deploy web/dist --project-name=calcarc --branch=main
```

**`--branch` が本番とプレビューを決める**（同ファイルの註。「Direct Upload は `--branch` が
本番/プレビューを決める」）。**`main` 以外を渡せば、Cloudflare Pages はプレビューとして配り、
URL を返す。** **新しい仕組みは要らない。**

### 1.2 URL は 2 種類あり、片方は固定

| 形 | 例 | |
|---|---|---|
| デプロイごと | `<hash>.calcarc.pages.dev` | **毎回変わる** |
| **枝ごとの別名** | **`staging.calcarc.pages.dev`** | **同じ枝名なら常に同じ** |

**`--branch=staging` と決め打てば、URL は 1 本に固定される。**

### 1.3 ★ `main` を渡すと、それは本番配信である

**Pages の本番枝は `main`** ——`deploy.yml` が本番へ配るときに `--branch=main` を渡している。
**つまり「main にマージされたら `--branch=main` で配る」と書いた瞬間、
`calc.terapyon.net` に出る。** **タグだけが本番への扉、という裁定
（2026-08-25）を壊す。**

**★ これは推定ではなく、証明済みである**（2026-09-30、レビュー役）。
**`deploy.yml` は `--branch=main` で配った直後に `calc.terapyon.net/build-info.json` が
`$GITHUB_SHA` を返すまで待つ**（1 本目のスモーク）。**カスタムドメインは本番デプロイにしか
付かない**ので、**その緑が「Pages の本番枝 = main」の証明**である
（`v1.0.0` の走行 `36541199129` が success）。

**外れ方の向きも決まっている**——**本番枝が `main` 以外なら `--branch=main` もプレビューになり、
`--branch=staging` も当然プレビューである。** **安全側にしか外れない。**
**本番へ出る唯一の形は「Pages の設定画面で本番枝を `staging` に変える」**で、
**それはリポジトリの外**である。**`docs/deploy.md` に
「本番枝の名は `main`。`staging.yml` の枝名と一致させない」を 1 行残す。**

### 1.4 検査は写さずに呼べる

`ci.yml` は **`workflow_call` を持つ**（`:11`）。`release.yml` が
`uses: ./.github/workflows/ci.yml` で呼んでいる（`:79`）。**同じ形で `staging.yml` からも呼べる**
——**検査の定義を写さない**（`ci.yml` の註:「**写しを持つと、片方だけ直された日に**」）。

### 1.5 マニュアルの PDF は 11 秒で作れる

`web/package.json:24` の `"manuals": "pnpm shots --grep @manual && pnpm manual --shots manual-shots"`。
**手元の実測は 2 段で 11.0 秒**（`ci.yml:71` の註）。
**本番の配信は `manuals` ジョブの artifact を受け取っている**（`deploy.yml` の
`download-artifact`、`if: inputs.called_from_release`）。

### 1.6 `docs/deploy.md` はいま「プレビューも作らない」と書いている

`docs/deploy.md:5-8`:

> **2026-08-25 に契機が変わった。** それまでは main への push が即本番だった。
> いまは**タグだけが本番への扉**で、main への push はどこにも配らない
> （**プレビューも作らない**）。

**この 1 行を書き換える裁定である。**

---

## 2. 決めたこと

### 2.1 何を作るか

**`.github/workflows/staging.yml` 1 本。** **`main` への push で走る。**

```
main に push
  ↓ ① 検査（ci.yml を呼ぶ。約 4 分）
  ↓ ② マニュアルの PDF（約 11 秒＋道具の用意）
  ↓ ③ wasm-pack → vite build → 刻印 → check:sw
  ↓ ④ wrangler pages deploy --branch=staging
  ↓ ⑤ 配ったものが出ているかを確かめる
https://staging.calcarc.pages.dev
```

**`calc.terapyon.net` は `v*` タグだけ。そこは 1 バイトも変えない。**

### 2.2 検査を通してから配る（利用者の裁定 2026-09-29）

**`ci.yml` を `workflow_call` で呼ぶ。** **写しは持たない。**
**赤いものを staging に出すと「直したつもりが出ていない」を生む**ので、
**4 分を払って通す。**

### 2.3 マニュアルの PDF も作る（利用者の裁定 2026-09-29）

**作らないと PDF 3 本が 404 になり、「本番と同じものを見ている」と言えなくなる。**
**11 秒で作れるので、払う。**

### 2.4 番人を 2 つ置く

**① 配る命令が、ちょうどこの綴りであること。**

**★ 否定形にしてはいけない**（2026-09-30、レビュー役の阻止 A1）。
**`wrangler pages deploy` は `--branch` を省くと git の現在の枝名を使う**
——**main への push で checkout した runner では HEAD が `main`** なので、
**省略はそのまま本番配信である。** **「`main` や `production` が入っていない」という
主張は、省略を緑で通す。** **変数経由（`--branch=${{ … }}`）も同じ。**

**肯定形の等値にする**——`staging.yml` の `command:` が

```
pages deploy web/dist --project-name=calcarc --branch=staging
```

**に等しい**こと（**`${{` を含まない**、**`--branch=` がちょうど 1 回**）。
`tools/tests/release-workflow.test.ts:866-879` が `deploy.yml` を読むのと同じ形で。

**② 配ったものが staging に出ていること。**

**`build-info.json` の刻印が今回の SHA と一致するまで待つ**（`deploy.yml` の
1 本目のスモークと同じ形、同じ再試行）。**無いと「出たつもり」で終わる。**

**②b 本番が動いていないこと**（2026-09-30、レビュー役の条件 B1）。
**どんな経路で枝名が壊れても、最後に効くのはこれ**である。
**配る前に `calc.terapyon.net/build-info.json` の commit を控え、配った後に同じ値のまま**
であることを主張する。

**★ 「≠ `$GITHUB_SHA`」にしてはいけない**——**リリース直後は main の先頭とタグの SHA が
一致する**ので、**偽の赤になる。** **「配る前と同じ」で見る。**

**②c 配った PDF が届いていること**（レビュー役の条件 B3）。
**§2.3 が PDF を作る理由は「404 にしない」なのに、それを検査しなければ裁定の当のものが
未検査になる。** 本番と同じ形で——**`ls web/dist/manual` から名前を取り**（版数を綴ると
上げ忘れた日に緑になる）、**再試行つき**で。

**②d staging に `X-Robots-Tag: noindex` が在ること**（レビュー役の条件 B2）。
**`dist/_headers` への追記は黙って失敗しうる**——**末尾に改行が無いと `/*` が前の行に繋がる。**
**追記は `printf '\n/*\n  X-Robots-Tag: noindex\n' >>` の形**にし、**配った先で在ることを見る。**

### 2.4b 刻印に `"channel":"staging"` を足す

**`build-info.json` が本番と staging で同じ形だと、人も番人 #3b も見分けに commit しか
使えない**（レビュー役の注記 C3）。**staging の刻印にだけ `"channel":"staging"` を足す。**
**本番の刻印は触らない**——**`deploy.yml` を触ると、次の Release で初めて試すことになる。**

### 2.4c 各ジョブに `timeout-minutes` と `permissions: contents: read`

`ci.yml` の規律（註:「**書かないと GitHub の既定は 6 時間**」）。**配る段の上限は、
本番の 20 分ではなく、staging の実測から決める**——**スモークの再試行予算が本番より
少ない**（3 本 × 12 回 × 10 秒 = 6 分）ので、**初回の走行を測ってから置く。**

### 2.5 検索に載せない

**プレビュー URL は公開される。** **本番と同じ中身が 2 つの URL で引けると、
利用者が staging に迷い込む。** **`X-Robots-Tag: noindex` を付ける。**

**`web/public/_headers` は本番と共用なので、そこには書かない**
——**staging の配信の段でだけ足す**（`dist/_headers` に追記してから配る）。
**本番の `_headers` を汚さない。**

**★ 本番に `X-Robots-Tag` が無いことも見る。置き場は `staging.yml`**
（2026-09-30、レビュー役の条件 B2 と監視役の反対案を突き合わせた結論）。

**「本番の `_headers` に書かれていない」だけでは足りない**——**Cloudflare の設定画面
（Transform Rules など）から入った `noindex` は、リポジトリの検査では誰も見ない。**
**守りたい事故は遅くて静か**なので、**気づく仕組みは頻繁に走る場所に要る。**

**`deploy.yml` には足さない**（監視役の反対案）——**あのスモークは `wrangler` の後**で、
**同ファイルが「いちばん悪い終わり方」と呼ぶ区間**にある。**そこを増やさない。**

**代わりに `staging.yml` の「本番が動いていないことを控える」段に 1 行**:
```bash
curl -sSI https://calc.terapyon.net/ | grep -qi x-robots-tag && exit 1
```
**この置き場が優れている理由が 4 つ**:
- **main への push ごとに走る**ので、**設定画面の経路も日の単位で見つかる**（Release 時より早い）
- **`deploy.yml` を触らない**
- **赤くなっても本番は 1 バイトも動いていない**（staging の走行が止まるだけ。
  **「出たまま未検査」にならない**）
- **本番を読む `curl` が 1 か所に集まる**（番人 #3b と同じ段）

**基線は確かめた**——**2026-09-30 の実測で、`calc.terapyon.net` の応答に `X-Robots-Tag` は
0 件**（`curl -sSI … | grep -ci x-robots-tag` → `0`）。

**★ 監視役の反対案には、言い過ぎが 1 つあった**——「**間違いは本番配信の最中に初めて出る**」。
**公開 URL への読み取りは手元で試せる**（上の実測がそれである）。**置き場の判断は変わらないが、
理由の 1 つは成り立っていなかった。**

### 2.6 `docs/deploy.md` を書き換える

**「main への push はどこにも配らない（プレビューも作らない）」**を、
**「main への push は staging に配る。本番はタグだけ」**に。

**理由も残す**——**2026-08-25 の懸念は「main の先頭が本番になる」ことだった。**
**`staging` という別の枝名なら本番には届かない**ので、**あの懸念は staging には当たらない。**

---

## 3. 作らないもの

- **PR ごとの URL**（利用者の裁定 2026-09-29「main マージで 1 本だけ」）。
  **PR 段階では見ない**——**マージしてから確かめ、悪ければ revert を積む。**
- **staging へのアクセス制限**（Cloudflare Access）。**公開されている電卓の写しであり、
  秘密は無い。** **検索に載せないことだけ手当てする**（§2.5）。
- **本番のスモーク 5 本のうち 3 本**（`_headers` が効く・HTML の束・**無い** PDF が 404）。
  **staging が持つのは 4 本**（刻印・本番が動いていない・配った PDF・noindex）。
  **落とした理由**: **staging で先に見えることに価値があるのは配信物そのもの**
  （**PDF が届くか**・**検索に載らないか**）で、**配信経路が正しいかはタグの走行が持つ。**
  （**2026-09-30 に書き直した**——初稿は「staging はその経路を検査する場ではない」とだけ
  書いており、**PDF の配信まで落としていた。** **§2.3 が PDF を作る理由は「404 にしない」なのに、
  それを検査しないと裁定の当のものが未検査になる**——レビュー役の条件 B3。）

---

## 4. 番人

| # | 何を主張するか | 置き場 |
|---|---|---|
| 1 | **配る命令が `…--branch=staging` とちょうど等しい**（`${{` を含まない） | `tools/tests/` の静的テスト |
| 2 | **`staging.yml` は `ci.yml` を呼んでいる**（検査を写していない） | 同上 |
| 3 | **配ったものが staging に出ている** | `staging.yml` の中のスモーク |
| 3b | **本番が動いていない**（配る前後で `build-info.json` の commit が同じ） | 同上 |
| 3c | **配った PDF が staging で開く** | 同上 |
| 3d | **staging に `X-Robots-Tag: noindex` が在る** | 同上 |
| 4 | **本番に `X-Robots-Tag` が無い** | `staging.yml` の #3b と同じ段 |
| 4b | **`noindex` の綴りがリポジトリの配信物に 0 件**（`web/public/_headers`・`functions/`・`web/index.html` の `<meta name="robots">`・`deploy.yml` の本文） | `tools/tests/` の静的テスト |
| 4c | **`staging.yml` の追記先が `web/dist/_headers` である**（肯定形） | 同上 |
| 5 | **`staging.yml` のビルド段の `run:` 列が `deploy.yml` と同じ** | `tools/tests/` の静的テスト |

**#1・#3b・#4 は「本番を壊さない」側の番人である**——**#1 が破れると本番に配り、
#4 が破れると本番が検索から消える。** **どちらも気づくのが遅い形の事故なので、機械に言わせる。**
**#3b は最後の砦**——**どんな経路で枝名が壊れても、これだけは走行の中で鳴る。**

**#2 が要る理由**: **`ci.yml` を呼ぶ代わりに段を写すと、片方だけ直された日にずれる**
——`ci.yml` の註が既にそう書いている。**写しを持たないことを、機械が見張る。**

**#5 が要る理由**（レビュー役の注記 C1）: **ビルド段は `deploy.yml` の写しになる**
（`setup-wasm-pack` → `wasm-pack build` → `setup-web` → `vite build` → PDF → 刻印 → `check:sw`）。
**共通化すると `deploy.yml` を触ることになり、それは次の Release で初めて試される。**
**触らずに、段の一致を静的に見張るほうが安い**（`release-workflow.test.ts` の「段の一致」と同じ形）。

---

## 5. 段取り

| 順 | やること |
|---|---|
| 1 | **番人 #1・#2・#4 を先に書く**（静的なので E2E は要らない）。**赤確認つき** |
| 2 | `staging.yml` を書く（`ci.yml` を呼ぶ → manuals → build → deploy → スモーク） |
| 3 | `docs/deploy.md` の 1 行と理由を書き換える |
| 4 | **利用者が push** → **1 度目の走行を見る** |

**★ 目視に残るのは 1 つだけ**（レビュー役の注記 C6）——**#3b と #3c を走行に入れたので、
「本番が動いていない」と「PDF が開く」は毎回機械が見る。**
**人が見るのは「`staging.calcarc.pages.dev` が開くか」だけ**である。

---

## 6. 未確認

- **`--branch=staging` が `staging.calcarc.pages.dev` を作ること。**
  **Cloudflare の枝ごとの別名の綴り方（`.` を含む枝名など）は、この枝名では問題にならないはず**だが、
  **実走で確かめる。**
- **`CLOUDFLARE_API_TOKEN` がプレビューの配信にも足りること。**
  **本番配信で使っているトークンなので足りるはず**だが、**権限の粒度は確かめていない。**
- **同じ Pages プロジェクトへ 2 本同時に上載したとき、Cloudflare がどう振る舞うか。**
  **群が衝突しないことは静的に言える**（下）が、**同時上載そのものは確かめていない。**

---

## 7. 読み方（走行が赤いとき）と、番人の限界

**2026-09-30、レビュー役の実装レビューで分かったこと。**

- **本番が落ちている日は、staging も赤くなる。** 配る前に `calc.terapyon.net/build-info.json` を
  `curl -fsS` で読むので、**本番が 5xx なら staging の走行が止まる。** **無害だが、
  「staging が壊れた」と読まないこと。**
- **スモーク ②（本番が動いていない）が偽の赤を出しうる形は 1 つだけ**——
  **配る前後の数分の窓に Release が本番を動かした場合。** **読み方は印字の
  「本番が動いた: 旧 → 新」で、新がタグの SHA なら無実である。**
- **番人 #5（段の一致）が比べているのは、各段の 1 行目だけ**
  （`- uses:` / `- run:` / `- name:`）。**`with:` の `path:`・`working-directory:`・
  `uses:` の SHA は比べていない**（レビュー役の変異 G5d が緑だった）。
- **番人 #1 は、`staging.yml` の中の「本番へ出る道」を塞ぐ。**
  **綴りの等値だけでは足りなかった**——**`wrangler-action` の `preCommands` に書いても、
  別の `run:` 段で `npx wrangler` を打っても通った**（レビュー役の変異 G1d・G1e）。
  **`pages deploy` の綴りが 1 回だけで、それが `command:` の行**であること、
  **`preCommands` / `postCommands` の鍵が無い**ことも見る。
- **枝の門は `deploy` ジョブの 1 段目に在る**（2026-09-30、レビュー役の注記）。
  **作業枝から手で起動すると、`ci`（4 分）と `manuals`（PDF）を回してから落ちる。**
  **上載は起きないので無害**だが、**runner を 5 分ほど無駄にする。**
  **速く落としたければ、門を単独の最初のジョブにして `ci` が `needs` する形にする**
  ——**急がないので、そのときが来たら。**
  （`deploy.yml` の門は**唯一のジョブの 1 段目**なので同じ形に見えるが、
  **こちらは 2 ジョブ手前がある。**）
- **`workflow_dispatch` は main からしか受けない。** **どの枝からでも起動できると、
  作業枝のビルドが `staging.calcarc.pages.dev` に乗り、「main にマージしたものを見る URL」
  という約束が黙って破れる**（レビュー役の条件 B2）。

---

## 8. 群と、CI が 2 回走ること

**群は衝突しない**（2026-09-30、レビュー役が静的に確認）。`ci.yml` の群は
`ci-${{ github.workflow }}-${{ github.ref }}` なので、**Staging から呼ばれると
`ci-Staging-refs/heads/main`、普段の CI は `ci-CI-…`、Release は `ci-Release-…`**
——**互いに打ち切らない。**

**`staging.yml` の群は `cancel-in-progress: false`**（本番と同じ）。
**`true` にすると、続けて push した B が A の `wrangler` 上載中を殺す**——
`deploy.yml` の註 ②「**中断した Direct Upload が live になりうるかは未確認**」が、
**staging で現実になる。**

**★ main への push ごとに CI が 2 回走る。** `ci.yml` は `on: push: branches: [main]` を
持つので、**単独の走行と、Staging の中の走行**で **約 4 分の runner が二重**になる。
**受け入れる**——**避けるには `ci.yml` の push トリガを外すことになるが、
それが PR のチェック表示に影響しないかを確かめていない。**
**時間が問題になったら、そこから始める。**

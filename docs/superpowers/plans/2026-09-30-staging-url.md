# staging（固定 URL）実装計画

> **実行方法は Subagent-Driven。** 実行役・レビュー役・検証役の 3 人で、監視役が枠と中継を持つ。

**目標**: **main にマージしたものを `https://staging.calcarc.pages.dev` で見られるようにする。**
**本番 `calc.terapyon.net` は `v*` タグだけ**——**そこは 1 バイトも変えない。**

**設計書**: `docs/superpowers/specs/2026-09-30-staging-url-design.md`（**両方読むこと**）
**起点**: `2b478f0`（= v1.0.0）。枝は `feat/staging-url`。

---

## 全体の制約

- **`deploy.yml` を触らない。** **あのファイルの段は本番配信でしか走らない**ので、
  **触ると次の Release で初めて試される**——`deploy.yml` 自身の註が
  「**確かめる場所が無いまま上げると、失敗するのは本番配信の最中である**」と書いている。
- **配る命令は、ちょうどこの綴り**（**変数を混ぜない**）:
  `pages deploy web/dist --project-name=calcarc --branch=staging`
  **`--branch` を省くと git の現在の枝名（= `main`）を使い、それは本番配信である。**
- **`ci.yml` は呼ぶ。写さない**（`uses: ./.github/workflows/ci.yml`、`release.yml:79` と同じ形）。
- **群は `staging-deploy` の固定名、`cancel-in-progress: false`**
  （`true` だと続く push が `wrangler` の上載中を殺す。
  `deploy.yml` の註 ②「**中断した Direct Upload が live になりうるかは未確認**」）。
- **各ジョブに `timeout-minutes` と `permissions: contents: read`。**
- **コミット前に 3 つ揃える**（`pnpm test`・lint・`tsc`）。
  **`tools/` を触ったら `cd heavy && pnpm lint`**（`heavy/` だけ緑でも CI は赤い）。
- **★ 主作業木の `web/src/wasm` は古くなっていることがある**（2026-09-30 に実測、
  `UnitPanel.wasm.test.tsx` の 26 件が赤くなった）。**`pnpm wasm` を先に。**

---

## noindex の見張り——結論（2026-09-30）

**レビュー役の条件 B2(a)（`deploy.yml` のスモークに 1 行足す）に監視役が反対し、
レビュー役が置き場を変えて再提案した。それを採る。**

**`deploy.yml` には足さない。** **あのスモークは `wrangler` の後**で、
**同ファイルが「いちばん悪い終わり方」と呼ぶ区間**にある——**そこを増やさない。**

**代わりに `staging.yml` の「本番の刻印を控える」段に 1 行**:
```bash
curl -sSI https://calc.terapyon.net/ | grep -qi x-robots-tag && exit 1
```
**main への push ごとに走るので設定画面の経路も日の単位で見つかり、`deploy.yml` を触らず、
赤くなっても本番は 1 バイトも動いていない。**

**基線は実測済み**——**2026-09-30 に `calc.terapyon.net` の応答に `X-Robots-Tag` は 0 件。**

**★ 監視役の反対案の理由の 1 つは成り立っていなかった**——「間違いは本番配信の最中に
初めて出る」。**公開 URL への読み取りは手元で試せる**（上の実測がそれ）。
**置き場の判断は変わらないが、根拠の 1 本は落ちた。**

**静的な番人の範囲も広げる**（#4b）——`web/public/_headers`・`functions/`・
**`web/index.html` の `<meta name="robots">`**・**`deploy.yml` の本文**
（**staging の追記段が写されて本番に入る形を止める**）。

---

## 触るファイル

| ファイル | 役割 |
|---|---|
| `.github/workflows/staging.yml` | **新設**——検査 → PDF → ビルド → 配信 → スモーク 4 本 |
| `tools/tests/staging-workflow.test.ts` | **新設**——番人 #1・#2・#4・#5 |
| `docs/deploy.md` | 「プレビューも作らない」を書き換え、本番枝の名を 1 行 |
| **`CLAUDE.md`** | **監視役が書く**（利用者の許可 2026-09-30）。**`staging.yml` と同じコミットで** |

**`deploy.yml` は触らない。** **`web/public/_headers` も触らない。**

---

## タスク

### Task 1 — `staging.yml` と静的番人 4 本【実行役】

**番人は `staging.yml` を読むので、ファイルより先には書けない。** **同じタスクにし、
赤確認は `staging.yml` を変異させて撮る。**

- [ ] **1-1** `.github/workflows/staging.yml` を書く。骨は `release.yml` と `deploy.yml` から。

```yaml
name: Staging
on:
  push:
    branches: [main]
  workflow_dispatch:
concurrency:
  group: staging-deploy
  cancel-in-progress: false
jobs:
  ci:
    name: CI
    uses: ./.github/workflows/ci.yml
  manuals:
    name: Manuals
    needs: ci
    # release.yml の manuals と同じ 1 行 + upload-artifact
  deploy:
    name: Deploy to staging
    needs: manuals
    # ここに §2.1 の ③④⑤
```

**`secrets: inherit` を忘れない**（`release.yml:102` の註:「**呼ばれた側は呼び出し元の
secrets を自動では受け取らない**」）。

- [ ] **1-2** ビルド段は **`deploy.yml` の `run:` 列と同じ順**にする
  （`setup-wasm-pack` → `wasm-pack build` → `setup-web` → `vite build` → PDF の展開 →
  刻印 → `check:sw`）。**刻印には `"channel":"staging"` を足す**（設計 §2.4b）。
- [ ] **1-3** `_headers` に追記。**末尾の改行が無いと `/*` が前の行に繋がる**ので:
```bash
printf '\n/*\n  X-Robots-Tag: noindex\n' >> web/dist/_headers
```
- [ ] **1-4** 配信。**綴りをそのまま**:
```yaml
command: pages deploy web/dist --project-name=calcarc --branch=staging
```
- [ ] **1-5** スモーク 4 本（**すべて `deploy.yml` の再試行と同じ形、12 回 × 10 秒**）。
  **①刻印が今回の SHA**（`https://staging.calcarc.pages.dev/build-info.json`）／
  **②本番が動いていない**——**配る前に `calc.terapyon.net/build-info.json` の commit を控え、
  配った後に同じ値**（**`≠ $GITHUB_SHA` にしない**。リリース直後は一致するので偽の赤になる）／
  **③配った PDF が開く**（`ls web/dist/manual` から名前を取る）／
  **④`X-Robots-Tag: noindex` が在る**。
  **⑤本番に `X-Robots-Tag` が無い**——②と同じ段に
  `curl -sSI https://calc.terapyon.net/ | grep -qi x-robots-tag && exit 1`
  （**基線は 2026-09-30 に実測、0 件**）。
- [ ] **1-6** `tools/tests/staging-workflow.test.ts` に番人 4 本。
  **#1**: `command:` が `pages deploy web/dist --project-name=calcarc --branch=staging` に
  **等しい**（`${{` を含まない・`--branch=` がちょうど 1 回）。
  **#2**: `uses: ./.github/workflows/ci.yml` が在る。
  **#4b**: **`noindex` の綴りが 0 件**——`web/public/_headers`・`functions/`・
  **`web/index.html`**（`<meta name="robots">`）・**`deploy.yml` の本文**。
  **#4c**: **`staging.yml` の追記先が `web/dist/_headers` である**（肯定形）。
  **#5**: ビルド段の `run:` 列が `deploy.yml` の該当区間と**同じ**。
- [ ] **1-7 赤確認を 5 通り**（**一時コミット → 変異 → 走行 → 再編集で戻す**）:
  **(a) `--branch=staging` を消す**（省略）→ **#1 赤**／
  **(b) `--branch=main` にする** → **#1 赤**／
  **(c) `--branch=${{ github.ref_name }}` にする** → **#1 赤**（`${{` を含む）／
  **(d) `uses: ./.github/workflows/ci.yml` を消す** → **#2 赤**／
  **(e) `web/public/_headers` に `X-Robots-Tag: noindex` を書く** → **#4b 赤**／
  **(e2) `web/index.html` に `<meta name="robots" content="noindex">` を書く** → **#4b 赤**。
  **(f) ビルド段の 1 行を入れ替える** → **#5 赤**。
- [ ] **1-8** `cd web && pnpm test`・lint・`tsc`／**`cd heavy && pnpm lint`**／
  `node tools/check-conflict-markers.mjs` → コミット。

**★ `timeout-minutes` は仮の値を置き、初回の走行を測ってから据え直す**（設計 §2.4c）。
**仮は 25 分**（本番の 20 分＋スモークが 1 本多いぶん）。**註に「初回の実測で据え直す」と書く。**

### Task 2 — 文書【実行役 →（`CLAUDE.md` だけ監視役）】

- [ ] **2-1** `docs/deploy.md:5-8` の「**プレビューも作らない**」を
  「**main への push は staging に配る（`staging.calcarc.pages.dev`）。本番はタグだけ**」に。
  **理由も残す**——**2026-08-25 の懸念は「main の先頭が本番になる」ことで、
  `staging` という別の枝名なら本番には届かない。**
- [ ] **2-2** 同じ文書に **「本番枝の名は `main`。`staging.yml` の枝名と一致させない」**を 1 行。
- [ ] **2-3** `docs/superpowers/specs/2026-08-25-release-gate-design.md` に**撤回の印**
  （「プレビューも作らない」は 2026-09-30 に一部撤回した、と）。
- [ ] **2-4** **`CLAUDE.md` は監視役が書く。** **実行役は触らない。**
- [ ] **2-5** `check-citations`・`check-conflict-markers` → コミット。

---

## 実走でしか分からないこと（初回の走行で見る）

| | 誰が見るか |
|---|---|
| **`staging.calcarc.pages.dev` が開く** | **人**（目視はこれだけ） |
| 本番が動いていない | 番人 #3b |
| PDF 3 本が開く | 番人 #3c |
| `noindex` が在る | 番人 #3d |
| `--branch=staging` が別名 URL を作る | 走行が緑になれば分かる |
| トークンがプレビューに足りる | 同上 |
| 走行の実測時間（`timeout-minutes` を据え直す） | **人が印字から** |

---

## レビュー役への発注

1. **noindex の置き場（`staging.yml` の #3b と同じ段）が、狙いどおり機能するか。**
2. **番人 #1 が、赤確認 (a)(b)(c) の 3 通りで本当に鳴るか**——**ご自分の変異で。**
3. **番人 #5（段の一致）が、入れ替え・削除・追加の 3 通りで鳴るか。**
4. **スモーク ②（本番が動いていない）が、偽の赤を出さない形か**
   ——**リリース直後**（main の先頭とタグの SHA が一致）を想定して。
5. **`CLAUDE.md` の書き換えが、`staging.yml` と同じコミットに入っているか**
   ——**先に入れると、実装が入るまで嘘になる。**

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

## ★ レビュー役の条件 B2(a) に、監視役から反対案

**B2(a) は「`deploy.yml` の『_headers are respected』スモークに
『`X-Robots-Tag` が無いこと』を 1 行足す」。** **狙い（本番が検索から消える事故そのものを見る）は正しい。**

**採らない。** 理由は**失敗の向き**である。

- **`deploy.yml` のスモークは `wrangler` の**後**に走る**——同ファイルの註が区間 ③ と呼び、
  「**いちばん悪い終わり方**」と書いている所（**出てはいるが、出たことを誰も確かめておらず、
  証拠も残っていない**）。
- **足した 1 行の綴りを間違えると、次の Release がそこで落ちる。**
  **そしてその 1 行は本番配信でしか走らない**ので、**間違いは本番配信の最中に初めて出る。**
- **守りたい事故（検索から消える）は、遅いが静か**である。**引き換えに置くリスク
  （リリースが区間 ③ で落ちる）は、速くて騒がしい。** **交換が釣り合わない。**

**代わりに、静的な番人の範囲を広げる**（番人 #4）:
**`web/public/_headers` と `functions/` の両方に `X-Robots-Tag` が無いこと。**
**リポジトリから入る経路はこれで塞がる。** **Cloudflare の設定画面から入る経路は、
リポジトリからは見えない**ので、**§6 の未確認に 1 行残す。**

**レビュー役に再判定を求める。** 反対案が弱ければ B2(a) を採る。

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
- [ ] **1-6** `tools/tests/staging-workflow.test.ts` に番人 4 本。
  **#1**: `command:` が `pages deploy web/dist --project-name=calcarc --branch=staging` に
  **等しい**（`${{` を含まない・`--branch=` がちょうど 1 回）。
  **#2**: `uses: ./.github/workflows/ci.yml` が在る。
  **#4**: `web/public/_headers` と `functions/` に `X-Robots-Tag` が **0 件**。
  **#5**: ビルド段の `run:` 列が `deploy.yml` の該当区間と**同じ**。
- [ ] **1-7 赤確認を 5 通り**（**一時コミット → 変異 → 走行 → 再編集で戻す**）:
  **(a) `--branch=staging` を消す**（省略）→ **#1 赤**／
  **(b) `--branch=main` にする** → **#1 赤**／
  **(c) `--branch=${{ github.ref_name }}` にする** → **#1 赤**（`${{` を含む）／
  **(d) `uses: ./.github/workflows/ci.yml` を消す** → **#2 赤**／
  **(e) `web/public/_headers` に `X-Robots-Tag: noindex` を書く** → **#4 赤**。
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

1. **反対案（B2(a) を採らず、静的番人の範囲を広げる）の再判定。**
2. **番人 #1 が、赤確認 (a)(b)(c) の 3 通りで本当に鳴るか**——**ご自分の変異で。**
3. **番人 #5（段の一致）が、入れ替え・削除・追加の 3 通りで鳴るか。**
4. **スモーク ②（本番が動いていない）が、偽の赤を出さない形か**
   ——**リリース直後**（main の先頭とタグの SHA が一致）を想定して。
5. **`CLAUDE.md` の書き換えが、`staging.yml` と同じコミットに入っているか**
   ——**先に入れると、実装が入るまで嘘になる。**

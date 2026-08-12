# デプロイワークフロー — 設計

日付: 2026-08-12
対象: main → Cloudflare Pages への自動デプロイと、デプロイ後スモーク。
base-spec §50 DoD の「Smartphone で利用可能」「PWA インストール可能」
「Offline 動作」を実機で実証可能にする。
前提: PR #22（M5 PWA）マージ後の main から始める

## §0 前提（ユーザー準備完了済み）

- Cloudflare Pages プロジェクト `calcarc`（calcarc.pages.dev、仮ページ公開中）
- GitHub Actions Secrets: `CLOUDFLARE_API_TOKEN`（Pages Edit 権限のみ）、
  `CLOUDFLARE_ACCOUNT_ID`
- 方式: **GitHub Actions でビルドして Direct Upload**。

### D12 からの変更の記録

vertical-slice の D12 は「公開先 = Cloudflare Pages（利用者指定）」のみで、
ビルド方式は未規定だった。CF 側の Git 連携ビルドではなく **Actions ビルド +
Direct Upload** を採る。理由:

1. **ビルド環境の一元化**: wasm-pack のバージョン固定・ChromeDriver の対
   などの CI の罠対策（ci.yml に記録済み）を CF 側ビルドに二重移植しない。
   ビルドが再現する場所は 1 つでよい。
2. **成果物検査の直列化**: `check:sw` をデプロイする dist そのものに掛けて
   から上げられる。CF 側ビルドでは「検査した dist」と「配る dist」が別物に
   なる。
3. Secrets の権限を Pages Edit のみに絞れる（Git 連携は CF に repo 読み取り
   を渡す）。

## §1 ワークフロー（`.github/workflows/deploy.yml`）

- 発火: `push: branches: [main]` + `workflow_dispatch`（手動再デプロイ）。
- `concurrency: group: deploy`（`cancel-in-progress: false`——デプロイは
  途中中断より直列完走。古い方が後から上がる逆転は Direct Upload が
  コミット順で直列化される限り起きないが、並走自体を避ける）。
- **drift しうる部分を composite action に括り出す**。写しで持つと、
  バージョン固定やセットアップが 2 箇所に存在して片方だけ更新される——
  スイープ一覧の lint 欠落と同じ、手写しリストの宿命（レビュー指摘。
  採らなかった案: 写し + 相互参照コメント + 一致検査は、検査がもう 1 つの
  手写しになる）。ただし CI のジョブは artifact 経由で分割されている
  （wasm ジョブが pkg を上げ、web/e2e ジョブが拾う）ため、「全ビルドを
  1 action」に畳むと CI のトポロジーを壊す。**drift の実体はバージョン固定と
  セットアップ**なので、そこを 2 つに括る:
  - `.github/actions/setup-wasm-pack`: rust toolchain（wasm32）+ rust-cache +
    wasm-pack **v0.15.0 固定**（wasm-pack v0.9 事件の教訓）。
    ci.yml の wasm ジョブと deploy.yml が使う。
  - `.github/actions/setup-web`: pnpm/action-setup + node 22 + pnpm cache +
    `pnpm install --frozen-lockfile`。ci.yml の web/e2e ジョブと deploy.yml
    が使う。
  ChromeDriver 対策やテスト実行、artifact の上げ下ろしは各ジョブ固有のまま
  （drift の対象ではなく、ジョブの役割そのもの）。
- deploy.yml の手順:
  1. `uses: ./.github/actions/setup-wasm-pack` → wasm-pack build →
     `uses: ./.github/actions/setup-web` → `pnpm exec vite build`
  5. **ビルド刻印**: `dist/build-info.json` に
     `{"commit": "${GITHUB_SHA}", "builtAt": "<ISO8601>"}` を書き出す
     （ワークフローのステップで生成。アプリコードは触らない。build **後**に
     置くので SW の precache には入らない——これは意図で、刻印は「いま
     サーバが何を配っているか」の質問にネットワーク越しに答えるための
     ファイルであり、キャッシュから答えては意味がない）
  6. `pnpm check:sw`（デプロイする dist そのものへの成果物検査）
  7. `cloudflare/wrangler-action`（**バージョン固定**）で
     `pages deploy web/dist --project-name=calcarc --branch=main`
     （Direct Upload では `--branch` が本番/プレビューを決める。main = 本番）
  8. デプロイ後スモーク（§3）

## §2 CI との関係: 独立ワークフロー + 自前の最小検証

**決定: deploy.yml は CI の成功を待たない。** main に載るのは PR 経由の
マージコミットだけで、CI は PR で既に緑（ブランチ保護の前提）。`workflow_run`
での連結は「CI 全緑 → 40 分後にデプロイ」の遅延と、workflow_run 特有の
ref 取り違えの罠を持ち込む。二重ゲートは過剰。

ただし **`check:sw` だけはデプロイ側でも回す**（§1-6）。理由: CI の check:sw
が検査した dist と、デプロイジョブがビルドした dist は**別のビルド**である。
「検査した物を配る」を成立させるには、配る物を検査するしかない。
（レビュー推奨と同判断。理由ごとここに記録する。）

## §3 デプロイ後スモーク（2 前提の機械検証）

M5 の更新経路の安全性証明は「CF Pages が `_headers` を尊重する」
「最新デプロイのみ配信される」の 2 前提の上に立っている。デプロイのたびに
実 URL へ検証する:

1. **`_headers` の尊重**（ヘッダ検査、`curl -fsSI`）:
   - `https://calcarc.pages.dev/sw.js` → `Cache-Control` に `no-cache`
   - `/manifest.webmanifest` → 同上
   - `/assets/` 配下の実ファイル 1 つ（dist から名前を拾う）→ `immutable`
2. **最新デプロイの配信**（刻印照合）:
   - `/build-info.json` を取得し `commit == GITHUB_SHA` を検証。
   - 伝播遅延に備えて **リトライつき**（例: 10 秒間隔 × 12 回まで）。
     一致しないまま尽きたらワークフローを赤にする。
3. おまけの生存確認: `/` が 200 で `<div id="root">` を含む。

`_headers` に `/build-info.json → Cache-Control: no-cache` を 1 行足す
（刻印がエッジにキャッシュされたら照合の意味が消える。sw.js と同じ理由）。
これが本 spec で唯一のアプリリポジトリ側変更。

## §4 罠の先出し

- **wrangler-action のバージョン固定**（wasm-pack v0.9 事件の教訓。
  ci.yml の固定コメントと同じ形式で理由を書く）。
- `web/dist` に sw.js/manifest が入っている前提は M5 の check:sw が守る
  （§1-6 で配る物にも直接掛ける）。
- Direct Upload の本番/プレビューは `--branch` が決める。`--branch=main` を
  明示（プロジェクトの production branch 設定と一致させる）。
- 刻印の生成はビルド後（precache 非対象）。**vite build の前に public/ へ
  置いてはいけない**——precache に入って「キャッシュが答える」ファイルに
  なり、スモーク 2 が自分の尾を食う。
- スモークの curl は `-f`（HTTP エラーを exit code に）と `-sS`（静かに、
  ただしエラーは出す）。ヘッダ名の大文字小文字は不定なので `grep -i`。

## §5 検証段と初回確認手順

- **ワークフロー yml は手元で完全には検証できない。** `pnpm build` +
  `check:sw` + 刻印生成 + スモークのヘッダ検査ロジックまではローカルの
  preview（`vite preview` + curl）で素振りできるが、wrangler-action と
  実ヘッダは **push して初回実行で検証する**性質のものである。これを
  spec として明記し、plan は「初回実行の確認」を独立ステップに持つ。
- **初回デプロイの確認手順（ユーザー向け、実機）**——README ではなく
  `docs/deploy.md` に置く:
  1. Actions の deploy 実行が緑（スモーク込み）を確認
  2. スマートフォンの Chrome で calcarc.pages.dev を開く →
     Scientific で `3 + 4 =`、Data Scale で基準例
  3. 「ホーム画面に追加」（インストール）→ standalone で起動することを確認
  4. 機内モードにして起動 → 両電卓が動くこと（§39 の実機実証）
  5. 以後のデプロイ更新は「アプリを完全に閉じて再訪」で届く（M5 spec §2 の
     ライフサイクル。standalone 常駐だと旧世代に留まる——既知のコスト）

## §6 スコープ外

- カスタムドメイン、PR ごとのプレビューデプロイ、CF 側の設定変更
  （production branch の確認はユーザー作業として §5 手順に含めない——
  §0 の前提に含まれる）。
- デプロイ通知（Slack 等）、ロールバック自動化（revert コミットを main に
  積む方式で足りる——手順は docs/deploy.md。旧コミットからの
  workflow_dispatch は main と配信物の刻印を食い違わせるので**使わない**）。
- README への DoD 反映（Loan 完成後の §50 総点検で）。

## §7 完了条件

1. main への push で deploy.yml が走り、ビルド → check:sw → Direct Upload →
   スモークまで緑。**バージョン固定とセットアップは 2 つの composite action に
   のみ存在し、ci.yml と deploy.yml が同一の action を参照している**
   （写しが存在しない。`grep -c 'v0.15.0'` がワークフロー配下で 1 になる）。
1b. ci.yml が composite action 化の後も全ジョブ緑（既存 CI の回帰確認——
   PR 自身の CI 実行が pull_request トリガーで再編後の ci.yml を使うため、
   **この検証は PR を開いた時点で自動的に走る**）。
2. スモークが 2 前提（_headers 尊重・最新配信）を実 URL で機械検証している。
   **赤の対**: 刻印照合の赤の対はローカル preview の素振り（誤 SHA →
   リトライ尽き → exit 1）で取得済み（Task 2）。初回実行では緑側のみを
   確認する——ワークフロー上で人為的な赤を作る変更はデプロイを壊すので
   行わない。ヘッダ検査は _headers を触らずに赤を作れないため、ロジックの
   素振りをローカル preview で行う——preview は全レスポンスに一律
   no-cache を返すため、no-cache 系 2 脚は偶然緑になり、赤は immutable
   脚の不一致から出た（Task 2 の素振りで実測）。3 脚は同一の形なので、
   どの脚の赤でもスモーク自体が空虚でないことの実証としては等価——
   結論は変わらない。
3. `docs/deploy.md` に初回確認手順とロールバック 1 行がある。
4. ユーザーが実機で §5 の 2〜4 を確認（DoD の 3 項目の実証）。
5. D12 変更の記録が本 spec §0 にある（済）。

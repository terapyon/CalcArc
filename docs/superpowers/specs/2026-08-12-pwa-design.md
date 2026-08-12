# PWA（M5）+ MSRV 宣言 — 設計

日付: 2026-08-12
対象: base-spec §38（PWA Requirements）§39（Offline）、Milestone 5。
MSRV 宣言（M4 最終レビューの ledger 4）を同乗させる。
前提: PR #21（M4）マージ後の main から始める

## §0 目的

Web App Manifest・アイコン・standalone 表示・Service Worker・静的アセットと
WASM のキャッシュ（§38）。**一度ロードした後は Scientific と Data Scale が
ネットワークなしで動く**（§39。Loan は M6 で自動的にこの傘に入る）。

## §1 SW の実装方式: vite-plugin-pwa を採る

**決定: `vite-plugin-pwa`（workbox、generateSW モード）。依存を 1 つ足す。**

ルーター不採用（M4）との整合を問う: あのときの判断は「ブラウザ標準の
ハッシュ挙動 10 行で置き換えられる依存は足さない」だった。SW は逆で、

1. **precache の対象一覧はビルドの内部情報**（ハッシュ付きファイル名、
   `.wasm` を含む）。vite と統合されたプラグインでなければ、ビルドのたびに
   手で追従するか、自前の manifest 生成プラグインを書くことになる——
   後者は「依存を書き直して自分で保守する」ことに他ならない。
2. **更新ライフサイクル（install/waiting/activate/claim）は手書き SW が
   腐る場所そのもの**。stale SW の罠は世代管理のバグとして現れ、golden の
   ような検査網も届かない。
3. ハッシュ挙動と違い、**ブラウザ標準だけでは「WASM を含む precache」は
   構成できない**。

採らなかった案（手書き SW）は上記 1 の理由で不採用。理由ごとここに記録する。

## §2 キャッシュの版管理と更新戦略

- **precache のみ。runtime caching は設定しない。** このアプリに外部リクエスト
  は存在しない（フォント・API・CDN なし）。キャッシュ戦略の選択肢
  （SWR/NetworkFirst 等）が入り込む余地を最初から消す。
- **版の原子性**: vite の全アセットはコンテンツハッシュ付きで、SW の precache
  manifest は**そのビルドのファイル集合**を revision 付きで持つ。ある SW 世代が
  配るのは自分の世代のファイルだけ——「古い SW が新しい WASM を配る」食い違いは
  構成上起きない。
- **更新戦略: `registerType: "prompt"`、ただしプロンプト UI は配線しない**。
  新しいデプロイを検知したらバックグラウンドで install し、標準の SW
  ライフサイクルどおり**制御中のページがある間は waiting に留まる**。
  次の全タブ閉鎖→再訪で新世代に切り替わる。更新トーストの類は MVP に
  入れない（§8）。インストール済み standalone ウィンドウもクライアントに
  数える。常駐ユーザーは旧世代に留まりうる——更新 UI を持たない設計（§8）
  が引き受けたコスト。
  - **`"prompt"` という名前だが UI の有無ではなく登録戦略の名前である**
    （名前の意味のズレはこのリポジトリの流儀で書き残す）。対になる
    `"autoUpdate"` は skipWaiting + clientsClaim を注入し controllerchange で
    ページを**予告なくリロードする**モードで、実行中のページの下で
    アセット世代をすり替えるうえ入力中の計算状態が消える——本 spec が
    避けたい挙動そのもの。レビューがこの取り違えを設計段階で捕まえた
    （当初案は autoUpdate と書いていた）。
  - **検証**: ビルド成果物の `sw.js` に `skipWaiting` の呼び出しが
    **含まれない**ことを機械検査する（§9）。設定の意図が成果物に到達して
    いる証拠はこの層でしか取れない。
- **STATE_SCHEMA との関係**（設計に含めよとの指示への回答）: SW 導入で
  「デプロイをまたぐ開いたページ」はむしろ**一貫的になる**。開いたままの
  ページは自分の世代の JS/WASM を precache から受け取り続けるので、
  ページ内で新旧モジュールが混ざる事故は消える。STATE_SCHEMA の番が回るのは
  「古い state を持つページがリロードして新世代コードで読み直す」瞬間で、
  これは現行の `is_valid()` 破棄がそのまま正しい網。§40 を実装するときに
  この境界が再訪される（§4）。
- **SPA フォールバック**: `navigateFallback: "index.html"`。ハッシュルーティング
  なのでパスは `/` だけだが、standalone 起動の `start_url` とオフライン時の
  ナビゲーションを index.html に畳む。

## §3 Manifest とアイコン

- `manifest`: `name: "CalcArc"`、`short_name: "CalcArc"`、`lang: "ja"`、
  `display: "standalone"`、`start_url: "/"`、`scope: "/"`、
  `theme_color`/`background_color` は `tokens.css` の背景トークンと一致させる
  （値の重複はやむを得ない——manifest は CSS を読めない。コメントで対応関係を
  残す）。
- **アイコン**: `web/public/` に 192×192・512×512 の PNG と、512 の
  maskable を置く。デザインは電卓グリフの単色プレースホルダで MVP は足りる
  （ブランドデザインはスコープ外）。**生成方法（スクリプトか手描きか）と
  生成元は plan で決め、再生成手順をコメントに残す**——バイナリの出所不明を
  作らない。
- `index.html` に `theme-color` meta（既存の viewport-fit=cover は据え置き）。

## §4 §40（localStorage 永続化）は次送り

**決定: M5 に含めない。** base-spec の Milestone 5 定義は
installable + offline のみ（§47）。状態の永続化は
(a) STATE_SCHEMA の版またぎ移行方針（M4 台帳の M10: モジュール切替で状態を
捨てる現仕様の明文化を含む）、(b) 履歴の無効化設計（§40 自身が要求）と
絡み、独立した spec に値する。PWA の器（オフラインで開ける）と中身の永続化
（閉じても残る）は直交する関心で、混ぜると両方の検証が濁る。

## §5 MSRV 宣言（同乗タスク）

- ルート `Cargo.toml` の `[workspace.package]` に `rust-version = "1.87"`
  （`is_multiple_of` が要求する実質下限）。両クレートは
  `rust-version.workspace = true` で継承。
- CONTRIBUTING に 1 行: 「MSRV は現行 stable 追従。上げるときは理由を
  コミットメッセージに書く」。
- **CI に MSRV ジョブは足さない**: 追従方針の下では `rust-toolchain.toml` の
  `stable` と実質同義で、ジョブは重複した保守点になるだけ（レビュー推奨に
  同意）。`rust-version` フィールドの価値は、古いツールチェーンの利用者に
  cargo が明快なエラーを出すこと。
- ユーザーが issue を立てていれば PR で close（現時点で未起票なら PR 本文に
  経緯を 1 行）。

## §6 検証（**ci.yml から導出**——M4 の教訓の初適用）

ci.yml が回すもの: fmt / clippy / cargo test / wasm-pack test /
pnpm typecheck / lint / test / `vite build` / playwright / uv sync --locked /
pytest / ruff check / ruff format --check / golden 再生成 diff。
本ブランチの検証節はこの集合との差分として書く:

- **段付け**: web 層中心。Rust は MSRV フィールド追加のみ
  → `cargo test --workspace`（挙動不変の確認）。Python 不触。
  **SW / offline / installable / standalone は E2E 必須**。
- **オフライン E2E**（`web/tests/e2e/pwa.spec.ts`）:
  1. 通常ロード → `navigator.serviceWorker.ready` と precache 完了を待つ
  2. `context.setOffline(true)` → `page.reload()`
  3. Scientific で `3 + 4 =` が動く、Data Scale で基準例が動く
  4. **オフラインエミュレーションの実在確認（赤の対）**: 別の新規 context で
     最初から `setOffline(true)` にして `goto` が**失敗する**ことを確認する。
     これが無いと「オフラインでも動いた」は「そもそも切れていなかった」と
     区別できない——このリポジトリの vacuous-assertion クラスへの既定の対処。
- **installable E2E**: `link[rel="manifest"]` の存在 → manifest を fetch して
  `display === "standalone"`・icons に 192/512 が含まれることを検査。
  アイコン実体も fetch して 200 を確認。
- **既存 E2E の SW 環境回帰**: Playwright は既に本番ビルド + preview で
  回っている（playwright.config.ts）ので、SW 追加後は**既存 26 件が SW 有効
  環境で走る**。全緑のままであることが SW が透過であることの回帰検査になる。
- 検証コマンド一覧は plan の各タスクに明記し、フルスイープ（ブランチ末尾
  1 回）には ci.yml の全コマンドを列挙する。

## §7 踏みそうな罠（先に書いておく）

- **dev サーバーで SW を有効にしない**（`devOptions.enabled` は既定 false の
  まま）。dev で SW が生きると HMR とキャッシュが喧嘩し、「直したのに直らない」
  を量産する。
- **Playwright の SW 分離**: 登録は browser context 単位なので test 間の漏れは
  無いが、**preview の `reuseExistingServer: !CI`** は手元で古いビルドを
  掴みうる。SW を疑う前に build の鮮度を疑うこと。
- **workbox の `maximumFileSizeToCacheInBytes` 既定 2MB**。現在の wasm は
  約 130KB。上限は明示する——超過時の実挙動と番人はこの節の最後の
  bullet を見よ。
- **Cloudflare Pages の `_headers`** と SW のキャッシュヘッダが重ならないか
  確認（`public/_headers` が既存）。SW の precache はブラウザキャッシュと
  独立だが、`sw.js` 自体が長期キャッシュされると更新が届かない——
  `sw.js` は no-cache 側に置く。
- **`vite-plugin-pwa` と `vite-plugin-wasm`/`top-level-await` の共存**は
  plan の最初のタスクで素振り（ビルドが通り precache manifest に .wasm が
  載ること）を確認してから配線する。**さらに素振りで終わらせず恒久テスト化
  する**: ビルド後の `sw.js`（precache 一覧）に `.wasm` エントリが含まれる
  ことをビルド後検査か E2E で常時確認する。workbox の 2MB 上限超過は
  vite-plugin-pwa v1.3.0 の実測ではビルドエラーになる（劣化した sw.js を
  書き出してから落ちる）——「エラー側に倒す」はすでに plugin 自身がやって
  いる。だがそれは plugin のバージョンに紐づく実装詳細であり、将来変わり
  うる。「wasm がキャッシュされていること」を守る恒久的な網は、ビルドが
  成功するか劣化して落ちるかという経路に依存せず dist の実物を検査する
  この検査（scripts/check-sw.mjs）が担う成果物層の二段目である。

## §8 スコープ外

- §40 の永続化一式（§4 の理由）。更新トースト・skipWaiting UI。
- プッシュ通知・Background Sync・Periodic Sync。
- アイコンのブランドデザイン（プレースホルダで可）。
- M4 持ち越し（golden の必須 id assert・1024.0 TiB ケース・dimensions 側
  SyntaxError・engine 配置・e2e ヘルパ命名）——台帳管理、M5 のテーマ外。
- Loan（M6）、アカウント/同期（§48）。

## §9 完了条件

1. production ビルドに manifest・アイコン・SW が含まれ、Lighthouse の
   installable 判定相当の要素（manifest + SW + アイコン）が E2E で機械検査
   されている。
2. オフライン E2E が緑で、**かつ**オフラインエミュレーションの実在確認
   （初回訪問がオフラインで失敗する）も緑。
3. 既存 E2E 全件が SW 有効環境で緑のまま。
3b. ビルド成果物の `sw.js` が**無条件の即時活性化を含まない**ことが機械検査
   されている。注意: workbox は prompt モードでも `SKIP_WAITING` メッセージ
   への応答として `skipWaiting` を**ガード付きで**含むため、「skipWaiting
   という文字列が無い」は検査にならない。検査の実体は
   「`clientsClaim` が現れない（autoUpdate 注入の痕跡）かつ
   `SKIP_WAITING` メッセージガードが現れる（prompt の形）」。
   あわせて precache 一覧に `.wasm` エントリが含まれることも機械検査する
   （§2・§7 の恒久テスト）。
4. `rust-version = "1.87"` がワークスペースに宣言され、両クレートが継承、
   CONTRIBUTING に追従方針が 1 行。`cargo test --workspace` 緑のまま。
5. フルスイープ（ci.yml の全コマンド）がブランチ末尾で緑。
6. PR で M5 完了を宣言（MSRV issue があれば close）。

# Deploy

main への push が calc.terapyon.net に届くまでの経路と、届いたことを確認する手順。

## 仕組み要約

1. main への push（または `workflow_dispatch`）で `.github/workflows/deploy.yml` が
   起動し、Actions 上で wasm-pack → `vite build` → ビルド刻印（`dist/build-info.json`）
   → `check:sw` の順にビルドと自前検査を行う。
2. 検査を通った `web/dist` を `wrangler-action` が Cloudflare Pages に
   Direct Upload する（`--branch=main` で本番に配る）。
3. デプロイ直後にスモークが実 URL（calc.terapyon.net）へ `curl` を打ち、
   配信物が期待どおりかを機械検証する。

deploy.yml は CI（ci.yml）の成功を**待たない**独立ワークフローである。main に
載るのは PR 経由のマージコミットだけで、CI は PR の時点で既に緑（ブランチ保護の
前提）だから、二重にゲートする理由がない。理由の全体は
[deploy-design.md §2](superpowers/specs/2026-08-12-deploy-design.md)
を見ること。ただし `check:sw` だけはデプロイ側でも回す——CI の check:sw が
検査した dist と、デプロイジョブがビルドした dist は別のビルドで、「検査した
物を配る」を成立させるには配る物を検査するしかないため。

**スモークは公開 URL（`calc.terapyon.net`）を叩く。** Cloudflare Pages が持つ
`calcarc.pages.dev` ではない——利用者が見る URL を検査しないと、**カスタム
ドメイン側だけが壊れたときに緑のまま気づけない**。両方が同じビルドを配って
いることと、カスタムドメインでも `_headers` が効いていることは
2026-08-16 に実測で確認した。

## 初回確認チェックリスト

deploy.yml が初めて実際に走るのは main へのマージ後（このリポジトリの規約では
ワークフロー yml は手元で完全には検証できない）。初回実行のたびに、以下を
実機で確認する。

1. **Actions が緑**であることを確認する（deploy.yml のスモークまで含めて緑）。
2. **スマートフォンの Chrome** で `https://calc.terapyon.net` を開き、
   Scientific で `3 + 4 =`、Data Scale で基準例を 1 つ計算する。
3. **「ホーム画面に追加」**でインストールし、standalone（ブラウザ UI なし）で
   起動することを確認する。
4. **機内モード**にしてからアプリを起動し、両電卓（Scientific / Data Scale）が
   オフラインで動くことを確認する。
5. **更新のトーストを確認する。** 旧版を開いたままのタブ（またはホーム画面の
   standalone ウィンドウ）に、新しいデプロイのあと
   「新しいバージョンがあります」のトーストが出る。**「再読み込み」を押すと
   新版になり、押さなければ何も起きない**（「閉じる」で消しても、次に検知
   したときまた出る）。
6. **更新の届き方の背景。** Service Worker は `registerType: "prompt"` で
   新世代をバックグラウンド install するだけで、**制御中のページがある間は
   waiting に留まる**——全クライアント閉鎖で初めて切り替わる。上のトーストは
   その waiting を利用者に見せて、**押されたときだけ** `SKIP_WAITING` を
   送る出口である（勝手に世代をすり替えない原則は変えていない。
   [pwa-design.md §2](superpowers/specs/2026-08-12-pwa-design.md)、
   [sw-update-toast-design.md](superpowers/specs/2026-08-13-sw-update-toast-design.md)）。
   トーストが出ない・押しても変わらない場合は、旧版が SW ごと古い可能性が
   ある（トースト自体を持たない世代が制御している）——一度アプリを完全に
   閉じてから再訪すれば切り替わる。

## CSP を入れるとき

**いま CSP は無い。** `web/public/_headers` が持っているのは `Cache-Control`
だけである（実測 2026-08-20）。

**入れるときは `connect-src` に為替レートの取得先を足すこと。**

```text
connect-src 'self' https://open.er-api.com;
```

足し忘れると、**Convert の通貨カテゴリだけがレートを取れなくなる**。しかも
壊れ方が静かである——取得の失敗は致命的にしない設計（[U-4 spec
§5](superpowers/specs/2026-08-19-currency-design.md)）なので、画面は
エラーを出さずに**古いレートのまま換算を続ける**か、キャッシュが無ければ
「為替レートがありません」の案内を出す。**どちらも「オフラインなのだろう」と
読める見た目で、CSP が原因だとは分からない。**

取得先の綴りは `web/src/currency/provider.ts` の `PROVIDER_ENDPOINT` が
持っている（`https://open.er-api.com/v6/latest/{BASE}`）。**プロバイダを
替えるときは、この 2 か所を一緒に替えること。**

**CSP は 0.3.1 では新設しない**（U-4 spec §6 の裁定）。新設すると WASM・
Service Worker・フォント・画像のすべての経路を検証する話になり、為替の
範囲を超える。ここに書いてあるのは、**やる人が読む場所に残した宿題**である。

## ロールバック

**戻したいコミットに checkout して `workflow_dispatch` を叩く、ではなく
main に revert コミットを積む。**

理由: `workflow_dispatch` は「main の先頭を配り直す」——つまりデプロイが
詰まった／失敗した回を re-run するための手段であって、過去のコミットを
チェックアウトした状態で叩いても main は動かない。deploy.yml は
`GITHUB_SHA`（= 実行時にチェックアウトされているコミット）をビルド刻印に
焼き込み、スモークはその刻印と実際に配られている `/build-info.json` を
突き合わせる。過去のコミットを手元で checkout してから手動発火しても、
その実行は「main の先頭」ではない SHA を配ってしまい、**main の履歴と
配信物が食い違う**——次に誰かが何気なく再デプロイした瞬間、main の先頭が
また配られて古い版が消える、という事故の芽になる。

revert コミットを main に積んで通常の push 経路でデプロイすれば、
「main の先頭 = 配信物」という不変条件が最後まで崩れない。ロールバックも
新しい変更と同じ経路（PR → CI 緑 → merge → deploy.yml）を通るので、
特別扱いの手順を持ち込まずに済む。

## スモークが赤のときの読み方

デプロイ後スモークは 3 ステップで、赤になったステップがそのままどの前提が
破れたかを示す。

1. **刻印照合**（`/build-info.json` の `commit` と `GITHUB_SHA` の一致、
   リトライつき）が赤 → ビルドは成功しデプロイもキックされているが、
   エッジへの伝播が遅い（リトライ回数を使い切っただけなら再実行で消える
   一過性）か、配信されている版が最新デプロイと食い違っている（配信不整合、
   一過性でなければ深刻）。
2. **ヘッダ検査**（`sw.js` / `manifest.webmanifest` の `no-cache`、
   `/assets/` 配下の `immutable`。リトライつき——初回実行の実測で、
   `_headers` の規則は内容の伝播より遅れて効き始めることが分かっている）が
   **リトライ後も**赤 → Cloudflare Pages が `_headers` を
   尊重していない、または `web/public/_headers` の内容が設定退行している。
   デプロイそのものは成功している可能性があるので、まず `_headers` の中身と
   CF Pages 側の設定を疑う。
3. **生存確認**（この版のバンドルを指す HTML が配られている——`web/dist/index.html`
   が参照する `/assets/index-*.js` の名前を配信された `/` の HTML から
   grep する）が赤 → デプロイ自体が失敗している、ビルドが壊れている、
   または配信されている HTML が別のビルドを指している。最も基礎的な前提が
   崩れているので、Actions のビルド・アップロードのログを最初に見る。
   `_redirects` の `/* → 200` により HTTP 404 は起きない——スモークの
   失敗はすべて grep 不一致として現れる（`curl -f` は事実上効かない）。

3 ステップとも形は同じ（`curl -fsSI` または `curl -fsS` → `grep` →
非 0 exit でジョブを赤にする）。ローカルの `vite preview` で 3 つとも
同時に試すと、`preview` は全レスポンスに一律 `Cache-Control: no-cache` を
返すため no-cache 系の 2 脚（sw.js / manifest）は偶然緑になり、赤は
`immutable` 脚の不一致から出る（Task 2 の素振りで実測）。3 脚は
curl→grep→exit という同一の形なので、どの脚から赤が出てもロジックの
生存確認としては等価であり、結論は変わらない。

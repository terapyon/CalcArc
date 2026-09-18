/**
 * `/manual/` の下の要求を受ける Pages Function（0.9.3 設計書 §2.1.2）。
 *
 * **役目は 1 つ: 実体の無い `.pdf` に 404 を返すこと。**
 * `web/public/_redirects` の `/* /index.html 200` があるので、**放っておくと
 * 存在しない PDF の URL がアプリの画面として 200 で返る**——利用者には
 * 「電卓が出た」と見える（利用者の裁定 2026-09-17: **404 を返すように直す**）。
 *
 * ## なぜ `_redirects` でやらないか
 *
 * **できないからである。** Cloudflare Pages の `_redirects` が受ける status は
 * **301・302・303・307・308** と **200 の rewrite** だけで、**`404` は
 * 「対応していない」印つきで文書に挙がっている**（2026-09-17 に一次資料で確認）。
 *
 * ## なぜ置き場が `functions/manual/` なのか（**経路で絞る**）
 *
 * **Pages Functions の経路はファイルの置き場で決まる。** `functions/[[path]].js` は
 * **全要求を受ける**ので、**拡張子で弾いてもそれは「関数の中の分岐」**であり、
 * **全要求がここを通ることは変わらない**。**`functions/manual/` に置けば、
 * `/manual/` の外の要求はここに入らない**——**分岐では言えない主張である。**
 *
 * ## なぜリポジトリの根に置くのか
 *
 * **本番の配信が `pages deploy web/dist` をリポジトリの根から走らせる**からである
 * （`.github/workflows/deploy.yml`、`working-directory` を持たない段）。
 * **Functions は起動時の作業ディレクトリから見た `functions/` が拾われる**
 * ——**`web/functions/` に置くと拾われない。**
 * **証拠は 3 段に分かれている。強さが違うので、混ぜずに並べる**
 * （書き方は calcarc-e3 の裁定、2026-09-17）:
 *
 * > **測定（2026-09-17、calcarc-3d）**: 根に `functions/`・`web/dist/` を置き、
 * > `npx --yes wrangler@3.90.0 pages dev web/dist` を**根から**走らせた
 * > ——**実在する `.pdf` は素通し（200・`application/pdf`）、無いものは 404**。
 * > **測ったのは `pages dev` であって `pages deploy` ではない**（あちらは
 * > **本番へ配る操作そのもの**なので、ここからは走らせられない）。
 * >
 * > **読み（2026-09-17、calcarc-1e）**: wrangler 3.90.0 の出荷コードでは、
 * > **`pages deploy` が `functionsDirectory = "./functions"`（cwd 相対）**、
 * > **`pages dev` は `join(cwd(), "functions")`**——**同じ規則**である。
 * > **これはコードを読んだ証拠であって、この機で走らせた測定ではない。**
 * >
 * > **未確認**: **Pages 側の受け取り**。**最初のタグの走行のスモークが見る**
 * > ——`deploy.yml` が**存在しない PDF に 404 を要求する**ので、拾われて
 * > いなければそこで赤くなる。**黙って通る道は無い。**
 * > **拾われなければ、実体の無い `.pdf` はアプリの殻として 200 で返る**
 * > （0.9.2 までと同じ壊れ方）。
 *
 * ## なぜ content-type で見るのか（**許可側で書く**）
 *
 * **`env.ASSETS.fetch` は、実体が無くても 404 を返さない**——**200 と
 * `text/html` のアプリの殻**が返る（2026-09-17 実測。**`_redirects` の無い
 * dist でも同じだったので、`wrangler pages dev` の既定の振る舞いである**）。
 * **だから status では判別できない。**
 *
 * **判別は許可側で書く**: **`application/pdf` なら素通し、それ以外はすべて 404。**
 * 「pdf でなければ 404」と同じに見えて**同じではない**——**殻の type が
 * `text/html` でなくなった日に、禁止側で書いていると実体の無い PDF が 200 で通る**。
 * **許可側なら、知らない type は全部 404 に落ちる。**
 *
 * **脆さは両方向にある**（承知のうえで採る）:
 * - 実在の PDF が `application/pdf` 以外で配られた日 → **404 になる**（取れなくなる）
 * - **根拠は 2026-09-17 の測定であって、文書の保証ではない**
 *
 * **番人は 2 段**: この関数の単体テスト（`web/tests/unit/manual-function.test.ts`）と、
 * **本番のスモーク**（`deploy.yml`、存在しない `.pdf` が 404）。
 * **スモークだけにしない——タグを打つまで分からない番人は遅すぎる。**
 */

/*
 * ## この場所を lint しているのは誰か（**版もここに書く**）
 *
 * **`web` の `pnpm lint`** である——`biome check . && cd ../functions && biome check .`。
 * **`cd` しても PATH は変わらない**ので、**走るのは `web/node_modules/.bin/biome`**
 * （2026-09-17 実測、**Version 2.5.8**）。**ここに `package.json` は要らない。**
 * CI で走らせるのは **`Web build and unit tests` の `pnpm lint`**（`ci.yml:156`）。
 *
 * **版は `web` に従うのが意図である。** CLAUDE.md の記録どおり biome は
 * **`2.5.8` と厳密に綴る**もので、**範囲にすると lockfile が 2 本あるぶんずれる**
 * （実際に web 2.5.6 / heavy 2.5.8 が同居した）。**`heavy` 側から走らせると
 * `heavy` の版と設定で整形され、差分が出る**——**走らせるのは `web` からだけ。**
 *
 * **★ `functions/biome.json` に註を書こうとして踏んだ**（2026-09-17）:
 * **`biome.json` は `//` の註を受け付けない。しかも、はっきり落ちない**
 * ——**既定の設定へ黙って戻り**、この枝のすべての行を**タブで整形し直せ**と言い出した
 * （20 件）。**設定ファイルに註は書かない。註はここに書く。**
 */

/** 素通しする type。**ここに無いものはすべて 404 に落ちる**（許可側）。 */
export const SERVED_TYPE = "application/pdf";

/**
 * PDF に付ける `Content-Disposition`。
 *
 * ## ★ 0.9.5 から、アプリはここを指していない
 *
 * **リンク集の PDF は GitHub の Release の添付を指す**（`web/src/ui/Footer/
 * LinksPopup.tsx` の `manualPdfUrl`。利用者の裁定 2026-09-18）。**このヘッダは
 * 狙いを果たさなかった**:
 *
 * - **狙い**（0.9.4）: `attachment` でブラウザを「保存・共有」の扱いに倒し、
 *   **ホーム画面のアプリが PDF に乗っ取られるのを止める**
 * - **実測（監視役の `curl`、2026-09-18）**: 本番の PDF にこのヘッダは**付いていた**
 * - **実測（利用者の iPhone、2026-09-18）**: **それでも、ホーム画面のアプリから
 *   開くと窓ごと PDF に変わって戻れなかった**
 *
 * **0.9.4 が「測っていない代償」として書いていたほう**（PC では表示されず保存に
 * なる）**は当たり、狙いのほうが外れた。**
 *
 * ## なぜ消さずに残っているか
 *
 * **「残すのが良い」からではない。** **0.9.5 を出す前の夜に、リリースの経路
 * （PDF を `dist` に入れる段・本番のスモーク 2 本・その番人）を動かさない**
 * ためである。**撤去は 0.9.6 の宿題**で、対象は台帳
 * `docs/superpowers/sdd/2026-09-19-v0.9.5-implementation.md` に数えてある。
 * **この理由は 0.9.6 で腐る**——**そのとき、ここごと消す。**
 */
export const PDF_DISPOSITION = "attachment";

export async function onRequest(context) {
  const asset = await context.env.ASSETS.fetch(context.request);
  const type = asset.headers.get("content-type") ?? "";
  if (type.split(";")[0].trim().toLowerCase() === SERVED_TYPE) {
    // **名前は付けない。** ブラウザは URL の末尾から採る——**こちらで組み立てると、
    // パスの中身がそのままヘッダに入る経路を 1 つ作ることになる。**
    const headers = new Headers(asset.headers);
    headers.set("content-disposition", PDF_DISPOSITION);
    return new Response(asset.body, {
      status: asset.status,
      statusText: asset.statusText,
      headers,
    });
  }
  return new Response("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

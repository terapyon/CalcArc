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
 * **2026-09-17 に実測した**: 根に `functions/`・`web/dist/` を置いて
 * `npx --yes wrangler@3.90.0 pages dev web/dist` を根から走らせ、
 * **実在する `.pdf` は素通し（200・`application/pdf`）、無いものは 404** を確認。
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

/** 素通しする type。**ここに無いものはすべて 404 に落ちる**（許可側）。 */
export const SERVED_TYPE = "application/pdf";

export async function onRequest(context) {
  const asset = await context.env.ASSETS.fetch(context.request);
  const type = asset.headers.get("content-type") ?? "";
  if (type.split(";")[0].trim().toLowerCase() === SERVED_TYPE) {
    return asset;
  }
  return new Response("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

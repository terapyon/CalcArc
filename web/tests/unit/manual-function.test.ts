import { describe, expect, it } from "vitest";
// **リポジトリの根の `functions/`** を読む。置き場の理由は関数側の註にある
// （本番の配信が `pages deploy web/dist` を根から走らせるため）。
import {
  onRequest,
  PDF_DISPOSITION,
  SERVED_TYPE,
} from "../../../functions/manual/[[path]].js";

/** `env.ASSETS` の偽物。**1 つの応答を返すだけ**。 */
function assetsReturning(response: Response) {
  return { ASSETS: { fetch: async () => response } };
}

const request = () => new Request("https://calc.terapyon.net/manual/quick.pdf");

describe("/manual/ の Function（0.9.3 設計書 §2.1.2）", () => {
  it("実在する PDF は素通しする", async () => {
    const pdf = new Response("%PDF-1.7", {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });
    const out = await onRequest({
      request: request(),
      env: assetsReturning(pdf),
    });
    expect(out.status).toBe(200);
    expect(out.headers.get("content-type")).toBe("application/pdf");
    expect(await out.text()).toBe("%PDF-1.7");
  });

  it("PDF には attachment を付ける（0.9.4 の手。狙いは外れ、撤去は 0.9.6）", async () => {
    // **0.9.4 の狙い**は「iPhone のホーム画面のアプリが PDF に乗っ取られるのを
    // 止める」だった。**本番でヘッダは付いていたのに、止まらなかった**
    // （監視役の `curl` と利用者の iPhone、どちらも 2026-09-18 の実測）。
    // **0.9.5 からリンク集は GitHub の Release を指し、ここは指さない。**
    //
    // **この検査が見ているのは「ヘッダを付ける」ことだけ**である。
    // **残しているのはリリースの経路を出荷前の夜に動かさないため**で、
    // **Function ごと 0.9.6 で撤去する**（`functions/manual/[[path]].js` の註）。
    const pdf = new Response("%PDF-1.7", {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });
    const out = await onRequest({
      request: request(),
      env: assetsReturning(pdf),
    });
    expect(out.headers.get("content-disposition")).toBe(PDF_DISPOSITION);
    expect(PDF_DISPOSITION).toBe("attachment");
    // **元のヘッダを捨てない**（type が消えると、下の 404 の判別が壊れる）。
    expect(out.headers.get("content-type")).toBe("application/pdf");
  });

  it("404 の側には disposition を付けない", async () => {
    // 付けると、**アプリの殻を「保存しますか」と出す**ことになる。
    const shell = new Response("<!doctype html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    const out = await onRequest({
      request: request(),
      env: assetsReturning(shell),
    });
    expect(out.status).toBe(404);
    expect(out.headers.get("content-disposition")).toBeNull();
  });

  it("実体が無いときは 404 にする（`ASSETS` は 200 と殻を返す）", async () => {
    // **これが直したい穴である。** `env.ASSETS.fetch` は実体が無くても
    // **404 を返さない**——**200 と `text/html` のアプリの殻**が返る
    // （2026-09-17 実測）。**status では判別できない。**
    const shell = new Response("<!doctype html><title>CalcArc</title>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    const out = await onRequest({
      request: request(),
      env: assetsReturning(shell),
    });
    expect(out.status).toBe(404);
  });

  it("知らない type は、通さずに 404 に落とす（許可側で書いてある）", async () => {
    // **「pdf でなければ 404」と「pdf なら通す」は同じに見えて同じではない。**
    // **殻の type が `text/html` でなくなった日**、禁止側で書いていると
    // **実体の無い PDF が 200 で通る**——**直したはずの穴が黙って開き直る。**
    // ここは**その日を先取りした検査**である。
    const odd = new Response("something else", {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });
    const out = await onRequest({
      request: request(),
      env: assetsReturning(odd),
    });
    expect(out.status).toBe(404);
  });

  it("素通しする type は 1 つだけである", () => {
    // 増やすときは、上の 3 本のどれかが必ず動く。
    expect(SERVED_TYPE).toBe("application/pdf");
  });
});

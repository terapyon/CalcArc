import { readFileSync } from "node:fs";
import { imageFile } from "../shots/images";
import { openShot, parseScreenText, screenLines } from "../shots/screen-text";
import { SHOTS } from "../shots/shots";
import { expect, test } from "./fixtures";

/**
 * **README の写真が古くなったら気づく**(マニュアルの設計書 §1)。
 *
 * 0.2.0 の写真は、ラベルが変わり、タブが 4 つになり、版数が 0.9.0 に
 * なっても、**誰にも気づかれずに残っていた。** 撮るときに画面の文字を
 * `docs/images/<名前>.txt` に書き残してある(`pnpm shots`)ので、
 * **今の画面の文字がそれと違えば、写真は今の画面ではない。**
 *
 * **画面の開き方と文字の取り方は撮る側と共有する**(`../shots/screen-text.ts`)。
 * **画素は比べない**(手元と runner で描画が揺れる)。**文字は
 * `textContent` で取る**ので、Chromium と WebKit で同じになる。
 */
for (const shot of SHOTS.filter((s) => s.use === "readme")) {
  test(`docs/images/${shot.name}.png still shows today's screen`, async ({
    page,
  }) => {
    await openShot(page, shot);
    const committed = parseScreenText(
      readFileSync(imageFile(shot.name, "txt"), "utf-8"),
    );
    expect(
      await screenLines(page),
      `docs/images/${shot.name}.png is stale: the screen's text changed. ` +
        "Run `cd web && pnpm shots` and commit the new " +
        `docs/images/${shot.name}.png and docs/images/${shot.name}.txt`,
    ).toEqual(committed);
  });
}

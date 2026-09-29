import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **安全域を吸う場所は、辺ごとに 1 か所だけである。**
 *
 * 下端は**フッタが持っている**（`Footer.module.css:12` の
 * `padding-bottom: max(12px, env(safe-area-inset-bottom))`）。**盤面が同じ辺を
 * 吸うと二重になり、standalone 起動でだけ下が伸びる**——`ScientificPanel.module.css:7-11`
 * に、そう書いた註が残っている（**吸わない側に理由が書いてある**のが、この
 * プロジェクトのやり方である）。
 *
 * **左右は 1.1 で足した**（`App.module.css` の `.shell`）。**宣言は 2026-09-29 まで
 * 0 件だった**——縦持ちしか見ていなかったからである。**同じ二重取りを左右で
 * 繰り返さないために、ここが番人になる。**
 *
 * **註は数えない。宣言だけを数える。** `tools/check-boundary.mjs` の 4 本目と
 * 同じ形で、**理由を書いた行が規則違反になるのは検査の側の誤り**である
 * ——実物には「ここで `env(safe-area-inset-bottom)` を吸うと二重になり」という
 * 註が 6 ファイルに在る。
 */
const UI = join(import.meta.dirname, "..", "..", "src", "ui");

/** 左右を吸ってよい唯一の場所。 */
const SAFE_AREA_SIDES_HOME = "App.module.css";

/** `web/src/ui` 配下の `*.css` を、パスごと読む（下位のディレクトリも見る）。 */
function cssFiles(
  dir: string = UI,
  prefix = "",
): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const here = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...cssFiles(join(dir, entry.name), here));
    } else if (entry.name.endsWith(".css")) {
      out.push({
        path: here,
        text: readFileSync(join(dir, entry.name), "utf-8"),
      });
    }
  }
  return out;
}

/** その辺を**宣言として**吸っている行（`prop: … env(safe-area-inset-<辺>) …`）。 */
function declarationsFor(
  side: "left" | "right" | "bottom" | "top",
): { path: string; line: number; text: string }[] {
  const declaration = new RegExp(
    `^\\s*[-a-zA-Z]+\\s*:\\s*[^;{]*env\\(safe-area-inset-${side}\\)`,
  );
  return cssFiles().flatMap(({ path, text }) =>
    text
      .split("\n")
      .map((line, index) => ({ path, line: index + 1, text: line.trim() }))
      .filter((row) => declaration.test(row.text)),
  );
}

describe("安全域を吸う場所", () => {
  it("読んだ CSS の数を主張する（0 件を緑にしない）", () => {
    // **`readdirSync` が空を返した日に、下の「1 ファイルだけ」は何も
    // 意味しなくなる**（`check-boundary.test.ts` の「実物で確かめる」と同じ形）。
    expect(
      cssFiles().length,
      "web/src/ui の CSS を 1 件も読めていない",
    ).toBeGreaterThan(15);
  });

  it("左右を吸っているのは App.module.css だけである", () => {
    const sides = [...declarationsFor("left"), ...declarationsFor("right")];
    expect(sides.length, "左右の宣言が 1 つも無い").toBeGreaterThanOrEqual(2);
    expect([...new Set(sides.map((row) => row.path))]).toEqual([
      SAFE_AREA_SIDES_HOME,
    ]);
  });

  it("App.module.css は下端を吸わない（フッタが持っている）", () => {
    // **二重取りは standalone 起動でだけ出る**ので、手元のブラウザでは
    // 気づけない。**だから静的に見張る。**
    expect(
      declarationsFor("bottom").filter(
        (row) => row.path === SAFE_AREA_SIDES_HOME,
      ),
    ).toEqual([]);
  });

  it("下端を吸っているのは、いまの 3 か所である", () => {
    // **「よそが見張っている」と書くときは、その本数をその場で数える**
    // （`omission-reasons-claim-coverage`）。フッタ・お知らせ・リンクの一覧で、
    // **どれも画面の下端に貼り付く物**である。
    expect(
      [...new Set(declarationsFor("bottom").map((row) => row.path))].sort(),
    ).toEqual([
      "Footer/Footer.module.css",
      "Footer/LinksPopup.module.css",
      "UpdateToast/UpdateToast.module.css",
    ]);
  });
});

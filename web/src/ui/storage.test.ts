import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

/** `src/` を全部歩いて、TypeScript のファイル一覧を作る。 */
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/**
 * `localStorage` への**プロパティアクセス**だけを見る——語の言及ではない。
 * `window.localStorage` / `globalThis.localStorage` と、
 * `localStorage.foo` / `localStorage["foo"]` の形を拾う。
 *
 * **この正規表現がすり抜ける穴**(実測で確認したもの):
 * - 綴りを分割・計算した参照(`window["local" + "Storage"]`、
 *   `globalThis[SOME_VAR]` など)——字面に `localStorage` という
 *   連続した綴りが現れないので拾えない。
 * - `.` も `[` も続かない**裸の識別子参照**(例: 変数へ代入する
 *   `const s = localStorage;`)——プロパティアクセスの形をしていない。
 *
 * この検査は「字面が掴み手の形をしているか」だけを見る——意図して隠した
 * 掴み手や、上の 2 通りの形まではここでは検査できない、という前提に立つ。
 *
 * **逆向きの穴もある**(Fix round 3 finding。実際に踏んだ)。この検査は
 * コードとコメントを区別しない——**コメントの中で `localStorage.foo` の
 * 形を字面どおり綴っただけでも光る**。「語の言及ではない」は「裸の単語の
 * 言及ではない」という意味であって、「掴み手の形をした文章」まで除外して
 * いるわけではない。実際に本ファイルの上の doc comment
 * (`window.localStorage` / `localStorage.foo` 等)がこの正規表現に
 * マッチする——`.test.ts` は「1 ファイルだけ」の検査(下)から除外して
 * いるので実害は出ていないが、`.test.ts` でない場所に同じ形の説明的な
 * コメントを書けば、掴んでもいないファイルが「掴み手」として引っかかる。
 */
const REACHES_FOR_LOCAL_STORAGE =
  /\b(?:window|globalThis)\s*\.\s*localStorage\b|\blocalStorage\s*[.[]/;

it("the guard matches a property access, not a mention", () => {
  // ただ語が出てくるだけでは光らない。
  expect(REACHES_FOR_LOCAL_STORAGE.test("localStorage と同じ形")).toBe(false);
  expect(REACHES_FOR_LOCAL_STORAGE.test("`localStorage` を掴む")).toBe(false);
  // 実際に掴む形なら光る。
  expect(REACHES_FOR_LOCAL_STORAGE.test("window.localStorage")).toBe(true);
  expect(REACHES_FOR_LOCAL_STORAGE.test("globalThis.localStorage")).toBe(true);
  expect(REACHES_FOR_LOCAL_STORAGE.test("localStorage.getItem(k)")).toBe(true);
  expect(REACHES_FOR_LOCAL_STORAGE.test('localStorage["x"]')).toBe(true);
  // 既知の穴: 裸の識別子参照は、プロパティアクセスの形をしていないので
  // 光らない。バグではなく、上の doc comment が名指している穴そのもの。
  expect(REACHES_FOR_LOCAL_STORAGE.test("const s = localStorage;")).toBe(false);
});

it("only one file reaches for localStorage", () => {
  // **註が言っていることを、註ではなく検査が言う**(計画 Task 6)。
  const holders = filesUnder("src")
    .filter(
      (p) =>
        /\.tsx?$/.test(p) &&
        !p.endsWith(".test.ts") &&
        !p.endsWith(".test.tsx"),
    )
    .filter((p) => REACHES_FOR_LOCAL_STORAGE.test(readFileSync(p, "utf8")))
    .sort();
  expect(holders).toEqual(["src/ui/storage.ts"]);
});

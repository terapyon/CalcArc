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
 * `window.localStorage` と `localStorage.foo` / `localStorage["foo"]` の
 * 形を拾う。
 *
 * **この正規表現がすり抜ける穴**: 綴りを分割・計算した参照
 * (`window["local" + "Storage"]`、`globalThis[SOME_VAR]` など)は
 * 字面に `localStorage` という連続した綴りが現れないので拾えない。
 * この検査は「字面が掴み手の形をしているか」だけを見る——意図して隠した
 * 掴み手までは検査できない、という前提に立つ。
 */
const REACHES_FOR_LOCAL_STORAGE =
  /\bwindow\s*\.\s*localStorage\b|\blocalStorage\s*[.[]/;

it("the guard matches a property access, not a mention", () => {
  // ただ語が出てくるだけでは光らない。
  expect(REACHES_FOR_LOCAL_STORAGE.test("localStorage と同じ形")).toBe(false);
  expect(REACHES_FOR_LOCAL_STORAGE.test("`localStorage` を掴む")).toBe(false);
  // 実際に掴む形なら光る。
  expect(REACHES_FOR_LOCAL_STORAGE.test("window.localStorage")).toBe(true);
  expect(REACHES_FOR_LOCAL_STORAGE.test("localStorage.getItem(k)")).toBe(true);
  expect(REACHES_FOR_LOCAL_STORAGE.test('localStorage["x"]')).toBe(true);
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

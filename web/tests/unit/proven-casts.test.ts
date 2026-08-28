import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **文字列を切って union だと言い切るキャストを置かない。**
 *
 * 盤面のトークンは `field:months` `precision:fp16` のように接頭辞つきで、
 * パネルは接尾辞を取り出して union に入れていた:
 *
 * ```ts
 * setActive(token.slice("field:".length) as LlmField);
 * ```
 *
 * **`as` は検査ではなく宣言である。** 綴りを間違えても型は通り、
 * 盤面の綴りとパネルの union がずれた日に、**存在しない項目が active に
 * 入る**。2026-08-28 の点検で **13 か所**在った。
 *
 * 代わりに `Keypad/parse.ts` の `parsePrefixed` を通す——**一覧に載って
 * いなければ `null`**。キャストは 1 か所に閉じ、そこは実行時に確かめてから
 * 通している。
 *
 * **件数ではなく 0 件を主張する。** 「13 件が 0 件になった」と書くと、
 * 12 件直した日にも意味のある数として読めてしまう。**1 か所でも残っていたら
 * 赤い**、が主張である。
 */
const SRC = join(import.meta.dirname, "..", "..", "src");

/** `*.ts` / `*.tsx` を再帰で集める。生成物(`src/wasm`)は歩かない。 */
function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "wasm") continue;
      found.push(...sources(path));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes(".test.")) continue;
    found.push(path);
  }
  return found;
}

/** `…slice(…) as Union` の形。**`as const` は対象外**である。 */
const UNPROVEN = /\.slice\([^)]*\)\s+as\s+[A-Z]\w*/;

describe("接頭辞つきトークンの取り出し", () => {
  it("never asserts a union straight out of a slice", () => {
    const files = sources(SRC);
    // **読んだファイル数を先に主張する。** ディレクトリの綴りが変われば
    // 0 件になり、「違反 0 件」で緑を返してしまう。
    expect(files.length, "no source file was ever read").toBeGreaterThanOrEqual(
      40,
    );

    const found: string[] = [];
    for (const path of files) {
      readFileSync(path, "utf-8")
        .split("\n")
        .forEach((line, index) => {
          if (UNPROVEN.test(line)) {
            found.push(
              `${path.slice(SRC.length + 1)}:${index + 1}: ${line.trim()}`,
            );
          }
        });
    }
    expect(found).toEqual([]);
  });
});

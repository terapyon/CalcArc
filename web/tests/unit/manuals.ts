import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ManualFile } from "../../scripts/manual/markdown.ts";

/**
 * マニュアルの本文を読む**番人どうしの共有の 1 か所**(設計書
 * `2026-09-10-manuals-design.md` §2・§6)。キー名の番人
 * (`manual-key-names.test.ts`)と写真・章の番人(`manual-shots.test.ts`)が
 * 同じ読み方をする——片方だけ読み方が変わると、**片方が別のものを見て緑になる。**
 *
 * **このファイルはテストではない**(`*.test.ts` ではないので vitest は
 * 拾わない)。読むだけで、何も主張しない。
 */
export const MANUAL_DIR = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "docs",
  "manual",
);

/**
 * **在るべきマニュアルはちょうどこの 3 冊**(設計書 §2、裁定「簡易は日本語と
 * 英語、詳細は日本語だけ」)。並びは `readdirSync` を整列した順。
 *
 * **冊数の下限ではなく、一覧そのものを固定する。** 1 冊消えても、名前を
 * 綴り違えても、4 冊目が紛れ込んでも赤くなる——4 冊目を足すなら、
 * それは裁定を変える相談である。
 */
export const EXPECTED_MANUALS: readonly string[] = [
  "detail.ja.md",
  "quick.en.md",
  "quick.ja.md",
];

/** `docs/manual/*.md` をすべて、名前の順に読む。無ければ空。 */
export function readManuals(): ManualFile[] {
  if (!existsSync(MANUAL_DIR)) return [];
  return readdirSync(MANUAL_DIR)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => ({
      path: `docs/manual/${name}`,
      text: readFileSync(join(MANUAL_DIR, name), "utf8"),
    }));
}

/** `docs/manual/quick.ja.md` → `quick.ja.md`。 */
export function manualName(file: ManualFile): string {
  return file.path.replace(/^docs\/manual\//, "");
}

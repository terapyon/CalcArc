import { describe, expect, it } from "vitest";
import {
  extractChapters,
  extractShotRefs,
} from "../../scripts/manual/markdown.ts";
import { SHOTS } from "../shots/shots";
import { EXPECTED_MANUALS, manualName, readManuals } from "./manuals";

/**
 * **マニュアルの写真の印と章立ての番人**（設計書
 * `2026-09-10-manuals-design.md` §6・§7・§8、計画 T4）。
 *
 * - **`shot:` ↔ 撮影の台本を両向きに見る。** マニュアルの `shot:<名前>` は
 *   台本の `use: "manual"` の 1 枚を指し、台本の `use: "manual"` はどれかの
 *   マニュアルから使われる——**撮るだけで誰も載せない写真を残さない**
 *   （設計書 §6）。README の写真（`use: "readme"`）はマニュアルから指せない
 *   ——あちらはリポジトリに置く写真で、置き場も撮り直す契機も違う
 * - **英語の簡易版が章を黙って落とさない**（設計書 §7）。訳の良し悪しは
 *   機械で決まらないが、**章の数と番号**は数えられる
 *
 * **置けない番人**: 写真が章の説明に合っているか、訳が正しいかは機械では
 * 見られない。利用者が PR の差分と PDF で読む。
 */

const files = readManuals();
const byName = new Map(files.map((file) => [manualName(file), file]));

const manualShots = SHOTS.filter((shot) => shot.use === "manual").map(
  (shot) => shot.name,
);

const refs = files.flatMap((file) =>
  extractShotRefs(file.text).map((ref) => ({ ...ref, path: file.path })),
);

/**
 * 3 冊の `shot:` の件数の下限。**2026-09-10 に 3 冊の草稿で数えた実数。**
 * 写真を減らしたら、ここを実数に下げる（黙って減らさない）。
 */
const SHOT_REF_FLOOR = 10;

/** 章の数（設計書 §8 の章立て）。 */
const QUICK_CHAPTERS = 7;
const DETAIL_CHAPTERS = 10;

/** `1..n` の配列。 */
const upTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

function chapterNumbers(name: string): number[] {
  const file = byName.get(name);
  if (file === undefined) throw new Error(`docs/manual/${name} が無い`);
  return extractChapters(file.text).map((chapter) => chapter.number);
}

describe("マニュアルの写真の印", () => {
  it("reads the three manuals and finds shots in them", () => {
    // **読んだものを先に数える。** 0 冊・0 件でも下の 2 本は緑になる。
    expect(files.map(manualName)).toEqual(EXPECTED_MANUALS);
    expect(refs.length).toBeGreaterThanOrEqual(SHOT_REF_FLOOR);
    expect(manualShots.length).toBeGreaterThan(0);
  });

  it("names only manual shots from the shot list", () => {
    const unknown = refs
      .filter((ref) => !manualShots.includes(ref.name))
      .map((ref) => `${ref.path}:${ref.line} shot:${ref.name}`);
    expect(unknown).toEqual([]);
  });

  it("uses every manual shot in some manual", () => {
    const used = new Set(refs.map((ref) => ref.name));
    expect(manualShots.filter((name) => !used.has(name))).toEqual([]);
  });
});

describe("マニュアルの章立て", () => {
  it("numbers the quick manual's chapters 1 to 7", () => {
    expect(chapterNumbers("quick.ja.md")).toEqual(upTo(QUICK_CHAPTERS));
  });

  it("keeps every chapter of the Japanese quick manual in the English one", () => {
    // **番号の並びごと比べる。** 数だけ比べると、1 章消して別の章を
    // 2 回書いても緑になる。
    expect(chapterNumbers("quick.en.md")).toEqual(
      chapterNumbers("quick.ja.md"),
    );
  });

  it("numbers the detailed manual's chapters 1 to 10", () => {
    expect(chapterNumbers("detail.ja.md")).toEqual(upTo(DETAIL_CHAPTERS));
  });
});

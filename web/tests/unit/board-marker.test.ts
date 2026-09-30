import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **横向きの格子の規則は 1 か所にだけ在る**（1.1.0、設計書
 * `docs/superpowers/specs/2026-09-30-landscape-layout-design.md` §2.5 の番人 #9）。
 *
 * **器の CSS は 6 ファイルに分かれている**ので、**同じ媒体条件と格子を 6 つ写すと、
 * 1.1 の設計書 §1.3 が数えた「同じ 6 行の写し 8 ファイル」と同じ穴**になる。
 * **印（`data-board`）を器に付け、規則は `tokens.css` に 1 回だけ**書く。
 *
 * **★ 2 列になるのは「5×5 を持つ面」だけ**（**利用者の裁定 2026-09-30**
 * ——「**横にしたときには基本的に、10 キー部の 5×5 だけが右側に来るのが良い**」）。
 * **印は 3 つ**: `data-board`（器・6 面すべて）、`data-keypad`（キーの入れ物）、
 * **`data-square`（10 キー部。`columns === 5 && height === "square" &&
 * keys.length === 25` で `Keypad.tsx` が付ける）**。
 * **`data-square` が無い面は積んだまま**である（`#scale/llm` がそれ）。
 * **横向きでカテゴリの帯を上の段へ上げる印が `data-category`。**
 */
const UI = join(import.meta.dirname, "..", "..", "src", "ui");

/** `web/src/ui` 配下のファイルを、拡張子で選んで読む。 */
function filesUnder(suffix: string, dir: string = UI): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(suffix, path);
    return entry.name.endsWith(suffix) ? [path] : [];
  });
}

const read = (path: string) => readFileSync(path, "utf8");

/** 器を名乗っている場所（`data-board` を書いた行）。 */
const boards = () =>
  filesUnder(".tsx")
    .filter((path) => !path.endsWith(".test.tsx"))
    .filter((path) => read(path).includes("data-board"));

describe("横向きの格子の印", () => {
  it("6 つの器すべてが印を持つ", () => {
    // **名指しで数える。** 「6 件あった」だけだと、**別のファイルが 1 つ増えて
    // 別の 1 つが落ちた日**に緑のままになる。
    const names = boards()
      .map((path) => path.slice(UI.length + 1))
      .sort();
    expect(names).toEqual([
      "Convert/UnitPanel.tsx",
      "DataScale/DataScalePanel.tsx",
      "Finance/FinancePanel.tsx",
      "Llm/LlmPanel.tsx",
      "ScientificPanel.tsx",
      "Transfer/TransferPanel.tsx",
    ]);
  });

  it("印は値を持たない（面ごとに分けない）", () => {
    // **2026-09-30 に一度 `data-board="split"` を使い、関数電卓だけを 2 列に
    // した**が、**利用者の裁定で全面に広げた**ので値は要らなくなった。
    // **値を残すと「この面だけ違う」が黙って復活する。**
    //
    // **★ `=` そのものを禁じる**（レビュー役の条件 B2、2026-09-30）。
    // **`/data-board="/` は JSX の式 `data-board={"x"}` を通す**——
    // **主張は「値を持たない」なのだから、引用符ではなく `=` を見る。**
    for (const path of filesUnder(".tsx").filter(
      (file) => !file.endsWith(".test.tsx"),
    )) {
      const text = read(path);
      // **`data-board` と `data-category` は素の属性**である。
      for (const mark of ["data-board", "data-category"]) {
        expect(text, `${path} の ${mark} が値を持っている`).not.toMatch(
          new RegExp(`${mark}\\s*=`),
        );
      }
    }
    // **`data-square` だけは式で付ける**（区画の正体を見て決めるので）。
    // **付くときは値を持たない**——`"" : undefined` の形であることを見る。
    const keypad = read(join(UI, "Keypad", "Keypad.tsx"));
    expect(keypad, "印が値を持つ形になっている").toMatch(
      /data-square=\{[\s\S]*\?\s*""\s*:\s*undefined[\s\S]*\}/,
    );
  });

  it("10 キー部の印は Keypad.tsx が 1 か所で付ける", () => {
    // **「位置」ではなく「正体」で指す**——`:last-of-type` は面によって
    // 別の区画を指す（Data Scale の「データ型」、Convert の単位、金融の
    // モードと税の面では、キーパッドの最後が 5×5 ではない。2026-09-30 実測）。
    const marks = filesUnder(".tsx")
      .filter((path) => !path.endsWith(".test.tsx"))
      .filter((path) => read(path).includes("data-square"));
    expect(marks.map((path) => path.slice(UI.length + 1))).toEqual([
      "Keypad/Keypad.tsx",
    ]);
    // **判定の 3 つとも見る**（レビュー役の注記 C4）——**`height === "square"` だけ
    // 見ていると、`keys.length === 25` を外す変異が単体では止まらない。**
    const keypad = read(join(UI, "Keypad", "Keypad.tsx"));
    for (const part of [
      'section.height === "square"',
      "section.columns === 5",
      "section.keys.length === 25",
    ]) {
      expect(keypad, `印の判定から ${part} が消えた`).toContain(part);
    }
  });

  it("カテゴリの帯の印は CategorySelect だけが持つ", () => {
    const marks = filesUnder(".tsx")
      .filter((path) => !path.endsWith(".test.tsx"))
      .filter((path) => read(path).includes("data-category"));
    expect(marks.map((path) => path.slice(UI.length + 1))).toEqual([
      "Category/CategorySelect.tsx",
    ]);
  });

  it("印を読む CSS は tokens.css だけである", () => {
    // **写しを許すと、片方だけ直る日が来る**（設計書 §2.5）。
    const readers = filesUnder(".css").filter((path) =>
      read(path).includes("data-board"),
    );
    expect(readers.map((path) => path.slice(UI.length + 1))).toEqual([
      "tokens.css",
    ]);
  });

  it("10 キー部とカテゴリの印を読む CSS も、tokens.css だけである", () => {
    for (const mark of ["data-square", "data-category"]) {
      const readers = filesUnder(".css").filter((path) =>
        read(path).includes(mark),
      );
      expect(
        readers.map((path) => path.slice(UI.length + 1)),
        `${mark} を読む CSS`,
      ).toEqual(["tokens.css"]);
    }
  });

  it("キーの入れ物の印も、読むのは tokens.css だけである", () => {
    // `display: contents` を当てる相手（`data-keypad`）も同じ規律で。
    const readers = filesUnder(".css").filter((path) =>
      read(path).includes("data-keypad"),
    );
    expect(readers.map((path) => path.slice(UI.length + 1))).toEqual([
      "tokens.css",
    ]);
  });

  it("横向きの媒体条件も 1 か所だけである", () => {
    // **条件を写すと、片方の数字だけが動く日が来る**（660 / 840）。
    const withStage = filesUnder(".css").filter((path) =>
      read(path).includes("max-height: 840px"),
    );
    expect(withStage.map((path) => path.slice(UI.length + 1))).toEqual([
      "tokens.css",
    ]);
  });
});

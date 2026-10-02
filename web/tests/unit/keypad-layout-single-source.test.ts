import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **10 キーの配置を決める規則は 1 か所にしか無い**（2026-10-03、設計書
 * `docs/superpowers/specs/2026-09-30-landscape-layout-design.md` §2.0.8）。
 *
 * **利用者が実機で問うた**——「**10 キーの実装が二重化されているのでしょうか?
 * 表示する中身は別ですが、配置は同じだと思います**」。**数えたら実在した**:
 * **行（`grid-template-rows: repeat(5, 1fr)`）が 4 か所**、
 * **区画の正方（`aspect-ratio: 1 / 1`）が 3 か所**——**そして正方のほうは
 * Convert・Data Scale・Transfer にだけ在り、関数電卓と金融電卓には無かった。**
 * **利用者の「2 個はうまくいかず、2 個で問題ない」と同じ割れ方**である。
 *
 * **直すだけでは、また増える**（[[same-defect-four-times]]）。**だからここが数える。**
 *
 * **★ 「10 キーに当たる宣言」をどう見分けるか**——**選択子に印が在るかで見る**:
 * **`data-square`**（`tokens.css` が使う属性）、**`.square`**（`Keypad.module.css`
 * のクラス）、**`aria-label="数字と演算のキー"`**（面の CSS が使う綴り）。
 * **この 3 つのどれかを含む選択子だけを数える。**
 * **単位キー・データ型・候補キーなど、10 キー以外の 5 行の区画は数えない**
 * ——**面の CSS にはそれらの宣言が残る**（**それは写しではない**）。
 *
 * **★ キーに当たる宣言は除く**（`.square > button` など）——**見ているのは区画である。**
 * **選択子の最後の部分が `button` なら、それはキーの規則。**
 *
 * **数えないもの**: **横向きの段の上書き**（`tokens.css` の `aspect-ratio: auto`）。
 * **あれは「同じことの写し」ではなく、段を出入りするための上書き**である
 * ——**下の最後の主張が、その 1 か所だけであることを見る。**
 */
const UI = join(import.meta.dirname, "..", "..", "src", "ui");

/** `web/src/ui` 配下の CSS を、パスつきで読む。 */
function cssFiles(dir: string = UI): { path: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    if (!entry.name.endsWith(".css")) return [];
    return [
      { path: path.slice(UI.length + 1), text: readFileSync(path, "utf8") },
    ];
  });
}

/**
 * **CSS を「選択子 ＋ 宣言」の組に割る。**
 *
 * **註は先に落とす**——**註に綴りが現れた日に、主張が無くなるか偽の赤になる**
 * （`staging-workflow.test.ts` と同じ理由）。**`@media` は入れ子なので、
 * 波括弧の深さを数えて、葉の規則だけを取る。**
 */
function rules(css: string): { selector: string; body: string }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { selector: string; body: string }[] = [];
  const stack: string[] = [];
  let buffer = "";
  for (const ch of text) {
    if (ch === "{") {
      stack.push(buffer.trim());
      buffer = "";
    } else if (ch === "}") {
      const selector = stack.pop() ?? "";
      if (buffer.trim() !== "" && !selector.startsWith("@")) {
        out.push({ selector, body: buffer });
      }
      buffer = "";
    } else {
      buffer += ch;
    }
  }
  return out;
}

/** 10 キーの区画を指す印。**どれか 1 つでも在れば、その選択子は 10 キーに当たりうる。** */
const MARKS = [
  /data-square/,
  /\.square(?![\w-])/,
  /aria-label="数字と演算のキー"/,
];

/**
 * **選択子のこの部分は、10 キーの「区画」に当たるか**（キーではなく）。
 *
 * **★ `:has(…)` の中の印は数えない**——**`main:has([data-square])` は
 * 「10 キーを含む `main`」であって、10 キーではない**（2026-10-03 に
 * `tokens.css` の 2 本を数えてしまい、赤で気づいた）。**先に落とす。**
 */
function targetsTheSquare(selector: string): boolean {
  return selector.split(",").some((whole) => {
    const part = whole.replace(/:has\([^)]*\)/g, "");
    if (!MARKS.some((mark) => mark.test(part))) return false;
    // **最後の部分が `button` なら、それはキーの規則である。**
    const last = part.trim().split(/\s+|>/).filter(Boolean).at(-1) ?? "";
    return !last.includes("button");
  });
}

/** **その宣言を持つ、10 キーの区画の規則**を、ファイル名つきで集める。 */
function declaringFiles(property: RegExp): string[] {
  return cssFiles()
    .filter(({ text }) =>
      rules(text).some(
        (rule) => targetsTheSquare(rule.selector) && property.test(rule.body),
      ),
    )
    .map(({ path }) => path)
    .sort();
}

describe("10 キーの配置は 1 か所が決める", () => {
  it("読めている（0 件で緑にしない）", () => {
    const files = cssFiles();
    expect(files.length, "読んだ CSS の数").toBeGreaterThanOrEqual(15);
    const parsed = files.flatMap(({ text }) => rules(text));
    expect(parsed.length, "割れた規則の数").toBeGreaterThanOrEqual(100);
    const square = parsed.filter((rule) => targetsTheSquare(rule.selector));
    // **印の 3 つがどれも現れなくなった日に、下の `toEqual` は空どうしで緑になる。**
    expect(
      square.length,
      "10 キーの区画に当たる規則の数",
    ).toBeGreaterThanOrEqual(3);
  });

  it("区画の正方（`aspect-ratio: 1 / 1`）は 1 か所だけである", () => {
    // **2026-10-03 まで 3 か所に在った**（`Convert/UnitPanel`・
    // `DataScale/DataScalePanel`・`Transfer/TransferPanel`）——**そして
    // `Keypad.module.css` には無かった**ので、**関数電卓と金融電卓だけ
    // 箱の高さが中身なり**だった。
    expect(declaringFiles(/aspect-ratio:\s*1\s*\/\s*1/)).toEqual([
      join("Keypad", "Keypad.module.css"),
    ]);
  });

  it("区画の行（`grid-template-rows`）は 1 か所だけである", () => {
    // **2026-10-03 まで 4 か所**（上の 3 つ ＋ `Keypad.module.css`）。
    expect(declaringFiles(/grid-template-rows:/)).toEqual([
      join("Keypad", "Keypad.module.css"),
    ]);
  });

  it("横向きの上書きは `tokens.css` の 1 か所だけである", () => {
    // **これは写しではない**（段を出入りするための上書き）。**ただし、
    // 2 か所になったらやはり片方だけ直る日が来る**ので、ここでも数える。
    expect(declaringFiles(/aspect-ratio:\s*auto/)).toEqual(["tokens.css"]);
  });
});

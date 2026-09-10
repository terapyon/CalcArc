import { expect, type Page } from "../e2e/fixtures";
import type { Shot } from "./shots";

/**
 * **撮る側(`capture.spec.ts`)と E2E(`../e2e/readme-images.spec.ts`)が
 * 共有する 1 か所。** 画面の開き方と、画面の文字の取り方をここにだけ書く
 * ——2 か所に書くと、片方だけ直した日に「写真を撮った画面」と「突き合わせる
 * 画面」がずれ、**番人が別のものを見て緑になる。**
 */

/**
 * **フッタは写さない。文字も取らない**(マニュアルの設計書 §1)。フッタは
 * 版数を出すので、写すと**リリースのたびに写真が古くなる**——0.2.0 の 3 枚が
 * 「CalcArc 0.2.0」を載せたまま残ったのが、まさにその形である。
 */
export const FOOTER = "footer";

/** 台本の 1 枚の画面を開き、キーを押し終えたところまで進める。 */
export async function openShot(page: Page, shot: Shot): Promise<void> {
  await page.goto(`/${shot.hash}`);
  // **パネルが出てから進む。** フッタは WASM と無関係に即描画されるので、
  // これが無いと読み込み中の空の画面を撮る(`viewport-budget.spec.ts` と同じ理由)。
  await expect(page.getByTestId("display-main")).toBeVisible();
  for (const name of shot.keys ?? []) {
    await page.getByRole("button", { name, exact: true }).click();
  }
}

/**
 * **画面の文字を 1 行ずつ取る**——写真が古くなったことに気づくための材料
 * (マニュアルの設計書 §1)。**画素は比べない**(手元と runner で描画が揺れる)。
 *
 * **`textContent` で取る。`innerText` は使わない。** `innerText` は配置と
 * CSS に左右され、E2E は Chromium と WebKit の両方で回る
 * (1.0 の門の設計書 §1.3)。`textContent` は DOM だけで決まる。
 *
 * **行の切り方**: キー(`button`)と選択肢(`option`)は 1 つで 1 行
 * (2 行のラベル `返済⏎月額` は `返済 月額` の 1 行になる)。それ以外は、
 * 要素の境目で切った**連続する文字の塊**が 1 行。空白は 1 つに畳む。
 * ラベルを 1 つ変えると差分が 1 行で出る。
 *
 * **見えない文字も入る**(2026-09-10 に 3 画面で実測): 読み上げ用の
 * `<h1>`(`visually-hidden`)、押せないキーの説明、閉じた `<select>` の
 * 選ばれていない `<option>`。**見えている文字はすべて入っている**
 * (CSS の `content` で描いている文字は無い——`content: ""` の 1 か所だけ)ので、
 * ラベルが変われば必ず差分が出る。見えない文字が変わっても赤くなるが、
 * 撮り直せば済む側に倒れる。
 */
export async function screenLines(page: Page): Promise<string[]> {
  return page.evaluate((exclude) => {
    const root = document.getElementById("root");
    if (root === null) throw new Error("#root が無い");
    // **外すものが在ることを先に確かめる。** 綴りが変わって 0 件になると、
    // 版数が `.txt` に入り、**リリースのたびに赤くなる**番人になる。
    const excluded = root.querySelectorAll(exclude).length;
    if (excluded !== 1) {
      throw new Error(`"${exclude}" が 1 つではない(${excluded} 件)`);
    }
    const lines: string[] = [];
    const push = (text: string) => {
      const line = text.replace(/\s+/g, " ").trim();
      if (line !== "") lines.push(line);
    };
    const visit = (el: Element) => {
      if (el.matches(exclude)) return;
      if (el.matches("button, option")) {
        push(el.textContent ?? "");
        return;
      }
      let run = "";
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          run += node.textContent ?? "";
          continue;
        }
        push(run);
        run = "";
        if (node instanceof Element) visit(node);
      }
      push(run);
    };
    visit(root);
    return lines;
  }, FOOTER);
}

/** `docs/images/<name>.txt` の中身。1 行 1 項目、末尾に改行。 */
export function formatScreenText(lines: readonly string[]): string {
  return `${lines.join("\n")}\n`;
}

/** `formatScreenText` の逆。 */
export function parseScreenText(text: string): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

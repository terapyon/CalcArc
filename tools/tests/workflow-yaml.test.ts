import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **ワークフローのファイルが YAML として壊れていないこと。**
 *
 * **2026-09-30 に実際に壊れた。** `staging.yml` に
 * `run: printf '\n/*\n  X-Robots-Tag: noindex\n' >> web/dist/_headers` と
 * **1 行で**書いたところ、**引用符なしのスカラーに含まれるコロン＋空白**
 * (`X-Robots-Tag: noindex`)が**鍵と値に読まれて YAML が壊れた**。
 *
 * **壊れ方がいちばん悪い。** **GitHub はファイルを解析できないとトリガも読めない**
 * ので、**`on: push: branches: [main]` と書いてあっても、どの枝の push でも
 * 「失敗の走行」を作る**(走行 `36648277882`、ジョブ 0 本、名前が `name:` ではなく
 * ファイルパスで表示された)。
 *
 * **そして、それまでの番人 18 本は全部緑だった**——**あちらはファイルを
 * 文字列として読む**ので、**YAML として読めるかを誰も見ていなかった。**
 *
 * **YAML の読み手はこのリポジトリに無い**(`web` にも `heavy` にも
 * `yaml` / `js-yaml` は入っていない。2026-09-30 に確認)。**依存を増やさずに、
 * この罠そのものを捕まえる**——**引用符もブロックスカラーも使っていない 1 行の値に、
 * コロン＋空白が入っていないこと。**
 *
 * **これは YAML の検査の代わりではない。** 捕まえるのは**この 1 つの罠**だけで、
 * **字下げの崩れや鍵の重複は見ていない。** それでよい理由は、
 * **この罠が「手元では全部緑、GitHub でだけ壊れる」形**だからである
 * ——ほかの壊れ方は、たいてい書いたその場で目に付く。
 */
const WORKFLOWS = join(import.meta.dirname, "..", "..", ".github", "workflows");

/** 値が「引用符・ブロックスカラー・配列・辞書」で始まっていれば、コロンは安全。 */
const QUOTED_OR_BLOCK = /^["'|>[{&*!]/;

type Offender = { file: string; line: number; text: string };

function inlineScalarsWithColonSpace(file: string): Offender[] {
  const out: Offender[] = [];
  const text = readFileSync(join(WORKFLOWS, file), "utf8");
  text.split("\n").forEach((raw, index) => {
    // 註の行は読まない。**GitHub も読まない。**
    if (/^\s*#/.test(raw)) return;
    // `<字下げ><鍵>: <値>` の形だけを見る。`- ` で始まる段の 1 行目も含む。
    const m = /^\s*-?\s*[A-Za-z_][A-Za-z0-9_-]*:[ \t]+(.*)$/.exec(raw);
    if (m === null) return;
    const value = m[1] ?? "";
    if (value === "" || QUOTED_OR_BLOCK.test(value)) return;
    // **行末の註を落としてから見る**(` #` の前までが値である)。
    const withoutComment = value.replace(/\s+#.*$/, "");
    if (/:[ \t]/.test(withoutComment)) {
      out.push({ file, line: index + 1, text: raw.trim() });
    }
  });
  return out;
}

describe("ワークフローの 1 行の値に、コロン＋空白が入っていない", () => {
  const files = readdirSync(WORKFLOWS).filter((n) => n.endsWith(".yml"));

  it("読んだファイルが 1 つ以上ある", () => {
    // **0 件で緑を返さない。** パスを綴り違えた日に、この検査は黙る。
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(files).toContain("staging.yml");
    expect(files).toContain("deploy.yml");
  });

  it.each([
    "ci.yml",
    "deploy.yml",
    "release.yml",
    "heavy-corpus.yml",
    "staging.yml",
  ])("%s は 1 行の値にコロン＋空白を持たない", (file) => {
    const found = inlineScalarsWithColonSpace(file);
    expect(found, `YAML が壊れる: ${JSON.stringify(found)}`).toEqual([]);
  });
});

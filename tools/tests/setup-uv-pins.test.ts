import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **`astral-sh/setup-uv` の使用は、どれも uv と Python を同じ値に固定する。**
 *
 * **2026-10-13 に実際に落ちた。** `heavy-corpus.yml` の setup-uv にだけ
 * `version` も `python-version` も無く、走行 `38400161178` では action が
 * 最新の uv 0.13.0 を入れ、それが CPython 3.15.0 を選んだ。コーパス 18 枚の
 * `generated_by` が「Python 3.14」から「Python 3.15」に変わり、
 * 「The committed corpus must equal a fresh generation」が赤くなった。
 * **`ci.yml` の側は固定してあったので、毎回の CI は緑のままだった**——
 * **ずれは手動起動とタグの走行でしか見えない。**
 *
 * 値を 1 か所にそろえるのは、**参照実装を回す Python が走行ごとに違うと、
 * 同じ生成器の出力が CI と Heavy corpus で食い違う**からである。
 */
const GITHUB = join(import.meta.dirname, "..", "..", ".github");

const yamlFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return yamlFiles(path);
    return /\.ya?ml$/.test(entry.name) ? [path] : [];
  });

type Use = {
  where: string;
  version: string | undefined;
  python: string | undefined;
};

/** `uses: astral-sh/setup-uv@…` の段ごとに、`with:` の中の 2 つの値を取る。**註の行は読まない。** */
function setupUvUses(file: string): Use[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const out: Use[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*-?\s*uses:\s*astral-sh\/setup-uv@/.test(line)) return;
    const indent = line.search(/\S/);
    const use: Use = {
      where: `${relative(GITHUB, file)}:${index + 1}`,
      version: undefined,
      python: undefined,
    };
    // 段の終わり（同じか浅い字下げの `- `、または段より浅い行）まで読む。
    for (const next of lines.slice(index + 1)) {
      if (next.trim() === "" || /^\s*#/.test(next)) continue;
      const nextIndent = next.search(/\S/);
      if (nextIndent < indent || /^\s*- /.test(next)) break;
      const m = /^\s*(version|python-version):\s*(.+?)\s*$/.exec(next);
      if (m?.[1] === "version") use.version = m[2];
      if (m?.[1] === "python-version") use.python = m[2];
    }
    out.push(use);
  });
  return out;
}

describe("setup-uv の固定", () => {
  const uses = yamlFiles(GITHUB).flatMap(setupUvUses);

  it("setup-uv の使用を見つけている（0 件で緑にならない）", () => {
    // `ci.yml` の Python reference と `heavy-corpus.yml` の 2 か所。
    expect(uses.length).toBeGreaterThanOrEqual(2);
  });

  it("どの使用にも version と python-version がある", () => {
    const missing = uses.filter(
      (use) => use.version === undefined || use.python === undefined,
    );
    expect(missing).toEqual([]);
  });

  it("値が全箇所で同じである", () => {
    const pin = (use: Use) => `${use.version} / ${use.python}`;
    const first = uses[0] === undefined ? "" : pin(uses[0]);
    expect(uses.filter((use) => pin(use) !== first)).toEqual([]);
  });
});

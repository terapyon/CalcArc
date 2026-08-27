import { describe, expect, it } from "vitest";
import {
  findBoundaryViolations,
  readWebFiles,
} from "../../../tools/check-boundary.mjs";

// **向きは片方向である**(CLAUDE.md)。`web` から重量級への参照は 0 件で、
// この向きを保つ。逆(`heavy` が `web` を読む)は正常なので見ない。

describe("findBoundaryViolations", () => {
  it("web が heavy を名指ししていたら見つける", () => {
    const found = findBoundaryViolations([
      {
        path: "web/scripts/x.mjs",
        text: 'const HEAVY_MARKER = "Heavy corpus";\n',
      },
    ]);
    expect(found).toEqual([
      {
        path: "web/scripts/x.mjs",
        line: 1,
        text: 'const HEAVY_MARKER = "Heavy corpus";',
      },
    ]);
  });

  it("大文字小文字を問わない", () => {
    expect(
      findBoundaryViolations([{ path: "web/a.ts", text: "heavy-report.md" }]),
    ).toHaveLength(1);
    expect(
      findBoundaryViolations([{ path: "web/a.ts", text: "HEAVY" }]),
    ).toHaveLength(1);
  });

  it("web の外は見ない", () => {
    // `heavy/` 自身と `tools/` は heavy を名乗ってよい。
    expect(
      findBoundaryViolations([
        { path: "heavy/tests/corpus/report.ts", text: "heavy" },
        {
          path: "tools/release-evidence.mjs",
          text: 'const HEAVY_MARKER = "Heavy corpus";',
        },
      ]),
    ).toHaveLength(0);
  });

  it("行番号と中身を返す（どこを直せばよいか分かる形で）", () => {
    const found = findBoundaryViolations([
      { path: "web/b.ts", text: "ok\nok\nimport heavy from 'x'\n" },
    ]);
    expect(found).toEqual([
      { path: "web/b.ts", line: 3, text: "import heavy from 'x'" },
    ]);
  });

  it("いまの web は 1 件も無い（実物で確かめる）", () => {
    // **これが本題である。** D-2（`web` が heavy を知っていた 6 行）は
    // 2026-08-26 の移動で消えた。**消えたままであることを、この検査が見張る。**
    const found = findBoundaryViolations(readWebFiles());
    expect(found).toEqual([]);
  });
});

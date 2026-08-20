import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runOneMutation } from "../../scripts/detection-power.mjs";

// **`detection-power.test.ts` とは別ファイルにした。** あちらはファイル
// 全体に効く `vi.mock("node:fs", ...)` / `vi.mock("node:child_process",
// ...)` を持っている——`measure()` を単体テストするために `readFileSync`
// / `writeFileSync` / `rmSync` / `execFileSync` を丸ごと差し替えている。
// ここのテストは逆に、一時ディレクトリへ**実際にファイルを書いて読む**
// ことでしか「原状回復」を確かめられない。同じファイルに置くと、
// あちらの `vi.mock` がここの `writeFileSync`/`readFileSync` も差し替えて
// しまい、`runOneMutation` が実在しないファイルを読み書きしたかのように
// 空振りする——テストが常に緑になる形の偽陰性。分けることで、モックの
// 有無をファイル境界で明確にした。

function sandbox(contents: string) {
  const root = mkdtempSync(join(tmpdir(), "detection-power-"));
  const relative = "crates/x/src/lib.rs";
  mkdirSync(dirname(join(root, relative)), { recursive: true });
  writeFileSync(join(root, relative), contents, "utf-8");
  return {
    root,
    relative,
    read: () => readFileSync(join(root, relative), "utf-8"),
  };
}

const ORIGINAL = "let x = 1;\nlet y = 2;\n";
const mutation = {
  id: "m",
  what: "",
  file: "crates/x/src/lib.rs",
  from: "let x = 1;",
  to: "let x = 9;",
  expectShards: [],
  minRate: {},
};

describe("the file always goes back", () => {
  it("restores it when the heavy run throws", () => {
    const box = sandbox(ORIGINAL);
    expect(() =>
      runOneMutation(mutation, {
        root: box.root,
        measure: () => {
          throw new Error("heavy died");
        },
      }),
    ).toThrow(/heavy died/);
    expect(box.read()).toBe(ORIGINAL);
  });

  it("restores it when the verdict throws", () => {
    // **ここが守っているのは実装の配置ではなく、外から見える契約――
    // 「変異してから戻るまでのどこで例外が出ても、ファイルは原文に戻る」
    // ――である。** 判定(`verdictFor`)を `finally` の外で呼ぶ旧い
    // 書き方に戻しても、このテスト自体は通ってしまう:`finally` を
    // 抜けてから判定を呼ぶ以上、判定に処理が届く時点で復元はすでに
    // 終わっており、判定が例外を投げても復元は影響を受けない。つまり
    // 「判定が finally の内側にあるかどうか」は、原文と一致するかを
    // 見るだけのこのテストでは検出できない――JS の `finally` は、
    // その後に続く文が何であれ先に走ることが保証されているため。
    const box = sandbox(ORIGINAL);
    expect(() =>
      runOneMutation(mutation, {
        root: box.root,
        measure: () =>
          ({
            get buildOk(): never {
              throw new Error("parse blew up");
            },
          }) as never,
      }),
    ).toThrow(/parse blew up/);
    expect(box.read()).toBe(ORIGINAL);
  });

  it("fails loudly when the mutation site is gone", () => {
    // **黙って飛ばさない。** 飛ばすと「検出力を測った」という記録だけが残る。
    const box = sandbox("let z = 3;\n");
    const result = runOneMutation(mutation, {
      root: box.root,
      measure: () => {
        throw new Error("should not run");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.kind).toBe("mutation-site-missing");
    expect(box.read()).toBe("let z = 3;\n");
  });
});

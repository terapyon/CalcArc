import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **E2E は `./fixtures` の `test` を使う。素の `@playwright/test` は使わない。**
 *
 * `fixtures.ts` の `test` は**既定でレートのプロバイダを塞ぐ**。素の
 * `@playwright/test` を import したファイルはその既定の外にいて、
 * `#convert/currency` を開いた瞬間に**本物の `open.er-api.com` へ出る**
 * ——そして**成功すれば緑になる**ので、誰も気づかない。
 *
 * 以前の塞ぎは `convert.spec.ts` の `test.beforeEach` にだけ在り、
 * **Playwright の `beforeEach` はファイルの中でしか効かなかった**。
 * 既定に移したので、いま塞ぎを外せるのは**この import を迂回すること**
 * だけである。だからそこを見張る。
 *
 * **これは vitest から見る。** Playwright に自分の走らせ方を検査させると、
 * 迂回したファイルは**その検査自体を迂回する**——外から読むしかない。
 */
const E2E_DIR = join(import.meta.dirname, "..", "e2e");

describe("E2E の import", () => {
  it("goes through the shared fixtures, never straight to playwright", () => {
    const specs = readdirSync(E2E_DIR).filter((name) =>
      name.endsWith(".spec.ts"),
    );
    // **件数を先に主張する。** ディレクトリの綴りが変われば 0 件になり、
    // 「違反 0 件」で緑を返してしまう。
    expect(specs.length, "no spec file was ever read").toBeGreaterThanOrEqual(
      20,
    );

    const offenders: string[] = [];
    for (const name of specs) {
      const src = readFileSync(join(E2E_DIR, name), "utf-8");
      if (src.includes("@playwright/test")) offenders.push(name);
      // `test` をどこからも取っていないファイルは、そもそも走らない。
      if (!src.includes('from "./fixtures"')) {
        offenders.push(`${name}(fixtures を import していない)`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

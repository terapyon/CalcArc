import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

/** `src/` を全部歩いて、`localStorage` の綴りを数える。 */
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

it("only one file reaches for localStorage", () => {
  // **註が言っていることを、註ではなく検査が言う**(計画 Task 6)。
  const holders = filesUnder("src")
    .filter(
      (p) =>
        /\.tsx?$/.test(p) &&
        !p.endsWith(".test.ts") &&
        !p.endsWith(".test.tsx"),
    )
    .filter((p) => readFileSync(p, "utf8").includes("localStorage"));
  expect(holders).toEqual(["src/ui/storage.ts"]);
});

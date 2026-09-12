import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { imageFile } from "../shots/images";
import { SHOTS } from "../shots/shots";

/**
 * **README が載せる写真は、すべて撮影の台本から撮ったものである**
 * (マニュアルの設計書 §1、裁定 #5)。
 *
 * 0.2.0 の写真は**撮った手順ごと失われていた**——台本に無い写真は
 * `pnpm shots` が撮り直さず、`readme-images.spec.ts` も突き合わせない。
 * **台本に無い写真を README に足すと、ここが赤くなる。** 逆に、台本の
 * README 用の写真が README から外れたら、それも赤くする(撮るだけで
 * 誰も見ない写真を残さない)。
 */
const REPO = join(import.meta.dirname, "..", "..", "..");
const READMES = ["README.md", "README.en.md"];

/** README が `docs/images/` から読むファイル名。 */
function referencedImages(readme: string): string[] {
  const text = readFileSync(join(REPO, readme), "utf-8");
  return [...text.matchAll(/docs\/images\/([^)\s"'#?]+)/g)].map(
    (m) => m[1] ?? "",
  );
}

const readmeShots = SHOTS.filter((shot) => shot.use === "readme");

describe("README の写真", () => {
  it("has at least the three README shots", () => {
    // **件数を先に主張する。** 台本が空になれば、下の 2 本は何も比べずに
    // 緑になる。
    expect(readmeShots.map((shot) => shot.name).length).toBeGreaterThanOrEqual(
      3,
    );
    const names = SHOTS.map((shot) => shot.name);
    expect(new Set(names).size, "shot names repeat").toBe(names.length);
  });

  it.each(READMES)(
    "%s shows only shots from the list, each with its text",
    (readme) => {
      const missing: string[] = [];
      for (const file of referencedImages(readme)) {
        const name = file.replace(/\.png$/, "");
        if (!file.endsWith(".png")) {
          missing.push(`${file}(pnpm shots が作るのは .png だけ)`);
        } else if (!readmeShots.some((shot) => shot.name === name)) {
          missing.push(`${file}(台本に use: "readme" の ${name} が無い)`);
        } else {
          for (const ext of ["png", "txt"] as const) {
            if (!existsSync(imageFile(name, ext))) {
              missing.push(`docs/images/${name}.${ext}(ファイルが無い)`);
            }
          }
        }
      }
      expect(missing).toEqual([]);
    },
  );

  it("puts every README shot in README.md", () => {
    const shown = new Set(referencedImages("README.md"));
    const unused = readmeShots
      .map((shot) => `${shot.name}.png`)
      .filter((file) => !shown.has(file));
    expect(unused).toEqual([]);
  });
});

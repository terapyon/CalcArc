import { join } from "node:path";

/**
 * README の写真の置き場。**README の写真だけはリポジトリに置く**——GitHub で
 * README に出すためである(マニュアルの設計書 §1、裁定 #5)。
 * マニュアルの写真は置かない(同 §3、裁定 #1)。
 *
 * **このファイルは Playwright を import しない。** 単体テスト(vitest)も
 * ここから置き場を読むので、Playwright の `test` を連れてくると
 * vitest の中で読み込めなくなる。
 */
export const IMAGES_DIR = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "docs",
  "images",
);

/**
 * `<name>.png` は写真、`<name>.txt` はそのとき画面にあった文字
 * (`screen-text.ts`)。**2 つは同じ撮影で同時に書く。**
 */
export function imageFile(name: string, ext: "png" | "txt"): string {
  return join(IMAGES_DIR, `${name}.${ext}`);
}

/**
 * **マニュアルの写真の置き場。追跡しない**(`.gitignore` の `web/manual-shots/`)。
 * マニュアルの写真は PDF の中にだけ入り、リポジトリに置かない(設計書 §2・§3、
 * 裁定 #1)。`pnpm manual --shots manual-shots` がここを読む。
 *
 * **文字(`.txt`)は書かない。** README の写真の `.txt` は「リポジトリに残った
 * 写真が古くなった」ことに気づくための材料で、マニュアルの写真は PDF を作る
 * たびに撮り直すので、古くなる写真がそもそも残らない。
 */
export const MANUAL_SHOTS_DIR = join(
  import.meta.dirname,
  "..",
  "..",
  "manual-shots",
);

/** マニュアルの写真 1 枚の置き場。`shot:<name>` が `<name>.png` を指す。 */
export function manualShotFile(name: string): string {
  return join(MANUAL_SHOTS_DIR, `${name}.png`);
}

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

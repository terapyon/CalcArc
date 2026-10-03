import { routeFromHash } from "../../src/route";
import { screenName } from "../../src/ui/screenName";
import { expect, type Page } from "./fixtures";

/**
 * **その画面に居ることを待つ**（2026-10-03、台帳
 * `docs/superpowers/sdd/2026-10-03-hash-navigation-waits.md`）。
 *
 * **この巡回は hash だけで画面を移る**——`page.goto("/#manual")` は同じ文書内の
 * 遷移なので、**ページは読み直されない。** **`<h1>` も盤面も、React が
 * `hashchange` を受けて描き替えるまで前の画面のまま**である。
 *
 * **だから `main` のボタンや `display-main` では待てない**——**どちらも全画面に
 * 在るものなので、前の画面で通る。** **`<h1>` は画面ごとに違う**ので、
 * これは前の画面では通らない。
 *
 * **出方は 2 つある**:
 * - **床が「以上」の検査では、前の画面を数えて緑のまま間違える**
 *   （実測: `#finance` → `#manual` で、金融の 37 本をもう 1 度数えた）。
 * - **逆向きでは足りなくなって赤くなる**（`v1.1.0` のタグの前に CI が
 *   `checked 425 < 床 428` で落ちた。走行 `37088331044`）。
 *
 * **名前は `screenName(routeFromHash(hash))` から引く**——**綴りをここに
 * 書かない。** **アプリの `<h1>` も同じ関数が書いている**ので、
 * **画面の名前を変えた日に、待ちだけが古いまま残ることがない。**
 *
 * **中身の到着は呼ぶ側が待つ。** 画面によって「届いた印」が違う
 * （電卓の面は `main` のボタン、`#manual` は冊を選ぶボタンで、
 * あちらは `virtual:manuals` の動的 import なので `<h1>` のあとに届く）。
 * **ここが見るのは「どの画面に居るか」だけ**である。
 */
export async function onScreen(page: Page, hash: string): Promise<void> {
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: screenName(routeFromHash(hash)),
      exact: true,
    }),
    `${hash} の画面に切り替わらない（前の画面のまま測っている）`,
  ).toBeVisible();
}

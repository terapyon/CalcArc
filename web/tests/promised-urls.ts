import type { Route } from "../src/route";

/**
 * **1.0 が約束する画面の URL。** 1.0 のあとも、この表の URL は同じ画面を開く
 * (`docs/superpowers/specs/2026-09-10-one-point-oh-gate-design.md` の §2.3、
 * 利用者の裁定 2026-09-10)。
 *
 * **行は足してよい。消さない・`hash` の綴りを変えない。** 1.0 のあとに画面を
 * 退かせる・名前を変えるなら、**`web/src/route.ts` の `routeFromHash` に、
 * 古い URL を新しい画面へ向ける分岐を足す**——行は残し、`module` と
 * `category` を向け先に書き換える。「互換分岐は作らない」は 1.0 までの方針で
 * ある。
 *
 * **字面で書く。アプリの表から組み立てない。** `CONVERT_CATEGORY_IDS` や
 * `SCALE_CATEGORIES` から起こすと、**カテゴリを消した日に表も一緒に縮んで
 * 緑のまま**になる——`screen-identity.spec.ts` の件数(`1 +
 * CONVERT_CATEGORY_IDS.length + SCALE_CATEGORIES.length + 1`)がまさにそうで、
 * カテゴリと巡回の行を両方消すと緑のまま通っていた(設計書 §2.4 の「穴」)。
 * 同じファイルの `SCREENS` の註も同じ理由で期待値を手で書いている
 * (「組み立てると、表と期待値が同時に間違っても緑になる」)。
 * **型だけは `route.ts` から借りる**——型は縮めば赤くなる向きにしか効かない。
 *
 * **件数の下限 13 はここに書かない。** `web/src/route.test.ts` が字面で持つ
 * ——ここに定数で置くと、行を消した人が同じ diff で下げられる。
 *
 * **読むのは 2 か所である**(設計書 §2.4「表は 1 か所に置き、単体テストと
 * E2E が同じ表を読む」)。`web/src/route.test.ts` は `routeFromHash` がそれぞれを
 * その画面に解くことを、`web/tests/e2e/screen-identity.spec.ts` は表の URL が
 * すべて巡回に入っていることを見る。
 *
 * **置き場は `tests/` の直下である。** vitest の `include`
 * (`src/**\/*.test.ts(x)` と `tests/unit/**\/*.test.ts`)にも Playwright の
 * `testDir`(`tests/e2e`)にも当たらないので、**どちらもこれをテストとして
 * 拾わない**。型検査(`tsconfig.json` の `include` の `tests`)と lint
 * (`biome.json` の `tests/**`)には入る。
 *
 * **綴りは `screen-identity.spec.ts` の `SCREENS` から写した**(2026-09-10)。
 */
export type PromisedUrl = Route & { readonly hash: string };

export const PROMISED_URLS: readonly PromisedUrl[] = [
  { hash: "#scientific", module: "scientific", category: null },
  { hash: "#convert/length", module: "convert", category: "length" },
  { hash: "#convert/mass", module: "convert", category: "mass" },
  { hash: "#convert/temperature", module: "convert", category: "temperature" },
  { hash: "#convert/area", module: "convert", category: "area" },
  { hash: "#convert/volume", module: "convert", category: "volume" },
  { hash: "#convert/speed", module: "convert", category: "speed" },
  { hash: "#convert/data-size", module: "convert", category: "data-size" },
  { hash: "#convert/currency", module: "convert", category: "currency" },
  { hash: "#scale/data-scale", module: "scale", category: "data-scale" },
  { hash: "#scale/llm", module: "scale", category: "llm" },
  { hash: "#scale/transfer", module: "scale", category: "transfer" },
  { hash: "#finance", module: "finance", category: null },
];

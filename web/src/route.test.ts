import { describe, expect, it } from "vitest";
import { PROMISED_URLS } from "../tests/promised-urls";
import { routeFromHash } from "./route";

describe("routeFromHash", () => {
  it("reads the two known modules that have no category", () => {
    expect(routeFromHash("#scientific")).toEqual({
      module: "scientific",
      category: null,
    });
    expect(routeFromHash("#finance")).toEqual({
      module: "finance",
      category: null,
    });
  });

  it("reads a category out of the second segment", () => {
    expect(routeFromHash("#scale/data-scale")).toEqual({
      module: "scale",
      category: "data-scale",
    });
  });

  it("falls to the default category when the second segment is missing", () => {
    // U-0 の Scale は中身が 1 つしか無い。#scale はそこへ倒す。
    expect(routeFromHash("#scale")).toEqual({
      module: "scale",
      category: "data-scale",
    });
  });

  it("falls to the default category when the second segment is unknown", () => {
    expect(routeFromHash("#scale/nope")).toEqual({
      module: "scale",
      category: "data-scale",
    });
  });

  it("keeps convert's own categories, which are not the default one", () => {
    // **U-0 の時点では CATEGORIES と DEFAULT_CATEGORY を区別できなかった**
    // ——scale の唯一のカテゴリが既定値と同じ値だったので、CATEGORIES を空に
    // しても振る舞いが 1 つも変わらなかった(U-1 spec §6)。
    // **`#convert/mass` は既定(`length`)とは違う値なので、ここで穴が埋まる。**
    expect(routeFromHash("#convert/mass")).toEqual({
      module: "convert",
      category: "mass",
    });
    expect(routeFromHash("#convert/temperature")).toEqual({
      module: "convert",
      category: "temperature",
    });
  });

  it("falls back to length when the category is unknown", () => {
    expect(routeFromHash("#convert/furlong")).toEqual({
      module: "convert",
      category: "length",
    });
    expect(routeFromHash("#convert")).toEqual({
      module: "convert",
      category: "length",
    });
  });

  it("does not route the old #data-scale hash any more", () => {
    // **互換は作らない**(設計書 §1-4、クローズドβのため)。旧 #loan と
    // 同じ扱いで、知らないハッシュとして既定に倒れる。これは仕様である。
    expect(routeFromHash("#data-scale")).toEqual({
      module: "scientific",
      category: null,
    });
  });

  it("does not route the old #loan hash any more", () => {
    expect(routeFromHash("#loan")).toEqual({
      module: "scientific",
      category: null,
    });
  });

  it("falls back to scientific for an empty or unknown hash", () => {
    expect(routeFromHash("")).toEqual({ module: "scientific", category: null });
    expect(routeFromHash("#nope")).toEqual({
      module: "scientific",
      category: null,
    });
  });

  it("ignores a third segment instead of failing", () => {
    expect(routeFromHash("#scale/data-scale/extra")).toEqual({
      module: "scale",
      category: "data-scale",
    });
  });

  it("reads the three scale categories", () => {
    for (const category of ["data-scale", "llm", "transfer"]) {
      expect(routeFromHash(`#scale/${category}`)).toEqual({
        module: "scale",
        category,
      });
    }
  });
});

/**
 * **1.0 の URL の約束**(1.0 の門の設計書 §2.3・§2.4、利用者の裁定
 * 2026-09-10)。表は `web/tests/promised-urls.ts` が字面で持つ。
 */
describe("the URLs promised at 1.0", () => {
  it("keeps at least the 13 URLs promised at 1.0", () => {
    // **`13` を字面で書く。** 表の隣に定数を置くと、行を消した人が同じ
    // diff で下げられる。**表は増やしてよいが減らせない**ので下限である
    // ——画面を足した日にここを直す必要は無い。
    //
    // この件数は下の 2 本の前提でもある。表が空になれば、行ごとの検査は
    // **1 度も比較せずに緑を返す。**
    expect(
      PROMISED_URLS.length,
      `the promise lists ${PROMISED_URLS.length}: ${PROMISED_URLS.map(({ hash }) => hash).join(" ")}`,
    ).toBeGreaterThanOrEqual(13);
  });

  it("opens each promised URL on its own screen", () => {
    // **食い違いを全部集めてから比べる。** 1 行目で止まると、2 つ消えた日に
    // 1 つしか見えない。
    //
    // **倒れ先そのものである 3 行は、「解けた」と「倒れた」を見分けられない**
    // (2026-09-10 に変異させて測った)。`#scientific` は知らない先頭の倒れ先、
    // `#convert/length` と `#scale/data-scale` はカテゴリの既定である。
    // - `SCALE_CATEGORIES` から `"transfer"` を消す → **ここが赤い**
    //   (`#scale/transfer → data-scale`)
    // - `"data-scale"` を消す／`MODULES` から `"scientific"` を消す／
    //   `CONVERT_CATEGORY_TOKENS` から `"length"` を消す → **ここは緑**。
    //   倒れた先が同じ画面なので、答えが変わらない
    //
    // **それでも約束は破れていない**——同じ URL で同じ画面が開く。破れるのは
    // 倒れ先が動いたときで、**そちらはここが赤くなる**(`"data-scale"` を消して
    // 既定を `llm` にする、`"scientific"` を消して知らない先頭を `finance` へ
    // 倒す、の 2 つで確かめた)。緑だった 3 つのうち `"data-scale"` と
    // `"length"` は別の検査(`ScalePanel`・`SCREEN_NAMES`・型検査ほか)が
    // 赤くなる。**`"scientific"` だけは vitest 477 本と型検査の全部が緑だった**
    // ——振る舞いが 1 つも変わらないので、赤くなる理由が無い。
    //
    // **ここが見ないのは画面の中身である。** その 3 行が本当にその画面を
    // 描くかは、`screen-identity.spec.ts` の巡回がタブの名前と `<h1>` で見る
    // (E2E。上の変異では走らせていない)。
    const wrong = PROMISED_URLS.filter(({ hash, module, category }) => {
      const route = routeFromHash(hash);
      return route.module !== module || route.category !== category;
    }).map(({ hash }) => `${hash} → ${JSON.stringify(routeFromHash(hash))}`);
    expect(wrong, "promised URLs that open another screen").toEqual([]);
  });

  it("lists each promised URL once", () => {
    // 重複があると、下限の 13 を 12 の URL で満たせてしまう。
    const hashes = PROMISED_URLS.map(({ hash }) => hash);
    const repeated = hashes.filter((hash, i) => hashes.indexOf(hash) !== i);
    expect(repeated, "promised URLs listed twice").toEqual([]);
  });
});

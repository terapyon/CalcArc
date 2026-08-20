import { describe, expect, it } from "vitest";
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

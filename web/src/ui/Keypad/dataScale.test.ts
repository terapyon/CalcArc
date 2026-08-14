import { describe, expect, it } from "vitest";
import { DATA_TYPE_TOKENS } from "../../datascale/types";
import { DATA_SCALE_SECTIONS, FIELD_SECTION, TYPE_SECTIONS } from "./dataScale";

/** 数字面の 4×4 と、それと入れ替わる型面。 */
const PAD = DATA_SCALE_SECTIONS[1];
const TYPE_SECTION = TYPE_SECTIONS[1];

if (PAD === undefined || TYPE_SECTION === undefined) {
  throw new Error("面が 2 区画で組まれていない");
}

describe("Data Scale のキー集合", () => {
  it("names its sections the way the design fixed them", () => {
    // 区画名は E2E のセレクタである(設計書 §3)。Loan と同名のものがあるので、
    // E2E はパネル起点で引く。
    expect(DATA_SCALE_SECTIONS.map((s) => s.ariaLabel)).toEqual([
      "入力する項目",
      "数字と単位のキー",
    ]);
    expect(TYPE_SECTIONS.map((s) => s.ariaLabel)).toEqual([
      "入力する項目",
      "データ型のキー",
    ]);
    // **項目の区画はどちらの面でも同じ**。面が変わっても項目は選べる。
    expect(TYPE_SECTIONS[0]).toBe(FIELD_SECTION);
    expect(DATA_SCALE_SECTIONS[0]).toBe(FIELD_SECTION);
  });

  it("keeps both faces on the same four by four frame", () => {
    // 面を入れ替えても画面が伸び縮みしないこと(設計書 §2)。
    // **これは列数と高さクラスが同じというだけでは成立しない**——型面は
    // 11 キーで 3 行しか描かれないので、行数は CSS が押さえる。
    expect(PAD.columns).toBe(4);
    expect(TYPE_SECTION.columns).toBe(4);
    expect(PAD.height).toBe("square");
    expect(TYPE_SECTION.height).toBe("square");
  });

  it("puts DEL and AC in the same place on both faces", () => {
    // 右上と、その下(設計書 §2)。面が変わっても指の位置が変わらない。
    expect(PAD.keys[3]?.token).toBe("del");
    expect(PAD.keys[7]?.token).toBe("ac");
    expect(TYPE_SECTION.keys[3]?.token).toBe("del");
    expect(TYPE_SECTION.keys[7]?.token).toBe("ac");
  });

  it("offers every data type the core knows, and no new tokens", () => {
    // token_parity は DATA_TYPE_TOKENS ↔ DataType::ALL を見ている。
    // キー化はボタンにするだけで、トークンは増やさない(設計書 §5)。
    const types = TYPE_SECTION.keys.flatMap((k) =>
      k.token?.startsWith("dtype:") ? [k.token.slice("dtype:".length)] : [],
    );
    expect(types.sort()).toEqual([...DATA_TYPE_TOKENS].sort());
  });

  it("leaves the spare cells empty rather than drawing dead buttons", () => {
    // 恒久の空きは何も描かない(S1 の予約スロット「ここに何か来る」とは
    // 別物。設計書 §2)。
    expect(TYPE_SECTION.keys).toHaveLength(11); // 9 型 + DEL + AC
  });

  it("gives every key an accessible name", () => {
    for (const s of [...DATA_SCALE_SECTIONS, ...TYPE_SECTIONS]) {
      for (const key of s.keys) {
        expect(key.ariaLabel.length).toBeGreaterThan(0);
      }
    }
  });
});

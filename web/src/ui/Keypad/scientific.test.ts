import { describe, expect, it } from "vitest";
import { KEY_TOKENS } from "../../calc";
import { SCIENTIFIC_SECTIONS } from "./scientific";

// Scientific のキー集合そのものの検査。描画を伴わないので .ts に置く
// （Keypad.test.tsx は部品の振る舞いを見る。設計書 §4）。

const allKeys = SCIENTIFIC_SECTIONS.flatMap((s) => s.keys);

/** 区画は名前で引く。添字だと並べ替えで黙って別の区画を見る。 */
function section(ariaLabel: string) {
  const found = SCIENTIFIC_SECTIONS.find((s) => s.ariaLabel === ariaLabel);
  if (!found) throw new Error(`no section named ${ariaLabel}`);
  return found;
}

describe("Scientific のキー集合", () => {
  it("offers every key the core accepts, exactly once", () => {
    // レイアウトから漏れたキーは押しようがない。網羅をテストで固定する。
    // 第 1 面と第 2 面のどちらに出るかは問わない(π は Shift 面にある)。
    const laidOut = allKeys
      .flatMap((k) => [k.token, k.shift?.token ?? null])
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .sort();
    expect(laidOut).toEqual([...KEY_TOKENS].sort());
  });

  it("has no reserved slots in the function row or main grid", () => {
    // S2 で 000 と Exp が有効になった。関数列 2 段目には ENG 以外に 6 つの
    // 予約がある(S-1/S-4 が後で埋める)ので、そこだけ対象から外す。
    for (const name of ["関数キー", "数字と演算のキー"]) {
      const reserved = section(name).keys.filter(
        (k) => k.token === null && !k.kind,
      );
      expect(reserved).toEqual([]);
    }
  });

  it("gives every key an accessible label", () => {
    for (const key of allKeys) {
      expect(key.ariaLabel.length).toBeGreaterThan(0);
      if (key.shift) expect(key.shift.ariaLabel.length).toBeGreaterThan(0);
    }
  });

  it("lays the main grid out five by five", () => {
    const main = section("数字と演算のキー");
    expect(main.columns).toBe(5);
    expect(main.keys).toHaveLength(25);
    // 先頭行と最終行だけ固定する(配置の意図が壊れたら気づく)。
    expect(main.keys.slice(0, 5).map((k) => k.label)).toEqual([
      "(",
      ")",
      "+/−",
      "DEL",
      "AC",
    ]);
    expect(main.keys.slice(20, 25).map((k) => k.label)).toEqual([
      "0",
      "000",
      ".",
      "+",
      "=",
    ]);
  });

  it("puts the function row above, half height, with DRG at its end", () => {
    const functions = section("関数キー");
    expect(functions.height).toBe("half");
    expect(functions.keys.map((k) => k.label)).toEqual([
      "Shift",
      "sin",
      "cos",
      "tan",
      "√",
      "x²",
      "DRG",
    ]);
  });

  it("puts ENG on the first face, not behind Shift", () => {
    // 「押しやすくしたい」(ユーザー)——Shift の裏では要件を満たさない。
    const second = SCIENTIFIC_SECTIONS.find(
      (s) => s.ariaLabel === "第 2 関数列",
    );
    expect(second?.columns).toBe(7);
    expect(second?.height).toBe("half");
    expect(second?.keys[0]?.token).toBe("eng");
    // 予約スロットが 6 つあること自体を主張する。長さの検査が無いと
    // "every" は空配列でも真になり、予約スロットを消しても緑のまま
    // 通ってしまう(§7.3 が予約スロットを置く理由が守られない)。
    expect(second?.keys).toHaveLength(7);
    // 残りは予約スロット。S-1 と S-4 が埋める。
    expect(second?.keys.slice(1).every((k) => k.token === null)).toBe(true);
  });

  it("does not move the main grid", () => {
    // **3 タブで揃えた 5×5**。ここを崩すと Finance / Data Scale と食い違う。
    const pad = SCIENTIFIC_SECTIONS.find(
      (s) => s.ariaLabel === "数字と演算のキー",
    );
    expect(pad?.columns).toBe(5);
    expect(pad?.keys).toHaveLength(25);
  });

  it("does not let one section name match another", () => {
    // Playwright の getByRole は**部分一致**である。区画名が他の区画名の
    // 部分文字列になっていると、1 要素を期待する locator が strict-mode で
    // 落ちる——しかも書いた人には理由が見えない。
    const names = SCIENTIFIC_SECTIONS.map((s) => s.ariaLabel);
    for (const a of names) {
      for (const b of names) {
        if (a !== b) expect(b.includes(a)).toBe(false);
      }
    }
  });
});

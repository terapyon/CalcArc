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
    // S2 で 000 と Exp が有効になり、S-1 と S-4 が 2 段目を埋め切った。
    // **どの区画にも予約スロットは残っていない。**
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
    expect(second?.keys).toHaveLength(7);
    // **並びを丸ごと主張する**(S-1 §7 の確定盤面 + S-4 の `°'"`)。
    // `every` で書くと空配列でも真になり、スロットを消しても緑のまま
    // 通ってしまう。
    expect(second?.keys.map((k) => k.token)).toEqual([
      "eng",
      "ln",
      "log10",
      "recip",
      "exp_e",
      "pow",
      "dms",
    ]);
  });

  it("puts the inverse trig functions behind their own first face", () => {
    // sin の裏が asin という対応が自然だから第 2 面に置いた(S-1 設計書 §7)。
    const pairs = section("関数キー").keys.map((k) => [
      k.token,
      k.shift?.token,
    ]);
    expect(pairs).toContainEqual(["sin", "asin"]);
    expect(pairs).toContainEqual(["cos", "acos"]);
    expect(pairs).toContainEqual(["tan", "atan"]);
  });

  it("puts the base of the natural logarithm behind e to the x", () => {
    // ユーザーの質問への答え: 同じ e。eˣ を Shift すると底そのものが出る。
    const key = section("第 2 関数列").keys.find((k) => k.token === "exp_e");
    expect(key?.shift?.token).toBe("e");
  });

  it("has no reserved slots left anywhere on the board", () => {
    // **S-4 で最後の 1 枠(`°'"`)が埋まった。** 4 本の spec を通して
    // 盤面に空きは 1 つも無い——Shift 自身を除けば、すべてのキーが
    // トークンを持つ。次に機能を足す人は**置き場を作るところから**になる。
    const reserved = allKeys.filter((k) => k.token === null && !k.kind);
    expect(reserved).toEqual([]);
    // 第 2 面にも「準備中」は残っていない。
    const faces = allKeys.filter((k) => k.shift).map((k) => k.shift?.token);
    expect(faces.every((t) => t !== null)).toBe(true);
  });

  it("puts the counting keys behind the digits, the only place three fit", () => {
    // S-3 設計書 §7 の裁定 2。**数字キーに第 2 面が付くのは初めて**なので、
    // 3 つが隣り合っていることを明示的に主張する。
    const grid = section("数字と演算のキー");
    const shifted = grid.keys
      .filter((k) => k.shift)
      .map((k) => [k.token, k.shift?.token]);
    expect(shifted).toEqual([
      ["7", "n_fact"],
      ["8", "n_p_r"],
      ["9", "n_c_r"],
      ["exp", "pi"],
    ]);
  });

  it("makes the shifted digits look like functions, not digits", () => {
    // 裁定 2 の「発見性」への答え。色が変わらないと、第 2 面に入ったことが
    // 数字キーの上では見えない(E2E が実ブラウザで背景色を確かめる)。
    const grid = section("数字と演算のキー");
    for (const token of ["7", "8", "9"]) {
      const key = grid.keys.find((k) => k.token === token);
      expect(key?.variant).toBe("digit");
      expect(key?.shift?.variant).toBe("function");
    }
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

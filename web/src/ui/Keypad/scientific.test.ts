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
  });

  it("names the history key as the board's only tokenless second face", () => {
    // `token: null` の第 2 面は本来「準備中」の印——`hist` だけが例外
    // (Task 8。トークンを送らず UI 操作を起こす。設計書
    // `2026-09-03-history-design.md` §9.1)。`action` の有無で判定すると、
    // 将来のスタブが `action` だけ真似て通り抜けられる。**集合を丸ごと
    // 名指しする**——`hist` 以外に `token: null` の第 2 面が増えたら、
    // それが `action` を持っていても、このテストは落ちる。
    const nullFaces = allKeys
      .filter((k) => k.shift?.token === null)
      .map((k) => k.shift);
    expect(nullFaces).toEqual([
      {
        token: null,
        label: "hist",
        ariaLabel: "履歴",
        variant: "function",
        action: "history",
      },
    ]);
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

  it("hides no digit behind the second face", () => {
    // **数字が消えるより、使っていない裏を使うほうがよい**(0.2.0 設計書 §9)。
    // 7/8/9 に裏があると、Shift 中は数字が打てない。
    const main = SCIENTIFIC_SECTIONS.find(
      (s) => s.ariaLabel === "数字と演算のキー",
    );
    for (const token of ["7", "8", "9"]) {
      const key = main?.keys.find((k) => k.token === token);
      expect(key?.shift, `${token} still has a second face`).toBeUndefined();
    }
  });

  it("puts the counting functions behind the parens and the sign", () => {
    const main = SCIENTIFIC_SECTIONS.find(
      (s) => s.ariaLabel === "数字と演算のキー",
    );
    const behind = (token: string) =>
      main?.keys.find((k) => k.token === token)?.shift?.token;
    expect(behind("lparen")).toBe("n_fact");
    expect(behind("rparen")).toBe("n_p_r");
    expect(behind("neg")).toBe("n_c_r");
  });

  it("puts the history key behind j and sends no token", () => {
    const j = allKeys.find((k) => k.token === "j");
    expect(j?.shift).toEqual({
      token: null,
      label: "hist",
      ariaLabel: "履歴",
      variant: "function",
      action: "history",
    });
  });
});

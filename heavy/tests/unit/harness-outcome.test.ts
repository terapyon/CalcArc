import { describe, expect, it } from "vitest";
import { openOutcome } from "../../harness/outcome";

/**
 * **境界の形を開く翻訳**（2026-08-28、T-3 の統合で見つけた欠陥の直し）。
 *
 * T-3 が境界の結果型を `Outcome<T>` にした——`{"kind":"ok", …}` /
 * `{"kind":"error","code":X}` で、**payload は camelCase**。
 * **コミット済みのコーパスは平らな snake_case** で、`kind` を持たない。
 * ハーネスが素通ししていたので、**5,500 件が全件不一致になった。**
 *
 * **翻訳は「間違えると黙って一致する」場所である。** マッピングを取り違えて
 * たまたま期待値に合えば、偽の緑が 5,500 件出る。だから両方向を固定する。
 */

describe("openOutcome", () => {
  it("ok の payload はそのまま平らに返す（名前は変えない）", () => {
    // **名前の変換は比較側（`calls.ts` の `normalise`）の仕事である。**
    // ここで変換すると 2 か所が同じ仕事をし、camelCase のまま読む
    // `certificates.ts` が壊れる（2026-08-28 に実際に壊して気づいた）。
    expect(
      openOutcome({
        kind: "ok",
        monthlyPayment: "85000",
        totalInterest: "1200",
        rowsPaid: 40,
      }),
    ).toEqual({ monthlyPayment: "85000", totalInterest: "1200", rowsPaid: 40 });
  });

  it("error は error の 1 語に戻す", () => {
    expect(openOutcome({ kind: "error", code: "Overflow" })).toEqual({
      error: "Overflow",
    });
  });

  it("kind だけを外す（他の鍵には触らない）", () => {
    expect(openOutcome({ kind: "ok", n: 12, bonus_rows: 3 })).toEqual({
      n: 12,
      bonus_rows: 3,
    });
  });

  it("payload の鍵を 1 つも落とさない", () => {
    // **落ちた鍵は比較で「不一致」ではなく「undefined」になる**ので、
    // 数が合っていることを先に見る。
    const camel = {
      kind: "ok",
      monthlyPayment: 1,
      totalInterest: 2,
      rowsPaid: 3,
      finalPayment: 4,
      n: 5,
    };
    const opened = openOutcome(camel);
    expect(Object.keys(opened).sort()).toEqual(
      [
        "finalPayment",
        "monthlyPayment",
        "n",
        "rowsPaid",
        "totalInterest",
      ].sort(),
    );
  });

  describe("知らない形は、黙って通さない", () => {
    // **素通しに戻さない。** 次に境界の形が変わった日に、**ここが最初に
    // 赤くなる**のが正しい——今回の欠陥は「境界が変わったのにハーネスが
    // 気づかなかった」ことそのものだった。

    it("kind が無ければ落ちる", () => {
      expect(() => openOutcome({ monthly_payment: "1" })).toThrow(/kind/);
    });

    it("知らない kind なら落ちる", () => {
      expect(() => openOutcome({ kind: "pending" })).toThrow(/pending/);
    });

    it("error なのに code が無ければ落ちる", () => {
      expect(() => openOutcome({ kind: "error" })).toThrow(/code/);
    });

    it("オブジェクトでなければ落ちる", () => {
      expect(() => openOutcome("ok")).toThrow(/形/);
      expect(() => openOutcome(null)).toThrow(/形/);
    });
  });
});

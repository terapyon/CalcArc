import { describe, expect, it } from "vitest";
import type { CallCase } from "../heavy/corpus";
import {
  digitKeys,
  expectedAnswer,
  expressible,
  FACES,
  type FinanceFace,
  keySequence,
  missingOps,
  pickCases,
  readAnswer,
  readNumbers,
} from "../heavy-ui/finance-cases";

/**
 * **この検査は本当に何かを比べているか。**
 *
 * `finance-ui.spec.ts` の主張は 11.7 分の走行の中にしかない。そこだけで
 * 確かめると、**ケースを 1 件も選べていないのに緑**という壊れ方が見えない
 * ——選び方も画面の読み方も純関数なので、ここで壊した入力を渡して
 * **赤くなることを確かめる**(`heavy-ui-presses.test.ts` と同じ流儀)。
 */

const faceFor = (op: string): FinanceFace => {
  const face = FACES.find((f) => f.op === op);
  if (face === undefined) throw new Error(`no face for ${op}`);
  return face;
};

const call = (
  op: string,
  input: CallCase["input"],
  expected: CallCase["expect"],
  id = "fin-000000",
): CallCase => ({
  kind: "call",
  id,
  op,
  input,
  expect: expected,
  stratum: `${op}/test`,
});

const loanForward = (over: Partial<CallCase["input"]> = {}): CallCase =>
  call(
    "loan_forward",
    { n: 36, principal: "3000000", rate: "2.0", residual: "0", ...over },
    {
      monthly_payment: "85000",
      total_payment: "3060000",
      total_interest: "60000",
      final_payment: "85000",
    },
  );

const compoundGrow = (over: Partial<CallCase["input"]> = {}): CallCase =>
  call(
    "compound_grow",
    {
      deposit: "10000",
      periods: 24,
      periods_per_year: 12,
      principal: "1000000",
      rate: "3.0",
      tax: false,
      ...over,
    },
    {
      final_balance: "1300000",
      net: "1250000",
      principal_total: "1240000",
      interest: "60000",
    },
  );

describe("the face table", () => {
  it("carries exactly the eight faces, one per corpus op", () => {
    expect(FACES).toHaveLength(8);
    expect(new Set(FACES.map((face) => face.op)).size).toBe(8);
  });

  it("names an op that no face covers", () => {
    expect(missingOps([...FACES.map((f) => f.op), "loan_refinance"])).toEqual([
      "loan_refinance",
    ]);
  });

  it("says nothing when the corpus carries only the covered ops", () => {
    expect(missingOps(FACES.map((face) => face.op))).toEqual([]);
  });
});

describe("expressible", () => {
  const forward = faceFor("loan_forward");
  const grow = faceFor("compound_grow");

  it("accepts a case whose every field has a key on the panel", () => {
    expect(expressible(forward, loanForward())).toBe(true);
    expect(expressible(grow, compoundGrow())).toBe(true);
  });

  it("refuses a compounding frequency the keypad cannot select", () => {
    // 盤面は 年/半年/月 の 3 つしか持たない。4 期・13 期・0 期はコアの
    // 定義域の話であって、画面から打てる形ではない。
    expect(expressible(grow, compoundGrow({ periods_per_year: 4 }))).toBe(
      false,
    );
    expect(expressible(grow, compoundGrow({ periods_per_year: 0 }))).toBe(
      false,
    );
  });

  it("refuses a rate the entry gate would reject before the core sees it", () => {
    // 5 桁の小数・負の年利・非数字。**画面に出るエラーは入口の側になり、
    // コアが返すはずのエラーとは別物になる。**
    for (const rate of ["1.23456", "-1", "abc", "", "100.0001"]) {
      expect(expressible(forward, loanForward({ rate }))).toBe(false);
    }
  });

  it("refuses a term past the panel's ceiling, and zero periods for compound", () => {
    expect(expressible(forward, loanForward({ n: 1201 }))).toBe(false);
    // ローンの 0 か月は打てる(そしてコアがエラーを返す)。
    expect(expressible(forward, loanForward({ n: 0 }))).toBe(true);
    // 複利の 0 期は画面が計算そのものを始めないので、何も出ない。
    expect(expressible(grow, compoundGrow({ periods: 0 }))).toBe(false);
  });

  it("refuses a case that carries a field this face never types", () => {
    // **ボーナスと残価は排他**なので、残価つきのボーナス案件は盤面から
    // 打てない。同じ判定が、コーパスが入力の欄を 1 つ増やした日にも効く。
    const bonus = faceFor("loan_bonus_forward");
    const withResidual = call(
      "loan_bonus_forward",
      {
        bonus_principal: "1000000",
        n: 84,
        principal: "5000000",
        rate: "2.7",
        residual: "500000",
      },
      { monthly_payment: "1" },
    );
    expect(expressible(bonus, withResidual)).toBe(false);
    const without = call(
      "loan_bonus_forward",
      {
        bonus_principal: "1000000",
        n: 84,
        principal: "5000000",
        rate: "2.7",
      },
      { monthly_payment: "1" },
    );
    expect(expressible(bonus, without)).toBe(true);
  });
});

describe("pickCases", () => {
  const forward = faceFor("loan_forward");

  it("takes the middle of each pool, not the head", () => {
    const pool = [
      loanForward({ n: 1 }),
      loanForward({ n: 2 }),
      loanForward({ n: 3 }),
    ];
    const failing = call(
      "loan_forward",
      { n: 9, principal: "7", rate: "99.0", residual: "2" },
      { error: "SyntaxError" },
    );
    const picked = pickCases(forward, [...pool, failing]);
    expect(picked.normal.input.n).toBe(2);
    expect(picked.error).toBe(failing);
  });

  it("refuses to run when the corpus has no passing case for the face", () => {
    const failing = call(
      "loan_forward",
      { n: 9, principal: "7", rate: "99.0", residual: "2" },
      { error: "SyntaxError" },
    );
    expect(() => pickCases(forward, [failing])).toThrow(/no passing case/);
  });

  it("refuses to run when the corpus has no failing case for the face", () => {
    expect(() => pickCases(forward, [loanForward()])).toThrow(
      /no failing case/,
    );
  });

  it("refuses to run when every case of the op is beyond the panel", () => {
    expect(() =>
      pickCases(forward, [loanForward({ rate: "1.23456" })]),
    ).toThrow(/cannot type/);
  });
});

describe("keySequence", () => {
  it("presses the mode, then each field, then its digits", () => {
    expect(keySequence(faceFor("loan_forward"), loanForward())).toEqual([
      "月々の返済額を求める",
      "借入額を入力",
      "3",
      "0",
      "0",
      "0",
      "0",
      "0",
      "0",
      "年利を入力",
      "2",
      "小数点",
      "0",
      "返済期間を入力",
      "3",
      "6",
      "残価を入力",
      "0",
    ]);
  });

  it("chooses the compounding frequency and the tax before typing anything", () => {
    // **面が入れ替わるキーを先に押す。** 数字を打っている途中で面を替えると、
    // 替えたあとの欄が入力中のまま残る。
    const keys = keySequence(
      faceFor("compound_grow"),
      compoundGrow({ tax: true }),
    );
    expect(keys.slice(0, 5)).toEqual([
      "複利で増やす",
      "複利の周期を選ぶ",
      "月ごとに複利",
      "税の扱いを選ぶ",
      "源泉分離課税を引く",
    ]);
    expect(keys).toContain("毎期の積立額を入力");
  });

  it("has no key for anything but digits and the decimal point", () => {
    expect(() => digitKeys("1e5")).toThrow(/no key/);
  });
});

describe("expectedAnswer", () => {
  it("expects the after-tax figure when the tax is withheld", () => {
    const grow = faceFor("compound_grow");
    expect(expectedAnswer(grow, compoundGrow({ tax: true }))).toEqual({
      kind: "yen",
      value: "1250000",
    });
    expect(expectedAnswer(grow, compoundGrow({ tax: false }))).toEqual({
      kind: "yen",
      value: "1300000",
    });
  });
});

describe("readAnswer", () => {
  it("reads the three shapes the panel puts on the answer line", () => {
    expect(readAnswer("1,234,567 円")).toEqual({
      kind: "yen",
      value: "1234567",
    });
    expect(readAnswer("19 期")).toEqual({ kind: "periods", value: "19" });
    expect(readAnswer("420 か月")).toEqual({ kind: "months", value: "420" });
  });

  it("refuses an amount whose digit grouping is wrong", () => {
    // **整形を製品の関数から借りない**理由がこれである。借りると、区切りが
    // 崩れても期待値が同じだけ崩れて緑になる。
    expect(() => readAnswer("1234567 円")).toThrow(/not an amount/);
    expect(() => readAnswer("1,23,4567 円")).toThrow(/not an amount/);
  });

  it("refuses the error text, so an error on a passing case cannot pass", () => {
    expect(() => readAnswer("Math ERROR")).toThrow(/Math ERROR/);
    expect(() => readAnswer("")).toThrow(/not an amount/);
  });
});

describe("readNumbers", () => {
  it("strips the grouping from every number in the breakdown", () => {
    expect(readNumbers("総支払額 38,579,007 円 総利息 8,579,007 円")).toEqual([
      "38579007",
      "8579007",
    ]);
  });

  it("splits a wrongly grouped number, so it never matches the expectation", () => {
    expect(readNumbers("総支払額 38579007 円")).not.toContain("38579007");
  });
});

import type { CallCase } from "../corpus/corpus";

/**
 * **Finance を実画面から通すための、盤面に依らない部分**(設計書 §7.2)。
 *
 * ディスクも Playwright も触らない純関数だけを置く。理由は `select.ts` と
 * 同じ——**この検査が本当に何かを比べているかを、11.7 分の走行の末尾ではなく
 * 6 秒で確かめられる場所に置く**ためである(`tests/unit/heavy-ui-finance.test.ts`)。
 *
 * ここが持つのは 4 つ:
 *
 * 1. **面の一覧**(8 面)。面の識別子はコーパスの `op` そのもので、手で付けた
 *    名前ではない。`missingOps` が「コーパスに在る op を面が覆っているか」を
 *    見るので、コーパスが 9 つ目の op を持った日にここが赤くなる。
 * 2. **盤面で表現できるか**の判定。コーパスはコアの定義域を突くので、
 *    **画面からは打てない入力を持つケースがある**(周期 4、年利 5 桁、
 *    ボーナスと残価の同時指定)。それを打とうとすると押せないキーを待って
 *    ハングする——**打てないことは欠陥ではなく、面の性質である。**
 * 3. **キー列の組み立て**。入力の値からアクセシブルネームの列を作る。
 * 4. **画面の読み方**。`grouped()` を呼ばずに、**桁区切りまで含めて厳密に**
 *    読む——製品の整形関数で期待値も作ると、整形が壊れても両側が同じだけ
 *    壊れて緑になる。
 */

/** 答の種類。**円だけが桁区切りされる**(期と か月 は素の数字)。 */
export type AnswerKind = "yen" | "periods" | "months";

export interface Answer {
  kind: AnswerKind;
  /** 桁区切りを外した整数。コーパスの期待値と同じ表記。 */
  value: string;
}

/** 面が打つ 1 欄。`from` はコーパスの `input` のキー。 */
export interface FaceField {
  /** 「入力する項目」のキーのアクセシブルネーム。 */
  label: string;
  from: string;
}

export interface FinanceFace {
  /** コーパスの `op`。**面の名前はここから来る。** */
  op: string;
  /** 「計算の種類」のキーのアクセシブルネーム。 */
  mode: string;
  /** 複利系か。**周期と税を先に選ぶ**——面が入れ替わるので順番に意味がある。 */
  compound: boolean;
  fields: FaceField[];
  /** 答の読み方と、コーパスのどの欄と比べるか。 */
  answer: {
    kind: AnswerKind;
    of: (testCase: CallCase) => string;
  };
  /**
   * 内訳(`finance-breakdown`)に必ず現れる整数。**答だけを見ると、
   * 内訳が丸ごと消えても気づかない。**
   */
  breakdown: (testCase: CallCase) => string[];
}

const expectOf = (testCase: CallCase, key: string): string =>
  String(testCase.expect[key] ?? "");

const totals = (testCase: CallCase): string[] => [
  expectOf(testCase, "total_payment"),
  expectOf(testCase, "total_interest"),
];

const compoundTotals = (testCase: CallCase): string[] => [
  expectOf(testCase, "principal_total"),
  expectOf(testCase, "interest"),
];

/**
 * 8 面。**「6 モード + ボーナス 2 面」はこの 8 つのこと**で、コーパスの
 * `op` と 1 対 1 に対応する(実測: `finance-000.json` の op はちょうどこの 8 つ)。
 *
 * ボーナスの 2 面が別なのは、盤面の上でも別の道だからである——ボーナス欄に
 * 何か打つと `bonusForward` / `bonusPrincipal` に分岐し、**残価欄が押せなく
 * なる**(排他)。同じモードキーから始まっても、通る枝が違う。
 */
export const FACES: FinanceFace[] = [
  {
    op: "loan_forward",
    mode: "月々の返済額を求める",
    compound: false,
    fields: [
      { label: "借入額を入力", from: "principal" },
      { label: "年利を入力", from: "rate" },
      { label: "返済期間を入力", from: "n" },
      { label: "残価を入力", from: "residual" },
    ],
    answer: { kind: "yen", of: (c) => expectOf(c, "monthly_payment") },
    breakdown: (c) => [expectOf(c, "final_payment"), ...totals(c)],
  },
  {
    op: "loan_bonus_forward",
    mode: "月々の返済額を求める",
    compound: false,
    fields: [
      { label: "借入額を入力", from: "principal" },
      { label: "年利を入力", from: "rate" },
      { label: "返済期間を入力", from: "n" },
      // 月額モードのボーナスは**元本の内訳**である(設計書 §6)。名前が
      // 借入可能額モードと違うのは、意味が違うからで、装飾ではない。
      { label: "ボーナス返済分（元本）を入力", from: "bonus_principal" },
    ],
    answer: { kind: "yen", of: (c) => expectOf(c, "monthly_payment") },
    breakdown: (c) => [expectOf(c, "bonus_payment"), ...totals(c)],
  },
  {
    op: "loan_principal",
    mode: "借入可能額を求める",
    compound: false,
    fields: [
      { label: "月々の返済額を入力", from: "payment" },
      { label: "年利を入力", from: "rate" },
      { label: "返済期間を入力", from: "n" },
    ],
    answer: { kind: "yen", of: (c) => expectOf(c, "principal") },
    breakdown: totals,
  },
  {
    op: "loan_bonus_principal",
    mode: "借入可能額を求める",
    compound: false,
    fields: [
      { label: "月々の返済額を入力", from: "monthly_payment" },
      { label: "年利を入力", from: "rate" },
      { label: "返済期間を入力", from: "n" },
      { label: "ボーナス回の返済額を入力", from: "bonus_payment" },
    ],
    answer: { kind: "yen", of: (c) => expectOf(c, "total_principal") },
    breakdown: (c) => [expectOf(c, "monthly_principal"), ...totals(c)],
  },
  {
    op: "loan_term",
    mode: "返済期間を求める",
    compound: false,
    fields: [
      { label: "借入額を入力", from: "principal" },
      { label: "年利を入力", from: "rate" },
      { label: "月々の返済額を入力", from: "payment" },
    ],
    answer: { kind: "months", of: (c) => expectOf(c, "n") },
    breakdown: totals,
  },
  {
    op: "compound_grow",
    mode: "複利で増やす",
    compound: true,
    fields: [
      { label: "元本を入力", from: "principal" },
      { label: "毎期の積立額を入力", from: "deposit" },
      { label: "年利を入力", from: "rate" },
      { label: "期間を入力", from: "periods" },
    ],
    // **税ありのときは手取りを一番大きく出す**(F1 裁定 Q5)。ここを
    // `final_balance` に固定すると、税の 2 段の丸めを画面から一度も見ない。
    answer: {
      kind: "yen",
      of: (c) =>
        c.input.tax === true
          ? expectOf(c, "net")
          : expectOf(c, "final_balance"),
    },
    breakdown: compoundTotals,
  },
  {
    op: "compound_deposit_for",
    mode: "必要な積立額を求める",
    compound: true,
    fields: [
      { label: "元本を入力", from: "principal" },
      { label: "目標額を入力", from: "target" },
      { label: "年利を入力", from: "rate" },
      { label: "期間を入力", from: "periods" },
    ],
    answer: { kind: "yen", of: (c) => expectOf(c, "deposit") },
    breakdown: compoundTotals,
  },
  {
    op: "compound_periods_for",
    mode: "必要な期間を求める",
    compound: true,
    fields: [
      { label: "元本を入力", from: "principal" },
      { label: "毎期の積立額を入力", from: "deposit" },
      { label: "年利を入力", from: "rate" },
      { label: "目標額を入力", from: "target" },
    ],
    answer: { kind: "periods", of: (c) => expectOf(c, "periods") },
    breakdown: compoundTotals,
  },
];

/** 盤面が持つ周期。**4 期・13 期・0 期はキーが無い**(numerical-policy)。 */
export const PERIOD_KEY: Record<number, string> = {
  1: "年ごとに複利",
  2: "半年ごとに複利",
  12: "月ごとに複利",
};

/** 税の面の 2 キー。既定はタックスフリー(NISA 前提)。 */
export const TAX_KEY = {
  none: "税を引かない",
  withholding: "源泉分離課税を引く",
} as const;

/** 期間の上限(`FinancePanel` の `MAX_PERIODS`)。 */
const MAX_TERM = 1200;

/** 年利の上限。コアが受ける最長は "100.0000"。 */
const RATE = /^\d{1,3}(?:\.\d{1,4})?$/;

/** 金額は u64。10 進 20 桁で頭打ち(`finance/entry.ts` の `MAX_YEN_DIGITS`)。 */
const AMOUNT = /^\d{1,20}$/;

/** 計算に入るが**欄ではない**もの。周期と税は選択であって打鍵ではない。 */
const CHOSEN_NOT_TYPED = new Set(["periods_per_year", "tax"]);

/**
 * **この面の盤面から打てるケースか。**
 *
 * コーパスはコアの定義域を突くので、**画面からは打てない入力**を持つケースが
 * ある。打てないものを打とうとすると、押せないキーを Playwright が待ち続けて
 * ハングする——それは engine の欠陥ではなく、盤面の表現力の話である。
 *
 * **欄の集合が一致することを要求する**のが一番効く。これが
 * `loan_bonus_forward` の残価つき 150 件(ボーナスと残価は排他なので同時に
 * 打てない)を自動的に外し、同時に**コーパスが入力の欄を 1 つ増やした日に
 * 気づく**——打たない欄があると、画面は別の計算をして緑になる。
 */
export function expressible(face: FinanceFace, testCase: CallCase): boolean {
  const input = testCase.input;
  const typed = Object.keys(input).filter((key) => !CHOSEN_NOT_TYPED.has(key));
  const wanted = face.fields.map((field) => field.from);
  if (typed.length !== wanted.length) return false;
  if (!wanted.every((key) => typed.includes(key))) return false;

  for (const [key, value] of Object.entries(input)) {
    if (key === "periods_per_year") {
      if (PERIOD_KEY[value as number] === undefined) return false;
      continue;
    }
    if (key === "tax") continue;
    if (key === "rate") {
      if (typeof value !== "string") return false;
      if (!RATE.test(value) || Number(value) > 100) return false;
      continue;
    }
    if (key === "n" || key === "periods") {
      if (typeof value !== "number" || !Number.isInteger(value)) return false;
      if (value < 0 || value > MAX_TERM) return false;
      // **複利系は期数が 0 だと画面が計算そのものを始めない**
      // (`FinancePanel` の `periods > 0` の門)。答も出ないしエラーも出ない
      // ——画面に何も出ないケースは、画面から確かめようがない。
      if (face.compound && value < 1) return false;
      continue;
    }
    if (typeof value !== "string" || !AMOUNT.test(value)) return false;
  }
  return true;
}

export interface FacePick {
  face: FinanceFace;
  normal: CallCase;
  error: CallCase;
}

/**
 * **面ごとに正常 1 件・異常 1 件を、コーパスから引く。**
 *
 * **真ん中を採る。** 先頭は各 op の先に置かれた退化の境界(n=1、年利 0、
 * 元本 1)で、8 面すべてが「1 回払いで利息 0」になってしまう。真ん中は
 * `"{op}/random"` の層に落ちるので、桁の大きい実際の計算になる(実測)。
 * 選び方は決定的で、コーパスが変わらないかぎり同じケースを引く。
 *
 * **空なら投げる。** 0 件のまま静かに 0 周回るのは、緑のまま何も
 * 確かめていない状態そのものである。
 */
export function pickCases(face: FinanceFace, cases: CallCase[]): FacePick {
  const mine = cases.filter(
    (testCase) => testCase.op === face.op && expressible(face, testCase),
  );
  const normal = mine.filter((testCase) => !("error" in testCase.expect));
  const failing = mine.filter((testCase) => "error" in testCase.expect);
  const middle = (pool: CallCase[], kind: string): CallCase => {
    const chosen = pool[Math.floor(pool.length / 2)];
    if (chosen === undefined) {
      throw new Error(
        `finance-ui: the corpus has no ${kind} case for ${face.op} that this ` +
          "panel can express. Either the shard stopped carrying that op, or " +
          "every case of it needs an input the keypad cannot type. Both mean " +
          "this face would verify nothing, so the run refuses to be green.",
      );
    }
    return chosen;
  };
  return {
    face,
    normal: middle(normal, "passing"),
    error: middle(failing, "failing"),
  };
}

/**
 * **コーパスに在って、どの面も覆っていない op。**
 *
 * 面の一覧を手で持つ以上、コーパスが増えた日に気づく手立てが要る。
 * これが空でないなら、その op は**画面から一度も通っていない。**
 */
export function missingOps(ops: string[]): string[] {
  const covered = new Set(FACES.map((face) => face.op));
  return [...new Set(ops)].filter((op) => !covered.has(op)).sort();
}

/** 数字と小数点を、盤面のアクセシブルネームに直す。 */
export function digitKeys(value: string): string[] {
  return [...value].map((char) => {
    if (char === ".") return "小数点";
    if (char >= "0" && char <= "9") return char;
    throw new Error(
      `finance-ui: ${JSON.stringify(value)} contains ${JSON.stringify(char)}, ` +
        "which has no key on the finance keypad",
    );
  });
}

/**
 * ケース 1 件を打つキー列。**モードを押し、周期と税を選び、欄ごとに打つ。**
 *
 * 周期と税を**先に**選ぶのは、その 2 つで盤面の下段が丸ごと入れ替わるから
 * である(設計書 §7)。数字を打っている途中に面を替えると、替えたあとの
 * 欄が `active` のまま残る。
 */
export function keySequence(face: FinanceFace, testCase: CallCase): string[] {
  const input = testCase.input;
  const keys: string[] = [face.mode];
  if (face.compound) {
    const periodsPerYear = input.periods_per_year as number;
    const period = PERIOD_KEY[periodsPerYear];
    if (period === undefined) {
      throw new Error(
        `finance-ui: ${testCase.id} compounds ${periodsPerYear} times a year, ` +
          "which the keypad cannot select",
      );
    }
    keys.push("複利の周期を選ぶ", period);
    keys.push(
      "税の扱いを選ぶ",
      input.tax === true ? TAX_KEY.withholding : TAX_KEY.none,
    );
  }
  for (const field of face.fields) {
    keys.push(field.label, ...digitKeys(String(input[field.from])));
  }
  return keys;
}

/** 答の期待値。**コーパスの整数そのもの**——桁区切りを足さない。 */
export function expectedAnswer(pick: FinanceFace, testCase: CallCase): Answer {
  return { kind: pick.answer.kind, value: pick.answer.of(testCase) };
}

/** 円の表示。**桁区切りの位置まで含めて**厳密に読む。 */
const YEN = /^(\d{1,3}(?:,\d{3})*) 円$/;
const PERIODS = /^(\d+) 期$/;
const MONTHS = /^(\d+) か月$/;

/**
 * 画面の 1 行を読む。**`grouped()` を呼ばない。**
 *
 * 製品の整形関数で期待値も作ると、整形が壊れたとき両側が同じだけ壊れて
 * 緑になる——確かめたいことがちょうど失われる。ここは「人が読む形」を
 * 正規表現で書き下し、そこから整数だけを取り出す。読めない形は投げる
 * (`Math ERROR` が正常系のケースに出たときも、ここで捕まる)。
 */
export function readAnswer(shown: string): Answer {
  const text = shown.trim();
  const yen = YEN.exec(text);
  if (yen?.[1] !== undefined) {
    return { kind: "yen", value: yen[1].replace(/,/g, "") };
  }
  const periods = PERIODS.exec(text);
  if (periods?.[1] !== undefined) {
    return { kind: "periods", value: periods[1] };
  }
  const months = MONTHS.exec(text);
  if (months?.[1] !== undefined) {
    return { kind: "months", value: months[1] };
  }
  throw new Error(
    `the screen shows ${JSON.stringify(text)}, which is not an amount ` +
      '("1,234,567 円"), a number of periods ("19 期") or a number of ' +
      'months ("420 か月")',
  );
}

/**
 * 文字列から数を全部拾って、桁区切りを外す。**内訳の照合に使う。**
 *
 * 桁区切りが崩れた数(`1234567`)はここで `123` `456` `7` に割れるので、
 * 期待した整数がそのまま見つからない——**位置の誤りも捕まる。**
 */
export function readNumbers(text: string): string[] {
  return [...text.matchAll(/\d{1,3}(?:,\d{3})*/g)].map((match) =>
    match[0].replace(/,/g, ""),
  );
}

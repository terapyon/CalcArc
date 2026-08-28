import { useEffect, useState } from "react";
import { type ExprCalc, initExpr, type UnitSetName } from "../../expr";
import {
  type CompoundInverseResult,
  type FinanceCalc,
  initFinance,
} from "../../finance";
import {
  backspace,
  canPushCloseParen,
  canPushOpenParen,
  canPushOperator,
  canPushUnit,
  EMPTY,
  type Entry,
  fromDigits,
  grouped,
  isEmpty,
  MAN,
  MONTH,
  OKU,
  pushCloseParen,
  pushDigit,
  pushDot,
  pushOpenParen,
  pushOperator,
  pushUnit,
  text,
  type Unit,
  YEAR,
} from "../../finance/entry";
import { initLoan, type LoanCalc } from "../../finance/loan";
import type { PanelMode, PeriodsPerYear } from "../../settings";
import { PANEL_MODES } from "../../settings/types";
import {
  COMPOUND_FIELD_SECTION,
  DEPOSIT_FOR_FIELD_SECTION,
  FINANCE_FIELDS,
  FINANCE_SECTIONS,
  type FinanceField,
  type FinanceKeyToken,
  PERIODS_FOR_FIELD_SECTION,
  PERIODS_SECTION,
  TAX_SECTION,
} from "../Keypad/finance";
import { Keypad } from "../Keypad/Keypad";
import { parsePrefixed } from "../Keypad/parse";
import type { KeypadSection } from "../Keypad/types";
import { Readout } from "../Readout/Readout";
import { loadSettings, updateSettings } from "../useSetting";
import styles from "./FinancePanel.module.css";

/** 金額の項目。ここだけが万・億を受け、`entry.ts` を通る(設計書 §6)。 */

/** 項目を移すときの探索順(盤面の並びと同じ)。 */
const FIELD_ORDER: FinanceField[] = [
  "principal",
  "rate",
  "months",
  "payment",
  "residual",
  "bonus",
];

/**
 * 期間の桁数。**u32 の境界で黙って折り返させないための上限**である。
 *
 * 期間は Number にしてから wasm へ u32 として渡る。10 桁を超えると変換が
 * 2^32 で折り返し、たとえば 4,294,968,496 が 1200 に化けて、**もっともらしい
 * 答えが出てしまう**(コアの上限ガードもすり抜ける)。4 桁あれば実装上の
 * 上限 1,200 か月を覆える。
 */

/** 金額の上限。u64(設計書 §8 の着地表)。 */
const MAX_YEN = "18446744073709551615";

/**
 * 期間の上限。**盤面が置いている上限**であって、コアの上限の写しではない。
 *
 * **数がコアの `finance::compound::MAX_PERIODS` と一致すること**は
 * `token_parity.rs` が見張っている——複利はそこが本当の定義域で、
 * `grow` が `periods > MAX_PERIODS` を弾く。盤面が大きすぎれば打てた値を
 * コアが弾き、小さすぎれば打てない期数が静かに増える。
 *
 * **`MAX_TERM_MONTHS` ではない。** 数は同じ 1200 だが、あちらは
 * `loan/inverse.rs` の**期間逆算の探索打ち切り**であり、
 * **前進の償還表には上限が無い**(`grep MAX_TERM_MONTHS` の出現は
 * `inverse.rs` だけ)。つまりこの 1 つの定数は、コアの**別々の 2 つ**
 * ——複利の定義域と、逆算の打ち切り——に掛かっており、ローンの前進には
 * 対応するものが無い。**製品として置くべき上限**の議論は別件である。
 */
const MAX_PERIODS = 1200;

const OPERATORS = { add: "+", sub: "-", mul: "*", div: "/" } as const;

const PERIOD_LABELS: Record<1 | 2 | 12, string> = {
  12: "月ごと",
  2: "半年ごと",
  1: "年ごと",
};

/**
 * その項目で単位キーが何になるか。**金額は 万/億、期間は 年/月、年利は無い。**
 * 5 列目の 2 マスは項目に従って差し替わる(設計書 §5)。
 */
function unitFor(
  field: FinanceField,
  slot: "unit:high" | "unit:low",
): Unit | null {
  if (field === "rate") return null;
  if (field === "months") return slot === "unit:high" ? YEAR : MONTH;
  return slot === "unit:high" ? MAN : OKU;
}

/**
 * 年利の文字数。コアが受ける最長は "100.0000"(整数 3 桁 + 小数 4 桁)。
 * それ以上打てても SyntaxError になるだけなので、入口で止める。
 */
const MAX_RATE_LEN = 8;

/** モードが求める値の項目。その項目は入力できない(それが答だから)。 */
const SOLVED_FOR: Record<PanelMode, FinanceField | null> = {
  payment: "payment",
  principal: "principal",
  term: "months",
  // 複利は正算だけ(逆算はスコープ外。設計書 §12)。
  compound: null,
  // 積立額が答なので入力できない。
  "deposit-for": "deposit",
  // 期間が答なので入力できない。
  "periods-for": "months",
};

const MODE_STATUS: Record<PanelMode, string> = {
  payment: "月額を求める",
  principal: "借入可能額を求める",
  term: "返済期間を求める",
  compound: "複利で増やす",
  "deposit-for": "必要な積立額を求める",
  "periods-for": "必要な期間を求める",
};

/**
 * 複利系のモード。**行ごと差し替える**(設計書 §4)——求める項目が消えて
 * 目標が出る(既存の `SOLVED_FOR` の仕組みをそのまま使う。設計書 §11)。
 */
const COMPOUND_MODE_FIELDS: Record<
  "compound" | "deposit-for" | "periods-for",
  FinanceField[]
> = {
  compound: ["principal", "deposit", "rate", "months", "periods", "tax"],
  "deposit-for": ["principal", "target", "rate", "months", "periods", "tax"],
  "periods-for": ["principal", "deposit", "rate", "target", "periods", "tax"],
};

/** ローンの項目行に出さない、複利系だけの項目(元本・年利・期間は共有)。 */
const COMPOUND_ONLY_FIELDS: FinanceField[] = [
  "deposit",
  "periods",
  "tax",
  "target",
];

function isCompoundFamily(
  m: PanelMode,
): m is "compound" | "deposit-for" | "periods-for" {
  return m === "compound" || m === "deposit-for" || m === "periods-for";
}

const FIELD_LABELS: Record<FinanceField, string> = {
  principal: "借入額",
  rate: "年利",
  months: "期間",
  payment: "月々の返済額",
  residual: "残価",
  bonus: "ボーナス",
  deposit: "積立額",
  periods: "周期",
  tax: "税",
  target: "目標額",
};

/** 項目に付く単位。echo の末尾に出す(整形ではなく単位の表示)。 */
const FIELD_UNITS: Record<FinanceField, string> = {
  principal: "円",
  rate: "%",
  months: "か月",
  payment: "円",
  residual: "円",
  bonus: "円",
  deposit: "円",
  periods: "",
  tax: "",
  target: "円",
};

/**
 * 複利の逆算の内訳。**deposit-for と periods-for で同じ形**(コアが返す
 * `CompoundInverseResult` の構造が同じだから)。税ありのときは手取りを
 * 一番大きく出す(裁定 Q5)。
 */
function compoundInverseBreakdown(
  r: CompoundInverseResult,
  withholding: boolean,
): Line[] {
  return [
    {
      label: withholding ? "手取り" : "残高",
      value: `${grouped(withholding && r.net ? r.net : (r.finalBalance ?? ""))} 円`,
    },
    { label: "元本合計", value: `${grouped(r.principalTotal ?? "")} 円` },
    { label: "運用収益", value: `${grouped(r.interest ?? "")} 円` },
    ...(withholding
      ? [
          { label: "国税", value: `${grouped(r.nationalTax ?? "")} 円` },
          { label: "地方税", value: `${grouped(r.localTax ?? "")} 円` },
          { label: "税引前", value: `${grouped(r.finalBalance ?? "")} 円` },
        ]
      : []),
  ];
}

/** ボーナス欄はモードで意味が変わる(設計書 §6)。値も別々に持つ。 */
function bonusName(mode: PanelMode): string {
  return mode === "principal" ? "ボーナス回の返済額" : "ボーナス返済分（元本）";
}

interface Line {
  label: string;
  value: string;
}

export function FinancePanel() {
  const [calc, setCalc] = useState<LoanCalc | null>(null);
  const [expr, setExpr] = useState<ExprCalc | null>(null);
  const [finance, setFinance] = useState<FinanceCalc | null>(null);
  const [failed, setFailed] = useState(false);
  // **設定は保存から起こす**(P-1 設計書 §4)。amounts は保存しないので
  // 初期値のままである。
  const [mode, setMode] = useState<PanelMode>(
    () => loadSettings().finance.mode,
  );
  // 周期と税は選択。**計算に入るので盤面の中**にある(設計書 §7)。
  const [periodsPerYear, setPeriodsPerYear] = useState<PeriodsPerYear>(
    () => loadSettings().finance.periodsPerYear,
  );
  const [withholding, setWithholding] = useState(
    () => loadSettings().finance.withholding,
  );

  /** 設定を 1 項目だけ書き戻す。**新しい値を使う**——state の更新は
      非同期なので、直後に読むと 1 つ前の値を保存することになる。 */
  function rememberFinance(patch: {
    mode?: PanelMode;
    periodsPerYear?: PeriodsPerYear;
    withholding?: boolean;
  }): void {
    updateSettings((current) => ({
      ...current,
      finance: { ...current.finance, ...patch },
    }));
  }
  // **すべての項目を同じ構造で持つ。** 年利も期間もトークン列である
  // ——式が全項目で打てる(裁定 Q14)し、項目ごとに違う入力機構を持つと
  // `000` のような取りこぼしが生まれる(設計書 §3 の記録)。
  const [amounts, setAmounts] = useState<Record<string, Entry>>({
    principal: EMPTY,
    rate: EMPTY,
    months: EMPTY,
    payment: EMPTY,
    residual: EMPTY,
    // ボーナスはモードで意味が変わるので、意味ごとに別々に持つ。
    bonusPrincipal: EMPTY,
    bonusPayment: EMPTY,
  });

  /**
   * 打てる項目から始める。**モードを復元すると "principal" が求める値の
   * 項目になっていることがある**(借入可能額モードでは借入額が答である)。
   * そのまま始めると、無効なタブが押下状態のまま「借入額を入力中」と
   * 名乗り、打鍵が計算に使われない欄に落ちる——モードキーの press が
   * 切り替えのときにやっている正規化と同じものを、復元にも掛ける。
   *
   * **`amounts` の後に置く。** `fieldEnabledIn` は残価×ボーナスの排他で
   * `amounts` を読む(初回描画では全部空なので排他は効かないが、順序に
   * 頼らないほうが安全である)。
   */
  const [active, setActive] = useState<FinanceField>(
    () =>
      orderFor(mode).find((field) => fieldEnabledIn(field, mode)) ??
      "principal",
  );

  useEffect(() => {
    let cancelled = false;
    initExpr().then(
      (loaded) => {
        if (!cancelled) setExpr(loaded);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    initFinance().then(
      (loaded) => {
        if (!cancelled) setFinance(loaded);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    initLoan().then(
      (loaded) => {
        if (!cancelled) setCalc(loaded);
      },
      () => {
        // WASM が読めなければ何も計算できない。読み込み中のまま固まらせず、
        // 起きたことを伝える(DataScalePanel と同じ流儀)。
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <p role="alert" data-testid="finance-load-error">
        計算エンジンを読み込めませんでした。ページを再読み込みしてください。
      </p>
    );
  }

  /** ボーナスの入れ物の名前。モードで別々(設計書 §6)。 */
  const bonusKey = mode === "principal" ? "bonusPayment" : "bonusPrincipal";

  /**
   * 値の入れ物の名前。
   *
   * **複利はローンと別の入れ物を使う**——欄の名前が同じでも**意味が違う**
   * からである。借入額は負債の元本、複利の元本は投資の元本。年利は借入金利と
   * 想定利回り。決定的なのは**期間**で、ローンは「か月」、複利は「期」
   * (長さは周期に従う)——420 か月(35 年)を持ち回ると、年次複利では
   * **420 年**として黙って計算される。もっともらしい誤答の典型である。
   *
   * ボーナスをモードごとに分けたのと同じ理由で、「値は保持する」は
   * **同じ意味の欄の値が消えない**という意味である(設計書 §6)。
   *
   * **2 つの逆算も複利とは別の入れ物を持つ**——欄の名前が同じでも意味が
   * 違う(F1 が「ローンの値を持ち回らない」と決めたのと同じ理由。設計書
   * §11)。**ただし目標額だけは 2 つの逆算で共有する**——同じ意味の欄
   * だからキーを `target` に固定する。
   */
  function amountKey(field: FinanceField): string {
    if (mode === "compound") return `compound:${field}`;
    if (mode === "deposit-for" || mode === "periods-for") {
      return field === "target" ? "target" : `${mode}:${field}`;
    }
    return field === "bonus" ? bonusKey : field;
  }

  function entryOf(field: FinanceField): Entry {
    return amounts[amountKey(field)] ?? EMPTY;
  }

  function setEntry(field: FinanceField, next: Entry) {
    setAmounts((previous) => ({ ...previous, [amountKey(field)]: next }));
  }

  /**
   * そのモードが受ける項目か(求める値は入力できない。残価×ボーナスは排他)。
   *
   * **モードを引数に取る**——切り替えの瞬間、まだ state に入っていない次の
   * モードで判定する必要がある(下の press を参照)。
   */
  function fieldEnabledIn(field: FinanceField, forMode: PanelMode): boolean {
    // **複利系は別の行**。ローンの項目とは互いに出ない(設計書 §6・§11)。
    // 求める項目はその行に出ない(目標に差し替わっているので、これだけで
    // `SOLVED_FOR` を経由せずに答の項目が閉じる)。
    if (isCompoundFamily(forMode)) {
      return COMPOUND_MODE_FIELDS[forMode].includes(field);
    }
    if (COMPOUND_ONLY_FIELDS.includes(field)) return false;
    if (field === SOLVED_FOR[forMode]) return false;
    if (field === "residual") {
      // 残価は月額モードのみ。同じモードのボーナス(元本)と排他。
      return forMode === "payment" && isEmpty(amounts.bonusPrincipal ?? EMPTY);
    }
    if (field === "bonus") {
      if (forMode === "term") return false;
      // **排他が効くのは月額モードだけ。** 借入可能額モードでは残価は計算に
      // 使われないので、そこに残っている値でボーナスを塞がない。
      return forMode !== "payment" || isEmpty(amounts.residual ?? EMPTY);
    }
    return true;
  }

  function fieldEnabled(field: FinanceField): boolean {
    return fieldEnabledIn(field, mode);
  }

  /** いま押せないキー(設計書 §6 の可否表 + 単位の文法)。 */
  function keyDisabled(token: FinanceKeyToken): boolean {
    const field = parsePrefixed(token, "field:", FINANCE_FIELDS);
    if (field !== null) {
      return !fieldEnabled(field);
    }
    if (token.startsWith("mode:")) return false;
    switch (token) {
      // 小数点は年利だけ(parse_yen は小数点を拒否し、期間は整数月)。
      case "dot":
        return active !== "rate";
      // 000 は年利で無効(0.000 の誤入力を誘うだけ)。
      case "zeros3":
        return active === "rate";
      // **単位キーは項目に従う**(設計書 §5)。金額は 万/億、期間は 年/月、
      // 年利は単位を持たないので空きになる。
      case "unit:high":
      case "unit:low": {
        const unit = unitFor(active, token);
        return unit === null || !canPushUnit(entryOf(active), unit);
      }
      case "add":
      case "sub":
      case "mul":
      case "div":
        return !canPushOperator(entryOf(active));
      case "lparen":
        return !canPushOpenParen(entryOf(active));
      case "rparen":
        return !canPushCloseParen(entryOf(active));
      case "eq":
        return settle(active) === null;
      default:
        return false; // 数字・DEL・AC はいつでも押せる
    }
  }

  /** トグルとして押されているキー。数字は undefined(トグルではない)。 */
  function keyPressed(token: FinanceKeyToken): boolean | undefined {
    if (token.startsWith("mode:")) return token === `mode:${mode}`;
    if (token.startsWith("field:")) return token === `field:${active}`;
    if (token.startsWith("period:"))
      return token === `period:${periodsPerYear}`;
    if (token === "tax:none") return !withholding;
    if (token === "tax:withholding") return withholding;
    return undefined;
  }

  function pressDigit(digit: string) {
    setEntry(active, pushDigit(entryOf(active), digit));
  }

  /** 項目の定義域。着地の上限と、どの単位表で読むか。 */
  function domainOf(field: FinanceField): {
    max: string;
    unitSet: UnitSetName;
  } {
    if (field !== "months") return { max: MAX_YEN, unitSet: "yen" };
    // **複利の期間は「期」**。年 の scale が 1 年あたりの期数になるので、
    // どの周期でも割り切れる(設計書 §5)。
    return {
      max: String(MAX_PERIODS),
      unitSet: isCompoundFamily(mode) ? `periods:${periodsPerYear}` : "months",
    };
  }

  function press(token: FinanceKeyToken) {
    // **解けたときだけ進む**(`Keypad/parse.ts`)。
    const mode_ = parsePrefixed(token, "mode:", PANEL_MODES);
    if (mode_ !== null) {
      const next = mode_;
      setMode(next);
      // **変わっていないなら書かない。** 書き込みの契機は「設定が変わった
      // その場」である(P-1 設計書 §6)。いま選ばれているモードをもう一度
      // 押すのは変更ではない——書くと、設定を 1 つも変えていない利用者に
      // 保存キーが生まれる(ScientificPanel の savedScientific と同じ規律)。
      if (next !== mode) rememberFinance({ mode: next });
      // **次のモードで打てない項目に居たままにしない。** 求める値の項目だけ
      // でなく、そのモードが受けない項目(借入可能額モードの残価、期間モードの
      // ボーナス)も同じである——放っておくと、無効なタブが押下状態のまま
      // 「〜を入力中」と名乗り、打鍵が計算に使われない欄に落ちる。
      if (!fieldEnabledIn(active, next)) {
        const moved = orderFor(next).find((field) =>
          fieldEnabledIn(field, next),
        );
        if (moved) setActive(moved);
      }
      return;
    }
    const nextField = parsePrefixed(token, "field:", FINANCE_FIELDS);
    if (nextField !== null) {
      setActive(nextField);
      return;
    }
    if (token.startsWith("digit:")) {
      pressDigit(token.slice("digit:".length));
      return;
    }
    switch (token) {
      case "zeros3": {
        // **ローカルで畳んでから 1 回だけ書く。** 3 回に分けて書くと、同じ
        // イベントの中で 3 回とも同じ値を読み、最後の 1 回しか残らない
        // ——L で実際にそうなっていた(設計書 §3)。
        let next = entryOf(active);
        for (const _ of [0, 1, 2]) next = pushDigit(next, "0");
        setEntry(active, next);
        break;
      }
      case "dot":
        setEntry(active, pushDot(entryOf(active), MAX_RATE_LEN));
        break;
      case "add":
      case "sub":
      case "mul":
      case "div":
        setEntry(active, pushOperator(entryOf(active), OPERATORS[token]));
        break;
      case "lparen":
        setEntry(active, pushOpenParen(entryOf(active)));
        break;
      case "rparen":
        setEntry(active, pushCloseParen(entryOf(active)));
        break;
      case "period:1":
      case "period:2":
      case "period:12": {
        const nextPeriod = Number(
          token.slice("period:".length),
        ) as PeriodsPerYear;
        setPeriodsPerYear(nextPeriod);
        // 変わっていないなら書かない(モードと同じ理由)。
        if (nextPeriod !== periodsPerYear) {
          rememberFinance({ periodsPerYear: nextPeriod });
        }
        break;
      }
      case "tax:none":
        setWithholding(false);
        if (withholding) rememberFinance({ withholding: false });
        break;
      case "tax:withholding":
        setWithholding(true);
        if (!withholding) rememberFinance({ withholding: true });
        break;
      case "eq": {
        // **式を評価して項目の値にする。** 項目をまたぐ式は書けない
        // (設計書 §8)。壊れた式は何も起きない——エラーは結果の表示が言う。
        const settled = settle(active);
        if (settled !== null) setEntry(active, fromDigits(settled));
        break;
      }
      case "unit:high":
      case "unit:low": {
        const unit = unitFor(active, token);
        if (unit === null) break;
        const next = pushUnit(entryOf(active), unit);
        // 盤面は押せないようにしてあるので、null はここに来ない(設計書 §5)。
        if (next !== null) setEntry(active, next);
        break;
      }
      case "del":
        setEntry(active, backspace(entryOf(active)));
        break;
      case "ac":
        // AC はいま打っている項目を最初に戻す(設計書 §5)。
        setEntry(active, EMPTY);
        break;
    }
  }

  /** 項目の、打った通りの文字列。周期と税は選んだものを言葉で出す。 */
  function typedIn(field: FinanceField): string {
    if (field === "periods") return PERIOD_LABELS[periodsPerYear];
    if (field === "tax") return withholding ? "20.315%" : "なし";
    return text(entryOf(field));
  }

  /** 式を評価した結果（値とエラー）。 */
  function settleResult(field: FinanceField): {
    value: string | null;
    error: string | null;
  } {
    // **周期と税は選択であって式ではない。** 評価に回すと、選んだ言葉
    // (「半年ごと」)を式として読もうとして SyntaxError になる。
    if (field === "periods" || field === "tax")
      return { value: null, error: null };
    const typed = typedIn(field);
    if (typed === "" || expr === null) return { value: null, error: null };
    if (field === "rate") {
      const r = expr.percent(typed);
      return { value: r.value, error: r.error };
    }
    const { max, unitSet } = domainOf(field);
    const r = expr.integer(typed, max, unitSet);
    return { value: r.value, error: r.error };
  }

  /** 式を評価した値。壊れていれば null。 */
  function settle(field: FinanceField): string | null {
    const typed = typedIn(field);
    if (typed === "" || expr === null) return null;
    if (field === "rate") return expr.percent(typed).value;
    const { max, unitSet } = domainOf(field);
    return expr.integer(typed, max, unitSet).value;
  }

  function labelOf(field: FinanceField): string {
    // **同じ入れ物でも意味が違えば名前も違う。** 複利系の `principal` は
    // 負債ではなく投資の元本である(入れ物も別。amountKey を参照)。
    if (isCompoundFamily(mode) && field === "principal") return "元本";
    return field === "bonus" ? bonusName(mode) : FIELD_LABELS[field];
  }

  // 入力の一覧。**打っている項目は大きく、入力済みは画面に残す**
  // (設計書 §2)。**そのモードで使わない項目と、未入力の項目は出さない**
  // ——空の「残価」で埋めても根拠にならない。
  const entries = orderFor(mode)
    .filter(
      (field) =>
        field === active ||
        (fieldEnabledIn(field, mode) && typedIn(field) !== ""),
    )
    .map((field) => {
      const typed = typedIn(field);
      return {
        label: labelOf(field),
        // **単位を二重に付けない。** `35年` に「か月」を足すと `35年か月`
        // になる——単位を打った時点で、その値は自分の単位を持っている。
        value: typed === "" ? "" : `${typed}${unitSuffix(field, typed)}`,
        active: field === active,
      };
    });

  // 結果は保持しない。必要な項目が埋まっているときだけ計算する(M6 の規律)。
  /**
   * 項目の値。**打った通りの文字列をコアに評価させる**——単位を解釈するのも
   * 四則を計算するのもコアである(設計書 訂正 2)。空なら空文字、式が壊れて
   * いれば空文字にして「まだ揃っていない」扱いにする。
   */
  /** 項目の値（式を評価した結果）。壊れていれば空文字＝「まだ揃っていない」。 */
  function evaluated(field: FinanceField): string {
    return settle(field) ?? "";
  }

  // 項目の値。**式はコアが評価する**——単位の展開も四則もそこでやる。
  const principalDigits = evaluated("principal");
  const paymentDigits = evaluated("payment");
  const residualDigits = evaluated("residual");
  const bonusDigits = evaluated("bonus");
  const rate = evaluated("rate");
  const months = evaluated("months");
  const monthsNumber = months === "" ? 0 : Number(months);
  const targetDigits = evaluated("target");

  // **式が壊れていたら、そこで止めて言う**(設計書 §8)。
  let error: string | null =
    orderFor(mode)
      .filter((f) => fieldEnabledIn(f, mode))
      .map((f) => settleResult(f).error)
      .find((e) => e != null) ?? null;
  let answer = "";
  let breakdown: Line[] = [];

  if (error === null && mode === "compound") {
    // **一括預入は積立額 0、毎月積立は元本 0** の退化。コアが 1 本の関数
    // なので、盤面もその形をそのまま写す(設計書 §6)。
    const deposit = evaluated("deposit");
    const periods = months === "" ? 0 : Number(months);
    if (
      finance &&
      rate !== "" &&
      periods > 0 &&
      (principalDigits !== "" || deposit !== "")
    ) {
      const r = finance.grow(
        principalDigits || "0",
        deposit || "0",
        rate,
        periodsPerYear,
        periods,
        withholding,
      );
      error = r.error;
      if (!r.error && r.finalBalance) {
        // 税ありのときは**手取り**を一番大きく出す(裁定 Q5)。
        answer = `${grouped(withholding && r.net ? r.net : r.finalBalance)} 円`;
        breakdown = [
          { label: "元本合計", value: `${grouped(r.principalTotal ?? "")} 円` },
          { label: "運用収益", value: `${grouped(r.interest ?? "")} 円` },
          ...(withholding
            ? [
                { label: "国税", value: `${grouped(r.nationalTax ?? "")} 円` },
                { label: "地方税", value: `${grouped(r.localTax ?? "")} 円` },
                { label: "税引前", value: `${grouped(r.finalBalance)} 円` },
              ]
            : []),
        ];
      }
    }
  } else if (error === null && mode === "deposit-for") {
    // **必要積立額**。目標に届く最小の積立額を、コアが二分探索で出す
    // (設計書 §4)。答は積立額、内訳は複利と同じ形。
    const periods = months === "" ? 0 : Number(months);
    if (finance && rate !== "" && periods > 0 && targetDigits !== "") {
      const r = finance.depositFor(
        principalDigits || "0",
        targetDigits,
        rate,
        periodsPerYear,
        periods,
        withholding,
      );
      error = r.error;
      if (!r.error && r.deposit) {
        answer = `${grouped(r.deposit)} 円`;
        breakdown = compoundInverseBreakdown(r, withholding);
      }
    }
  } else if (error === null && mode === "periods-for") {
    // **必要年数**。目標に最初に届いた期を、コアが前進 1 本で出す
    // (設計書 §4)。**次の期がまた下回ることがある**(§3 帰結 2)——それでも
    // 「最初に届いた期」を答として保つ。
    const depositDigits = evaluated("deposit");
    if (
      finance &&
      rate !== "" &&
      targetDigits !== "" &&
      (principalDigits !== "" || depositDigits !== "")
    ) {
      const r = finance.periodsFor(
        principalDigits || "0",
        depositDigits || "0",
        targetDigits,
        rate,
        periodsPerYear,
        withholding,
      );
      error = r.error;
      if (!r.error && r.periods) {
        answer = `${r.periods} 期`;
        breakdown = compoundInverseBreakdown(r, withholding);
      }
    }
  } else if (error === null && calc && rate !== "") {
    if (mode === "payment" && principalDigits !== "" && months !== "") {
      if (bonusDigits !== "") {
        const r = calc.bonusForward(
          principalDigits,
          bonusDigits,
          rate,
          monthsNumber,
        );
        error = r.error;
        if (!r.error && r.monthlyPayment && r.bonusPayment) {
          answer = `${grouped(r.monthlyPayment)} 円`;
          breakdown = [
            {
              label: "ボーナス回の返済額",
              value: `${grouped(r.bonusPayment)} 円`,
            },
            ...totals(r.totalPayment, r.totalInterest),
          ];
        }
      } else {
        const r = calc.forward(
          principalDigits,
          rate,
          monthsNumber,
          residualDigits === "" ? "0" : residualDigits,
        );
        error = r.error;
        if (!r.error && r.monthlyPayment) {
          answer = `${grouped(r.monthlyPayment)} 円`;
          breakdown = [
            ...(residualDigits !== "" && r.finalPayment
              ? [
                  {
                    label: "最終回（残価）",
                    value: `${grouped(r.finalPayment)} 円`,
                  },
                ]
              : []),
            ...totals(r.totalPayment, r.totalInterest),
          ];
        }
      }
    } else if (mode === "principal" && paymentDigits !== "" && months !== "") {
      if (bonusDigits !== "") {
        const r = calc.bonusPrincipal(
          paymentDigits,
          bonusDigits,
          rate,
          monthsNumber,
        );
        error = r.error;
        if (!r.error && r.totalPrincipal && r.monthlyPrincipal) {
          answer = `${grouped(r.totalPrincipal)} 円`;
          breakdown = [
            {
              label: "うち月払い分",
              value: `${grouped(r.monthlyPrincipal)} 円`,
            },
            ...(r.bonusPrincipal
              ? [
                  {
                    label: "うちボーナス分",
                    value: `${grouped(r.bonusPrincipal)} 円`,
                  },
                ]
              : []),
            ...totals(r.totalPayment, r.totalInterest),
          ];
        }
      } else {
        const r = calc.principal(paymentDigits, rate, monthsNumber);
        error = r.error;
        if (!r.error && r.principal) {
          answer = `${grouped(r.principal)} 円`;
          breakdown = totals(r.totalPayment, r.totalInterest);
        }
      }
    } else if (
      mode === "term" &&
      principalDigits !== "" &&
      paymentDigits !== ""
    ) {
      const r = calc.term(principalDigits, rate, paymentDigits);
      error = r.error;
      if (!r.error && r.months !== null) {
        answer = `${r.months} か月`;
        breakdown = totals(r.totalPayment, r.totalInterest);
      }
    }
  }

  return (
    <section className={styles.panel} aria-label="金融計算">
      <Readout
        entries={entries}
        main={error ? "Math ERROR" : answer}
        error={error}
        status={[
          {
            testId: "finance-mode",
            ariaLabel: "求めるもの",
            text: MODE_STATUS[mode],
          },
          {
            testId: "finance-field",
            ariaLabel: "入力中の項目",
            text: `${labelOf(active)}を入力中`,
          },
        ]}
      />
      <Keypad
        sections={sectionsFor(mode, active)}
        onPress={press}
        pressed={keyPressed}
        disabled={keyDisabled}
      />
      {breakdown.length > 0 && (
        <div className={styles.breakdown} data-testid="finance-breakdown">
          {breakdown.map((line) => (
            <p key={line.label}>
              <span className={styles.breakdownLabel}>{line.label}</span>
              {line.value}
            </p>
          ))}
        </div>
      )}
      {/* 免責は常設(M6 設計書 §0)。エラーではないので alert にしない。 */}
      <p className={styles.disclaimer}>
        実際の返済額は金融機関の計算方法により異なります。
      </p>
    </section>
  );
}

/** 項目の並び。**入力の一覧は盤面と同じ順**に出す(設計書 §2)。 */
/** 項目の既定の単位。**打った値が自分の単位を持っていれば足さない。** */
function unitSuffix(field: FinanceField, typed: string): string {
  if (field === "months" && /[年月]/.test(typed)) return "";
  return FIELD_UNITS[field];
}

function orderFor(mode: PanelMode): FinanceField[] {
  return isCompoundFamily(mode) ? COMPOUND_MODE_FIELDS[mode] : FIELD_ORDER;
}

/** 複利系モードの項目行。**求める項目の代わりに目標が出る**(設計書 §11)。 */
function compoundFieldSection(
  mode: "compound" | "deposit-for" | "periods-for",
): KeypadSection<FinanceKeyToken> {
  if (mode === "deposit-for") return DEPOSIT_FOR_FIELD_SECTION;
  if (mode === "periods-for") return PERIODS_FOR_FIELD_SECTION;
  return COMPOUND_FIELD_SECTION;
}

/** ボーナス欄の名前だけモードで差し替える(設計書 §6)。 */
function sectionsFor(mode: PanelMode, active: FinanceField) {
  // 複利系は項目行を差し替え、周期・税では**面が入れ替わる**(設計書 §7)。
  const base = isCompoundFamily(mode)
    ? [
        FINANCE_SECTIONS[0] as KeypadSection<FinanceKeyToken>,
        compoundFieldSection(mode),
        active === "periods"
          ? PERIODS_SECTION
          : active === "tax"
            ? TAX_SECTION
            : (FINANCE_SECTIONS[2] as KeypadSection<FinanceKeyToken>),
      ]
    : FINANCE_SECTIONS;
  // **単位キーのラベルも項目に従う**(設計書 §5)。挙動だけ差し替えて絵が
  // `万` のままだと、期間を打っている人には嘘のキーが見える——実機で
  // 実際にそうなっていた。
  const withUnits = base.map((section) =>
    section.ariaLabel === "数字と演算のキー"
      ? {
          ...section,
          keys: section.keys.map((key) => {
            if (key.token !== "unit:high" && key.token !== "unit:low")
              return key;
            const unit = unitFor(active, key.token);
            if (unit === null) {
              // 年利には単位が無い。予約スロットとして無効に描く。
              return { ...key, token: null, label: "—", ariaLabel: "空き" };
            }
            return { ...key, label: unit.label, ariaLabel: unit.label };
          }),
        }
      : section,
  );
  return withUnits.map((section) =>
    section.ariaLabel === "入力する項目"
      ? {
          ...section,
          keys: section.keys.map((key) =>
            key.token === "field:bonus"
              ? { ...key, ariaLabel: `${bonusName(mode)}を入力` }
              : key,
          ),
        }
      : section,
  );
}

function totals(
  totalPayment: string | null,
  totalInterest: string | null,
): Line[] {
  const out: Line[] = [];
  if (totalPayment) {
    out.push({ label: "総支払額", value: `${grouped(totalPayment)} 円` });
  }
  if (totalInterest) {
    out.push({ label: "総利息", value: `${grouped(totalInterest)} 円` });
  }
  return out;
}

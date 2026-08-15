import { useEffect, useState } from "react";
import { initLoan, type LoanCalc, type LoanMode } from "../../loan";
import {
  backspace,
  canPushUnit,
  digits,
  EMPTY,
  type Entry,
  grouped,
  isEmpty,
  MAN,
  OKU,
  pushDigit,
  pushUnit,
  text,
} from "../../loan/entry";
import { Keypad } from "../Keypad/Keypad";
import {
  LOAN_SECTIONS,
  type LoanField,
  type LoanKeyToken,
} from "../Keypad/loan";
import { Readout } from "../Readout/Readout";
import styles from "./LoanPanel.module.css";

/** 金額の項目。ここだけが万・億を受け、`entry.ts` を通る(設計書 §6)。 */
const MONEY_FIELDS: LoanField[] = ["principal", "payment", "residual", "bonus"];

/** 項目を移すときの探索順(盤面の並びと同じ)。 */
const FIELD_ORDER: LoanField[] = [
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
const MAX_MONTHS_LEN = 4;

/**
 * 年利の文字数。コアが受ける最長は "100.0000"(整数 3 桁 + 小数 4 桁)。
 * それ以上打てても SyntaxError になるだけなので、入口で止める。
 */
const MAX_RATE_LEN = 8;

/** モードが求める値の項目。その項目は入力できない(それが答だから)。 */
const SOLVED_FOR: Record<LoanMode, LoanField> = {
  payment: "payment",
  principal: "principal",
  term: "months",
};

const MODE_STATUS: Record<LoanMode, string> = {
  payment: "月額を求める",
  principal: "借入可能額を求める",
  term: "返済期間を求める",
};

const FIELD_LABELS: Record<LoanField, string> = {
  principal: "借入額",
  rate: "年利",
  months: "期間",
  payment: "月々の返済額",
  residual: "残価",
  bonus: "ボーナス",
};

/** 項目に付く単位。echo の末尾に出す(整形ではなく単位の表示)。 */
const FIELD_UNITS: Record<LoanField, string> = {
  principal: "円",
  rate: "%",
  months: "か月",
  payment: "円",
  residual: "円",
  bonus: "円",
};

/** ボーナス欄はモードで意味が変わる(設計書 §6)。値も別々に持つ。 */
function bonusName(mode: LoanMode): string {
  return mode === "principal" ? "ボーナス回の返済額" : "ボーナス返済分（元本）";
}

interface Line {
  label: string;
  value: string;
}

export function LoanPanel() {
  const [calc, setCalc] = useState<LoanCalc | null>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<LoanMode>("payment");
  const [active, setActive] = useState<LoanField>("principal");
  // 金額は entry.ts の構造で持つ。年利は小数を含み、期間は整数の月数なので、
  // どちらも素の文字列で持つ(entry.ts は金額のためのもの)。
  const [amounts, setAmounts] = useState<Record<string, Entry>>({
    principal: EMPTY,
    payment: EMPTY,
    residual: EMPTY,
    // ボーナスはモードで意味が変わるので、意味ごとに別々に持つ。
    bonusPrincipal: EMPTY,
    bonusPayment: EMPTY,
  });
  const [rate, setRate] = useState("");
  const [months, setMonths] = useState("");

  useEffect(() => {
    let cancelled = false;
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
      <p role="alert" data-testid="loan-load-error">
        計算エンジンを読み込めませんでした。ページを再読み込みしてください。
      </p>
    );
  }

  /** ボーナスの入れ物の名前。モードで別々(設計書 §6)。 */
  const bonusKey = mode === "principal" ? "bonusPayment" : "bonusPrincipal";

  function amountKey(field: LoanField): string {
    return field === "bonus" ? bonusKey : field;
  }

  function entryOf(field: LoanField): Entry {
    return amounts[amountKey(field)] ?? EMPTY;
  }

  function setEntry(field: LoanField, next: Entry) {
    setAmounts((previous) => ({ ...previous, [amountKey(field)]: next }));
  }

  /**
   * そのモードが受ける項目か(求める値は入力できない。残価×ボーナスは排他)。
   *
   * **モードを引数に取る**——切り替えの瞬間、まだ state に入っていない次の
   * モードで判定する必要がある(下の press を参照)。
   */
  function fieldEnabledIn(field: LoanField, forMode: LoanMode): boolean {
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

  function fieldEnabled(field: LoanField): boolean {
    return fieldEnabledIn(field, mode);
  }

  /** いま押せないキー(設計書 §6 の可否表 + 単位の文法)。 */
  function keyDisabled(token: LoanKeyToken): boolean {
    if (token.startsWith("field:")) {
      return !fieldEnabled(token.slice("field:".length) as LoanField);
    }
    if (token.startsWith("mode:")) return false;
    const money = MONEY_FIELDS.includes(active);
    switch (token) {
      // 小数点は年利だけ(parse_yen は小数点を拒否し、期間は整数月)。
      case "dot":
        return active !== "rate";
      // 000 は年利で無効(0.000 の誤入力を誘うだけ)。
      case "zeros3":
        return active === "rate";
      // 単位は金額だけ。さらに「いまの入力が受けられるか」が重なる(§5)。
      case "man":
        return !money || !canPushUnit(entryOf(active), MAN);
      case "oku":
        return !money || !canPushUnit(entryOf(active), OKU);
      default:
        return false; // 数字・DEL・AC はいつでも押せる
    }
  }

  /** トグルとして押されているキー。数字は undefined(トグルではない)。 */
  function keyPressed(token: LoanKeyToken): boolean | undefined {
    if (token.startsWith("mode:")) return token === `mode:${mode}`;
    if (token.startsWith("field:")) return token === `field:${active}`;
    return undefined;
  }

  function pressDigit(digit: string) {
    if (MONEY_FIELDS.includes(active)) {
      setEntry(active, pushDigit(entryOf(active), digit));
      return;
    }
    if (active === "rate") {
      setRate((previous) => {
        if (previous.length >= MAX_RATE_LEN) return previous;
        return previous === "0" ? digit : previous + digit;
      });
      return;
    }
    setMonths((previous) => {
      if (previous.length >= MAX_MONTHS_LEN) return previous;
      return previous === "0" ? digit : previous + digit;
    });
  }

  function press(token: LoanKeyToken) {
    if (token.startsWith("mode:")) {
      const next = token.slice("mode:".length) as LoanMode;
      setMode(next);
      // **次のモードで打てない項目に居たままにしない。** 求める値の項目だけ
      // でなく、そのモードが受けない項目(借入可能額モードの残価、期間モードの
      // ボーナス)も同じである——放っておくと、無効なタブが押下状態のまま
      // 「〜を入力中」と名乗り、打鍵が計算に使われない欄に落ちる。
      if (!fieldEnabledIn(active, next)) {
        const moved = FIELD_ORDER.find((field) => fieldEnabledIn(field, next));
        if (moved) setActive(moved);
      }
      return;
    }
    if (token.startsWith("field:")) {
      setActive(token.slice("field:".length) as LoanField);
      return;
    }
    if (token.startsWith("digit:")) {
      pressDigit(token.slice("digit:".length));
      return;
    }
    switch (token) {
      case "zeros3":
        for (const _ of [0, 1, 2]) pressDigit("0");
        break;
      case "dot":
        setRate((previous) => {
          if (previous.includes(".")) return previous;
          const next = `${previous || "0"}.`;
          return next.length > MAX_RATE_LEN ? previous : next;
        });
        break;
      case "man":
      case "oku": {
        const next = pushUnit(entryOf(active), token === "man" ? MAN : OKU);
        // 盤面は押せないようにしてあるので、null はここに来ない(設計書 §5)。
        if (next !== null) setEntry(active, next);
        break;
      }
      case "del":
        if (MONEY_FIELDS.includes(active)) {
          setEntry(active, backspace(entryOf(active)));
        } else if (active === "rate") {
          setRate((previous) => previous.slice(0, -1));
        } else {
          setMonths((previous) => previous.slice(0, -1));
        }
        break;
      case "ac":
        // AC はいま打っている項目を最初に戻す(設計書 §5)。
        if (MONEY_FIELDS.includes(active)) setEntry(active, EMPTY);
        else if (active === "rate") setRate("");
        else setMonths("");
        break;
    }
  }

  /** いまアクティブな項目の、打った通りの文字列。 */
  function activeText(): string {
    if (MONEY_FIELDS.includes(active)) return text(entryOf(active));
    return active === "rate" ? rate : months;
  }

  const activeLabel =
    active === "bonus" ? bonusName(mode) : FIELD_LABELS[active];
  const typed = activeText();
  const echo =
    typed === ""
      ? `${activeLabel}`
      : `${activeLabel} ${typed}${FIELD_UNITS[active]}`;

  // 結果は保持しない。必要な項目が埋まっているときだけ計算する(M6 の規律)。
  const principalDigits = digits(amounts.principal ?? EMPTY);
  const paymentDigits = digits(amounts.payment ?? EMPTY);
  const residualDigits = digits(amounts.residual ?? EMPTY);
  const bonusDigits = digits(amounts[bonusKey] ?? EMPTY);
  const monthsNumber = /^\d+$/.test(months) ? Number(months) : 0;

  let error: string | null = null;
  let answer = "";
  let breakdown: Line[] = [];

  if (calc && rate !== "") {
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
        echo={echo}
        main={error ? "Math ERROR" : answer}
        error={error}
        status={[
          {
            testId: "loan-mode",
            ariaLabel: "求めるもの",
            text: MODE_STATUS[mode],
          },
          {
            testId: "loan-field",
            ariaLabel: "入力中の項目",
            text: `${activeLabel}を入力中`,
          },
        ]}
      />
      <Keypad
        sections={sectionsFor(mode)}
        onPress={press}
        pressed={keyPressed}
        disabled={keyDisabled}
      />
      {breakdown.length > 0 && (
        <div className={styles.breakdown} data-testid="loan-breakdown">
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

/** ボーナス欄の名前だけモードで差し替える(設計書 §6)。 */
function sectionsFor(mode: LoanMode) {
  return LOAN_SECTIONS.map((section) =>
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

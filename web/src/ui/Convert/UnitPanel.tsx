import { useEffect, useState } from "react";
import {
  type ConvertCalc,
  type ConvertCategoryToken,
  type ConvertUnitToken,
  initConvert,
} from "../../convert";
import {
  backspace,
  canPushCloseParen,
  canPushOpenParen,
  canPushOperator,
  EMPTY,
  type Entry,
  fromDigits,
  hasOperator,
  isEmpty,
  type Operator,
  pushCloseParen,
  pushDigit,
  pushDot,
  pushOpenParen,
  pushOperator,
  text,
} from "../../convert/entry";
import {
  CONVERT_SECTIONS,
  type ConvertField,
  type ConvertKeyToken,
  UNIT_LABELS,
  unitSections,
} from "../Keypad/convert";
import { Keypad } from "../Keypad/Keypad";
import { Readout } from "../Readout/Readout";
import styles from "./UnitPanel.module.css";

/**
 * 単位換算の盤面。**3 つのカテゴリで 1 つを共有する**——長さ・質量・温度で
 * 変わるのは単位面の中身と既定の単位だけで、項目も操作も同じである。
 *
 * **符号はここが持つ**(計画の裁定 3)。`units/entry.ts` は空の式に `-` を
 * 置けない(単項マイナスを持たない)ので、`±` はパネル局所の state を反転し、
 * 評価の直前に先頭へ付ける。**共有層は 1 行も変えない**——`pushOperator` は
 * Finance も使っており(`web/src/finance/entry.ts`)、意味を変えると金額や
 * 期間の欄に単項マイナスが生える。
 */

/** 項目の並び(項目行と同じ順、spec §4.1)。 */
const FIELD_ORDER: readonly ConvertField[] = ["value", "from", "to"];

const FIELD_LABELS: Record<ConvertField, string> = {
  value: "値",
  from: "変換元",
  to: "変換先",
};

const OPERATORS: Record<"add" | "sub" | "mul" | "div", Operator> = {
  add: "+",
  sub: "-",
  mul: "*",
  div: "/",
};

/**
 * 既定の単位。**どれも「日本の単位からヤード・ポンドへ」**で、換算器を開く
 * 動機のいちばん多い向きである(spec は既定を決めていない。Task 11 の裁定)。
 */
const DEFAULT_UNITS: Record<
  ConvertCategoryToken,
  { from: ConvertUnitToken; to: ConvertUnitToken }
> = {
  length: { from: "km", to: "mi" },
  mass: { from: "kg", to: "lb" },
  temperature: { from: "degc", to: "degf" },
};

export function UnitPanel({ category }: { category: ConvertCategoryToken }) {
  const defaults = DEFAULT_UNITS[category];
  const [calc, setCalc] = useState<ConvertCalc | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState<ConvertField>("value");
  const [entry, setEntry] = useState<Entry>(EMPTY);
  // **符号は値の一部だが、Entry には入らない**(計画の裁定 3)。
  const [negative, setNegative] = useState(false);
  const [from, setFrom] = useState<ConvertUnitToken>(defaults.from);
  const [to, setTo] = useState<ConvertUnitToken>(defaults.to);

  useEffect(() => {
    let cancelled = false;
    initConvert().then(
      (loaded) => {
        if (!cancelled) setCalc(loaded);
      },
      () => {
        // WASM が読めなければ何も計算できない。読み込み中のまま固まらせず、
        // 起きたことを伝える(DataScalePanel / TransferPanel と同じ流儀)。
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <p role="alert" data-testid="convert-load-error">
        計算エンジンを読み込めませんでした。ページを再読み込みしてください。
      </p>
    );
  }

  const valueField = active === "value";

  /**
   * コアへ渡す式。**符号はここで先頭に付く**(計画の裁定 3)。空の入力には
   * 付けない——`-` だけを渡すと、何も打っていない画面に SyntaxError が出る。
   */
  const typed = isEmpty(entry) ? "" : `${negative ? "-" : ""}${text(entry)}`;

  /**
   * `=` の着地。**打った式をその場で評価して値にする**(FinancePanel の
   * `settle` と同じ)。同じ単位への換算に通すのは、有理数のまま評価して
   * 10 進に落とす経路がそこしか無いからである——`from → from` は恒等である。
   *
   * **打ち直せない形は落とさない。** カンマや指数表記(`1e12`)を Entry に
   * 入れると、次の評価でコアが読めない文字列になる。
   */
  function settled(): string | null {
    if (calc === null || typed === "") return null;
    const folded = calc.convert(typed, category, from, from);
    if (folded.text === null) return null;
    const plain = folded.text.replace(/,/g, "");
    return /^-?\d+(\.\d+)?$/.test(plain) ? plain : null;
  }

  /** いま押せないキー。**DEL はどの面にも居る**ので、単位面では消すものが無い。 */
  function keyDisabled(token: ConvertKeyToken): boolean {
    switch (token) {
      case "del":
        return !valueField;
      // 畳むものが無ければ `=` は押せない(FinancePanel の `=` と同じ)。
      case "eq":
        return !hasOperator(entry);
      case "add":
      case "sub":
      case "mul":
      case "div":
        return !canPushOperator(entry);
      case "lparen":
        return !canPushOpenParen(entry);
      case "rparen":
        return !canPushCloseParen(entry);
      default:
        return false;
    }
  }

  /** トグルとして押されているキー。数字は undefined(トグルではない)。 */
  function keyPressed(token: ConvertKeyToken): boolean | undefined {
    if (token.startsWith("field:")) return token === `field:${active}`;
    if (token.startsWith("unit:")) {
      // 単位面は変換元と変換先で共用する。押されて見えるのは**いま選んでいる
      // 項目の**単位である。
      return token === `unit:${active === "to" ? to : from}`;
    }
    return undefined;
  }

  function press(token: ConvertKeyToken): void {
    if (token.startsWith("field:")) {
      setActive(token.slice("field:".length) as ConvertField);
      return;
    }
    if (token.startsWith("unit:")) {
      const unit = token.slice("unit:".length) as ConvertUnitToken;
      if (active === "from") setFrom(unit);
      else if (active === "to") setTo(unit);
      return;
    }
    if (token === "swap") {
      // **値はそのまま残す**(spec §4.2)。符号も値の一部なので、触らない。
      // 2 つの setState は次の描画でまとめて効く——どちらも古い値を読む。
      setFrom(to);
      setTo(from);
      return;
    }
    if (token === "ac") {
      // AC はいま打っている項目を最初に戻す(DataScale / Transfer と同じ規律。
      // 読み上げ名も「この項目を消去」である)。**符号も値のうち**なので、
      // 値を空にするときは一緒に落とす。
      if (active === "from") setFrom(defaults.from);
      else if (active === "to") setTo(defaults.to);
      else {
        setEntry(EMPTY);
        setNegative(false);
      }
      return;
    }
    if (token === "del") {
      if (valueField) setEntry(backspace(entry));
      return;
    }
    // ここから先は数字面のキーだけ。単位面には無い。
    if (!valueField) return;
    if (token.startsWith("digit:")) {
      setEntry(pushDigit(entry, token.slice("digit:".length)));
      return;
    }
    switch (token) {
      case "zeros3": {
        // **ローカルで畳んでから 1 回だけ書く。** 3 回に分けて書くと、同じ
        // イベントの中で 3 回とも同じ値を読み、最後の 1 回しか残らない。
        let next = entry;
        for (const _ of [0, 1, 2]) next = pushDigit(next, "0");
        setEntry(next);
        break;
      }
      case "dot":
        setEntry(pushDot(entry));
        break;
      case "sign":
        setNegative(!negative);
        break;
      case "add":
      case "sub":
      case "mul":
      case "div":
        setEntry(pushOperator(entry, OPERATORS[token]));
        break;
      case "lparen":
        setEntry(pushOpenParen(entry));
        break;
      case "rparen":
        setEntry(pushCloseParen(entry));
        break;
      case "eq": {
        const folded = settled();
        if (folded === null) break;
        // 符号は Entry に入らないので、負なら state のほうへ移す。
        setNegative(folded.startsWith("-"));
        setEntry(fromDigits(folded.replace(/^-/, "")));
        break;
      }
    }
  }

  // 結果は保持しない。**打った通りの文字列をコアに評価させる**(spec §4.3)
  // ——式も単位も解釈するのはコアで、ここは境界を渡すだけである。
  const shown =
    calc !== null && typed !== ""
      ? calc.convert(typed, category, from, to)
      : null;
  const answer =
    shown === null
      ? ""
      : shown.text === null
        ? "Math ERROR"
        : `${shown.text} ${UNIT_LABELS[to]}`;

  // 入力の一覧。**打っている項目は大きく、入力済みは画面に残す**(設計書 §2)。
  // 単位は常に値を持つので、消えるのは未入力の値だけである。
  const entries = FIELD_ORDER.map((field) => ({
    label: FIELD_LABELS[field],
    value:
      field === "value" ? typed : UNIT_LABELS[field === "from" ? from : to],
    active: field === active,
  })).filter((item) => item.active || item.value !== "");

  return (
    <section className={styles.panel} aria-label="単位変換">
      <Readout
        entries={entries}
        main={answer}
        error={shown?.error ?? null}
        status={[
          {
            testId: "convert-field",
            ariaLabel: "入力中の項目",
            text: `${FIELD_LABELS[active]}を入力中`,
          },
        ]}
      />
      <Keypad
        sections={valueField ? CONVERT_SECTIONS : unitSections(category)}
        onPress={press}
        pressed={keyPressed}
        disabled={keyDisabled}
      />
      {shown !== null && shown.text !== null && (
        <p className={styles.result} data-testid="convert-result">
          {`${typed} ${UNIT_LABELS[from]} = ${shown.text} ${UNIT_LABELS[to]}`}
        </p>
      )}
    </section>
  );
}

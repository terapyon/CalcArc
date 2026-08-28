import { useEffect, useState } from "react";
import { type ConvertCalc, initConvert } from "../../convert";
import {
  backspace,
  canPushCloseParen,
  canPushOpenParen,
  canPushOperator,
  EMPTY,
  type Entry,
  fromDigits,
  isEmpty,
  type Operator,
  pushCloseParen,
  pushDigit,
  pushDot,
  pushOpenParen,
  pushOperator,
  text,
} from "../../convert/entry";
// **カテゴリの綴りと述語は `types.ts` から取る。** ラッパー本体
// (`../../convert`)はテストがまるごと差し替えるので、そちらから取ると
// **モックに無い関数が `undefined` になって落ちる**(`UnitPanel.test.tsx` が
// トークンの一覧を `types.ts` から取っているのと同じ理由)。
import type {
  ConvertCategoryId,
  ConvertCategoryToken,
} from "../../convert/types";
import { isCurrencyCategory } from "../../convert/types";
import { PROVIDER_ATTRIBUTION } from "../../currency/provider";
import { CURRENCY_CODE } from "../../currency/rates";
import type { CurrencyToken } from "../../currency/types";
import {
  CONVERT_SECTIONS,
  type ConvertFaceUnit,
  type ConvertField,
  type ConvertKeyToken,
  FACE_LABELS,
  unitSections,
} from "../Keypad/convert";
import { Keypad } from "../Keypad/Keypad";
import { Readout } from "../Readout/Readout";
import styles from "./UnitPanel.module.css";
import { useCurrencyRates } from "./useCurrencyRates";

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
 * 既定の単位。**多くは「日本の単位からヤード・ポンドへ」**——換算器を開く
 * 動機のいちばん多い向きである(spec は既定を決めていない。Task 11 の裁定)。
 * **例外が 2 つある**: area は 坪→m²(ヤード・ポンドへ行かない。下の注記)、
 * data-size は GB→GiB(どちらの向きでもない。SI/IEC の分離を見せるためで、
 * 「日本の単位から」でも「ヤード・ポンドへ」でもない)。
 */
const DEFAULT_UNITS: Record<
  ConvertCategoryId,
  { from: ConvertFaceUnit; to: ConvertFaceUnit }
> = {
  length: { from: "km", to: "mi" },
  mass: { from: "kg", to: "lb" },
  temperature: { from: "degc", to: "degf" },
  // **面積だけは向きが違う。** 日本で面積を引くのは「坪はいくつの m² か」
  // であって、ヤード・ポンドへ出す用ではない(U-2 spec §3.3 が名指しする
  // `坪 ≠ 2 畳` も、この向きで見える)。
  area: { from: "tsubo", to: "m2" },
  volume: { from: "l", to: "gal_us" },
  speed: { from: "kmh", to: "mph" },
  // **SI と IEC の分離が既定で見えるようにする**(設計書 §6 の例、`1 GB`)。
  "data-size": { from: "gb", to: "gib" },
  // **為替は「外貨から円へ」。** 日本で為替を引く動機のいちばん多い向きで、
  // area が 坪→m² を既定にしたのと同じ判断である。**レートの中身では
  // 決めない**(spec §7)——表に無ければキーが押せなくなるだけで、
  // 既定の位置は動かさない。
  currency: { from: "usd", to: "jpy" },
};

/**
 * レート日付が無いとき(キャッシュ無し)に出す字。
 *
 * **行ごと消さない**(spec §5・§0.0-3)——**古いときだけ日付を出すと、
 * 出ていないことが「新しい」の意味になり**、読み手がそれを学習しなければ
 * ならなくなる。**同じ場所に同じ形で、いつも出す。**
 */
const NO_DATE = "—";

/**
 * `=` が式を畳むときに通す恒等換算。**カテゴリに依らない**——`1 m → 1 m` は
 * どんな式に対しても「有理数のまま評価して 10 進に落とす」だけである。
 *
 * **為替でここを `convertCurrency` にしない。** あちらは着地通貨の桁で
 * 丸めるので、`=` が打った値を書き換えてしまう(`settled()` の注記)。
 */
const FOLD_CATEGORY: ConvertCategoryToken = "length";
const FOLD_UNIT = "m";

export function UnitPanel({ category }: { category: ConvertCategoryId }) {
  const defaults = DEFAULT_UNITS[category];
  const currency = isCurrencyCategory(category);
  const [calc, setCalc] = useState<ConvertCalc | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState<ConvertField>("value");
  const [entry, setEntry] = useState<Entry>(EMPTY);
  // **符号は値の一部だが、Entry には入らない**(計画の裁定 3)。
  const [negative, setNegative] = useState(false);
  const [from, setFrom] = useState<ConvertFaceUnit>(defaults.from);
  const [to, setTo] = useState<ConvertFaceUnit>(defaults.to);
  // **為替のときだけレートを読む**(spec §0.0-2)。他の 7 カテゴリを見て
  // いるあいだは、`fetch` も IndexedDB も触らない。
  const rates = useCurrencyRates(currency);

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
   * その通貨のレート。**`validate` が通した `rates` の鍵からだけ起こす**
   * (Task 6 の申し送り)——`CURRENCY_TOKENS` から起こすと、**検証で落ちた
   * はずの通貨が押せてしまう。**
   *
   * 綴りの変換は `CURRENCY_CODE`(`currency/rates.ts`)が持つ。**盤面で
   * `.toUpperCase()` を書き直さない**——同じ対応表が 2 つになる。
   */
  function rateOf(unit: ConvertFaceUnit): string | null {
    if (!currency || rates.set === null) return null;
    return rates.set.rates[CURRENCY_CODE[unit as CurrencyToken]] ?? null;
  }

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
    // **為替でも畳むのは単位の恒等換算である。** `convertCurrency` は
    // **着地通貨の桁で丸める**(spec §3.1)ので、JPY を選んで `12.5` と
    // 打つと `13` に化ける——**打った値が `=` で書き換わってはならない。**
    // 畳むのは「式を数にする」ことだけで、丸めは表示側の仕事である。
    const folded = currency
      ? calc.convert(typed, FOLD_CATEGORY, FOLD_UNIT, FOLD_UNIT)
      : calc.convert(typed, category as ConvertCategoryToken, from, from);
    if (folded.kind === "error") return null;
    const plain = folded.text.replace(/,/g, "");
    return /^-?\d+(\.\d+)?$/.test(plain) ? plain : null;
  }

  /** いま押せないキー。**DEL はどの面にも居る**ので、単位面では消すものが無い。 */
  function keyDisabled(token: ConvertKeyToken): boolean {
    // **レート表に無い通貨は押せない**(spec §7)。`Key` が `:disabled` で
    // 薄くするので、**押せないキーは押せないように見える**——0.2.0 の
    // 予約スロットの穴(有効なキーと同じ見た目で無反応)を繰り返さない。
    if (currency && token.startsWith("unit:")) {
      return rateOf(token.slice("unit:".length) as ConvertFaceUnit) === null;
    }
    switch (token) {
      case "del":
        return !valueField;
      // 畳んだ結果が取れなければ `=` は押せない(FinancePanel の `settle` と
      // 同じ述語——`hasOperator` ではなく「評価できるか」で判定する)。
      case "eq":
        return settled() === null;
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
      const unit = token.slice("unit:".length) as ConvertFaceUnit;
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
  const fromRate = rateOf(from);
  const toRate = rateOf(to);
  // 結果は保持しない。**打った通りの文字列をコアに評価させる**(spec §4.3)。
  // **為替はレートを引数で渡す**(spec §3)——レートが 1 つでも欠けていれば
  // 換算しない(そのキーは押せないので、既定が欠けているときだけ起きる)。
  const shown =
    calc === null || typed === ""
      ? null
      : currency
        ? fromRate === null || toRate === null
          ? null
          : calc.convertCurrency(typed, from, to, fromRate, toRate)
        : calc.convert(typed, category as ConvertCategoryToken, from, to);
  // **成功と失敗は別の形**なので、先に枝を分けてから読む(設計書 §0)。
  const ok = shown?.kind === "ok" ? shown : null;
  const calcError = shown?.kind === "error" ? shown.code : null;
  const answer =
    shown === null
      ? ""
      : ok === null
        ? "Math ERROR"
        : `${ok.text} ${FACE_LABELS[to]}`;

  // 入力の一覧。**打っている項目は大きく、入力済みは画面に残す**(設計書 §2)。
  // 単位は常に値を持つので、消えるのは未入力の値だけである。
  const entries = FIELD_ORDER.map((field) => ({
    label: FIELD_LABELS[field],
    value:
      field === "value" ? typed : FACE_LABELS[field === "from" ? from : to],
    active: field === active,
  })).filter((item) => item.active || item.value !== "");

  return (
    <section className={styles.panel} aria-label="単位変換">
      <Readout
        entries={entries}
        main={answer}
        error={calcError}
        status={[
          {
            testId: "convert-field",
            ariaLabel: "入力中の項目",
            text: `${FIELD_LABELS[active]}を入力中`,
          },
        ]}
      />
      {/* **レート日付は常にここに出る**(spec §5・§0.0-3)。キャッシュが
          新しくても古くても、オフラインでも取得に失敗していても、**同じ
          場所に同じ形で**——古いときだけ出すと、出ていないことが「新しい」
          の意味になる。**帰属表示はその隣**(spec §2.1 実装時義務 3・§7)
          ——出さない選択肢は無い。 */}
      {currency && (
        <p className={styles.rate} data-testid="currency-rate">
          <span data-testid="currency-rate-date">{`Rate: ${
            rates.set?.date ?? NO_DATE
          }`}</span>
          {/* オフラインは**状態であってエラーではない**(spec §5)。
              キャッシュがあればそのまま換算が続く。 */}
          {rates.offline && <span data-testid="currency-offline">Offline</span>}
          <a
            className={styles.attribution}
            href={PROVIDER_ATTRIBUTION.href}
            target="_blank"
            rel="noreferrer"
            data-testid="currency-attribution"
          >
            {PROVIDER_ATTRIBUTION.text}
          </a>
        </p>
      )}
      {/* **キャッシュ無しはエラーではなく案内である**(spec §5)。読み込み中は
          出さない——開いた直後の一瞬だけ「ありません」と出て消えるのは嘘で
          ある。**このとき換算結果の欄は出ない**(`shown` が null になる)。 */}
      {currency && !rates.loading && rates.set === null && (
        <p className={styles.notice} role="note" data-testid="currency-none">
          為替レートがありません。インターネットに接続して取得してください。
        </p>
      )}
      <Keypad
        sections={valueField ? CONVERT_SECTIONS : unitSections(category)}
        onPress={press}
        pressed={keyPressed}
        disabled={keyDisabled}
      />
      {ok !== null && (
        <p className={styles.result} data-testid="convert-result">
          {`${typed} ${FACE_LABELS[from]} = ${ok.text} ${FACE_LABELS[to]}`}
        </p>
      )}
    </section>
  );
}

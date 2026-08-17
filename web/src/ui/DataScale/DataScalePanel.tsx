import { useEffect, useState } from "react";
import {
  type DataScaleCalc,
  type DataTypeToken,
  initDataScale,
} from "../../datascale";
import {
  backspace,
  canPushUnit,
  EMPTY,
  type Entry,
  G,
  isEmpty,
  K,
  M,
  pushDigit,
  pushUnit,
  text,
} from "../../datascale/entry";
import { type ExprCalc, initExpr } from "../../expr";
import type { Primary } from "../../settings";
import {
  DATA_SCALE_SECTIONS,
  type DataScaleField,
  type DataScaleKeyToken,
  TYPE_SECTIONS,
} from "../Keypad/dataScale";
import { Keypad } from "../Keypad/Keypad";
import { Readout } from "../Readout/Readout";
import { loadSettings, updateSettings } from "../useSetting";
import styles from "./DataScalePanel.module.css";

/** 既定のデータ型。フォーム時代の select の初期値を引き継ぐ(設計書 §5)。 */
const DEFAULT_TYPE: DataTypeToken = "float32";

/** 件数・次元数の上限。u128(設計書 §8 の着地表)。 */
const MAX_COUNT = "340282366920938463463374607431768211455";

const FIELD_LABELS: Record<DataScaleField, string> = {
  count: "件数",
  dimensions: "次元数",
  dtype: "データ型",
};

const PRIMARY_STATUS: Record<Primary, string> = {
  decimal: "10 進を主表示",
  binary: "2 進を主表示",
};

export function DataScalePanel() {
  const [calc, setCalc] = useState<DataScaleCalc | null>(null);
  const [expr, setExpr] = useState<ExprCalc | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState<DataScaleField>("count");
  const [count, setCount] = useState<Entry>(EMPTY);
  const [dimensions, setDimensions] = useState<Entry>(EMPTY);
  // **設定は保存から起こす**(P-1 設計書 §4)。打鍵中の値(count /
  // dimensions)は保存しないので、上の 2 つは初期値のままである。
  const [dtype, setDtype] = useState<DataTypeToken>(
    () => loadSettings().dataScale.dtype,
  );
  const [primary, setPrimary] = useState<Primary>(
    () => loadSettings().dataScale.primary,
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
    initDataScale().then(
      (loaded) => {
        if (!cancelled) setCalc(loaded);
      },
      () => {
        // WASM が読めなければ何も計算できない。読み込み中のまま
        // 固まらせず、起きたことを伝える(App と同じ流儀)。
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <p role="alert" data-testid="datascale-load-error">
        計算エンジンを読み込めませんでした。ページを再読み込みしてください。
      </p>
    );
  }

  const numberField = active !== "dtype";
  const entry = active === "dimensions" ? dimensions : count;
  const setEntry = active === "dimensions" ? setDimensions : setCount;

  /** いま押せないキー。型面では DEL に消すものが無い(設計書 §5)。 */
  function keyDisabled(token: DataScaleKeyToken): boolean {
    if (token === "del") return !numberField;
    if (token === "k") return !numberField || !canPushUnit(entry, K);
    if (token === "m") return !numberField || !canPushUnit(entry, M);
    if (token === "g") return !numberField || !canPushUnit(entry, G);
    return false;
  }

  /** トグルとして押されているキー。数字は undefined(トグルではない)。 */
  function keyPressed(token: DataScaleKeyToken): boolean | undefined {
    if (token.startsWith("field:")) return token === `field:${active}`;
    if (token.startsWith("dtype:")) return token === `dtype:${dtype}`;
    return undefined;
  }

  /** データ型を変え、設定に書き戻す。**新しい値を使う**——state の更新は
   * 非同期なので、直後に dtype を読むと 1 つ前の値になる。
   *
   * **変わっていないなら書かない。** 書き込みの契機は「設定が変わった
   * その場」である(P-1 設計書 §6)。いま選ばれている型をもう一度押す、
   * 既定のまま型の面で AC を押す——どちらも設定は変わっていないのに、
   * 書くと保存キーが生まれる(ScientificPanel の savedScientific が
   * 同じ規律を持っている)。 */
  function chooseDtype(next: DataTypeToken): void {
    if (next === dtype) return;
    setDtype(next);
    updateSettings((current) => ({
      ...current,
      dataScale: { ...current.dataScale, dtype: next },
    }));
  }

  /** 主に表示する単位系を変え、設定に書き戻す。理由は chooseDtype と同じ。 */
  function choosePrimary(next: Primary): void {
    if (next === primary) return;
    setPrimary(next);
    updateSettings((current) => ({
      ...current,
      dataScale: { ...current.dataScale, primary: next },
    }));
  }

  function press(token: DataScaleKeyToken) {
    if (token.startsWith("field:")) {
      setActive(token.slice("field:".length) as DataScaleField);
      return;
    }
    if (token.startsWith("dtype:")) {
      chooseDtype(token.slice("dtype:".length) as DataTypeToken);
      return;
    }
    if (token.startsWith("digit:")) {
      if (numberField) setEntry(pushDigit(entry, token.slice("digit:".length)));
      return;
    }
    switch (token) {
      case "zeros3":
        if (numberField) {
          let next = entry;
          for (const _ of [0, 1, 2]) next = pushDigit(next, "0");
          setEntry(next);
        }
        break;
      case "k":
      case "m":
      case "g": {
        if (!numberField) break;
        const unit = token === "k" ? K : token === "m" ? M : G;
        // 盤面は押せないようにしてあるので、null はここに来ない(設計書 §4)。
        const next = pushUnit(entry, unit);
        if (next !== null) setEntry(next);
        break;
      }
      case "del":
        if (numberField) setEntry(backspace(entry));
        break;
      case "ac":
        // AC はいま打っている項目を最初に戻す。型は既定へ(設計書 §5)。
        if (numberField) setEntry(EMPTY);
        else chooseDtype(DEFAULT_TYPE);
        break;
    }
  }

  // 入力の一覧。**打っている項目は大きく、入力済みは画面に残す**
  // (設計書 §2)。未入力の項目は出さない。
  // **未入力の項目は出さない**——空の「次元数」で埋めても根拠にならない
  // (設計書 §2)。データ型は常に値を持つ。
  const entries = (["count", "dimensions", "dtype"] as const)
    .map((field) => ({
      label: FIELD_LABELS[field],
      value:
        field === "dtype"
          ? dtype
          : text(field === "count" ? count : dimensions),
      active: field === active,
    }))
    .filter((entry) => entry.active || entry.value !== "");

  // 結果は保持しない。両方の項目が埋まっているときだけ計算する。
  // 打った通りの文字列をコアに評価させる(設計書 訂正 2)。
  function evaluate(entry: Entry) {
    const typed = text(entry);
    if (typed === "" || expr === null) return { value: "", error: null };
    const r = expr.integer(typed, MAX_COUNT, "count");
    return { value: r.value ?? "", error: r.error };
  }

  const countResult = evaluate(count);
  const dimensionResult = evaluate(dimensions);
  const countDigits = countResult.value;
  const dimensionDigits = dimensionResult.value;
  // **式が壊れていたら、そこで止めて言う。** 黙って中立に戻ると、打った人は
  // 何も起きない画面を見ることになる(設計書 §8)。
  const exprError = countResult.error ?? dimensionResult.error;
  const shown =
    calc && !isEmpty(count) && !isEmpty(dimensions)
      ? calc.compute(countDigits, dimensionDigits, dtype)
      : null;

  // main は主 → 副 → bytes の順に繰り上げる(設計書 §6)。空の主表示を
  // 見せない——値が無いときだけ空になるべきである。
  const decimal = shown?.decimal ?? null;
  const binary = shown?.binary ?? null;
  const first = primary === "decimal" ? decimal : binary;
  const second = primary === "decimal" ? binary : decimal;
  const answer = exprError
    ? "Math ERROR"
    : shown?.error
      ? "Math ERROR"
      : (first ??
        second ??
        (shown?.bytesGrouped ? `${shown.bytesGrouped} bytes` : ""));

  return (
    <section className={styles.panel} aria-label="データスケール計算">
      <Readout
        entries={entries}
        main={answer}
        error={exprError ?? shown?.error ?? null}
        status={[
          {
            testId: "datascale-primary",
            ariaLabel: "主に表示する単位系",
            text: PRIMARY_STATUS[primary],
          },
          {
            testId: "datascale-field",
            ariaLabel: "入力中の項目",
            text: `${FIELD_LABELS[active]}を入力中`,
          },
        ]}
      />
      <Keypad
        sections={numberField ? DATA_SCALE_SECTIONS : TYPE_SECTIONS}
        onPress={press}
        pressed={keyPressed}
        disabled={keyDisabled}
      />
      {/* Keypad の区画と同じ流儀で <fieldset>——role=group な <div> は
          WAI-ARIA の推奨要素チェックに引っかかる。見た目だけ打ち消す。 */}
      <fieldset className={styles.units} aria-label="主に表示する単位系を選ぶ">
        {(["decimal", "binary"] as const).map((system) => (
          <button
            key={system}
            type="button"
            aria-pressed={primary === system}
            onClick={() => choosePrimary(system)}
          >
            {system === "decimal" ? "10 進 (KB) を主に" : "2 進 (KiB) を主に"}
          </button>
        ))}
      </fieldset>
      {shown && !shown.error && (
        <div className={styles.result} data-testid="datascale-result">
          {shown.bytesGrouped !== null && <p>{shown.bytesGrouped} bytes</p>}
          {first !== null && <p className={styles.primary}>{first}</p>}
          {second !== null && <p className={styles.secondary}>{second}</p>}
        </div>
      )}
    </section>
  );
}

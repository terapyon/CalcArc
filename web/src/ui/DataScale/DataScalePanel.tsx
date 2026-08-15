import { useEffect, useState } from "react";
import {
  type DataScaleCalc,
  type DataTypeToken,
  initDataScale,
} from "../../datascale";
import {
  backspace,
  canPushUnit,
  digits,
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
import {
  DATA_SCALE_SECTIONS,
  type DataScaleField,
  type DataScaleKeyToken,
  TYPE_SECTIONS,
} from "../Keypad/dataScale";
import { Keypad } from "../Keypad/Keypad";
import { Readout } from "../Readout/Readout";
import styles from "./DataScalePanel.module.css";

/** 既定のデータ型。フォーム時代の select の初期値を引き継ぐ(設計書 §5)。 */
const DEFAULT_TYPE: DataTypeToken = "float32";

const FIELD_LABELS: Record<DataScaleField, string> = {
  count: "件数",
  dimensions: "次元数",
  dtype: "データ型",
};

/** 主に表示する単位系。表示だけの切り替えで、計算には触れない(設計書 §6)。 */
type Primary = "decimal" | "binary";

const PRIMARY_STATUS: Record<Primary, string> = {
  decimal: "10 進を主表示",
  binary: "2 進を主表示",
};

export function DataScalePanel() {
  const [calc, setCalc] = useState<DataScaleCalc | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState<DataScaleField>("count");
  const [count, setCount] = useState<Entry>(EMPTY);
  const [dimensions, setDimensions] = useState<Entry>(EMPTY);
  const [dtype, setDtype] = useState<DataTypeToken>(DEFAULT_TYPE);
  const [primary, setPrimary] = useState<Primary>("decimal");

  useEffect(() => {
    let cancelled = false;
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

  function press(token: DataScaleKeyToken) {
    if (token.startsWith("field:")) {
      setActive(token.slice("field:".length) as DataScaleField);
      return;
    }
    if (token.startsWith("dtype:")) {
      setDtype(token.slice("dtype:".length) as DataTypeToken);
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
        else setDtype(DEFAULT_TYPE);
        break;
    }
  }

  // 入力の一覧。**打っている項目は大きく、入力済みは画面に残す**
  // (設計書 §2)。未入力の項目は出さない。
  const entries = (["count", "dimensions", "dtype"] as const).map((field) => ({
    label: FIELD_LABELS[field],
    value:
      field === "dtype" ? dtype : text(field === "count" ? count : dimensions),
    active: field === active,
  }));

  // 結果は保持しない。両方の項目が埋まっているときだけ計算する。
  const countDigits = digits(count);
  const dimensionDigits = digits(dimensions);
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
  const answer = shown?.error
    ? "Math ERROR"
    : (first ??
      second ??
      (shown?.bytesGrouped ? `${shown.bytesGrouped} bytes` : ""));

  return (
    <section className={styles.panel} aria-label="データスケール計算">
      <Readout
        entries={entries}
        main={answer}
        error={shown?.error ?? null}
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
            onClick={() => setPrimary(system)}
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

import { useEffect, useState } from "react";
import {
  type BandwidthUnitToken,
  type DataScaleCalc,
  type DurationUnitToken,
  initDataScale,
} from "../../datascale";
import {
  backspace,
  EMPTY,
  type Entry,
  isEmpty,
  pushDigit,
  text,
} from "../../datascale/entry";
import { type ExprCalc, initExpr } from "../../expr";
import type { Primary } from "../../settings";
import { Keypad } from "../Keypad/Keypad";
import { isDeadOperator } from "../Keypad/operators";
import {
  BANDWIDTH_UNIT_LABELS,
  BANDWIDTH_UNIT_SECTION,
  DURATION_UNIT_LABELS,
  DURATION_UNIT_SECTION,
  TRANSFER_FIELD_LABELS,
  TRANSFER_FIELD_ORDER,
  TRANSFER_FIELD_SECTION,
  TRANSFER_PAD,
  type TransferField,
  type TransferKeyToken,
  type TransferValueField,
} from "../Keypad/transfer";
import type { KeypadSection } from "../Keypad/types";
import { Readout } from "../Readout/Readout";
import { loadSettings } from "../useSetting";
import styles from "./TransferPanel.module.css";

/** 項目の数値上限。u128(設計書 §8 の着地表)。DataScalePanel と同じ境界。 */
const MAX_COUNT = "340282366920938463463374607431768211455";

/**
 * 既定の単位(plan Task 10)。**headline がそのまま出る組み合わせ**である
 * ——`100` と `3` を打てば `100 Mbps × 3 時間` になる。
 */
const DEFAULT_BANDWIDTH_UNIT: BandwidthUnitToken = "mbps";
const DEFAULT_DURATION_UNIT: DurationUnitToken = "hour";

const PRIMARY_STATUS: Record<Primary, string> = {
  decimal: "10 進を主表示",
  binary: "2 進を主表示",
};

function isValueField(field: TransferField): field is TransferValueField {
  return field === "bandwidth" || field === "duration";
}

export function TransferPanel() {
  const [calc, setCalc] = useState<DataScaleCalc | null>(null);
  const [expr, setExpr] = useState<ExprCalc | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState<TransferField>("bandwidth");

  // **値の項目は空から始める。** 単位だけが既定を持つ——両方の値が
  // 埋まるまで答えを出さない(Data Scale の「未入力の項目は出さない」)。
  const [bandwidth, setBandwidth] = useState<Entry>(EMPTY);
  const [duration, setDuration] = useState<Entry>(EMPTY);
  const [bandwidthUnit, setBandwidthUnit] = useState<BandwidthUnitToken>(
    DEFAULT_BANDWIDTH_UNIT,
  );
  const [durationUnit, setDurationUnit] = useState<DurationUnitToken>(
    DEFAULT_DURATION_UNIT,
  );

  // **Transfer は自前のトグルを持たない**(LlmPanel と同じ)。縦を 1 行
  // 増やさないため、`settings.dataScale.primary` を読むだけで、書き戻しは
  // しない——書く操作(トグル)がこのパネルに無い。
  const [primary] = useState<Primary>(() => loadSettings().dataScale.primary);

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
        // 固まらせず、起きたことを伝える(DataScalePanel と同じ流儀)。
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <p role="alert" data-testid="transfer-load-error">
        計算エンジンを読み込めませんでした。ページを再読み込みしてください。
      </p>
    );
  }

  // 数字が打てる面か。**単位の面では打てない。**
  const numberField = isValueField(active);
  const entry = active === "duration" ? duration : bandwidth;
  const setEntry = active === "duration" ? setDuration : setBandwidth;

  /** いま出す面。項目行 + (単位面 or 数字面)。 */
  function sectionsFor(): KeypadSection<TransferKeyToken>[] {
    if (active === "bandwidthUnit") {
      return [TRANSFER_FIELD_SECTION, BANDWIDTH_UNIT_SECTION];
    }
    if (active === "durationUnit") {
      return [TRANSFER_FIELD_SECTION, DURATION_UNIT_SECTION];
    }
    return [TRANSFER_FIELD_SECTION, TRANSFER_PAD];
  }

  /** いま押せないキー。単位面では DEL に消すものが無い(設計書 §5)。
   *
   * **演算子の 7 個だけは条件が付かない**——この面には式を組み立てる入口が
   * 無く、**何をしても押せるようにならない**。DEL の「いまは押せない」とは
   * 意味が違う(`Keypad/operators.ts` に理由がある)。 */
  function keyDisabled(token: TransferKeyToken): boolean {
    if (isDeadOperator(token)) return true;
    return token === "del" && !numberField;
  }

  /** トグルとして押されているキー。数字は undefined(トグルではない)。 */
  function keyPressed(token: TransferKeyToken): boolean | undefined {
    if (token.startsWith("field:")) return token === `field:${active}`;
    if (token.startsWith("bandwidth:")) {
      return token === `bandwidth:${bandwidthUnit}`;
    }
    if (token.startsWith("duration:")) {
      return token === `duration:${durationUnit}`;
    }
    return undefined;
  }

  function press(token: TransferKeyToken): void {
    if (token.startsWith("field:")) {
      setActive(token.slice("field:".length) as TransferField);
      return;
    }
    if (token.startsWith("bandwidth:")) {
      setBandwidthUnit(token.slice("bandwidth:".length) as BandwidthUnitToken);
      return;
    }
    if (token.startsWith("duration:")) {
      setDurationUnit(token.slice("duration:".length) as DurationUnitToken);
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
      case "del":
        if (numberField) setEntry(backspace(entry));
        break;
      case "ac":
        // AC はいま打っている項目を最初に戻す。単位は既定へ、値は空に
        // 戻す(DataScalePanel / LlmPanel と同じ規律)。
        if (active === "bandwidthUnit") {
          setBandwidthUnit(DEFAULT_BANDWIDTH_UNIT);
        } else if (active === "durationUnit") {
          setDurationUnit(DEFAULT_DURATION_UNIT);
        } else {
          setEntry(EMPTY);
        }
        break;
    }
  }

  /** 項目の、打った通りの表示値。単位の項目は画面の文字(`Mbps`・`時`)。 */
  function typedIn(field: TransferField): string {
    switch (field) {
      case "bandwidth":
        return text(bandwidth);
      case "bandwidthUnit":
        return BANDWIDTH_UNIT_LABELS[bandwidthUnit];
      case "duration":
        return text(duration);
      case "durationUnit":
        return DURATION_UNIT_LABELS[durationUnit];
    }
  }

  // 結果は保持しない。打った通りの文字列をコアに評価させる
  // (設計書 訂正 2)。**単位表は `none`**——単位は別の項目が持っており、
  // 数の後ろに単位を書く入口が盤面に無い。
  function evaluate(value: Entry) {
    const typed = text(value);
    if (typed === "" || expr === null) return { value: "", error: null };
    const r = expr.integer(typed, MAX_COUNT, "none");
    return { value: r.value ?? "", error: r.error };
  }

  const bandwidthResult = evaluate(bandwidth);
  const durationResult = evaluate(duration);

  // **式が壊れていたら、そこで止めて言う。** 黙って中立に戻ると、打った人は
  // 何も起きない画面を見ることになる(設計書 §8)。
  const exprError = bandwidthResult.error ?? durationResult.error ?? null;

  const shown =
    calc && !isEmpty(bandwidth) && !isEmpty(duration)
      ? calc.transfer(
          bandwidthResult.value,
          bandwidthUnit,
          durationResult.value,
          durationUnit,
        )
      : null;

  // main は主 → 副 → bytes の順に繰り上げる(設計書 §6)。1 バイトのように
  // どの単位にも届かない値では bytes だけが残る。
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

  // 入力の一覧。**打っている項目は大きく、入力済みは画面に残す**
  // (設計書 §2)。単位は常に値を持つので、消えるのは未入力の値だけである。
  const entries = TRANSFER_FIELD_ORDER.map((field) => ({
    label: TRANSFER_FIELD_LABELS[field],
    value: typedIn(field),
    active: field === active,
  })).filter((item) => item.active || item.value !== "");

  return (
    <section className={styles.panel} aria-label="データ転送量計算">
      <Readout
        entries={entries}
        main={answer}
        error={exprError ?? shown?.error ?? null}
        status={[
          {
            testId: "transfer-primary",
            ariaLabel: "主に表示する単位系",
            text: PRIMARY_STATUS[primary],
          },
          {
            testId: "transfer-field",
            ariaLabel: "入力中の項目",
            text: `${TRANSFER_FIELD_LABELS[active]}を入力中`,
          },
        ]}
      />
      <Keypad
        sections={sectionsFor()}
        onPress={press}
        pressed={keyPressed}
        disabled={keyDisabled}
      />
      {shown && !shown.error && (
        <div className={styles.result} data-testid="transfer-result">
          {shown.bytesGrouped !== null && <p>{shown.bytesGrouped} bytes</p>}
          {first !== null && <p className={styles.primary}>{first}</p>}
          {second !== null && <p className={styles.secondary}>{second}</p>}
        </div>
      )}
    </section>
  );
}

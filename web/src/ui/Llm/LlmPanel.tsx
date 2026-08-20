import { useEffect, useState } from "react";
import {
  type ByteLines,
  type DataScaleCalc,
  initDataScale,
  type PrecisionToken,
} from "../../datascale";
import {
  backspace,
  canPushUnit,
  EMPTY,
  type Entry,
  fromDigits,
  isEmpty,
  pushDigit,
  pushUnit,
  text,
  type Unit,
} from "../../datascale/entry";
import { type ExprCalc, initExpr } from "../../expr";
import type { Primary } from "../../settings";
import { Keypad } from "../Keypad/Keypad";
import {
  CANDIDATE_SECTIONS,
  LLM_FIELD_LABELS,
  LLM_FIELD_SECTION,
  type LlmField,
  type LlmKeyToken,
  llmPad,
} from "../Keypad/llm";
import type { KeypadSection } from "../Keypad/types";
import { Readout } from "../Readout/Readout";
import { loadSettings } from "../useSetting";
import styles from "./LlmPanel.module.css";

/** パラメータ数の単位(spec §4.3)。`十億`/`百万` は既存の G/M と同じ読み上げ
 * だが、件数のバイト単位(G=10⁹バイト)とは意味が違うのでここで別に持つ。 */
const B: Unit = { label: "B", rank: 0 };
const M: Unit = { label: "M", rank: 1 };

/** 項目の数値上限。u128(設計書 §8 の着地表)。DataScalePanel と同じ境界。 */
const MAX_COUNT = "340282366920938463463374607431768211455";

/** 精度の既定値(spec §5)。重み・KV とも fp16。 */
const DEFAULT_PRECISION: PrecisionToken = "fp16";

/** 数値を持つ項目。weight/kvPrecision は選択のみで Entry を持たない。 */
type EntryField = Exclude<LlmField, "weight" | "kvPrecision">;

/** 候補面と手入力面を持つ項目。layers は候補を持たないので除く。 */
type CandidateField = Exclude<EntryField, "layers">;

function isCandidateField(field: LlmField): field is CandidateField {
  return (
    field === "parameters" ||
    field === "kvHeads" ||
    field === "headDim" ||
    field === "context"
  );
}

/** 項目の並び(項目行と同じ順、spec §4.3)。 */
const FIELD_ORDER: readonly LlmField[] = [
  "parameters",
  "weight",
  "layers",
  "kvHeads",
  "headDim",
  "context",
  "kvPrecision",
];

const PRIMARY_STATUS: Record<Primary, string> = {
  decimal: "10 進を主表示",
  binary: "2 進を主表示",
};

export function LlmPanel() {
  const [calc, setCalc] = useState<DataScaleCalc | null>(null);
  const [expr, setExpr] = useState<ExprCalc | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState<LlmField>("parameters");

  // **既定値を持つ**(spec §4.3、コントローラの裁定 3)。層数だけが空——
  // ここが埋まるまで答えを出さない(Data Scale の「未入力の項目は出さない」
  // と同じ)。既定はどれも、対応する候補キーを押したのと同じ Entry にする
  // ——候補の一覧(`llm.ts` の `CANDIDATE_VALUES`)と値がずれない。
  const [parameters, setParameters] = useState<Entry>(() =>
    fromDigits("7000000000"),
  );
  const [layers, setLayers] = useState<Entry>(EMPTY);
  const [kvHeads, setKvHeads] = useState<Entry>(() => fromDigits("8"));
  const [headDim, setHeadDim] = useState<Entry>(() => fromDigits("128"));
  const [context, setContext] = useState<Entry>(() => fromDigits("4096"));
  const [weight, setWeight] = useState<PrecisionToken>(DEFAULT_PRECISION);
  const [kvPrecision, setKvPrecision] =
    useState<PrecisionToken>(DEFAULT_PRECISION);

  // **既定は選択面**(DataScalePanel の dimensionsMode と同じ)。打鍵中の
  // 値なので保存はしない。
  const [mode, setMode] = useState<Record<CandidateField, "choose" | "manual">>(
    {
      parameters: "choose",
      kvHeads: "choose",
      headDim: "choose",
      context: "choose",
    },
  );

  // **LLM は自前のトグルを持たない**(コントローラの裁定 1)。縦を 1 行
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
      <p role="alert" data-testid="llm-load-error">
        計算エンジンを読み込めませんでした。ページを再読み込みしてください。
      </p>
    );
  }

  function entryOf(field: EntryField): Entry {
    switch (field) {
      case "parameters":
        return parameters;
      case "layers":
        return layers;
      case "kvHeads":
        return kvHeads;
      case "headDim":
        return headDim;
      case "context":
        return context;
    }
  }

  function setEntryOf(field: EntryField, next: Entry): void {
    switch (field) {
      case "parameters":
        setParameters(next);
        break;
      case "layers":
        setLayers(next);
        break;
      case "kvHeads":
        setKvHeads(next);
        break;
      case "headDim":
        setHeadDim(next);
        break;
      case "context":
        setContext(next);
        break;
    }
  }

  // 候補面を出しているか(選択のみの項目は常に候補面)。
  const choosingCandidate =
    isCandidateField(active) && mode[active] === "choose";
  // 数字が打てる面か。**選択のみの項目と、候補面を出している項目では
  // 打てない。**
  const numberField =
    active === "layers" ||
    (isCandidateField(active) && mode[active] === "manual");

  /** いま出す面。項目行 + (候補面 or 数字面)。 */
  function sectionsFor(): KeypadSection<LlmKeyToken>[] {
    if (active === "weight" || active === "kvPrecision") {
      return [LLM_FIELD_SECTION, CANDIDATE_SECTIONS[active]];
    }
    if (active === "layers") {
      return [LLM_FIELD_SECTION, llmPad("layers")];
    }
    return [
      LLM_FIELD_SECTION,
      choosingCandidate ? CANDIDATE_SECTIONS[active] : llmPad(active),
    ];
  }

  /** いま押せないキー。DEL は数字面以外で無効。単位は parameters だけ、
   * かつ下る向きにしか置けない(設計書 §5・§4)。 */
  function keyDisabled(token: LlmKeyToken): boolean {
    if (token === "del") return !numberField;
    if (token === "unit:b") return !numberField || !canPushUnit(parameters, B);
    if (token === "unit:m") return !numberField || !canPushUnit(parameters, M);
    return false;
  }

  /** トグルとして押されているキー。数字・候補値は undefined(トグルではない)。 */
  function keyPressed(token: LlmKeyToken): boolean | undefined {
    if (token.startsWith("field:")) return token === `field:${active}`;
    if (token.startsWith("precision:")) {
      if (active === "weight") return token === `precision:${weight}`;
      if (active === "kvPrecision") return token === `precision:${kvPrecision}`;
    }
    return undefined;
  }

  function press(token: LlmKeyToken): void {
    if (token.startsWith("field:")) {
      setActive(token.slice("field:".length) as LlmField);
      return;
    }
    if (token.startsWith("param:")) {
      setParameters(fromDigits(token.slice("param:".length)));
      return;
    }
    if (token.startsWith("heads:")) {
      setKvHeads(fromDigits(token.slice("heads:".length)));
      return;
    }
    if (token.startsWith("dim:")) {
      setHeadDim(fromDigits(token.slice("dim:".length)));
      return;
    }
    if (token.startsWith("ctx:")) {
      setContext(fromDigits(token.slice("ctx:".length)));
      return;
    }
    if (token.startsWith("precision:")) {
      const value = token.slice("precision:".length) as PrecisionToken;
      if (active === "weight") setWeight(value);
      else if (active === "kvPrecision") setKvPrecision(value);
      return;
    }
    if (token === "entry:manual") {
      // **手入力へ移るときは空から打ち始める。** DataScalePanel の次元数と
      // 違い、この 4 項目は候補を押さなくても既定値が入っている——候補の
      // 続きに数字を足すのではなく、「新しく打つ」が手入力の意味である
      // (候補を選び直したいだけなら「選択」で戻ればよい。値はそちらでは
      // 消さない)。
      if (isCandidateField(active)) {
        setMode((current) => ({ ...current, [active]: "manual" }));
        setEntryOf(active, EMPTY);
      }
      return;
    }
    if (token === "entry:choose") {
      if (isCandidateField(active)) {
        setMode((current) => ({ ...current, [active]: "choose" }));
      }
      return;
    }
    if (token.startsWith("digit:")) {
      if (numberField) {
        setEntryOf(
          active as EntryField,
          pushDigit(
            entryOf(active as EntryField),
            token.slice("digit:".length),
          ),
        );
      }
      return;
    }
    switch (token) {
      case "zeros3":
        if (numberField) {
          let next = entryOf(active as EntryField);
          for (const _ of [0, 1, 2]) next = pushDigit(next, "0");
          setEntryOf(active as EntryField, next);
        }
        break;
      case "unit:b":
      case "unit:m": {
        if (!numberField) break;
        const unit = token === "unit:b" ? B : M;
        // 盤面は押せないようにしてあるので、null はここに来ない(設計書 §4)。
        const next = pushUnit(parameters, unit);
        if (next !== null) setParameters(next);
        break;
      }
      case "del":
        if (numberField) {
          setEntryOf(
            active as EntryField,
            backspace(entryOf(active as EntryField)),
          );
        }
        break;
      case "ac":
        // AC はいま打っている項目を最初に戻す。選択のみの項目は既定の
        // 精度へ、数値の項目は空に戻す(DataScalePanel/FinancePanel と
        // 同じ規律——既定値は「候補を選んだのと同じ状態」であって、
        // AC が守る不変ではない)。
        if (active === "weight") setWeight(DEFAULT_PRECISION);
        else if (active === "kvPrecision") setKvPrecision(DEFAULT_PRECISION);
        else setEntryOf(active as EntryField, EMPTY);
        break;
    }
  }

  /** 項目の、打った通りの表示値。選択のみの項目は精度の文字を大文字で。 */
  function typedIn(field: LlmField): string {
    if (field === "weight") return weight.toUpperCase();
    if (field === "kvPrecision") return kvPrecision.toUpperCase();
    return text(entryOf(field as EntryField));
  }

  // 結果は保持しない。打った通りの文字列をコアに評価させる
  // (設計書 訂正 2)。**パラメータ数だけ `params` 単位表**(`B`=10⁹/`M`=10⁶)、
  // 他は単位を持たないので `none`(申し送り 2)。
  function evaluate(entry: Entry, unitSet: "params" | "none") {
    const typed = text(entry);
    if (typed === "" || expr === null) return { value: "", error: null };
    const r = expr.integer(typed, MAX_COUNT, unitSet);
    return { value: r.value ?? "", error: r.error };
  }

  const parametersResult = evaluate(parameters, "params");
  const layersResult = evaluate(layers, "none");
  const kvHeadsResult = evaluate(kvHeads, "none");
  const headDimResult = evaluate(headDim, "none");
  const contextResult = evaluate(context, "none");

  // **式が壊れていたら、そこで止めて言う。** 黙って中立に戻ると、打った人は
  // 何も起きない画面を見ることになる(設計書 §8)。
  const exprError =
    parametersResult.error ??
    layersResult.error ??
    kvHeadsResult.error ??
    headDimResult.error ??
    contextResult.error ??
    null;

  // **層数が埋まるまで答えを出さない**(コントローラの裁定 3)。他の項目は
  // 既定値を持つので、この 1 つが揃った瞬間に答えが出る。
  const allFilled =
    !isEmpty(parameters) &&
    !isEmpty(layers) &&
    !isEmpty(kvHeads) &&
    !isEmpty(headDim) &&
    !isEmpty(context);

  const shown =
    calc && allFilled
      ? calc.llm(
          parametersResult.value,
          weight,
          layersResult.value,
          kvHeadsResult.value,
          headDimResult.value,
          contextResult.value,
          kvPrecision,
        )
      : null;

  // main は合計の 主 → 副 → bytes の順に繰り上げる(設計書 §6)。**この
  // 参照は下の結果欄の行とは別に持つ**——赤確認(Step 8)がここではなく
  // 行の側を狙い撃てるようにするため。
  const totalDecimal = shown?.total?.decimal ?? null;
  const totalBinary = shown?.total?.binary ?? null;
  const first = primary === "decimal" ? totalDecimal : totalBinary;
  const second = primary === "decimal" ? totalBinary : totalDecimal;
  const answer = exprError
    ? "Math ERROR"
    : shown?.error
      ? "Math ERROR"
      : (first ??
        second ??
        (shown?.total?.bytesGrouped
          ? `${shown.total.bytesGrouped} bytes`
          : ""));

  // 入力の一覧。**打っている項目は大きく、入力済みは画面に残す**
  // (設計書 §2)。未入力の項目は出さない——層数が空のあいだは根拠にならない。
  const entries = FIELD_ORDER.map((field) => ({
    label: LLM_FIELD_LABELS[field],
    value: typedIn(field),
    active: field === active,
  })).filter((entry) => entry.active || entry.value !== "");

  return (
    <section className={styles.panel} aria-label="LLM のメモリ計算">
      <Readout
        entries={entries}
        main={answer}
        error={exprError ?? shown?.error ?? null}
        status={[
          {
            testId: "llm-primary",
            ariaLabel: "主に表示する単位系",
            text: PRIMARY_STATUS[primary],
          },
          {
            testId: "llm-field",
            ariaLabel: "入力中の項目",
            text: `${LLM_FIELD_LABELS[active]}を入力中`,
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
        <div className={styles.result} data-testid="llm-result">
          {byteRow("llm-weight-bytes", "重み", shown.weight)}
          {byteRow("llm-kv-bytes", "KV cache", shown.kv)}
          {byteRow("llm-total-bytes", "合計", shown.total)}
        </div>
      )}
      {/* 免責は常設(Finance の免責と同じ扱い)。エラーではないので
          alert にしない(コントローラの裁定 5)。**設計書 §21 のリストを
          写さない**——この実装は KV cache を計算に入れているので、
          「追加で必要になるもの」に KV cache を挙げると画面が自分に
          ついて嘘をつく(spec §5)。 */}
      <div className={styles.notice} data-testid="llm-notice">
        <p>表示しているのは理論値です。</p>
        <p>実際に必要なメモリはこれより大きくなります。</p>
        <p>
          一時バッファ・実行時のオーバーヘッド・量子化のメタデータが加わります。
        </p>
      </div>
    </section>
  );
}

/** 結果欄の 1 行(バイト数・10 進・2 進、spec §5 の形)。 */
function byteRow(testId: string, label: string, lines: ByteLines | null) {
  if (!lines) return null;
  return (
    <p className={styles.line} key={testId}>
      <span className={styles.lineLabel}>{label}</span>
      <span data-testid={testId}>{lines.bytesGrouped} bytes</span>
      {lines.decimal !== null && (
        <span className={styles.secondary}>{lines.decimal}</span>
      )}
      {lines.binary !== null && (
        <span className={styles.secondary}>{lines.binary}</span>
      )}
    </p>
  );
}

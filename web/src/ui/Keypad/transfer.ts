import type {
  BandwidthUnitToken,
  DurationUnitToken,
} from "../../datascale/types";
import {
  BANDWIDTH_UNIT_TOKENS,
  DURATION_UNIT_TOKENS,
} from "../../datascale/types";
import type { KeyDef, KeypadSection } from "./types";

/**
 * Data Transfer のキー集合。
 *
 * 項目は 4 つ(帯域幅の値・帯域幅の単位・時間の値・時間の単位。spec §4.4)。
 * **値は手入力、単位は選択面**である。骨格は `dataScale.ts` / `llm.ts` と
 * 同じ——DEL・AC の位置、恒久の空きの扱い、数字面と単位面が同じ 5 列 × 5 行の
 * 枠に載ることを踏襲する(設計書 §4.2)。
 *
 * **トークンの一覧は `datascale/types.ts` から起こす。** 綴りはコアの
 * `data_scale::transfer` の `from_token`/`token` が正で、ここで手で写すと
 * いつか片方だけずれる。
 */
export type TransferField =
  | "bandwidth"
  | "bandwidthUnit"
  | "duration"
  | "durationUnit";

/** 数を打つ項目(単位の項目は選択しか受けない)。 */
export type TransferValueField = "bandwidth" | "duration";

export type TransferKeyToken =
  | "digit:0"
  | "digit:1"
  | "digit:2"
  | "digit:3"
  | "digit:4"
  | "digit:5"
  | "digit:6"
  | "digit:7"
  | "digit:8"
  | "digit:9"
  | "zeros3"
  | "del"
  | "ac"
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "lparen"
  | "rparen"
  | "eq"
  | `field:${TransferField}`
  | `bandwidth:${BandwidthUnitToken}`
  | `duration:${DurationUnitToken}`;

/** 項目の表示名(項目行のラベル・表示欄の見出しに使う)。 */
export const TRANSFER_FIELD_LABELS: Record<TransferField, string> = {
  bandwidth: "帯域幅",
  bandwidthUnit: "帯域幅の単位",
  duration: "時間",
  durationUnit: "時間の単位",
};

/** 項目ごとの読み上げ名。手入力できる項目は「〜を入力」、選択だけの項目は
 * 「〜を選ぶ」(`dataScale.ts` の FIELDS・`llm.ts` の流儀)。 */
const FIELD_ARIA_LABELS: Record<TransferField, string> = {
  bandwidth: "帯域幅を入力",
  bandwidthUnit: "帯域幅の単位を選ぶ",
  duration: "時間を入力",
  durationUnit: "時間の単位を選ぶ",
};

/**
 * 単位の表示。**トークンは小文字、画面の文字は SI の慣習**である
 * (`k` は小文字、`M`・`G` は大文字。spec §3.5)。`Record` にしてあるので、
 * トークンが増えればここが型で落ちる。
 */
export const BANDWIDTH_UNIT_LABELS: Record<BandwidthUnitToken, string> = {
  bps: "bps",
  kbps: "kbps",
  mbps: "Mbps",
  gbps: "Gbps",
};

export const DURATION_UNIT_LABELS: Record<DurationUnitToken, string> = {
  second: "秒",
  minute: "分",
  hour: "時",
  day: "日",
};

/** 項目行に並べる順(spec §4.4 の 4 項目)。 */
const FIELD_ORDER: TransferField[] = [
  "bandwidth",
  "bandwidthUnit",
  "duration",
  "durationUnit",
];

const RESERVED: KeyDef<TransferKeyToken> = {
  token: null,
  label: "—",
  ariaLabel: "空き",
  variant: "function",
};

const DEL: KeyDef<TransferKeyToken> = {
  token: "del",
  label: "DEL",
  ariaLabel: "1文字消去",
  variant: "danger",
};

const AC: KeyDef<TransferKeyToken> = {
  token: "ac",
  label: "AC",
  ariaLabel: "この項目を消去",
  variant: "danger",
};

/** 項目行。**4 列 × 1 段 = 4 セル**で、恒久の空きは無い(spec §4.4)。 */
export const TRANSFER_FIELD_SECTION: KeypadSection<TransferKeyToken> = {
  ariaLabel: "入力する項目",
  columns: 4,
  height: "half",
  keys: FIELD_ORDER.map((field) => ({
    token: `field:${field}` as TransferKeyToken,
    label: TRANSFER_FIELD_LABELS[field],
    ariaLabel: FIELD_ARIA_LABELS[field],
    variant: "function" as const,
  })),
};

/**
 * 単位の面を組む。**先頭行の 4・5 番目は DEL・AC**(数字面と同じ位置)。
 * 残りは 1 行あたり 3 セルに候補を詰め、行の 4・5 列目は恒久の空き
 * (`llm.ts` の `buildCandidateFace` と同じ配り方)。
 *
 * **単位キーはラベルと読み上げが同じ**——`Mbps` は画面でも声でも `Mbps`
 * である(数を隠す `8K` のような候補ではない)。
 */
function buildUnitFace(
  ariaLabel: string,
  content: readonly KeyDef<TransferKeyToken>[],
): KeypadSection<TransferKeyToken> {
  const keys: KeyDef<TransferKeyToken>[] = [];
  let index = 0;
  let firstRow = true;
  do {
    const row: KeyDef<TransferKeyToken>[] = [];
    for (let col = 0; col < 3; col += 1) {
      const item = content[index];
      if (item !== undefined) {
        row.push(item);
        index += 1;
      } else {
        row.push(RESERVED);
      }
    }
    if (firstRow) {
      row.push(DEL, AC);
      firstRow = false;
    } else {
      row.push(RESERVED, RESERVED);
    }
    keys.push(...row);
  } while (index < content.length);
  return { ariaLabel, columns: 5, height: "square", keys };
}

/** 単位の面。**並びと顔ぶれはトークンの一覧が決める**(手で並べない)。 */
export const BANDWIDTH_UNIT_SECTION: KeypadSection<TransferKeyToken> =
  buildUnitFace(
    "帯域幅の単位のキー",
    BANDWIDTH_UNIT_TOKENS.map((token) => ({
      token: `bandwidth:${token}` as TransferKeyToken,
      label: BANDWIDTH_UNIT_LABELS[token],
      ariaLabel: BANDWIDTH_UNIT_LABELS[token],
      variant: "function" as const,
    })),
  );

export const DURATION_UNIT_SECTION: KeypadSection<TransferKeyToken> =
  buildUnitFace(
    "時間の単位のキー",
    DURATION_UNIT_TOKENS.map((token) => ({
      token: `duration:${token}` as TransferKeyToken,
      label: DURATION_UNIT_LABELS[token],
      ariaLabel: DURATION_UNIT_LABELS[token],
      variant: "function" as const,
    })),
  );

/**
 * 数字面。Data Scale の `PAD` と同じ並び(設計書 §4)。
 *
 * **単位キーは置かない。** 帯域幅も時間も単位は別の項目が持っており、
 * `K`/`M`/`G` を数の後ろに付ける入口は無い(だから式の単位表も `none`)。
 * その 3 スロットと 5 行 3 列目は恒久の空きである。
 */
export const TRANSFER_PAD: KeypadSection<TransferKeyToken> = {
  ariaLabel: "数字と演算のキー",
  columns: 5,
  height: "square",
  keys: [
    { token: "lparen", label: "(", ariaLabel: "開き括弧", variant: "function" },
    { token: "rparen", label: ")", ariaLabel: "閉じ括弧", variant: "function" },
    RESERVED,
    DEL,
    AC,

    { token: "digit:7", label: "7", ariaLabel: "7", variant: "digit" },
    { token: "digit:8", label: "8", ariaLabel: "8", variant: "digit" },
    { token: "digit:9", label: "9", ariaLabel: "9", variant: "digit" },
    { token: "div", label: "÷", ariaLabel: "割る", variant: "operator" },
    RESERVED,

    { token: "digit:4", label: "4", ariaLabel: "4", variant: "digit" },
    { token: "digit:5", label: "5", ariaLabel: "5", variant: "digit" },
    { token: "digit:6", label: "6", ariaLabel: "6", variant: "digit" },
    { token: "mul", label: "×", ariaLabel: "掛ける", variant: "operator" },
    RESERVED,

    { token: "digit:1", label: "1", ariaLabel: "1", variant: "digit" },
    { token: "digit:2", label: "2", ariaLabel: "2", variant: "digit" },
    { token: "digit:3", label: "3", ariaLabel: "3", variant: "digit" },
    { token: "sub", label: "−", ariaLabel: "引く", variant: "operator" },
    RESERVED,

    { token: "digit:0", label: "0", ariaLabel: "0", variant: "digit" },
    { token: "zeros3", label: "000", ariaLabel: "3桁のゼロ", variant: "digit" },
    RESERVED,
    { token: "add", label: "+", ariaLabel: "足す", variant: "operator" },
    { token: "eq", label: "=", ariaLabel: "計算する", variant: "operator" },
  ],
};

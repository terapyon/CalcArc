import type { PrecisionToken } from "../../datascale/types";
import { PRECISION_TOKENS } from "../../datascale/types";
import type { KeyDef, KeypadSection } from "./types";

/**
 * LLM メモリ計算のキー集合。
 *
 * 項目行(7 項目)と、項目ごとの候補面・数字面を持つ。**盤面の意味(どの面が
 * いつ出るか)は Task 9(LLM パネル)の仕事**——ここはデータだけである。
 *
 * 先例は `dataScale.ts`。DEL・AC の位置、恒久の空きの扱い、数字面と候補面が
 * 同じ 5 列 × 5 行の枠に載ることを踏襲する(設計書 §4.2、§4.3)。
 */
export type LlmField =
  | "parameters"
  | "weight"
  | "layers"
  | "kvHeads"
  | "headDim"
  | "context"
  | "kvPrecision";

/**
 * 候補の実数値(spec §4.3)。**ラベル・読み上げ・トークンはここから起こす**
 * ——手で 3 つ並べると、いつか 1 つだけずれる(赤確認が見張っている)。
 *
 * パラメータ数の `B` は 10⁹、文脈長の `K`/`M` は 1024/1024²。**同じ字が
 * 2 つの意味を持つので、値は展開済みで持つ**(設計書 §4.3)。
 */
export const CANDIDATE_VALUES = {
  parameters: [
    1_000_000_000, 3_000_000_000, 7_000_000_000, 8_000_000_000, 14_000_000_000,
    27_000_000_000, 32_000_000_000, 70_000_000_000,
  ],
  kvHeads: [1, 2, 4, 8, 16, 32],
  headDim: [64, 80, 96, 128, 256],
  context: [2048, 4096, 8192, 16384, 32768, 131072, 1048576],
} as const;

type ParamValue = (typeof CANDIDATE_VALUES)["parameters"][number];
type KvHeadsValue = (typeof CANDIDATE_VALUES)["kvHeads"][number];
type HeadDimValue = (typeof CANDIDATE_VALUES)["headDim"][number];
type ContextValue = (typeof CANDIDATE_VALUES)["context"][number];

/**
 * 精度の面だけは値ではなくトークンの一覧を持つ(コントローラの裁定 2)。
 * 重みは `PRECISION_TOKENS` の 5 つそのまま。KV は 4 つ——**`int4` は
 * KV cache には出さない**(spec §4.3 の候補表)。**コアは 5 つとも受ける**が、
 * 盤面が出す並びはここで決める。
 */
const WEIGHT_PRECISION_CANDIDATES: readonly PrecisionToken[] = PRECISION_TOKENS;
const KV_PRECISION_CANDIDATES: readonly PrecisionToken[] = [
  "fp16",
  "bf16",
  "fp32",
  "int8",
];

export type LlmKeyToken =
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
  | "unit:m"
  | "unit:b"
  | "del"
  | "ac"
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "lparen"
  | "rparen"
  | "eq"
  | `field:${LlmField}`
  | `param:${ParamValue}`
  | `heads:${KvHeadsValue}`
  | `dim:${HeadDimValue}`
  | `ctx:${ContextValue}`
  | `precision:${PrecisionToken}`
  | "entry:manual"
  | "entry:choose";

/** 項目の表示名(項目行のラベル・面の見出しに使う)。 */
export const LLM_FIELD_LABELS: Record<LlmField, string> = {
  parameters: "パラメータ数",
  weight: "重みの精度",
  layers: "層数",
  kvHeads: "KVヘッド数",
  headDim: "ヘッド次元",
  context: "文脈長",
  kvPrecision: "KVの精度",
};

/** 項目ごとの読み上げ名。手入力できる項目は「〜を入力」、選択だけの項目は
 * 「〜を選ぶ」(dataScale.ts の FIELDS の流儀)。 */
const FIELD_ARIA_LABELS: Record<LlmField, string> = {
  parameters: "パラメータ数を入力",
  weight: "重みの精度を選ぶ",
  layers: "層数を入力",
  kvHeads: "KVヘッド数を入力",
  headDim: "ヘッド次元を入力",
  context: "文脈長を入力",
  kvPrecision: "KVの精度を選ぶ",
};

/** 項目行に並べる順(spec §4.3 の表と同じ 4 列 × 2 段)。 */
const FIELD_ORDER: LlmField[] = [
  "parameters",
  "weight",
  "layers",
  "kvHeads",
  "headDim",
  "context",
  "kvPrecision",
];

const RESERVED: KeyDef<LlmKeyToken> = {
  token: null,
  label: "—",
  ariaLabel: "空き",
  variant: "function",
};

const DEL: KeyDef<LlmKeyToken> = {
  token: "del",
  label: "DEL",
  ariaLabel: "1文字消去",
  variant: "danger",
};

const AC: KeyDef<LlmKeyToken> = {
  token: "ac",
  label: "AC",
  ariaLabel: "この項目を消去",
  variant: "danger",
};

const MANUAL_ENTRY: KeyDef<LlmKeyToken> = {
  token: "entry:manual",
  label: "手入力",
  ariaLabel: "手入力",
  variant: "operator",
};

/** 項目行。**4 列 × 2 段 = 8 セル、7 項目 + 恒久の空き 1**(spec §4.3)。 */
export const LLM_FIELD_SECTION: KeypadSection<LlmKeyToken> = {
  ariaLabel: "入力する項目",
  columns: 4,
  height: "half",
  keys: [
    ...FIELD_ORDER.map((field) => ({
      token: `field:${field}` as LlmKeyToken,
      label: LLM_FIELD_LABELS[field],
      ariaLabel: FIELD_ARIA_LABELS[field],
      variant: "function" as const,
    })),
    RESERVED,
  ],
};

/** パラメータ数のラベル(`B` = 10⁹。spec §4.3)。 */
function paramLabel(value: number): string {
  return `${value / 1_000_000_000}B`;
}

/** 文脈長のラベル(`K` = 1024、`M` = 1024²。spec §4.3)。 */
function contextLabel(value: number): string {
  const mebi = 1024 * 1024;
  if (value >= mebi && value % mebi === 0) {
    return `${value / mebi}M`;
  }
  return `${value / 1024}K`;
}

/** 候補値 1 つぶんのキー。**ラベルはここでしか組まない**——ariaLabel は
 * 常に展開済みの数そのもの(赤確認 1 の対象)。 */
function valueKey(
  prefix: string,
  value: number,
  label: string,
): KeyDef<LlmKeyToken> {
  return {
    token: `${prefix}:${value}` as LlmKeyToken,
    label,
    ariaLabel: String(value),
    variant: "function",
  };
}

/** 精度候補 1 つぶんのキー。ラベルと読み上げは同じ(spec §4.3 の「同じ」)。 */
function precisionKey(token: PrecisionToken): KeyDef<LlmKeyToken> {
  const label = token.toUpperCase();
  return {
    token: `precision:${token}`,
    label,
    ariaLabel: label,
    variant: "function",
  };
}

/**
 * 候補面を組む。**先頭行の 4・5 番目は DEL・AC**(数字面と同じ位置)。
 * 残りは 1 行あたり 3 セルに候補を詰め、行の 4・5 列目は恒久の空き
 * (dataScale.ts の DIMENSIONS・TYPES と同じ配り方)。
 */
function buildCandidateFace(
  ariaLabel: string,
  content: readonly KeyDef<LlmKeyToken>[],
): KeypadSection<LlmKeyToken> {
  const keys: KeyDef<LlmKeyToken>[] = [];
  let index = 0;
  let firstRow = true;
  do {
    const row: KeyDef<LlmKeyToken>[] = [];
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

/** 候補面(spec §4.3、`layers` は候補を持たない項目なので含まれない)。 */
export const CANDIDATE_SECTIONS: Record<
  Exclude<LlmField, "layers">,
  KeypadSection<LlmKeyToken>
> = {
  parameters: buildCandidateFace("パラメータ数の候補キー", [
    ...CANDIDATE_VALUES.parameters.map((v) =>
      valueKey("param", v, paramLabel(v)),
    ),
    MANUAL_ENTRY,
  ]),
  weight: buildCandidateFace(
    "重みの精度のキー",
    WEIGHT_PRECISION_CANDIDATES.map((t) => precisionKey(t)),
  ),
  kvHeads: buildCandidateFace("KVヘッド数の候補キー", [
    ...CANDIDATE_VALUES.kvHeads.map((v) => valueKey("heads", v, String(v))),
    MANUAL_ENTRY,
  ]),
  headDim: buildCandidateFace("ヘッド次元の候補キー", [
    ...CANDIDATE_VALUES.headDim.map((v) => valueKey("dim", v, String(v))),
    MANUAL_ENTRY,
  ]),
  context: buildCandidateFace("文脈長の候補キー", [
    ...CANDIDATE_VALUES.context.map((v) => valueKey("ctx", v, contextLabel(v))),
    MANUAL_ENTRY,
  ]),
  kvPrecision: buildCandidateFace(
    "KVの精度のキー",
    KV_PRECISION_CANDIDATES.map((t) => precisionKey(t)),
  ),
};

/**
 * 数字面。Data Scale の `PAD` と同じ並び(設計書 §4)。
 *
 * - 単位スロット(`G`・`M`・`K` の位置)は `parameters` のときだけ
 *   `unit:b`・`unit:m` が立つ。`B` は既存の `G` と係数が同じなので、同じ
 *   読み上げ「十億」を使う(spec §4.3)。第 3 のスロット(`K` の位置)は
 *   どの項目にも対応する単位が無いので常に予約。
 * - 5 行 3 列目は、候補面を持つ項目(`layers` 以外)のときだけ
 *   `entry:choose`。
 */
export function llmPad(field: LlmField): KeypadSection<LlmKeyToken> {
  const isParameters = field === "parameters";
  const hasCandidateFace = field !== "layers";

  return {
    ariaLabel: "数字と演算のキー",
    columns: 5,
    height: "square",
    keys: [
      {
        token: "lparen",
        label: "(",
        ariaLabel: "開き括弧",
        variant: "function",
      },
      {
        token: "rparen",
        label: ")",
        ariaLabel: "閉じ括弧",
        variant: "function",
      },
      RESERVED,
      DEL,
      AC,

      { token: "digit:7", label: "7", ariaLabel: "7", variant: "digit" },
      { token: "digit:8", label: "8", ariaLabel: "8", variant: "digit" },
      { token: "digit:9", label: "9", ariaLabel: "9", variant: "digit" },
      { token: "div", label: "÷", ariaLabel: "割る", variant: "operator" },
      isParameters
        ? {
            token: "unit:b",
            label: "B",
            ariaLabel: "十億",
            variant: "operator",
          }
        : RESERVED,

      { token: "digit:4", label: "4", ariaLabel: "4", variant: "digit" },
      { token: "digit:5", label: "5", ariaLabel: "5", variant: "digit" },
      { token: "digit:6", label: "6", ariaLabel: "6", variant: "digit" },
      { token: "mul", label: "×", ariaLabel: "掛ける", variant: "operator" },
      isParameters
        ? {
            token: "unit:m",
            label: "M",
            ariaLabel: "百万",
            variant: "operator",
          }
        : RESERVED,

      { token: "digit:1", label: "1", ariaLabel: "1", variant: "digit" },
      { token: "digit:2", label: "2", ariaLabel: "2", variant: "digit" },
      { token: "digit:3", label: "3", ariaLabel: "3", variant: "digit" },
      { token: "sub", label: "−", ariaLabel: "引く", variant: "operator" },
      RESERVED,

      { token: "digit:0", label: "0", ariaLabel: "0", variant: "digit" },
      {
        token: "zeros3",
        label: "000",
        ariaLabel: "3桁のゼロ",
        variant: "digit",
      },
      hasCandidateFace
        ? {
            token: "entry:choose",
            label: "選択",
            ariaLabel: "候補から選ぶ",
            variant: "operator",
          }
        : RESERVED,
      { token: "add", label: "+", ariaLabel: "足す", variant: "operator" },
      { token: "eq", label: "=", ariaLabel: "計算する", variant: "operator" },
    ],
  };
}

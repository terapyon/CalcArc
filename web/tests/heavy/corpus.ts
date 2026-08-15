import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** 許容誤差。**値はコーパスの JSON が持つ**(CLAUDE.md の規約)。 */
export interface Tolerance {
  abs: number;
  rel: number;
}

export interface ValueCase {
  kind: "value";
  id: string;
  mode: string;
  keys: string[];
  expr: string;
  expect: { re: number; im: number };
}

/**
 * 期待値を持たないケース。二つのキー列が同じ表示に着くことだけを主張する。
 * Python が介在しないので、比較は corpus.spec.ts が実ブラウザ上で行う。
 */
export interface EquivalenceCase {
  kind: "equivalence";
  id: string;
  mode: string;
  left: string[];
  right: string[];
}

export type CorpusCase = ValueCase | EquivalenceCase;

export interface Shard {
  schema: number;
  generated_by: string;
  tolerance: Tolerance;
  cases: CorpusCase[];
}

// web/tests/heavy/ から見たリポジトリ直下。package.json が type: module
// なので __dirname は無い。
const HERE = fileURLToPath(new URL(".", import.meta.url));
const CORPUS = join(HERE, "..", "..", "..", "corpus", "generated");

/**
 * このコーパスが踏む角度モード。段階 2 は Deg だけである。
 * ハーネスは `engine.initial()` から始めて `angle_toggle` を一度も押さない
 * ——通っているのは engine の既定が Deg だからで、宣言と一致しているからでは
 * ない。段階 3 で `angle_toggle` の前置に置き換わるまで、その一致を大きな声で
 * 検査しておく(レビュー修正ラウンド 2)。
 */
export const SUPPORTED_MODE = "Deg";

export function assertSupportedMode(name: string, cases: CorpusCase[]): void {
  const others = cases.filter((c) => c.mode !== SUPPORTED_MODE);
  if (others.length > 0) {
    const ids = others.slice(0, 5).map((c) => `${c.id} (${c.mode})`);
    throw new Error(
      `${name}: this stage runs every case in ${SUPPORTED_MODE} only, but ` +
        `${others.length} case(s) declare another mode: ${ids.join(", ")}. ` +
        "The harness never presses angle_toggle, so those cases would be " +
        "silently evaluated in the engine's default mode.",
    );
  }
}

export function loadShards(): { name: string; shard: Shard }[] {
  return readdirSync(CORPUS)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({
      name,
      shard: JSON.parse(readFileSync(join(CORPUS, name), "utf-8")) as Shard,
    }));
}

/**
 * 絶対誤差と相対誤差のどちらかに収まれば一致とみなす。
 * generate.py の tolerance が abs / rel の対である以上、読み方も対にする。
 */
export function withinTolerance(
  actual: number,
  expected: number,
  tolerance: Tolerance,
): boolean {
  const difference = Math.abs(actual - expected);
  if (difference <= tolerance.abs) {
    return true;
  }
  const scale = Math.abs(expected);
  return scale > 0 && difference / scale <= tolerance.rel;
}

/**
 * 実効的な相対許容の帯。**許容誤差ではない。**
 *
 * ここに並ぶ数は判定に一切使われず、報告書で件数を並べるための目盛りである
 * (合否を決める値は corpus の JSON が持つ——CLAUDE.md の規約)。目盛りを
 * コードに置くのは、報告書の帯を機械が数えられるようにするためである。
 */
export const BAND_EDGES = [1e-9, 1e-7, 1e-5] as const;

export type ToleranceBand =
  /** 実効的な相対許容が rel そのもの。表示分解能どおりに検査した。 */
  | "display"
  | "1e-9"
  | "1e-7"
  | "1e-5"
  | "worse"
  /** 期待値が厳密に 0。相対誤差も相対許容も数学的に定義できない。 */
  | "undefined";

export const TOLERANCE_BANDS: ToleranceBand[] = [
  "display",
  "1e-9",
  "1e-7",
  "1e-5",
  "worse",
  "undefined",
];

export interface Classification {
  passed: boolean;
  absoluteError: number;
  /** 期待値が 0 のときは定義できない。その場合は 0 を入れ、bucket が "undefined" になる。 */
  relativeError: number;
  /**
   * **OR 判定が実際に許している相対誤差の上限。**
   *
   * `withinTolerance` は abs と rel の OR なので、|期待値| が 1 未満のとき
   * abs の側が常に緩い方になり、実効的な相対許容は `abs / |期待値|` まで
   * 広がる。この値を集計しないと、報告書の「表示される桁まで正しい」が
   * 実態より強い主張になる(レビュー修正ラウンド 2)。
   * 期待値が 0 のときは Infinity——相対の保証が全く無いという意味である。
   */
  effectiveRelTolerance: number;
  bucket: ToleranceBand;
}

/**
 * 1 件の比較を、合否と「どこまでの精度で検査したか」の両方に落とす。
 *
 * **値ケースと同値ケースの両方がこれを通る。** 比較を二箇所に書くと、
 * 片方だけ直す事故が必ず起きる(実際、レビュー修正ラウンド 2 の指摘 3・4 は
 * どちらも両方の修正を要求していた)。段階 3 で両者は分岐するので、
 * ここは分岐しない部分——1 件の数値比較——だけを持つ。
 */
export function classify(
  actual: number,
  expected: number,
  tolerance: Tolerance,
): Classification {
  const absoluteError = Math.abs(actual - expected);
  const scale = Math.abs(expected);
  const passed = withinTolerance(actual, expected, tolerance);
  if (scale === 0) {
    return {
      passed,
      relativeError: 0,
      absoluteError,
      effectiveRelTolerance: Number.POSITIVE_INFINITY,
      bucket: "undefined",
    };
  }
  const effectiveRelTolerance = Math.max(tolerance.rel, tolerance.abs / scale);
  return {
    passed,
    absoluteError,
    relativeError: absoluteError / scale,
    effectiveRelTolerance,
    bucket: bandOf(effectiveRelTolerance, tolerance.rel),
  };
}

function bandOf(effective: number, rel: number): ToleranceBand {
  if (effective <= rel) {
    return "display";
  }
  const [tight, middle, loose] = BAND_EDGES;
  if (effective <= tight) {
    return "1e-9";
  }
  if (effective <= middle) {
    return "1e-7";
  }
  if (effective <= loose) {
    return "1e-5";
  }
  return "worse";
}

/** 演算子と関数の出現を数える対象。数字キーと括弧は別に扱う。 */
const SHAPE_TOKENS = [
  "add",
  "sub",
  "mul",
  "div",
  "sqrt",
  "sqr",
  "sin",
  "cos",
  "tan",
  "neg",
] as const;

export interface ShapeSummary {
  /** 集計に使ったキー列の本数。同値シャードは左右の両方を数える。 */
  sequences: number;
  /** 演算子・関数ごとの出現回数。 */
  tokens: Record<string, number>;
  /** 括弧の最大深さ → その深さのキー列の本数。 */
  depths: Record<string, number>;
}

/**
 * コーパスが実際にどんな形を踏んでいるかを数える。
 *
 * 設計書 §11 は「分布そのものを報告書に載せて、外から検証可能にする」と
 * 書いている。総件数と不一致 0 だけでは、同じような式を大量に試しただけ
 * かどうかを外から判定できない。
 */
export function summarizeShape(sequences: string[][]): ShapeSummary {
  const tokens: Record<string, number> = {};
  for (const token of SHAPE_TOKENS) {
    tokens[token] = 0;
  }
  const depths: Record<string, number> = {};
  for (const keys of sequences) {
    let depth = 0;
    let deepest = 0;
    for (const key of keys) {
      if (key === "lparen") {
        depth += 1;
        deepest = Math.max(deepest, depth);
      } else if (key === "rparen") {
        depth -= 1;
      } else if (Object.hasOwn(tokens, key)) {
        tokens[key] = (tokens[key] ?? 0) + 1;
      }
    }
    depths[String(deepest)] = (depths[String(deepest)] ?? 0) + 1;
  }
  return { sequences: sequences.length, tokens, depths };
}

export interface Quantiles {
  count: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
}

/** 大きさの分位。最近傍順位法——補間しないので、必ず実在の観測値が出る。 */
export function quantiles(values: number[]): Quantiles {
  if (values.length === 0) {
    return { count: 0, min: 0, p25: 0, median: 0, p75: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number): number => {
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(fraction * sorted.length) - 1),
    );
    return sorted[index] ?? 0;
  };
  return {
    count: sorted.length,
    min: at(0),
    p25: at(0.25),
    median: at(0.5),
    p75: at(0.75),
    max: at(1),
  };
}

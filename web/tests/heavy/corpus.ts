import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { KEY_TOKENS } from "../../src/calc/types";

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

/**
 * このコードが読み方を知っているシャードの版。`Shard.schema` はいままで型に
 * 宣言されているだけで一度も読まれていなかった——宣言してあるのに読まないと、
 * 生成器が形を変えても読む側は黙って古い読み方を続ける。
 */
export const KNOWN_SCHEMA = 1;

/** 実行できるケースの種別。ここに無い `kind` は黙って捨てずに落とす。 */
export const CASE_KINDS = ["value", "equivalence"] as const;

/**
 * 許容誤差の**正気の上限**。
 *
 * これは合否の閾値ではない。合否を決める値は corpus の JSON が持つ
 * (CLAUDE.md の規約)ままで、ここでするのは**その値が正気かを見る**ことだけ
 * である。敵対者レビュー(2026-08-15)は、コミット済み JSON の tolerance を
 * `{abs: 1e30, rel: 1e30}` に書き換えるだけで、期待値が桁違いでも全件緑に
 * できることを実証した。「許容誤差をテストコードに書かない」を守った結果、
 * 合否基準がデータ側に完全に移り、**そのデータを検査するものが無くなって
 * いた**。ここは閾値を決め打ちするのではなく、明らかに異常な範囲を弾く。
 *
 * 電卓の表示は有効数字 10 桁なので、表示分解能は 1e-10 級である。1e-6 は
 * それより 4 桁緩い——「この層が主張しうる精度の外」を弾くだけの、意図的に
 * 甘い上限である。
 */
export const TOLERANCE_CEILING = 1e-6;

/**
 * シャードを読んだ**その場で**検証する。
 *
 * 検証しないと、`kind` の綴りを一つ変えるだけでケースが警告も無く消え、
 * レポートの総件数からも消える(敵対者レビューが実証: 誤字 `kind: "vaue"` の
 * ケースを混ぜても緑、`cases: []` でも緑、全 `kind` を改名するとテストの本数が
 * 6 本から 5 本に減って全部緑)。**黙って減るより、うるさく落ちる。**
 */
export function assertShardIsSound(name: string, shard: Shard): void {
  if (shard.schema !== KNOWN_SCHEMA) {
    throw new Error(
      `${name}: schema ${JSON.stringify(shard.schema)} is not one this ` +
        `code knows how to read (expected ${KNOWN_SCHEMA}). Refusing to ` +
        "guess at the layout of a shard written by a different generator.",
    );
  }
  assertToleranceIsSane(name, shard.tolerance);
  if (!Array.isArray(shard.cases) || shard.cases.length === 0) {
    throw new Error(
      `${name}: the shard carries no cases. An empty shard runs green ` +
        "while verifying nothing, so it is refused here.",
    );
  }
  const kinds: ReadonlySet<string> = new Set(CASE_KINDS);
  // JSON は型宣言に従う保証が無い。ここは「宣言どおりでない値」を探す場所
  // なので、宣言より緩い形で読む。
  const declared = shard.cases as unknown as { id?: string; kind?: string }[];
  const strangers = declared.filter((c) => !kinds.has(c.kind ?? ""));
  if (strangers.length > 0) {
    const shown = strangers
      .slice(0, 5)
      .map((c) => `${c.id ?? "(no id)"} has kind ${JSON.stringify(c.kind)}`);
    throw new Error(
      `${name}: ${strangers.length} case(s) declare a kind this suite does ` +
        `not run: ${shown.join(", ")}. Cases that match neither ` +
        `${CASE_KINDS.map((k) => JSON.stringify(k)).join(" nor ")} would be ` +
        "dropped without a warning and would vanish from the report's total.",
    );
  }
}

/**
 * 許容誤差が正気の範囲にあるか。**閾値を決めるのではなく、データを見る。**
 * 0 以下(何も通らない/絶対値比較が死ぬ)も、`TOLERANCE_CEILING` より緩い
 * (この層が主張しうる精度の外)も弾く。
 */
export function assertToleranceIsSane(
  name: string,
  tolerance: Tolerance,
): void {
  const bad = (["abs", "rel"] as const).filter((field) => {
    const value = tolerance?.[field];
    return (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value <= 0 ||
      value > TOLERANCE_CEILING
    );
  });
  if (bad.length > 0) {
    throw new Error(
      `${name}: tolerance ${JSON.stringify(tolerance)} is outside the sane ` +
        `range for this layer — ${bad.join(" and ")} must be > 0 and ` +
        `<= ${TOLERANCE_CEILING}. A tolerance this loose would pass cases ` +
        "whose expected value is off by orders of magnitude.",
    );
  }
}

/**
 * シャードのケースを種別ごとに分ける。**分けた結果の合計が元の件数と一致
 * しないことがありえない形にする。**
 *
 * `filter` を二回書いてそれぞれ回す書き方だと、どちらにも当たらないケースが
 * 黙って消え、レポートの「総ケース数」がフィルタ後の合計になる。ここで
 * 合計を突き合わせておけば、`assertShardIsSound` を将来ゆるめても総数の
 * 嘘だけは通らない。
 */
export function partitionCases(
  name: string,
  cases: CorpusCase[],
): { values: ValueCase[]; equivalences: EquivalenceCase[] } {
  const values = cases.filter((c): c is ValueCase => c.kind === "value");
  const equivalences = cases.filter(
    (c): c is EquivalenceCase => c.kind === "equivalence",
  );
  if (values.length + equivalences.length !== cases.length) {
    throw new Error(
      `${name}: ${cases.length} case(s) in the shard but only ` +
        `${values.length + equivalences.length} were partitioned into a kind ` +
        "this suite runs. The report's total would understate the shard.",
    );
  }
  return { values, equivalences };
}

export function loadShards(): { name: string; shard: Shard }[] {
  const shards = readdirSync(CORPUS)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({
      name,
      shard: JSON.parse(readFileSync(join(CORPUS, name), "utf-8")) as Shard,
    }));
  for (const { name, shard } of shards) {
    assertShardIsSound(name, shard);
  }
  return shards;
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

/** 報告書の表に列として並べる演算子・関数。数字キーと括弧は別に扱う。 */
export const SHAPE_TOKENS = [
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
  /** 集計に使ったキー列の本数。 */
  sequences: number;
  /**
   * **全 KEY_TOKENS の出現回数。** 表に出すのは SHAPE_TOKENS だけだが、
   * ここは全キーを数える——「一度も押されていないキー」を実データから
   * 導くためである(手書きの否定は段階 3 で黙って嘘になる)。
   */
  tokens: Record<string, number>;
  /** 括弧の最大深さ → その深さのキー列の本数。 */
  depths: Record<string, number>;
}

function emptyTokenCounts(): Record<string, number> {
  const tokens: Record<string, number> = {};
  for (const token of KEY_TOKENS) {
    tokens[token] = 0;
  }
  return tokens;
}

/** キー列 1 本のトークン出現数。集計にも差分にも使う。 */
function countTokens(keys: string[]): Record<string, number> {
  const tokens: Record<string, number> = {};
  for (const key of keys) {
    tokens[key] = (tokens[key] ?? 0) + 1;
  }
  return tokens;
}

/**
 * コーパスが実際にどんな形を踏んでいるかを数える。
 *
 * 設計書 §11 は「分布そのものを報告書に載せて、外から検証可能にする」と
 * 書いている。総件数と不一致 0 だけでは、同じような式を大量に試しただけ
 * かどうかを外から判定できない。
 */
export function summarizeShape(sequences: string[][]): ShapeSummary {
  const tokens = emptyTokenCounts();
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
      }
      tokens[key] = (tokens[key] ?? 0) + 1;
    }
    depths[String(deepest)] = (depths[String(deepest)] ?? 0) + 1;
  }
  return { sequences: sequences.length, tokens, depths };
}

/**
 * **同値ケースの右辺が左辺に付け足したキー**を数える。
 *
 * 同値ケースの右辺は、左辺に `neg neg` / `sqrt sqr` / `add 0` のような
 * 恒等変換を被せて作られている。左右をまとめて数えると、**変換が注入した
 * キーが電卓の「式の多様性」として計上される**——実測では同値シャードの
 * `neg` 2122 回のうち 74.2%(1574 回)が注入分だった。分布表がそれを
 * 区別せずに出すと、「同じような式を大量に試しただけか」への回答が
 * 水増しになる(敵対者レビュー 2026-08-15 の指摘)。
 *
 * ケースごとに「右辺の出現数 − 左辺の出現数」を取り、増えた分だけを足す。
 */
export function countInjectedTokens(
  pairs: { left: string[]; right: string[] }[],
): Record<string, number> {
  const injected = emptyTokenCounts();
  for (const { left, right } of pairs) {
    const before = countTokens(left);
    const after = countTokens(right);
    for (const [token, count] of Object.entries(after)) {
      const added = count - (before[token] ?? 0);
      if (added > 0) {
        injected[token] = (injected[token] ?? 0) + added;
      }
    }
  }
  return injected;
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

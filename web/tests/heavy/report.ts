import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KEY_TOKENS } from "../../src/calc/types";
import type {
  Quantiles,
  ShapeSummary,
  Tolerance,
  ToleranceBand,
} from "./corpus";
import { SHAPE_TOKENS, TOLERANCE_BANDS } from "./corpus";

/**
 * 「何をいつ何で回したか」。外の人が判断する材料には、結果と同じくらい
 * これが要る(レビュー修正ラウンド 2)。
 */
export interface Provenance {
  ranAt: string;
  commit: string;
  /** 計算コア(wasm)の版。ハーネス経由で実際に走ったものから取る。 */
  coreVersion: string;
  browser: string;
}

export interface ShardSummary {
  name: string;
  total: number;
  values: number;
  equivalences: number;
  /** シャード自身が名乗る素性(生成器と版)。 */
  generatedBy: string;
  mismatches: string[];
  maxRelativeError: number;
  maxAbsoluteError: number;
  // 相対誤差(rel)が測定できた(期待値 ≠ 0)うえで rel の許容は超えたが、
  // 絶対誤差(abs)の許容には収まったケース。**精度限界の実例。**
  // 事前に整形済みの説明文字列を、corpus.spec.ts が詰める(mismatches と同じ流儀)。
  absOnlyCases: string[];
  // 期待値が厳密に 0 で、相対誤差が数学的に定義できない(0 除算になる)ケース。
  // absOnlyCases と混ぜて数えると「精度低下が n 件あった」という誤読を招くため、
  // 別に集計する(修正ラウンド 1 のレビュー指摘)。
  relUndefinedCases: string[];
  /**
   * **相対誤差を測定できたケース数**(期待値 ≠ 0)。
   * 0 のとき、最大相対誤差も最悪の実効相対許容も数学的に定義できない。
   * この件数を持たないと、相対の保証が一切無い走行が見出しで
   * 「0.00e+0 = 完璧に厳しい」と読める(敵対者レビュー 2026-08-15)。
   */
  relMeasured: number;
  /**
   * relUndefinedCases のうち、絶対誤差が 0 でなかった件数。
   * 「ほとんどは完全一致」を手書きせず、実測から書くために持つ。
   */
  relUndefinedNonZeroAbs: number;
  // **実際にどこまでの精度で検査したか。** abs/rel の OR は |期待値| < 1 の
  // ところで abs の側が緩い方になり、実効的な相対許容が rel より広がる。
  // 集計しないと報告書の主張が実態より強くなる(修正ラウンド 2)。
  looserThanDisplay: number;
  worstEffectiveRelTolerance: number;
  bands: Record<ToleranceBand, number>;
  // 設計書 §11 の「分布そのものを報告書に載せる」。
  // **同値シャードでは左辺のキー列だけ**を数えたもの。右辺が付け足した分は
  // addedByTransform に分ける(注入分を式の多様性として数えないため)。
  shape: ShapeSummary;
  /**
   * 同値ケースの右辺が左辺に付け足したキーの出現数。値シャードには無い。
   * 「電卓に与えた式の多様性」と「変換で足したキー」を読み手が区別できる
   * ようにするためだけに持つ(敵対者レビュー 2026-08-15 の指摘)。
   */
  addedByTransform?: Record<string, number>;
  magnitudes: Quantiles;
  tolerance: Tolerance;
}

const summaries: ShardSummary[] = [];

export function record(summary: ShardSummary): void {
  summaries.push(summary);
}

const BAND_LABELS: Record<ToleranceBand, string> = {
  display: "rel そのもの(表示分解能どおり)",
  "1e-9": "rel 超 〜 1e-9",
  "1e-7": "1e-9 超 〜 1e-7",
  "1e-5": "1e-7 超 〜 1e-5",
  worse: "1e-5 超",
  undefined: "定義できない(期待値が厳密に 0)",
};

function exponential(value: number): string {
  return Number.isFinite(value) ? value.toExponential(2) : "—";
}

/**
 * **相対の量は、測定できたケースが 1 件も無ければ数字を出さない。**
 *
 * 期待値が全部 0 の走行では、`corpus.spec.ts` が非有限を集計から外し、
 * 下の `Math.max(0, ...)` が 0 で下駄を履かせるので、見出しが
 * 「最悪の実効相対許容: 0.00e+0」——**完璧に厳しい**と読める形で出た。
 * 実際には相対の保証が一切無い走行である(敵対者レビュー 2026-08-15)。
 * 測定できた件数が 0 なら、0 ではなく「定義できない」と書く。
 */
function relativeQuantity(value: number, measured: number): string {
  return measured === 0 ? "定義できない" : exponential(value);
}

/**
 * 外の人が読んで「これなら大丈夫だ」と判断できる材料を出す。
 * **緑のチェックは何件どこまでの精度で確かめたかを答えない**(設計書 §8)。
 */
export function renderReport(
  entries: ShardSummary[],
  provenance: Provenance,
): string {
  if (entries.length === 0) {
    // 「総ケース数 0 / 不一致 0」は**緑に見える成果物**である。一件も回って
    // いないことと、全件通ったことが、同じ見た目になってはならない
    // (修正ラウンド 2)。
    throw new Error(
      "report: no shard was summarised — refusing to write a report that " +
        "would read as '0 cases, 0 mismatches' and look like a pass",
    );
  }
  const total = entries.reduce((sum, entry) => sum + entry.total, 0);
  const failed = entries.reduce(
    (sum, entry) => sum + entry.mismatches.length,
    0,
  );
  const absOnly = entries.reduce(
    (sum, entry) => sum + entry.absOnlyCases.length,
    0,
  );
  const relUndefined = entries.reduce(
    (sum, entry) => sum + entry.relUndefinedCases.length,
    0,
  );
  const looser = entries.reduce(
    (sum, entry) => sum + entry.looserThanDisplay,
    0,
  );
  const worstEffective = Math.max(
    0,
    ...entries.map((entry) => entry.worstEffectiveRelTolerance),
  );
  const maxRelativeError = Math.max(
    0,
    ...entries.map((entry) => entry.maxRelativeError),
  );
  const maxAbsoluteError = Math.max(
    0,
    ...entries.map((entry) => entry.maxAbsoluteError),
  );
  const relMeasured = entries.reduce(
    (sum, entry) => sum + entry.relMeasured,
    0,
  );
  // **経路ごとに分ける。** 合計 4000 を「二経路が同じ数に着くことを確かめた」
  // の直下に置くと、独立した二経路の証拠が 2 倍に見える。実際に Python が
  // 介在するのは値ケースだけで、同値ケースは電卓の自己整合しか見ていない
  // (敵対者レビュー 2026-08-15 の開示要求)。
  const valueCases = entries.reduce((sum, entry) => sum + entry.values, 0);
  const equivalenceCases = entries.reduce(
    (sum, entry) => sum + entry.equivalences,
    0,
  );
  const lines = [
    "# 重量級コーパスの実行結果",
    "",
    `- **二経路で照合したケース(値): ${valueCases}** ` +
      "— Rust の計算コアと Python の mpmath が独立に同じ数に着くことを確かめた件数",
    `- **電卓の自己整合を見たケース(同値): ${equivalenceCases}** ` +
      "— 二つのキー列の表示が一致することだけを確かめた件数。Python は介在しない",
    `- 合計: **${total}**`,
    `- 不一致: **${failed}**`,
    `- 観測された最大相対誤差: **${relativeQuantity(maxRelativeError, relMeasured)}**`,
    `- 観測された最大絶対誤差: **${exponential(maxAbsoluteError)}**`,
    `- 絶対誤差の側だけで通ったケース(精度限界の実例): **${absOnly}**`,
    `- 相対誤差が定義できないケース(期待値が厳密に 0): **${relUndefined}**`,
    `- **表示分解能より緩く検査されたケース: ${looser}** ` +
      `(全 ${total} 件中 ${((looser / total) * 100).toFixed(1)}%)`,
    `- **最悪の実効相対許容: ${relativeQuantity(worstEffective, relMeasured)}**`,
    "",
    "## 何をどう確かめたか",
    "",
    "**独立した二つの経路が関与するのは、値ケースの側だけである。**",
    "",
    "- **値ケース。** 1 件は同じ式の二つの表現を持つ。キー列(`lparen 3 add 4",
    "  rparen eq` のような、実際に押すボタンの列)は Rust の計算コアが wasm",
    "  として食べる。数式(`(3 + 4)`)は Python の mpmath が 50 桁の精度で",
    "  独立に評価し、その値がコーパスの `expect` に入っている。電卓の表示と",
    "  この期待値を突き合わせる。**参照実装は Rust の移植ではない**ので、",
    "  同じバグが両方に入って一致してしまうことがない。",
    "- **同値ケース。** 期待値を持たない。数学的に等しい二つのキー列",
    "  (`x` と `√(x²)`、`neg(neg(x))`、`x + 0`)の表示が一致することだけを",
    "  主張する。ここでは Python は介在せず、電卓が自分自身と矛盾しないことを見る。",
    "",
    "### 同値ケースが単独では捕まえられないもの",
    "",
    "**「二つのキー列が同じ表示に着く」は、定数を返すだけのものが自明に満たす。**",
    "どんなキー列にも `0` を返すだけの偽物に対して、同値ケースは全件通る",
    "(2026-08-15 の敵対者レビューが実際に偽ハーネスで通した)。これは同値",
    "ケースの欠陥ではなく**性質**である——自己整合の検査は、外の基準を持たない。",
    "",
    "**それを捕まえるのは値ケースの側である。** 同じ偽ハーネスに対して値ケースは",
    "2000 件中 1996 件が不一致になった。外の基準(Python が独立に出した期待値)を",
    "持っているのは値ケースだけなので、上の見出しでも件数を分けている。",
    "",
    "**同値ケースの誤差が全件厳密に 0 なのは、選んだ変換の帰結である。**",
    "`√(x²)`・`neg(neg(x))`・`x + 0` はいずれも f64 の上で厳密に往復する",
    "(平方根と二乗は同じ値に戻り、符号反転は 2 回で元に戻り、0 の加算は値を",
    "変えない)。したがって同値ケースの最大誤差 0 は**品質の証拠ではなく、",
    "選んだ形の必然**である。強い結果として読まないこと。丸めをまたぐ変換を",
    "入れれば 0 でなくなるが、そのときは「どこまで一致すべきか」の基準が別に",
    "要る——段階 3 の主題である。",
    "",
    "電卓から取れるのは整形済みの表示文字列(有効数字 10 桁)だけで、内部の",
    "倍精度の値を取り出す口は無い。比較はその文字列を数に戻して行う。",
    "表示が電卓の出す書式(符号つき十進、小数点、小文字 `e` の指数)でない",
    "ときは、黙って 0 や NaN にせず不一致として記録する——空文字列が 0 と",
    "して通る経路が、上の偽ハーネスが同値ケースを全件通せた理由の一つだった。",
    "",
    "## 何をいつ何で回したか",
    "",
    `- 実行日時: ${provenance.ranAt}`,
    `- コミット: \`${provenance.commit}\``,
    `- 計算コア(wasm): \`${provenance.coreVersion}\``,
    `- ブラウザ: ${provenance.browser}`,
    ...entries.map(
      (entry) => `- シャード \`${entry.name}\` の素性: ${entry.generatedBy}`,
    ),
    "",
    "値が大きいケースほど絶対誤差も大きく出るのが正常である(相対許容 rel が",
    "絶対値の大きい分だけ広い絶対誤差を許すため)。そのときの判断材料は",
    "相対誤差(rel)の側を見る。",
    "",
    "## 自分で確かめるには",
    "",
    "**この報告書を信じる必要はない。実物と手順がここにある。**",
    "",
    "- **コーパスの実物:** リポジトリ直下の `corpus/generated/*.json`。",
    "  コミットされている。1 件ずつが `id` / `mode` / キー列 / 数式 / 期待値を",
    "  平文で持つので、任意の 1 件を取り出して手で電卓に打ち込める。",
    "- **再現:** `cd web && pnpm heavy`(内部で wasm をビルドし、ハーネスを",
    "  ポート 4180 で立て、実ブラウザで全件を回す)。この報告書",
    "  `web/heavy-report.md` はその実行が書き出したものである。",
    "- **期待値の作り直し:** `cd reference && uv run python scripts/generate.py`。",
    "  期待値は Python の mpmath が 50 桁で独立に評価したもので、Rust の移植",
    "  ではない。",
    "- **読む側のコード:** `web/tests/heavy/`。シャードの検証(`corpus.ts`)、",
    "  比較(`withinTolerance` / `classify`)、この報告書の生成(`report.ts`)。",
    "",
    "## シャード別",
    "",
    "| シャード | 総数 | 値 | 同値 | 不一致 | 最大相対誤差 | 最大絶対誤差 | " +
      "absのみ(精度限界) | rel未定義(期待値0) | 表示分解能より緩い | 最悪の実効相対許容 | 許容 |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const entry of entries) {
    lines.push(
      `| ${entry.name} | ${entry.total} | ${entry.values} | ${entry.equivalences} | ` +
        `${entry.mismatches.length} | ` +
        `${relativeQuantity(entry.maxRelativeError, entry.relMeasured)} | ` +
        `${exponential(entry.maxAbsoluteError)} | ${entry.absOnlyCases.length} | ` +
        `${entry.relUndefinedCases.length} | ${entry.looserThanDisplay} | ` +
        `${relativeQuantity(entry.worstEffectiveRelTolerance, entry.relMeasured)} | ` +
        `abs ${entry.tolerance.abs} / rel ${entry.tolerance.rel} |`,
    );
  }

  const failures = entries.flatMap((entry) =>
    entry.mismatches.map((line) => `- \`${entry.name}\` ${line}`),
  );
  if (failures.length > 0) {
    lines.push("", "## 不一致の全件", "", ...failures);
  }

  lines.push(
    ...renderEffectiveTolerance(entries, {
      total,
      looser,
      worstEffective,
      relMeasured,
      maxRelativeError,
      relUndefinedNonZeroAbs: entries.reduce(
        (sum, entry) => sum + entry.relUndefinedNonZeroAbs,
        0,
      ),
    }),
  );
  lines.push(...renderDistribution(entries));

  // abs/rel は OR で判定している。abs の側だけで通ったケースを黙って合格に
  // 混ぜると、「rel の許容に収まっている」という主張が実態より緩くなる。
  // 0 件でもここに明記する — 省略すると「確かめていない」のか「0 件だった」
  // のか読み手が区別できない。
  //
  // **精度限界の実例(rel を測定でき、かつ超えた)と、rel が数学的に定義できない
  // 完全一致(期待値が厳密に 0)は別の節に分ける。** 混ぜて 1 つの件数にすると、
  // 「精度低下が n 件あった」と読み手に伝わるが、多くは 0 対 0 の完全一致であり
  // 精度低下ではない。数字を混ぜると数字が嘘をつく(修正ラウンド 1 のレビュー指摘)。
  lines.push("", "## 絶対誤差の側だけで通ったケース(精度限界の実例)", "");
  if (absOnly === 0) {
    lines.push(
      "**0 件。** 相対誤差(rel)を測定できたケースはすべて rel の許容内にも",
      "収まっており、abs/rel の OR 判定が精度の実態を覆い隠している所見は無い。",
      "",
      "**ただしこれは「rel の精度で検査した」という意味ではない。** 実効的な",
      "相対許容がどこまで広がっていたかは上の節を見ること。",
    );
  } else {
    lines.push(
      `**${absOnly} 件。** 相対誤差(rel)を測定でき、rel の許容は超えたが、` +
        "絶対誤差(abs)の許容には収まった。abs/rel の OR 判定は「通った」としか" +
        "言わないので、id と数値をここに開示する。",
      "",
      ...entries.flatMap((entry) =>
        entry.absOnlyCases.map((line) => `- \`${entry.name}\` ${line}`),
      ),
    );
  }

  lines.push("", "## 相対誤差が定義できないケース(期待値が厳密に 0)", "");
  if (relUndefined === 0) {
    lines.push("**0 件。**");
  } else {
    // 「ほとんどは完全一致」は手書きの見込みだった。実測から書く——いまは
    // 全件が絶対誤差 0 だが、将来 0 でない abs 誤差を持つケースが来たときに
    // 文が黙って嘘になる書き方をしない(敵対者レビュー 2026-08-15)。
    const inexact = entries.reduce(
      (sum, entry) => sum + entry.relUndefinedNonZeroAbs,
      0,
    );
    lines.push(
      `**${relUndefined} 件。** 期待値が厳密に 0 のため、相対誤差は数学的に` +
        "定義できない(0 除算になる)。ここに載るのはそのために abs 側でしか" +
        "判定できなかったケースである。",
      "",
      inexact === 0
        ? `この走行では **${relUndefined} 件すべてが絶対誤差 0 の完全一致**であり、` +
            "精度低下の実例ではない。"
        : `この走行では **${inexact} 件が絶対誤差 0 でない**(残り ` +
            `${relUndefined - inexact} 件は完全一致)。0 でない側は abs の許容だけで` +
            "通っており、相対の保証は無い。",
      "",
      ...entries.flatMap((entry) =>
        entry.relUndefinedCases.map((line) => `- \`${entry.name}\` ${line}`),
      ),
    );
  }

  lines.push(...renderCaveats(entries));

  return lines.join("\n");
}

/**
 * **実効的な相対許容の開示。** この節が無いと、報告書の「表示される桁まで
 * 正しい」が、期待値の小さいケースについて偽になる(修正ラウンド 2 の Critical)。
 */
interface Aggregate {
  total: number;
  looser: number;
  worstEffective: number;
  relMeasured: number;
  maxRelativeError: number;
  relUndefinedNonZeroAbs: number;
}

function renderEffectiveTolerance(
  entries: ShardSummary[],
  aggregate: Aggregate,
): string[] {
  const { looser, worstEffective, relMeasured } = aggregate;
  const lines = [
    "",
    "## 実効的な相対許容の分布",
    "",
    "合否は `|実測 - 期待| ≤ abs` **または** `|実測 - 期待| / |期待| ≤ rel` で",
    "判定している。この二つは OR なので、**|期待値| が 1 未満のところでは abs の",
    "側が常に緩い方になる**。そのとき実際に許されている相対誤差は rel ではなく",
    "`abs / |期待値|` である。これを「実効的な相対許容」と呼び、ここに全件の",
    "分布を出す。",
    "",
    `**${looser} 件が rel より緩く検査されている。最悪の実効相対許容は ` +
      `${relativeQuantity(worstEffective, relMeasured)}。**`,
    "",
    ...(relMeasured === 0
      ? [
          "**この走行では相対誤差を測定できたケースが 1 件も無い**(期待値が",
          "すべて厳密に 0)。実効的な相対許容は数学的に定義できないので、",
          "0 とは書かない——0 は「完璧に厳しく検査した」と読めてしまう。",
          "",
        ]
      : []),
    "| シャード | " +
      TOLERANCE_BANDS.map((band) => BAND_LABELS[band]).join(" | ") +
      " |",
    `|---|${TOLERANCE_BANDS.map(() => "---").join("|")}|`,
  ];
  for (const entry of entries) {
    lines.push(
      `| ${entry.name} | ` +
        TOLERANCE_BANDS.map((band) => String(entry.bands[band])).join(" | ") +
        " |",
    );
  }
  lines.push(
    "",
    "### abs の下駄は何を救っているか",
    "",
    ...absVerdict(aggregate),
    "",
    "なお、実効的な相対許容は「そこまでの誤差なら通してしまう」という上限で",
    "あって、観測された誤差ではない。誤差が 0 だったケースでは、許容がどれだけ",
    "広くても結果は変わらない。実際に観測された誤差は上の表の「最大相対誤差」",
    "と「最大絶対誤差」を見ること。",
  );
  return lines;
}

/**
 * **abs の下駄の正当化を、実測から書く。**
 *
 * 以前ここには「1e9 級から 1e-6 級への桁落ちが起きたケースの偽陽性を abs の
 * 下駄が防いでいる」という説明が固定文字列で入っていた。**測ったらそうでは
 * なかった**——敵対者レビュー(2026-08-15)は `{abs: 0, rel: 1.5e-9}` で全
 * 4000 件が通ることを実証した。abs の下駄は一件も救っていない。
 *
 * 同じ嘘を二度書かないために、この節は判定を走行の実測から導く。abs を 0 に
 * しても全件通るかどうかは、走行の数字だけで決まる:
 *
 * - 相対誤差を測定できたケースは、rel を「観測された最大相対誤差」以上に
 *   取れば rel の側だけで通る。
 * - 期待値が厳密に 0 のケースは、絶対誤差が 0 なら `|差| ≤ 0` で abs = 0
 *   でも通る。0 でないものが 1 件でもあれば、abs は実際に効いている。
 *
 * **許容の設計は変えていない。** ここでしているのは開示だけである。
 */
function absVerdict(aggregate: Aggregate): string[] {
  const { total, maxRelativeError, relMeasured, relUndefinedNonZeroAbs } =
    aggregate;
  const closing = [
    "",
    "桁落ちで相対誤差が膨らむ領域が**あるかもしれない**ことは否定しない。",
    "ただしそれは**観測されていない想定の領域**であって、いまの許容を裏付ける",
    "実測ではない。マグニチュード依存の許容は段階 3 の主題である。",
    "",
    "ここでしているのは許容の設計変更ではなく、**その下駄が実際に何件をどこまで",
    "緩めているかの開示**である。",
  ];
  if (relMeasured === 0) {
    return [
      "この走行では相対誤差を測定できたケースが 1 件も無いため、abs の下駄が",
      "何を救っているかを実測から言えない。",
      ...closing,
    ];
  }
  if (relUndefinedNonZeroAbs > 0) {
    return [
      `**abs の側は実際に効いている。** 期待値が厳密に 0 のケースのうち ` +
        `${relUndefinedNonZeroAbs} 件は絶対誤差が 0 でなく、相対誤差が定義` +
        "できないため rel だけでは判定できない。abs を 0 にするとこれらは落ちる。",
      "",
      `残りは rel を ${exponential(maxRelativeError)}(観測された最大相対誤差)` +
        "以上に取れば rel の側だけで通る。",
      ...closing,
    ];
  }
  return [
    `**このコーパスでは abs の下駄は一件も救っていない。**`,
    "",
    `- 相対誤差を測定できた ${relMeasured} 件の最大は ` +
      `**${exponential(maxRelativeError)}** で、rel をそれ以上に取れば` +
      "全部が rel の側だけで通る。",
    "- 期待値が厳密に 0 のケースは全件が絶対誤差 0 なので、`abs` を **0** に",
    "  しても `|差| ≤ 0` で通る。",
    `- したがって **\`abs\` を 0 にした許容でも全 ${total} 件が通る**。`,
    "",
    "**それでも abs を残しているのは、期待値が厳密に 0 のケースに相対誤差が",
    "定義できないためである。** 将来そこに 0 でない誤差が出たとき、rel だけでは",
    "判定できない。その保険の代償が、上の表に開示している「rel より緩く検査",
    `された ${aggregate.looser} 件」と「最悪の実効相対許容 ` +
      `${relativeQuantity(aggregate.worstEffective, relMeasured)}」である。`,
    ...closing,
  ];
}

/** 設計書 §11:「分布そのものを報告書に載せて、外から検証可能にする。」 */
function renderDistribution(entries: ShardSummary[]): string[] {
  const lines = [
    "",
    "## コーパスの分布",
    "",
    "総件数と不一致 0 だけでは、**同じような式を大量に試しただけ**かどうかを",
    "外から判定できない(設計書 §11)。実際に押されたキーと式の形をここに出す。",
    "",
    "### 演算子・関数の出現回数",
    "",
    "**同値シャードは左辺のキー列だけを数えている。** 右辺は左辺に恒等変換",
    "(`neg neg`、`sqrt` と `sqr` の対、`add 0`)を被せて作られたもので、",
    "左右をまとめて数えると**変換が注入したキーが電卓に与えた式の多様性として",
    "計上される**。実測では同値シャードの `neg` 2122 回のうち 74.2%(1574 回)が",
    "注入分だった。この表が答えているのは「同じような式を大量に試しただけか」",
    "なので、注入分は「うち変換で付加」の行に分けて出す(敵対者レビュー",
    "2026-08-15 の指摘)。",
    "",
    `| シャード | キー列 | ${SHAPE_TOKENS.join(" | ")} |`,
    `|---|---|${SHAPE_TOKENS.map(() => "---").join("|")}|`,
  ];
  const columns = [...SHAPE_TOKENS];
  for (const entry of entries) {
    lines.push(
      `| ${entry.name} | ${entry.shape.sequences} | ` +
        columns
          .map((token) => String(entry.shape.tokens[token] ?? 0))
          .join(" | ") +
        " |",
    );
    const added = entry.addedByTransform;
    if (added !== undefined) {
      lines.push(
        `| ↳ うち変換で付加(右辺が左辺に足した分。上の行には含まれない) | — | ` +
          columns.map((token) => String(added[token] ?? 0)).join(" | ") +
          " |",
      );
    }
  }

  const depths = [
    ...new Set(entries.flatMap((entry) => Object.keys(entry.shape.depths))),
  ].sort((a, b) => Number(a) - Number(b));
  lines.push(
    "",
    "### 括弧の最大深さ(キー列 1 本あたり)",
    "",
    "上の表と同じく、**同値シャードは左辺のキー列だけ**を数えている。右辺は",
    "変換が括弧を足すことがあるので、左右をまとめると深さも水増しになる。",
    "",
    `| シャード | ${depths.map((depth) => `深さ ${depth}`).join(" | ")} |`,
    `|---|${depths.map(() => "---").join("|")}|`,
  );
  for (const entry of entries) {
    lines.push(
      `| ${entry.name} | ` +
        depths
          .map((depth) => String(entry.shape.depths[depth] ?? 0))
          .join(" | ") +
        " |",
    );
  }

  lines.push(
    "",
    "### 値の大きさ(|値| の分位)",
    "",
    "値ケースは期待値、同値ケースは比較の基準にした右辺の表示から読んだ値。",
    "",
    "| シャード | 件数 | 最小 | 25% | 中央 | 75% | 最大 |",
    "|---|---|---|---|---|---|---|",
  );
  for (const entry of entries) {
    const q = entry.magnitudes;
    lines.push(
      `| ${entry.name} | ${q.count} | ${exponential(q.min)} | ` +
        `${exponential(q.p25)} | ${exponential(q.median)} | ` +
        `${exponential(q.p75)} | ${exponential(q.max)} |`,
    );
  }
  return lines;
}

/**
 * **一度も押されていないキートークンを、実データから導く。**
 *
 * ここが手書きの固定文字列だったとき、段階 3 で複素数・指数表記・Rad・
 * 括弧なし式が入れば、誰かが手で消すまでレポートは古い否定を出し続ける。
 * 信憑性を目的とした文書として最悪の壊れ方である(敵対者レビュー 2026-08-15)。
 *
 * `summarizeShape` はキー列中の**全 KEY_TOKENS** の出現を数えているので、
 * `KEY_TOKENS` との差分を取れば「一度も押されていないキー」が出る。
 * 同値ケースの右辺が付け足したキーも押されてはいるので、`addedByTransform`
 * の側も足して数える(分布表では分けるが、「踏んだか」は合わせて見る)。
 */
function unusedKeyTokens(entries: ShardSummary[]): string[] {
  const pressed = new Set<string>();
  for (const entry of entries) {
    for (const source of [entry.shape.tokens, entry.addedByTransform ?? {}]) {
      for (const [token, count] of Object.entries(source)) {
        if (count > 0) {
          pressed.add(token);
        }
      }
    }
  }
  return KEY_TOKENS.filter((token) => !pressed.has(token));
}

function renderCaveats(entries: ShardSummary[]): string[] {
  const unused = unusedKeyTokens(entries);
  return [
    "",
    "## この結果が主張していないこと",
    "",
    "電卓の表示は整形済みの文字列で、数値をそのまま取り出す口がない。",
    "したがってこの層が言えるのは**表示される桁まで正しい**ことであって、",
    "倍精度の最後の桁まで正しいことではない。より深い精度は Rust 側の",
    "単体テストと golden(Layer 1〜4)の担当である。",
    "",
    "**さらに、期待値の絶対値が 1 未満のケースでは abs の下駄が効き、その分だけ",
    "検査は緩い。最小マグニチュード帯(|期待値| が 1e-6 級)では、有効数字 4 桁",
    "相当までしか主張していない。** 件数と最悪値は「実効的な相対許容の分布」の",
    "節にある。表示は 10 桁出るが、その 10 桁すべてを検査したとは言っていない。",
    "",
    "巨大な角度を三角関数に渡すとき、角度をラジアンに直す時点で f64 の",
    "刻み幅が引数そのものの不確かさになる。刻み幅は角度の大きさに比例して",
    "広がるので、大きな角度ほど入力の精度が落ち、結果の精度もそれを超えられ",
    "ない。これはバグではなく、**巨大角度の三角関数が引数還元の限界で表示",
    "精度に届かない、既知の領域**である。上の「絶対誤差の側だけで通った",
    "ケース(精度限界の実例)」はその実例であり、コーパスから除外せず、",
    "ここに開示することを裁定している。",
    "",
    "### まだ一度も踏んでいない領域",
    "",
    "以下はこのコーパスが**一件も含んでいない**。緑であることは、これらに",
    "ついて何も言っていない。",
    "",
    // **この一項目だけがこの走行の実データから出ている。** 残りは手書きで、
    // 下の但し書きがそのことを名指ししている。
    ...(unused.length === 0
      ? [
          "- **使っていないキートークン: 無し。** この走行のキー列は " +
            `${KEY_TOKENS.length} 個のキートークンをすべて一度以上押している` +
            "(この行はレポート生成時に実データから導いている)。",
        ]
      : [
          `- **使っていないキートークン(${unused.length}/${KEY_TOKENS.length})。** ` +
            unused.map((token) => `\`${token}\``).join(" ") +
            " は一度も押されない。**この行はレポート生成時に、実際に押された" +
            "キーの集計と `KEY_TOKENS` の差分から導いている**——手で消し忘れて" +
            "古い否定が残ることがない。",
        ]),
    "- **括弧を省いた式。** キー列は二項演算を必ず括弧で囲む。したがって",
    "  演算子の優先順位と保留演算の意味論(`1 + 2 * 3` が 7 か 9 か)を",
    "  一度も踏んでいない。そこは `engine_table.rs` の担当である。",
    "- **エラー経路。** ゼロ除算・オーバーフロー・三角関数の極・構文エラーは",
    "  生成の時点で範囲外にしている。エラーが出たケースは不一致として扱う。",
    "- **複素数。** 負数の平方根は範囲外。表示(`j2` のような形)も読まない。",
    "- **指数表記。** 平坦な十進表示に収まる範囲(|値| が 1e-6 〜 1e9)だけを",
    "  生成している。表示が指数表記に切り替わる領域は踏んでいない。",
    "- **Deg 以外の角度モード。** 全ケースが Deg で、`angle_toggle` を一度も",
    "  押していない。Rad の三角関数はこの層の外である。",
    "- **UI。** ボタンもキーボードも通らない。ここが呼ぶのは計算コアの",
    "  `dispatch` だけで、押せる場所に見えるかは既存の E2E(Layer 5)の担当である。",
    "",
    "> **この節は手で保守されている。** 「使っていないキートークン」の行だけが",
    "> 走行の実データから導かれていて、残りの項目——括弧なし式・エラー経路・",
    "> 複素数・指数表記・角度モード・UI——は固定の文章である。段階 3 でこれらの",
    "> 領域が埋まったら、**ここを更新すること**。更新を忘れると、この報告書は",
    "> 「一件も含んでいない」と言い続ける。信憑性を目的とした文書でそれが起きると、",
    "> 数字が正しくても文書全体が信用を失う。",
    "",
  ];
}

/** 実行環境から素性を集める。**ここだけが不純**で、renderReport は純粋に保つ。 */
function gitDescription(): string {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf-8",
    }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf-8",
    }).trim();
    // 汚れた作業ツリーで回した結果を、コミット済みの状態の結果として
    // 読ませない。素性が嘘をつくくらいなら、汚れていると書く。
    // (この報告書自身は .gitignore に入っているので、ここには出てこない。)
    return dirty === "" ? sha : `${sha} (作業ツリーに未コミットの変更あり)`;
  } catch {
    return "unknown";
  }
}

const runtime: { coreVersion: string; browser: string } = {
  coreVersion: "unknown",
  browser: "unknown",
};

/** 実際に走った実行環境を記録する。シャードごとに呼ばれてよい(最後が残る)。 */
export function noteRuntime(coreVersion: string, browser: string): void {
  runtime.coreVersion = coreVersion;
  runtime.browser = browser;
}

export function writeReport(): void {
  const path = fileURLToPath(new URL("../../heavy-report.md", import.meta.url));
  const markdown = renderReport(summaries, {
    ranAt: new Date().toISOString(),
    commit: gitDescription(),
    coreVersion: runtime.coreVersion,
    browser: runtime.browser,
  });
  writeFileSync(path, markdown, "utf-8");
  console.log(`wrote ${path}`);
}

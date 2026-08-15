import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  Quantiles,
  ShapeSummary,
  Tolerance,
  ToleranceBand,
} from "./corpus";
import { TOLERANCE_BANDS } from "./corpus";

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
  // ほとんどは完全一致で、精度低下の実例ではない。absOnlyCases と混ぜて数えると
  // 「精度低下が n 件あった」という誤読を招くため、別に集計する
  // (修正ラウンド 1 のレビュー指摘)。
  relUndefinedCases: string[];
  // **実際にどこまでの精度で検査したか。** abs/rel の OR は |期待値| < 1 の
  // ところで abs の側が緩い方になり、実効的な相対許容が rel より広がる。
  // 集計しないと報告書の主張が実態より強くなる(修正ラウンド 2)。
  looserThanDisplay: number;
  worstEffectiveRelTolerance: number;
  bands: Record<ToleranceBand, number>;
  // 設計書 §11 の「分布そのものを報告書に載せる」。
  shape: ShapeSummary;
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
  const lines = [
    "# 重量級コーパスの実行結果",
    "",
    `- 総ケース数: **${total}**`,
    `- 不一致: **${failed}**`,
    `- 観測された最大相対誤差: **${exponential(maxRelativeError)}**`,
    `- 観測された最大絶対誤差: **${exponential(maxAbsoluteError)}**`,
    `- 絶対誤差の側だけで通ったケース(精度限界の実例): **${absOnly}**`,
    `- 相対誤差が定義できないケース(期待値が厳密に 0): **${relUndefined}**`,
    `- **表示分解能より緩く検査されたケース: ${looser}** ` +
      `(全 ${total} 件中 ${((looser / total) * 100).toFixed(1)}%)`,
    `- **最悪の実効相対許容: ${exponential(worstEffective)}**`,
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
    "## シャード別",
    "",
    "| シャード | 総数 | 値 | 同値 | 不一致 | 最大相対誤差 | 最大絶対誤差 | " +
      "absのみ(精度限界) | rel未定義(期待値0) | 表示分解能より緩い | 最悪の実効相対許容 | 許容 |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const entry of entries) {
    lines.push(
      `| ${entry.name} | ${entry.total} | ${entry.values} | ${entry.equivalences} | ` +
        `${entry.mismatches.length} | ${exponential(entry.maxRelativeError)} | ` +
        `${exponential(entry.maxAbsoluteError)} | ${entry.absOnlyCases.length} | ` +
        `${entry.relUndefinedCases.length} | ${entry.looserThanDisplay} | ` +
        `${exponential(entry.worstEffectiveRelTolerance)} | ` +
        `abs ${entry.tolerance.abs} / rel ${entry.tolerance.rel} |`,
    );
  }

  const failures = entries.flatMap((entry) =>
    entry.mismatches.map((line) => `- \`${entry.name}\` ${line}`),
  );
  if (failures.length > 0) {
    lines.push("", "## 不一致の全件", "", ...failures);
  }

  lines.push(...renderEffectiveTolerance(entries, looser, worstEffective));
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
    lines.push(
      `**${relUndefined} 件。** 期待値が厳密に 0 のため、相対誤差は数学的に` +
        "定義できない(0 除算になる)。ここに載るのはそのために abs 側でしか" +
        "判定できなかったケースで、**ほとんどは完全一致であり精度低下の実例ではない**。",
      "",
      ...entries.flatMap((entry) =>
        entry.relUndefinedCases.map((line) => `- \`${entry.name}\` ${line}`),
      ),
    );
  }

  lines.push(...renderCaveats());

  return lines.join("\n");
}

/**
 * **実効的な相対許容の開示。** この節が無いと、報告書の「表示される桁まで
 * 正しい」が、期待値の小さいケースについて偽になる(修正ラウンド 2 の Critical)。
 */
function renderEffectiveTolerance(
  entries: ShardSummary[],
  looser: number,
  worstEffective: number,
): string[] {
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
      `${exponential(worstEffective)}。**`,
    "",
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
    "**abs の側は消せない。** 生成器は中間値に 1e9 までを許すので、1e9 級から",
    "1e-6 級への桁落ちが起きたケースでは f64 由来の相対誤差が 1e-1 級まで",
    "膨らみうる。abs の下駄はその偽陽性を防いでいる。ここでしているのは許容の",
    "設計変更ではなく、**その下駄が実際に何件をどこまで緩めているかの開示**である。",
    "マグニチュード依存の許容は段階 3 の主題である。",
  );
  return lines;
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
    "| シャード | キー列 | add | sub | mul | div | sqrt | sqr | sin | cos | tan | neg |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  const columns = [
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
  ];
  for (const entry of entries) {
    lines.push(
      `| ${entry.name} | ${entry.shape.sequences} | ` +
        columns
          .map((token) => String(entry.shape.tokens[token] ?? 0))
          .join(" | ") +
        " |",
    );
  }

  const depths = [
    ...new Set(entries.flatMap((entry) => Object.keys(entry.shape.depths))),
  ].sort((a, b) => Number(a) - Number(b));
  lines.push(
    "",
    "### 括弧の最大深さ(キー列 1 本あたり)",
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

function renderCaveats(): string[] {
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
    "- **使っていないキートークン。** `dot` `zeros3` `exp` `pi` `j`",
    "  `polar_toggle` `ac` `del` `angle_toggle` は一度も押されない。小数点の",
    "  入力すら踏んでいない(リテラルは 1〜3 桁の非負整数だけ)。",
    "- **UI。** ボタンもキーボードも通らない。ここが呼ぶのは計算コアの",
    "  `dispatch` だけで、押せる場所に見えるかは既存の E2E(Layer 5)の担当である。",
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

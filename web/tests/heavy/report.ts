import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Tolerance } from "./corpus";

export interface ShardSummary {
  name: string;
  total: number;
  values: number;
  equivalences: number;
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
  tolerance: Tolerance;
}

const summaries: ShardSummary[] = [];

export function record(summary: ShardSummary): void {
  summaries.push(summary);
}

/**
 * 外の人が読んで「これなら大丈夫だ」と判断できる材料を出す。
 * **緑のチェックは何件どこまでの精度で確かめたかを答えない**(設計書 §8)。
 */
export function renderReport(entries: ShardSummary[]): string {
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
    `- 観測された最大相対誤差: **${maxRelativeError.toExponential(2)}**`,
    `- 観測された最大絶対誤差: **${maxAbsoluteError.toExponential(2)}**`,
    `- 絶対誤差の側だけで通ったケース(精度限界の実例): **${absOnly}**`,
    `- 相対誤差が定義できないケース(期待値が厳密に 0): **${relUndefined}**`,
    "",
    "値が大きいケースほど絶対誤差も大きく出るのが正常である(相対許容 rel が",
    "絶対値の大きい分だけ広い絶対誤差を許すため)。そのときの判断材料は",
    "相対誤差(rel)の側を見る。",
    "",
    "## シャード別",
    "",
    "| シャード | 総数 | 値 | 同値 | 不一致 | 最大相対誤差 | 最大絶対誤差 | " +
      "absのみ(精度限界) | rel未定義(期待値0) | 許容 |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const entry of entries) {
    lines.push(
      `| ${entry.name} | ${entry.total} | ${entry.values} | ${entry.equivalences} | ` +
        `${entry.mismatches.length} | ${entry.maxRelativeError.toExponential(2)} | ` +
        `${entry.maxAbsoluteError.toExponential(2)} | ${entry.absOnlyCases.length} | ` +
        `${entry.relUndefinedCases.length} | abs ${entry.tolerance.abs} / rel ${entry.tolerance.rel} |`,
    );
  }

  const failures = entries.flatMap((entry) =>
    entry.mismatches.map((line) => `- \`${entry.name}\` ${line}`),
  );
  if (failures.length > 0) {
    lines.push("", "## 不一致の全件", "", ...failures);
  }

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

  lines.push(
    "",
    "## この結果が主張していないこと",
    "",
    "電卓の表示は整形済みの文字列で、数値をそのまま取り出す口がない。",
    "したがってこの層が言えるのは**表示される桁まで正しい**ことであって、",
    "倍精度の最後の桁まで正しいことではない。より深い精度は Rust 側の",
    "単体テストと golden(Layer 1〜4)の担当である。",
    "",
    "巨大な角度を三角関数に渡すとき、角度をラジアンに直す時点で f64 の",
    "刻み幅が引数そのものの不確かさになる。刻み幅は角度の大きさに比例して",
    "広がるので、大きな角度ほど入力の精度が落ち、結果の精度もそれを超えられ",
    "ない。これはバグではなく、**巨大角度の三角関数が引数還元の限界で表示",
    "精度に届かない、既知の領域**である。上の「絶対誤差の側だけで通った",
    "ケース(精度限界の実例)」はその実例であり、コーパスから除外せず、",
    "ここに開示することを裁定している。",
    "",
  );

  return lines.join("\n");
}

export function writeReport(): void {
  const path = fileURLToPath(new URL("../../heavy-report.md", import.meta.url));
  writeFileSync(path, renderReport(summaries), "utf-8");
  console.log(`wrote ${path}`);
}

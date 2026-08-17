import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KEY_TOKENS } from "../../src/calc/types";
import type {
  Quantiles,
  ShapeSummary,
  Tolerance,
  ToleranceBand,
} from "./corpus";
import {
  loadCallShards,
  loadDisplayShards,
  loadShards,
  partitionCases,
  SHAPE_TOKENS,
  TOLERANCE_BANDS,
  TOLERANCE_CEILING,
} from "./corpus";

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
  /**
   * このシャードで実際に適用された、名指しの上書き。
   *
   * 前の判定(絶対誤差と相対誤差の二者択一)では、この集合は「相対誤差(rel)
   * が測定できた(期待値 ≠ 0)うえで rel の許容は超えたが、絶対誤差(abs)の
   * 許容には収まったケース」という、絶対誤差の側だけを見る名前のフィールドで
   * 現れていた。判定を rel だけに締めたいま、シャードの rel を超えて合格する
   * 経路は名指しの上書きしか残っていないので、**同じ集合を、実際に起きて
   * いること(上書きが適用された)で呼ぶ。** 改名ではなく統合——古い名前の
   * まま値だけ変えると、「絶対誤差の側で通った」という嘘の説明が残る。
   *
   * **件数と理由の全文をレポートに出す**——外の読み手が「何件が特別扱いされ、
   * なぜか」を数えられることが要件である(設計書 §3.5)。2 件が 200 件に増えたら
   * この層が壊れている兆候で、レポートを読めばそれが分かる。
   */
  appliedOverrides: {
    id: string;
    rel: number;
    baseRel: number;
    reason: string;
  }[];
  // 期待値が厳密に 0 で、相対誤差が数学的に定義できない(0 除算になる)ケース。
  // appliedOverrides と混ぜて数えると「精度低下が n 件あった」という誤読を招くため、
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
  // **実際にどこまでの精度で検査したか。** 判定は rel だけで行うので、
  // シャードが宣言する rel より緩く検査されたケースがあるとすれば、それは
  // 名指しの上書きが効いているときだけである。集計しないと報告書の
  // 「表示される桁まで正しい」が実態より強い主張になる(修正ラウンド 2)。
  looserThanDisplay: number;
  /**
   * 優先順位が無ければ解釈できないキー列の件数。
   * **レポートの「まだ踏んでいない領域」をここから導く**——手書きの否定は
   * 次に領域が埋まったとき黙って嘘になる(設計書 §3.4)。
   */
  precedenceCases: number;
  /**
   * 答が指数表記で表示されたケースの件数。
   *
   * **段階 3b-A まで、この数は 0 だった**——生成器が値を `1e-6`〜`1e9` に
   * 閉じ込めていたためである。組合せ論のシャードが帯を外したので、
   * 初めて 0 でなくなる(設計書 2026-08-16-corpus-functions §3.2.1)。
   */
  exponentDisplayCases: number;
  /**
   * **エラーになることを期待値として持つケースの件数。**
   *
   * 科学計算のシャードは 0 である——定義域外は生成の時点で捨てている。
   * 金融とデータスケールは違う。**入力の検証が仕事の一部**なので、
   * エラーになること自体が仕様であり、エラー名まで突き合わせる。
   */
  errorCases: number;
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

/**
 * **集計はディスクに置く。プロセス内の配列に頼らない。**
 *
 * 以前ここはモジュールスコープの `summaries` 配列だった。Playwright は
 * テストが 1 本落ちるとワーカーを再起動するので、**配列ごと消える**。
 * 新しいワーカーの `afterAll` が自分の見た分だけで同じ `heavy-report.md` を
 * 上書きし、実測では「値: 0 / 不一致: 0 / 最大相対誤差 0.00e+0」——**赤い
 * 走行のあとに緑の顔をした成果物**が残った(`wrote …heavy-report.md` が
 * ログに 2 回出る)。`renderReport` の「空なら拒む」ガードは、同値シャードの
 * 集計が残るために発火しなかった。
 *
 * 直し方は「配列を守る」ではなく「配列に頼らない」である。`record()` が
 * シャード 1 枚につき 1 ファイルを書き、レポート生成は**走行の最後に
 * ディレクトリを読む**。ワーカーが何回死のうと、既に書かれた集計は残る。
 */
const SUMMARY_DIR = fileURLToPath(
  new URL("../../.heavy-summaries/", import.meta.url),
);

const REPORT_PATH = fileURLToPath(
  new URL("../../heavy-report.md", import.meta.url),
);

/** ディスクに落とす 1 枚分。素性もここに入れる(これもワーカーごとの状態だった)。 */
interface RecordedShard {
  summary: ShardSummary;
  runtime: { coreVersion: string; browser: string };
}

const runtime: { coreVersion: string; browser: string } = {
  coreVersion: "unknown",
  browser: "unknown",
};

/**
 * JSON は Infinity / NaN を持てない(`JSON.stringify` は黙って `null` にする)。
 * 集計の数字が黙って `null` に化けると、レポートの数字が黙って嘘をつく。
 * 非有限だけを文字列に包んで往復させる。
 */
const NON_FINITE_PREFIX = "__number__:";

function encodeNumbers(_key: string, value: unknown): unknown {
  return typeof value === "number" && !Number.isFinite(value)
    ? `${NON_FINITE_PREFIX}${String(value)}`
    : value;
}

function decodeNumbers(_key: string, value: unknown): unknown {
  return typeof value === "string" && value.startsWith(NON_FINITE_PREFIX)
    ? Number(value.slice(NON_FINITE_PREFIX.length))
    : value;
}

function summaryFileName(name: string): string {
  return `${name.replace(/[^A-Za-z0-9._-]+/g, "_")}.json`;
}

/**
 * **集計の名前は 1 か所でしか組み立てない(F9、修正ラウンド 4)。**
 *
 * 以前は `corpus.spec.ts` の `record()` 呼び出し・`expectedSummaryNames()`・
 * そして下の「優先順位シャードがこの走行に居るか」のゲートが、それぞれ
 * 独立に `` `${name} (values)` `` を書いていた。3 つが同じ規則を手で
 * 繰り返しているだけなので、書式を変えると `record()` と
 * `expectedSummaryNames()` は**揃って**動き(`missing` は空のまま、
 * `writeReport` は黙る)、ゲートだけが静かに一致しなくなる——実データの
 * 報告書から 1101 の段落が消えるのに、自分で名前を組み立てている
 * `report.spec.ts` は緑のまま、という壊れ方をする。
 */
export function summaryName(
  shardName: string,
  kind: "values" | "equivalences" | "calls" | "displays",
): string {
  return `${shardName} (${kind})`;
}

/** 括弧を省いたキー列のシャード。ゲートと `corpus.spec.ts` の不変条件が共有する。 */
export const PRECEDENCE_SHARD = "precedence-000.json";

/**
 * **`precedence-000.json` の 2000 件のうち、優先順位が無いと別の木になる件数。**
 *
 * この数は報告書が再計算しているものではない。reference の
 * `test_precedence_shard_reports_how_many_cases_change_meaning_without_precedence`
 * がコミット済みシャードを読んで構文木の等価性そのもので測り、`assert
 * changes_meaning == 1101` で固定している。
 *
 * **ここに直接書かれているのが唯一の複製である(F2、修正ラウンド 4)。**
 * 以前はこの数値が本文と但し書きの 2 か所に文字列リテラルとして書かれており、
 * どちらを 9999 に変えても 30 件のレポートテストが全部緑のままだった——
 * つまり報告書の最も具体的な数字を制約しているものが 1 つも無かった。
 * いまは (1) 描画側の複製がこの定数 1 つに畳まれ、(2)
 * `report.spec.ts` の "the 1101 figure is pinned to the number the reference
 * test asserts" が `reference/tests/test_generate_corpus.py` から
 * `assert changes_meaning == N` を実際に読み出して照合する。Python 側だけを
 * 直しても、こちらだけを直しても、赤くなる。
 */
export const PRECEDENCE_CHANGES_MEANING = 1101;

/**
 * **走行の開始時に古い残骸を消す。** 前回の走行が書いた集計が混ざると、
 * 今回一件も回らなかったシャードが前回の数字で埋まる——それは緑の顔である。
 * 前回の `heavy-report.md` も消す。書き出しを拒んだときに、**古い緑の
 * 報告書がそのまま残る**のでは意味がない。
 */
export function resetRun(): void {
  rmSync(SUMMARY_DIR, { recursive: true, force: true });
  mkdirSync(SUMMARY_DIR, { recursive: true });
  rmSync(REPORT_PATH, { force: true });
}

export function record(summary: ShardSummary): void {
  mkdirSync(SUMMARY_DIR, { recursive: true });
  const recorded: RecordedShard = { summary, runtime: { ...runtime } };
  writeFileSync(
    join(SUMMARY_DIR, summaryFileName(summary.name)),
    JSON.stringify(recorded, encodeNumbers),
    "utf-8",
  );
}

function readRecorded(): RecordedShard[] {
  let names: string[];
  try {
    names = readdirSync(SUMMARY_DIR);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map(
      (name) =>
        JSON.parse(
          readFileSync(join(SUMMARY_DIR, name), "utf-8"),
          decodeNumbers,
        ) as RecordedShard,
    );
}

/**
 * **この走行で揃っているべき集計の名前。** コーパスそのものから導く——
 * 「回った分だけ」を正解にすると、消えたシャードが検出できない(C3 の穴と
 * 同じ形)。`corpus.spec.ts` が `record()` に渡す名前と同じ規則で組み立てる。
 */
export function expectedSummaryNames(): string[] {
  const names: string[] = [];
  for (const { name, shard } of loadShards()) {
    const { values, equivalences } = partitionCases(name, shard.cases);
    if (values.length > 0) {
      names.push(summaryName(name, "values"));
    }
    if (equivalences.length > 0) {
      names.push(summaryName(name, "equivalences"));
    }
  }
  // **関数呼び出しのシャードも数える。** `loadShards()` はこれらを除外するので、
  // ここで足さないと**金融とデータスケールが「揃うはずの集計」から丸ごと外れる**
  // ——テストが走らなくても報告書が「完全である」と名乗り、判定表は
  // 「検証していない」と出て、その食い違いを誰も咎めない。
  for (const { name } of loadCallShards()) {
    names.push(summaryName(name, "calls"));
  }
  // **表示のシャードも数える。** `loadShards()` はこれも除外する。
  for (const { name } of loadDisplayShards()) {
    names.push(summaryName(name, "displays"));
  }
  return names;
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
 * **開示を 0 に丸めない(F11、修正ラウンド 4)。**
 *
 * `toFixed(1)` 固定だと 2/6000 が「0.0%」になる。緩く検査したケースが
 * **在る**ことを開示する行が、無いのと同じ字面で出る——信憑性を目的とした
 * 文書でいちばんしてはいけない丸め方である。0 でない限り、少なくとも
 * 有効数字 2 桁が残る桁数まで伸ばす。厳密に 0 のときだけ「0%」と書く。
 */
function percentage(part: number, whole: number): string {
  if (whole === 0) {
    return "—";
  }
  const pct = (part / whole) * 100;
  if (pct === 0) {
    return "0%";
  }
  const digits = pct >= 0.1 ? 1 : Math.min(6, Math.ceil(-Math.log10(pct)) + 1);
  return `${pct.toFixed(digits)}%`;
}

/**
 * 外の人が読んで「これなら大丈夫だ」と判断できる材料を出す。
 * **緑のチェックは何件どこまでの精度で確かめたかを答えない**(設計書 §8)。
 */
/**
 * 電卓の機能領域。**`crates/calcarc-core/src/` の区画がそのまま正である。**
 *
 * 判定は領域ごとに出す。「この電卓は正しいか」は 1 つの答えを持たない——
 * 科学計算が全件一致していても、金融が一件も試されていなければ、
 * **その 2 つを混ぜた 1 つの判定は嘘になる。**
 */
export const AREAS = [
  "scientific",
  "cancellation",
  "data_scale",
  "finance",
  "display",
  "complex",
] as const;
export type Area = (typeof AREAS)[number];

/**
 * シャード名から領域を決める。
 *
 * **未知の接頭辞は黙って `scientific` に落とさない。** 落とすと、新しい領域の
 * シャードを足したときに、その結果が科学計算の判定に混ざって見えなくなる。
 */
export function areaOfShard(shardName: string): Area {
  const stem = shardName.replace(/\.json$/, "").replace(/ \(.*\)$/, "");
  if (/^(finance|loan|compound)-/.test(stem)) {
    return "finance";
  }
  if (/^(data-scale|datascale|bytes)-/.test(stem)) {
    return "data_scale";
  }
  if (/^complex-/.test(stem)) {
    // **`complex-display-` もここに入る。** `display-` の規則より先に見る
    // ——後ろに置くと、複素数の表示のシャードが `display` 領域に落ちて
    // 「複素数を検証した」件数が別の領域の数字に混ざる。
    return "complex";
  }
  if (/^display-/.test(stem)) {
    // **`scientific` に混ぜない。** このシャードが主張しているのは値ではなく
    // **表示文字列**で、比較も厳密一致である。混ぜると「値がどれだけ合って
    // いるか」の件数に、値を一度も比べていない 2000 件が加わってしまう。
    return "display";
  }
  if (/^cancellation-/.test(stem)) {
    // **`scientific` に混ぜない。** このシャードは桁落ちを**狙って**作った
    // 入力で、普通の式ではない。混ぜると「わざと難しくした入力の結果」が
    // 「普通の入力の判定」を下げてしまい、どちらの数字も読めなくなる。
    return "cancellation";
  }
  if (
    /^(scientific|equivalence|precedence|elementary|inverse-trig|combinatorics|typed|corrections|angle-mode)-/.test(
      stem,
    )
  ) {
    return "scientific";
  }
  throw new Error(
    `report: shard ${JSON.stringify(shardName)} does not match any known ` +
      "area prefix. Add it to areaOfShard rather than letting it fall into " +
      "an area it does not belong to — a silent default would hide a whole " +
      "new area inside another area's verdict.",
  );
}

/** 判定の 4 段。閾値は表示(有効数字 10 桁)から導く。 */
export const VERDICTS = [
  "完全に正しい",
  "ある程度正しい",
  "多少疑問がある",
  "間違っている",
  "検証していない",
] as const;
export type Verdict = (typeof VERDICTS)[number];

/**
 * 判定の閾値。**桁で切る。**
 *
 * - `完全に正しい` — 表示 10 桁がすべて一致(相対誤差 ≤ 5e-10)
 * - `ある程度正しい` — 差はあるが 1e-6 未満。**表示の末尾数桁だけ違う。**
 *   f64 の丸めや桁落ちで説明でき、桁は合っている。**警告であって不合格ではない**
 * - `多少疑問がある` — 1e-6 以上 1 未満。有効数字の上位が違うが、桁は同じ
 * - `間違っている` — 相対誤差 1 以上、符号違い、桁違い、有限の答があるのに
 *   `inf`/`NaN`/エラー。**全然違う数**
 */
export const VERDICT_EDGES = { correct: 5e-10, mild: 1e-6, wrong: 1 } as const;

export function verdictOf(
  caseCount: number,
  worstRelativeError: number,
  structuralFailures: number,
): Verdict {
  if (caseCount === 0) {
    // **「一件も試していない」を「正しい」と書かない。** これが 3 領域のうち
    // 2 領域の現状であり、混同すると報告書がいちばん重い嘘をつく。
    return "検証していない";
  }
  if (structuralFailures > 0 || worstRelativeError >= VERDICT_EDGES.wrong) {
    return "間違っている";
  }
  if (worstRelativeError >= VERDICT_EDGES.mild) {
    return "多少疑問がある";
  }
  if (worstRelativeError > VERDICT_EDGES.correct) {
    return "ある程度正しい";
  }
  return "完全に正しい";
}

/**
 * 領域ごとの判定表。**この報告書でいちばん先に読まれる部分である。**
 *
 * 判定と一緒に件数を出すのは、**試していない領域に「正しい」と書かないため**で
 * ある。判定だけを並べると、`検証していない` が他の 3 段と同じ重さに見える。
 */
/**
 * `pnpm heavy:power` の測定結果を読む。**無ければ `null`。**
 *
 * 無いときに黙って節を省くと、「測ったが 0 件だった」と「測っていない」が
 * 同じ見た目になる。`renderDetectionPower` は `null` でもその旨の節を出す。
 */
function readDetectionPower(): DetectionPower | null {
  const path = join(dirname(SUMMARY_DIR), "detection-power.json");
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as DetectionPower;
  } catch {
    return null;
  }
}

/** `pnpm heavy:power` が書く測定結果。無ければ節ごと出さない。 */
export interface DetectionPower {
  results: {
    id: string;
    what: string;
    expect: string;
    caught: Record<string, number>;
    total: number;
    ok: boolean;
    why: string;
  }[];
}

/**
 * **「不一致 0 件」の意味を決める節である。**
 *
 * 0 件は、それだけでは「見つからなかった」しか言っていない。壊れたものを
 * 実際に入れて何件が赤くなるかを測って初めて、**「これだけの壊れ方を検出
 * できる網で 0 件だった」**と言える。
 *
 * **赤くならないことを期待した変異も載せる。** レポートが「この領域は
 * 踏んでいない」と書いているなら、その主張はこの表で確かめられている。
 */
export function renderDetectionPower(power: DetectionPower | null): string[] {
  if (power === null || power.results.length === 0) {
    return [
      "",
      "## この検査は壊れたものを見つけられるのか",
      "",
      "**測っていない。** `pnpm heavy:power` を走らせると、engine に既知の",
      "壊れ方を一時的に入れて何件が赤くなるかを測り、ここに表が出る。",
      "**それが無い限り、上の「不一致 0 件」は「見つからなかった」以上のことを",
      "言っていない。**",
    ];
  }
  const rows = power.results.map((r) => {
    const where =
      Object.keys(r.caught).length === 0
        ? "—"
        : Object.entries(r.caught)
            .map(([shard, n]) => `${shard.replace(/\.json$/, "")}: ${n}`)
            .join("<br>");
    return `| ${r.what} | ${where} | **${r.total}** | ${r.ok ? "期待どおり" : "**期待と違う**"} |`;
  });
  return [
    "",
    "## この検査は壊れたものを見つけられるのか",
    "",
    "**engine に既知の壊れ方を一時的に入れて、何件が赤くなるかを測った。**",
    "変異はコミットされない——測ったあと原文に戻し、バイト単位で一致を確かめている。",
    "",
    "| 入れた壊れ方 | 赤くなったシャード | 件数 | 判定 |",
    "|---|---|---:|---|",
    ...rows,
    "",
    "**件数が 0 の行は失敗ではない。** 「その領域はこのコーパスが踏んでいない」と",
    "レポートが書いているなら、**0 であることがその主張の裏付け**である。",
    "0 でなければ、レポートのほうが間違っていたことになる。",
    "",
    "**この表があって初めて、上の「不一致 0 件」に意味がある**——",
    "「何も見つからなかった」ではなく、**「これだけの壊れ方を検出できる網で 0 件だった」**。",
  ];
}

export function renderVerdicts(entries: ShardSummary[]): string[] {
  const rows = AREAS.map((area) => {
    const own = entries.filter((entry) => areaOfShard(entry.name) === area);
    const cases = own.reduce((sum, entry) => sum + entry.total, 0);
    const worst = Math.max(0, ...own.map((entry) => entry.maxRelativeError));
    const mismatches = own.reduce(
      (sum, entry) => sum + entry.mismatches.length,
      0,
    );
    // **その領域が「許容で」比べたのか「厳密に」比べたのかを区別する。**
    //
    // 表の「最大相対誤差」が 0.00e+0 のとき、意味は 2 通りある——
    // 許容で比べて 1 件も外れなかったのか、そもそも誤差という概念が無い
    // 比較(整数の一致、文字列の一致)なのか。**後者のほうが強い主張**なのに、
    // 同じ `0.00e+0` に見えると「測っていないから 0 なのだろう」と読める。
    // 誤差を 1 件も測っていない(`relMeasured === 0`)領域がそれである。
    const measured = own.reduce((sum, entry) => sum + entry.relMeasured, 0);
    return {
      area,
      cases,
      worst,
      mismatches,
      exact: cases > 0 && measured === 0,
      verdict: verdictOf(cases, worst, mismatches),
    };
  });
  const exactAreas = rows.filter((row) => row.exact).map((row) => row.area);
  return [
    "## 判定",
    "",
    "**領域ごとに出す。** 「この電卓は正しいか」に 1 つの答えは無い——",
    "科学計算が全件一致していても、金融を一件も試していなければ、",
    "その 2 つを混ぜた判定は嘘になる。",
    "",
    "| 領域 | 判定 | 照合した件数 | 最大相対誤差 | 不一致 |",
    "|---|---|---:|---:|---:|",
    ...rows.map(
      (row) =>
        `| \`${row.area}\` | **${row.verdict}** | ${row.cases} | ` +
        `${row.cases === 0 ? "—" : row.exact ? "厳密一致" : exponential(row.worst)} | ` +
        `${row.mismatches} |`,
    ),
    "",
    ...(exactAreas.length === 0
      ? []
      : [
          `**${exactAreas.map((area) => `\`${area}\``).join(" と ")} は「厳密一致」である** ` +
            "——相対誤差が小さかったのではなく、**誤差という概念が無い比較**である。",
          "金融とデータスケールは円とバイト数の整数、表示のシャードは表示文字列そのもの",
          "を突き合わせている。1 円違えば、1 文字違えば、不一致になる。",
          "",
        ]),
    "判定の意味:",
    "",
    "- **完全に正しい** — 表示される 10 桁がすべて一致した",
    "- **ある程度正しい** — 表示の末尾数桁だけ違う(相対誤差 1e-6 未満)。",
    "  f64 の丸めや桁落ちで説明でき、桁は合っている。**警告であって不合格ではない**",
    "- **多少疑問がある** — 有効数字の上位が違う(1e-6 以上)。桁は同じ",
    "- **間違っている** — 桁違い・符号違い、または有限の答があるのに",
    "  `inf`/`NaN`/エラー。**全然違う数**",
    "- **検証していない** — このコーパスに 1 件も無い。**「正しい」ではない**",
  ];
}

export function renderReport(
  entries: ShardSummary[],
  provenance: Provenance,
  /**
   * **揃っているはずなのに記録されなかった集計の名前。**
   * 空でないとき、この報告書は本文の先頭から「不完全である」と名乗る。
   * 部分的な集計から出た「不一致: 0」が、全件通った走行と同じ見た目に
   * なってはならない(ワーカー再起動で集計が消えた実測に対する構造的な塞ぎ)。
   */
  missing: string[] = [],
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
  const overrideCount = entries.reduce(
    (sum, entry) => sum + entry.appliedOverrides.length,
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
    ...(missing.length === 0
      ? []
      : [
          "# この走行は不完全である — 下の数字を結果として読まないこと",
          "",
          "**揃っているはずのシャードの集計が揃っていない。** 走行が途中で",
          "落ちたか、ワーカーが再起動して集計が失われている。以下に並ぶ件数・",
          "最大誤差・「不一致」は**記録が残った分だけの数字**であって、",
          "コーパス全体の結果ではない。**「不一致: 0」も、通ったという意味では",
          "ない。**",
          "",
          "集計が記録されなかったシャード:",
          "",
          ...missing.map((name) => `- \`${name}\``),
          "",
          "原因を取り除いて `pnpm heavy` を回し直すこと。この見出しが消えるまで、",
          "この文書は結果ではない。",
          "",
          "---",
          "",
        ]),
    "# 重量級コーパスの実行結果",
    "",
    ...renderVerdicts(entries),
    ...renderDetectionPower(readDetectionPower()),
    "",
    `- **二経路で照合したケース(値): ${valueCases}** ` +
      "— Rust の計算コアと Python の mpmath が独立に同じ数に着くことを確かめた件数",
    `- **電卓の自己整合を見たケース(同値): ${equivalenceCases}** ` +
      "— 二つのキー列の表示が一致することだけを確かめた件数。Python は介在しない",
    `- 合計: **${total}**`,
    `- 不一致: **${failed}**`,
    `- 観測された最大相対誤差: **${relativeQuantity(maxRelativeError, relMeasured)}**`,
    `- 観測された最大絶対誤差: **${exponential(maxAbsoluteError)}**`,
    `- 上書きされたケース: **${overrideCount}**`,
    `- 相対誤差が定義できないケース(期待値が厳密に 0): **${relUndefined}**`,
    `- **表示分解能より緩く検査されたケース: ${looser}** ` +
      `(全 ${total} 件中 ${percentage(looser, total)})`,
    `- **最悪の実効相対許容: ${relativeQuantity(worstEffective, relMeasured)}**`,
    "",
    "## 何をどう確かめたか",
    "",
    "**独立した二つの経路が関与するのは、値ケースの側だけである。**",
    "",
    "- **値ケース。** 生成器は**式木**を 1 本作り、そこから二つの表現を",
    "  描き出す。一つは**キー列**(`lparen 3 add 4 rparen eq` のような、実際に",
    "  押すボタンの列)で、これを Rust の計算コアが wasm として食べる。",
    "  もう一つが**数式テキスト**(`(3 + 4)`)である。",
    "  **Python の mpmath が 50 桁の精度で評価したのは式木の方**で、その値が",
    "  コーパスの `expect` に入っている。電卓の表示とこの期待値を突き合わせる。",
    "  Rust はキー列を歩き、Python は式木を歩く——**参照実装は Rust の移植では",
    "  ない**ので、同じバグが両方に入って一致してしまうことがない。",
    "",
    "  **数式テキスト(`expr`)は検証に使われていない。** これは人が 1 件を",
    "  取り出して手で検算するための描画であって、それを読んで値を出す経路は",
    "  どこにも無い。したがって `expr` の記法に誤りがあっても、このコーパスの",
    "  合否は変わらない。`expr` が審判の入口になるのは外からの投稿を受け付ける",
    "  段階 5 で、そのときは `expr` を値に戻すパーサとその検証が別に要る",
    "  (設計書 §7.4)。",
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
    // **F5 fix (fix round 4).** ここは 2026-08-15 の一度きりの測定であって、
    // この走行で測り直したものではない。当時の値ケースは 2000 件だったが、
    // いまは 4000 件ある——「2000 件中 1996 件」を裸で置くと、直上の見出しが
    // 出している今回の件数と食い違い、現在のコーパスの性質として読まれる。
    // 測定時点と当時の母数を明示して、過去の測定として書く。
    "不一致になった——**2026-08-15 の測定時点、当時の値ケース 2000 件中 1996 件**",
    "である(この走行で測り直した数字ではない)。外の基準(Python が独立に出した",
    "期待値)を持っているのは値ケースだけなので、上の見出しでも件数を分けている。",
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
    // **generate.py ではない。** あちらは testdata/ を作り直す別のスクリプトで、
    // これを回してもコーパスは 1 バイトも変わらない。外から確かめる人が最初に
    // 打つ行なので、ここを間違えると「再現できない」という結論になる。
    "- **期待値の作り直し:** `cd reference && UV_NO_CONFIG=1 uv run python scripts/generate_corpus.py`。",
    "  期待値は Python の mpmath が 50 桁で独立に評価したもので、Rust の移植",
    "  ではない。",
    "- **読む側のコード:** `web/tests/heavy/`。シャードの検証(`corpus.ts`)、",
    "  比較(`withinTolerance` / `classify`)、この報告書の生成(`report.ts`)。",
    "",
    "## シャード別",
    "",
    "| シャード | 総数 | 値 | 同値 | 不一致 | 最大相対誤差 | 最大絶対誤差 | " +
      "上書き | rel未定義(期待値0) | 表示分解能より緩い | 最悪の実効相対許容 | 許容 |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const entry of entries) {
    lines.push(
      `| ${entry.name} | ${entry.total} | ${entry.values} | ${entry.equivalences} | ` +
        `${entry.mismatches.length} | ` +
        `${relativeQuantity(entry.maxRelativeError, entry.relMeasured)} | ` +
        `${exponential(entry.maxAbsoluteError)} | ${entry.appliedOverrides.length} | ` +
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
      looser,
      worstEffective,
      relMeasured,
    }),
  );
  lines.push(...renderDistribution(entries));
  lines.push(...renderOverrides(entries));

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
 * 正しい」が、名指しで緩めたケースについて偽になる。
 *
 * 前は abs/rel の OR のせいで |期待値| < 1 のところが常に rel より緩く
 * 検査されていた(4000 件中 1315 件、最悪 4.15e-4)。判定を rel だけに締めた
 * いま、シャードの rel より緩い帯に落ちるケースがあるとすれば、それは
 * **名指しの上書きが効いているときだけ**である。この節はその分布を出す。
 */
function renderEffectiveTolerance(
  entries: ShardSummary[],
  aggregate: { looser: number; worstEffective: number; relMeasured: number },
): string[] {
  const { looser, worstEffective, relMeasured } = aggregate;
  const lines = [
    "",
    "## 実効的な相対許容の分布",
    "",
    "合否は `|実測 - 期待| / |期待| ≤ rel` で判定している(期待値が厳密に 0 の",
    "ときだけ `|実測 - 期待| ≤ abs` を使う——相対誤差が数学的に定義できない",
    "場合の専用経路であって、rel の代わりではない)。**上書きが無い限り、",
    "実際に検査に使われる相対許容はシャードが宣言する rel そのものである。**",
    "ここでシャードの rel より緩い帯に落ちるケースがあるとすれば、それは",
    "名指しの上書きで rel を差し替えたケースだけである。ここに全件の分布を出す。",
    "",
    `**${looser} 件がシャードの rel より緩く検査されている(すべて名指しの` +
      `上書きによる)。最悪の実効相対許容は ${relativeQuantity(worstEffective, relMeasured)}。**`,
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
    "件数・id・理由の全文は「名指しで緩めたケース」の節にある。",
    "",
    "なお、実効的な相対許容は「そこまでの誤差なら通してしまう」という上限で",
    "あって、観測された誤差ではない。誤差が 0 だったケースでは、許容がどれだけ",
    "広くても結果は変わらない。実際に観測された誤差は上の表の「最大相対誤差」",
    "と「最大絶対誤差」を見ること。",
  );
  return lines;
}

/**
 * **名指しで緩めたケースの開示。**
 *
 * 前の判定(abs/rel の OR)では、この情報は「絶対誤差の側だけで通ったケース
 * (精度限界の実例)」という節に、id と数値だけの整形済み文字列で現れていた。
 * 判定を rel だけに締めたいま、シャードの rel を超えて合格する経路は名指しの
 * 上書きしか残っていないので、同じ情報を、それが実際に起きていること
 * (上書きが適用された)として、id・緩めた倍率・理由の全文つきで開示する。
 * 外の読み手が「何件が特別扱いされ、なぜか」を数えられることが要件である
 * (設計書 §3.5)。
 */
function renderOverrides(entries: ShardSummary[]): string[] {
  const all = entries.flatMap((entry) =>
    entry.appliedOverrides.map((o) => ({ shard: entry.name, ...o })),
  );
  if (all.length === 0) {
    return [
      "",
      "## 名指しで緩めたケース",
      "",
      "**0 件。** すべてのケースがシャードの許容そのままで判定された。",
      "",
    ];
  }
  const lines = [
    "",
    "## 名指しで緩めたケース",
    "",
    `**${all.length} 件。** 下のケースは、シャードの許容では落ちるが、` +
      "理由を添えて個別に緩めてある。緩めた分だけこの層の主張は弱い。",
    "",
    // **上限があることを外の読み手に言う。** 倍率だけ並べると「上書きは
    // 何倍でも書けるのでは」という当然の疑いに答えられない。
    `なお、**上書きにも上限がある**——rel が ${TOLERANCE_CEILING.toExponential()} ` +
      "を超える上書きは、理由が何と書いてあっても読み込みの時点で拒否される" +
      "(シャードの許容に課しているのと同じ上限)。",
    "",
  ];
  for (const o of all) {
    const factor = Math.round(o.rel / o.baseRel);
    lines.push(
      `- \`${o.shard}\` **${o.id}** — rel ${o.rel.toExponential(2)}` +
        `（シャードの ${o.baseRel.toExponential(2)} の **${factor} 倍**）`,
      `  - ${o.reason}`,
    );
  }
  lines.push(
    "",
    // **この段落は上書きが 1 件以上あるときだけ出す。** 以前これは
    // 「この結果が主張していないこと」に固定文字列で置かれており、
    // 上書き 0 件の走行でも「上の『名指しで緩めたケース』に挙がっている
    // のはその実例であり」と印字して、直前の「**0 件。**」と矛盾していた。
    "上に挙がっているのは、いずれも**巨大な角度を三角関数に渡した**ケース",
    "である。角度をラジアンに直す時点で f64 の刻み幅が引数そのものの不確か",
    "さになり、刻み幅は角度の大きさに比例して広がるので、大きな角度ほど入力",
    "の精度が落ち、結果の精度もそれを超えられない。これはバグではなく、",
    "**巨大角度の三角関数が引数還元の限界で表示精度に届かない、既知の領域**",
    "である。全体を緩めて通すのではなく、ここに挙げた分だけを名指しで緩めて",
    "開示することを裁定している。",
    "",
  );
  return lines;
}

/**
 * **注入分がどれだけ効いているかを、この走行の数字で言う(F7、修正ラウンド 4)。**
 *
 * 以前ここは「`neg` 2122 回のうち 74.2%(1574 回)」という手書きの実測値で、
 * **その同じ量をデータから描いている表の真上**に座っていた。書いた時点では
 * 正しかった(実際に再導出して確認されている)が、`equivalence-000.json` を
 * 再生成すれば黙って腐る。左辺の出現回数と注入回数はどちらも集計に入って
 * いるので、そこから出す。
 *
 * 左右を合わせた回数が `左辺 × 2 + 注入` なのは、右辺が**左辺のキー列に恒等
 * 変換を被せたもの**だからである(`_equivalent_pair`。変換はキーを足すだけで
 * 減らさないので、左辺の分は右辺にもそのまま現れる)。`countInjectedTokens`
 * が数えているのは、その差分の正の側そのものである。
 */
function injectionShare(
  entries: ShardSummary[],
  token: string,
):
  | { left: number; added: number; combined: number; share: string }
  | undefined {
  const entry = entries.find((e) => e.addedByTransform !== undefined);
  const added = entry?.addedByTransform?.[token] ?? 0;
  const left = entry?.shape.tokens[token] ?? 0;
  if (entry === undefined || added === 0) {
    return undefined;
  }
  const combined = left * 2 + added;
  return { left, added, combined, share: percentage(added, combined) };
}

/** 設計書 §11:「分布そのものを報告書に載せて、外から検証可能にする。」 */
function renderDistribution(entries: ShardSummary[]): string[] {
  const negShare = injectionShare(entries, "neg");
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
    "計上される**。",
    ...(negShare === undefined
      ? []
      : [
          `この走行では左辺の \`neg\` が ${negShare.left} 回、変換が右辺に足した \`neg\` が ${negShare.added} 回。`,
          `左右を合わせた ${negShare.combined} 回のうち **${negShare.share}** が注入分になる`,
          "(右辺は左辺のキー列に変換を被せたものなので、左辺の分は右辺にも",
          "そのまま現れる)。この 3 つの数字は下の表と同じ集計から導いている",
          "——手で書いた実測値ではない。",
        ]),
    "この表が答えているのは「同じような式を大量に試しただけか」",
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
function pressedCounts(entries: ShardSummary[]): Record<string, number> {
  const pressed: Record<string, number> = {};
  for (const entry of entries) {
    for (const source of [entry.shape.tokens, entry.addedByTransform ?? {}]) {
      for (const [token, count] of Object.entries(source)) {
        pressed[token] = (pressed[token] ?? 0) + count;
      }
    }
  }
  return pressed;
}

function unusedKeyTokens(entries: ShardSummary[]): string[] {
  const pressed = pressedCounts(entries);
  return KEY_TOKENS.filter((token) => (pressed[token] ?? 0) === 0);
}

/**
 * **「括弧を省いた式」の項目が、この走行でどの形で出るか。**
 *
 * 3 状態あり、以前は項目自身が `precedence === 0` で 2 分岐、直後の但し書きが
 * `precedenceShard === undefined` で 2 分岐していた——**別々の述語で分岐する
 * 2 つの文章**である。`(precedence === 0, シャード無し)` の走行、つまり
 * 優先順位シャードを含まない**すべての**走行で、但し書きは項目を
 * 「見出しの件数だけの、完全にデータ由来の行である」と説明していたが、
 * その状態の項目は件数を 1 つも含まない固定文だった(F3、修正ラウンド 4)。
 * 状態をここで 1 度だけ決めて、項目と但し書きの両方がこれを見る。
 */
type ParenthesisItemState =
  /** 優先順位を一度も踏んでいない。項目は件数を持たない固定文。 */
  | { kind: "untouched" }
  /** 踏んだ件数はデータ由来。ただし優先順位シャード固有の内訳は出せない。 */
  | { kind: "counted" }
  /** 件数に加えて、reference テストが固定した内訳(1101)が付く。 */
  | { kind: "counted-with-pinned-breakdown"; shard: ShardSummary };

function renderCaveats(entries: ShardSummary[]): string[] {
  const unused = unusedKeyTokens(entries);
  const precedence = entries.reduce((sum, e) => sum + e.precedenceCases, 0);
  // **F6b fix (fix round 4).** 「上の『4000 件通った』」は以前リテラルで、
  // 2000 件だけの走行でも 4000 と書いた。見出しと同じ集計から出す。
  const valueCases = entries.reduce((sum, e) => sum + e.values, 0);
  // **N1 fix (review round 3).** The elaboration below (the pinned figure and
  // the associativity caveat) is a specific claim about how
  // `precedence-000.json` was built — it is true only when that shard is
  // actually part of this run. The old version rendered it unconditionally
  // whenever the *aggregate* `precedence` count was non-zero: measured with a
  // summary set holding only `scientific-000.json` and a count of 7, the
  // report still named `precedence-000.json`, still claimed it held 2000
  // cases, and still printed the figure — for a run that never touched that
  // shard. The head phrase (`precedence` itself) stays unconditional because
  // it is genuinely derived from whatever shard(s) are in this run.
  //
  // **The name is built by `summaryName`, not written out here (F9, fix round
  // 4)** — see that function for why a second hand-written copy of the format
  // is a silent failure.
  const precedenceShard = entries.find(
    (e) => e.name === summaryName(PRECEDENCE_SHARD, "values"),
  );
  const parenthesis: ParenthesisItemState =
    precedence === 0
      ? { kind: "untouched" }
      : precedenceShard === undefined
        ? { kind: "counted" }
        : { kind: "counted-with-pinned-breakdown", shard: precedenceShard };
  const errors = entries.reduce((sum, entry) => sum + entry.errorCases, 0);
  const errorItem =
    errors === 0
      ? [
          "- **エラー経路。** ゼロ除算・オーバーフロー・三角関数の極・構文エラーは",
          "  生成の時点で範囲外にしている。エラーが出たケースは不一致として扱う。",
        ]
      : [
          `- **エラー経路——${errors} 件は照合済み、それ以外は範囲外。**`,
          "  金融とデータスケールは**入力の検証が仕事の一部**なので、",
          "  エラーになること自体を期待値として持ち、**エラー名まで突き合わせる**",
          "  (返済額が利息に届かない、桁が読めない、など)。",
          "  一方、科学計算のシャードはゼロ除算・定義域外・三角関数の極を",
          "  **生成の時点で捨てている**——そちらでエラーが出たら不一致として扱う。",
          "  **つまり「エラーを検証している領域」と「していない領域」がある。**",
        ];
  const exponent = entries.reduce(
    (sum, entry) => sum + entry.exponentDisplayCases,
    0,
  );
  const exponentItem =
    exponent === 0
      ? [
          "- **指数表記の表示。** 生成器が値を `1e-6`〜`1e9` に閉じ込めているので、",
          "  **平坦表示の帯を一度も出ていない**。`parseDisplay` は指数表記を",
          "  受け付けるが、受け付けることと実際に読んだことは違う。",
        ]
      : [
          `- **指数表記の表示——${exponent} 件が読んでいる。** 組合せ論のシャードが`,
          "  帯を外したので、答が `1e10` 以上になるケースが出るようになった",
          "  (設計書 2026-08-16-corpus-functions §3.2.1)。表示は指数表記でも",
          "  有効数字 10 桁なので、許容はそのまま効く。",
        ];
  // **角度モードと表示のトグルは、押した回数から導く。**
  //
  // ここは長らく「全ケースが Deg で、`angle_toggle` を一度も押していない」と
  // 固定文で書かれていた。段階 H が Rad のシャードを 2000 件足した時点で
  // **その一行だけが嘘になった**——検査は全部緑のまま、報告書が自分の
  // コーパスについて事実と違うことを言う、という壊れ方である
  // (同じ形の矛盾を読み手が 3 件指摘したのが 2026-08-17)。
  //
  // 押した回数はキーの集計から出るので、**手で消し忘れることがない。**
  const pressed = pressedCounts(entries);
  const angleToggles = pressed.angle_toggle ?? 0;
  const angleItem =
    angleToggles === 0
      ? [
          "- **Deg 以外の角度モード。** 全ケースが Deg で、`angle_toggle` を一度も",
          "  押していない。**角度モードは Deg と Rad の 2 つ**で、Rad の",
          "  三角関数はこの層の外である。",
        ]
      : [
          `- **角度モード——${angleToggles} 本のキー列が \`angle_toggle\` を押している。**`,
          "  **角度モードは Deg と Rad の 2 つ**(`numeric/angle.rs`)で、両方を踏んでいる。",
          "  押した回数の偶奇がケースの宣言する `mode` と一致することを",
          "  `assertSupportedMode` が確かめる——押さずに `Rad` と名乗るケースは、",
          "  黙って Deg の答えと比べられてしまうので受け付けない。",
        ];
  // **複素数も押した回数から導く。** 角度モード・表示の記法と同じ理由である
  // ——固定文にしておくと、踏んだ瞬間にレポートだけが古い否定を言い続ける。
  const imaginaryPresses = pressed.j ?? 0;
  const polarPresses = pressed.polar_toggle ?? 0;
  const complexItem =
    imaginaryPresses === 0 && polarPresses === 0
      ? [
          "- **複素数。** 負数の平方根は範囲外で、`j` も `▸∠` も一度も押していない。",
          "  複素数の表示(`j2` のような形)を読んだケースは 1 件も無い。",
        ]
      : [
          `- **複素数——\`j\` を ${imaginaryPresses} 本、\`▸∠\` を ${polarPresses} 本のキー列が押している。**`,
          "  この電卓は複素数を持っている——`j` で虚数単位を打ち、四則が複素数のまま",
          "  動き、`▸∠` で極形式に切り替わる。期待値は Python の SymPy が**厳密な",
          "  有理数**で木全体を計算し、最後に 1 度だけ f64 に落としたものである",
          "  (engine は f64 の対で、演算ごとに丸める)。",
          "",
          "  **関数の定義域は一様ではない**(実測 2026-08-17)。`sqrt` `ln` `log10`",
          "  `recip` `n!` は複素数を `DomainError` で弾くが、**`sin` `cos` `tan` は",
          "  複素数のまま計算する**——実部・虚部の両方を同じ係数でラジアンに直す、",
          "  と実装自身が書いている。コーパスは受け付けるほうだけを踏む。",
          "",
          "  **負数の平方根は依然として範囲外である。** `√(-4)` は `j2` ではなく",
          "  `Math ERROR` を返す。`j2` という表示は出るが、それは `j` `2` と",
          "  打ったときであって、平方根の答えとしてではない。",
        ];
  const notationPresses = (pressed.eng ?? 0) + (pressed.dms ?? 0);
  const notationItem =
    notationPresses === 0
      ? [
          "- **表示の記法。** `ENG` も `°'\"` も一度も押していない。**値を変えない",
          "  キーなので、値だけを見るケースでは押しても押さなくても同じ答えになる**",
          "  ——踏んだことを主張するには表示文字列そのものを比べる必要がある。",
        ]
      : [
          `- **表示の記法——${notationPresses} 本のキー列が \`ENG\` か \`°'"\` を押している。**`,
          "  この 2 つは**値を変えない**ので、値だけを見るケースでは押しても",
          "  押さなくても同じ答えになる。だから `display` のシャードだけは",
          "  **表示文字列そのものを厳密一致で比べる**。期待値は Python の別実装",
          "  (`sexagesimal_ref` と `eng_ref`)が出しており、どちらも Rust の",
          "  手順を写していない。",
          "",
          "  **そのシャードの値は「打った数そのもの」に限っている。** 計算を挟むと、",
          "  engine と参照の f64 が数 ulp 違うだけで表示の 10 桁目が変わり、",
          "  整形の欠陥と計算の丸めを区別できなくなる(実測 5/2000)。",
          "  計算を挟む式には「トグルを 2 回押すと元の表示に戻る」ことだけを主張させた。",
        ];
  // **但し書きが名指しする「完全に固定の文章」の一覧。**
  // 項目そのものと同じ述語から組み立てる——別々に書くと、片方だけが動く。
  const fixedItems = [
    ...(imaginaryPresses === 0 && polarPresses === 0 ? ["複素数"] : []),
    ...(angleToggles === 0 ? ["角度モード"] : []),
    ...(notationPresses === 0 ? ["表示の記法"] : []),
    "UI",
    "入力中の表示",
  ];
  const parenthesisItem =
    parenthesis.kind === "untouched"
      ? [
          "- **括弧を省いた式。** キー列は二項演算を必ず括弧で囲む。したがって",
          "  演算子の優先順位と保留演算の意味論(`1 + 2 * 3` が 7 か 9 か)を",
          "  **一度も踏んでいない**。そこは `engine_table.rs` の担当である。",
        ]
      : [
          // **I1 fix (review round 2), step A.** この見出し文は R9 が実際に
          // 証明していることだけを言う——「同じ括弧の組に優先順位の異なる
          // 二項演算子が 2 つ以上」。「優先順位が無ければ正しく解釈できない」
          // とは**言わない**——独立した意味論パーサで測ると、drop の 45%
          // (899/2000、例 `prec-000001` = `(541 / 138) + 748`)は左結合の
          // 自然な読みと一致し、無くても同じ木になる。
          //
          // **F6 fix (fix round 4).** その限定は以前、優先順位シャードが
          // 走行に含まれるときだけ出る段落の中にしか無かった——N1 のゲートが
          // 「engine は括弧ではなく優先順位で構造を決めた」を限定なしで
          // 立たせたまま、限定する段落だけを消していた。限定を見出し文の側に
          // 移し、**どの分岐でも**主張に付いて回るようにする。シャード固有の
          // 内訳(何件がそうなのか)だけを下でゲートする。
          `- **括弧を省いた式——${precedence} 件が踏んでいる。** 同じ括弧の組の`,
          "  中に優先順位の異なる二項演算子が 2 つ以上並ぶキー列がこれだけある。",
          "  engine はその構造を括弧ではなく優先順位から復元した。**ただしこの",
          "  件数は「優先順位が無ければ誤答になる」件数ではない**——括弧を省いた",
          "  列にも、左結合で素直に読んだだけで同じ木になるもの(例 `(541 / 138)",
          "  + 748`)が相当数含まれる。その内訳は浮動小数の一致では測れず、",
          "  構文木そのものを突き合わせないと出ない。",
          ...(parenthesis.kind !== "counted-with-pinned-breakdown"
            ? [
                // **シャード名も件数もここでは出さない。** この走行はその
                // 内訳を測っていないのだから、測った側の固有名を出す資格が
                // ない(N1 が塞いだのはまさにその形である)。
                "  **この走行にはその内訳を測ったシャードが含まれていないので、",
                "  何件がそうなのかはここでは出せない。**",
              ]
            : [
                "",
                // **step B.** 「踏んだ」件数(構造を優先順位で決めた)と「無ければ
                // 誤答になる」件数は別である。後者は reference の構文木比較でしか
                // 測れない。手で数えるとポストフィックス単項の罠(`1 add 2 sqrt`
                // は `√(1+2)` ではなく `1 + √2`)を踏みやすいので、生成器が実際に
                // 持っている木と、優先順位を使わず同じキー列を読み直した木を、
                // 構造として直接突き合わせている。
                "  **その内訳がこの走行では測れている。**",
                `  \`${PRECEDENCE_SHARD}\` の ${parenthesis.shard.total} 件のうち、実際に優先順位が`,
                `  無いと別の木になる件数は **${PRECEDENCE_CHANGES_MEANING} 件**。`,
                // **N7 fix (review round 3), 理由を訂正(F10、修正ラウンド 4)。**
                // 前はここが 1 本の ~200 字の行だった。折ったのは正しいが、
                // 当時書いた理由(「この文書はどこも ~40〜70 字で折り返して
                // いる」)は事実ではない——「使っていないキートークン」の行は
                // 1 本で ~225 字あり、同じ節でいちばん長い。本当の理由は、
                // テストの完全修飾パスが 1 語として折れないこと:同じ行に文を
                // 混ぜると、その行だけが他の 2 倍以上に伸びて差分が読めなくなる。
                // だから前後の文をそれぞれ独立の行にして、折れない 1 語だけを
                // 孤立させている。
                "  この数値は reference のテストが構文木の等価性そのもので厳密に",
                "  測り、固定している",
                "  (`reference/tests/test_generate_corpus.py::" +
                  "test_precedence_shard_reports_how_many_cases_change_meaning_without_precedence`)。",
                "  この数はそのテストの assert に固定された値であって、ここで",
                "  再計算したものではない——シャードを再生成したらそのテストを",
                "  走らせて検算すること。**両者が食い違ったらレポートのテストが",
                "  赤くなる**(`report.spec.ts` がその assert を実際に読んで",
                "  照合している)ので、片方だけ直して黙って食い違うことはない。",
                "",
                "  **結合方向は踏んでいない**——同順位の入れ子は括弧を残して生成して",
                "  いるので、`10 - 3 - 2` のような列が一件も無い。省けるのは左結合だからで、",
                "  省いた瞬間に生成側が結合方向を知ることになるため、意図して残している",
                "  (設計書 2026-08-16 §3.1)。結合方向は `engine_table.rs` の担当である。",
              ]),
        ];
  return [
    "",
    "## この結果が主張していないこと",
    "",
    "電卓の表示は整形済みの文字列で、数値をそのまま取り出す口がない。",
    "したがってこの層が言えるのは**表示される桁まで正しい**ことであって、",
    "倍精度の最後の桁まで正しいことではない。より深い精度は Rust 側の",
    "単体テストと golden(Layer 1〜4)の担当である。",
    "",
    "**名指しで緩めたケースの分だけ、この層の主張は弱い。** 件数と理由の全文は",
    "「名指しで緩めたケース」の節にある。0 件ならその節がそう書く。緩めた",
    "ケースがなぜ緩められたのか(巨大角度の三角関数という既知の領域)の説明も、",
    "**実例があるときだけ**その節に出る——実例が無い走行で「上に挙がっている",
    "のはその実例であり」と書けば、それは 0 件という事実と矛盾する。",
    "",
    // **N5 fix (review round 3).** 見出しはもともと「まだ一度も踏んでいない
    // 領域」だった。I2(review round 2)が直下の前置きの自己矛盾(「一件も
    // 含んでいない」の直後に「2000 件が踏んでいる」)を直したが、見出し自身の
    // 「一度も」はそのまま残していた——矛盾は消えたのではなく 1 行上に
    // 移っただけだった。見出しと前置きを同時に、同じ言い方で直す。
    "### まだ踏んでいない、または限定的にしか踏んでいない領域",
    "",
    // **I2 fix (review round 2).** 以前ここは「以下はこのコーパスが一件も
    // 含んでいない」で固定していたが、直後の「括弧を省いた式」の項目が
    // 2000 件踏んでいる走行ではその場で自己矛盾していた——ブランチ分けは
    // 箇条書きの側だけを直し、この前置きは直していなかった。「守備範囲の外
    // か、限定的にしか踏んでいない」で、0 件の項目にも N 件の項目にも
    // 矛盾なく掛かるようにする。
    "以下はこのコーパスの守備範囲の外か、限定的にしか踏んでいない領域である。",
    // **F8 fix (fix round 4).** 以前ここは「緑であることは、これらについて
    // 何も言っていない」だった。N5(review round 3)が見出しの「一度も」を
    // 直したときに、矛盾はもう 1 行下のこの文へ移っていた——「括弧を省いた式」
    // の項目は 2000 件が緑で通ったことを報告しており、その項目については
    // 「何も言っていない」は端的に偽である。守備範囲の外の項目と、限定的に
    // 踏んでいる項目とで、緑の意味が違うことを書き分ける。
    "**守備範囲の外の項目については、緑であることは何も言っていない。**",
    "限定的に踏んでいる項目については、どこまで踏んだのかをその項目自身が書く。",
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
    ...parenthesisItem,
    ...exponentItem,
    // **`xʸ` は押されるが、結合方向にも優先順位 4 にも触れていない。**
    // キー列は二項を必ず括弧で囲むためである(設計書 2026-08-16-corpus-functions
    // §3.5)。新しい関数の検証と結合方向の検証を混ぜると、赤が出たときどちらが
    // 原因か分からなくなるので、意図して分けている。
    "- **`xʸ` の右結合と優先順位 4。** `pow` は押されるが、キー列は二項を必ず",
    "  括弧で囲むので、**右結合も優先順位 4 も踏んでいない**。これは意図した",
    "  分離である(設計書 2026-08-16-corpus-functions §3.5)。",
    "  **上の「この検査は壊れたものを見つけられるのか」の表がその裏付けである**",
    "  ——結合方向を反転する変異で 1 件も赤くならない。",
    ...errorItem,
    ...complexItem,
    ...angleItem,
    ...notationItem,
    "- **UI(この走行では)。** ここが呼ぶのは計算コアの `dispatch` と wasm の",
    "  関数だけで、ボタンもキーボードも通らない。**この走行のブラウザには",
    "  アプリの画面が存在しない**——`web/vite.heavy.config.ts` は React を",
    "  含まず、入口も `heavy-harness.html` の 1 つだけである。",
    "",
    "  **ただし盤面を通る走行が別にある。** `pnpm heavy:ui` が本物のアプリを",
    "  開き、キートークンとボタンの対応を盤面の定義から導いて実際に押す——",
    "  同じワークフローの次の段がそれで、**その結果はこの報告書には載らない**",
    "  (別の走行なので集計を共有しない)。**この報告書だけを見て「UI も",
    "  確かめた」と読まないこと。** 逆に、この報告書が緑でも",
    "  「盤面のどのボタンからその関数に届くか」——Shift 層の奥にあるキー、",
    "  押せない位置にあるボタン、表示に配線し忘れた欄——は何も分からない。",
    "",
    "  **この層が答えるのは「計算が合っているか」だけである。**",
    "  それが一番問われるところではあるが、それだけではアプリが正しいとは言えない。",
    "- **入力中の表示。** 全ケースが `=` で終わるので、**確定した値の表示しか",
    "  踏んでいない**。電卓には表示の規則が二つあり(`render()` の分岐)、入力中は",
    "  打った文字がそのまま出て、確定後だけが整形を通る。`1e10` を打ち込むと平坦な",
    "  `10000000000` が出るが、同じ値を計算で作ると `1e10` になる(2026-08-16 実測)。",
    // **F6b fix (fix round 4).** 以前ここは「上の『4000 件通った』」という
    // リテラルで、(a) 2000 件だけの走行でも 4000 と言い、(b) 引用元だと
    // 称する文字列が上に literal には出てこなかった(見出しは「二経路で
    // 照合したケース(値): 4000」)。見出しと同じ集計から、見出しと同じ
    // 言い方で引く。
    `  **上の「二経路で照合したケース(値): ${valueCases}」は、確定値の表示に`,
    "  ついてだけの主張である。**",
    "  なお入力中の側は踏む価値も薄い——「打った文字がそのまま出る」は規則というより",
    "  恒等写像で、破れるとしたら「打った文字が出ない」という壊れ方になる。それは",
    "  この層の道具立て(表示を数に戻して期待値と突き合わせる)では捕まえにくく、",
    "  既存の E2E(Layer 5)の方が向いている。",
    "",
    // **N6 fix (review round 3).** 以前ここは「括弧を省いた式」が丸ごと
    // データ由来であるかのように書いていたが、N1(review round 3)以降、
    // その項目はこの走行の内容によって違う——`precedence-000.json` 自身が
    // この走行に含まれるときだけ、reference テストの assert に固定された
    // 手書きの数値(1101)を伴う段落が付く。含まれない走行では、見出しの
    // 件数だけの完全にデータ由来な行になる。disclaimer 自身もそれに合わせて
    // 書き分ける——固定文にしてしまうと、precedenceShard が無い走行でこの
    // disclaimer 自体が存在しない主張(手書きの数値・シャード名)をすることになる。
    //
    // **F3 fix (fix round 4).** その書き分けは `precedenceShard === undefined`
    // を見ていたのに、項目自身は `precedence === 0` を見ていた——**別の述語**
    // である。両方が偽になる状態、つまり優先順位を一度も踏んでいない走行では、
    // 項目は件数を 1 つも含まない固定文なのに、この但し書きが「見出しの件数
    // だけの、完全にデータ由来の行である」と説明していた。いまは項目と
    // 但し書きが同じ `parenthesis.kind` を見る。
    "> **この節は手で保守されている。** 「使っていないキートークン」の行は",
    "> 走行の実データから導かれている。「括弧を省いた式」の項目は",
    ...(parenthesis.kind === "untouched"
      ? [
          "> この走行では**完全に固定の文章**である——この走行は優先順位を一度も",
          "> 踏んでいないので、この項目は件数を一つも含んでいない。",
        ]
      : parenthesis.kind === "counted"
        ? [
            "> この走行では見出しの件数だけの、完全にデータ由来の行である",
            "> (詳細な内訳を伴う手書きの段落は、その内訳の元になるシャードが",
            "> この走行に含まれるときだけ付く)。",
          ]
        : [
            "> **半分だけ**データ由来である——見出しの件数とシャードの有無判定は",
            `> 実データからだが、\`${PRECEDENCE_SHARD}\` の ${parenthesis.shard.total} 件中`,
            `> ${PRECEDENCE_CHANGES_MEANING} 件が意味を変える、という段落そのものは`,
            "> reference テストの assert に固定された数値である(その assert と",
            "> ここが食い違えば `report.spec.ts` が赤くなる)。",
          ]),
    "> 「エラー経路」と「指数表記」の 2 行も、件数を実データから導いている。",
    // **一覧を手で書かない(2026-08-17)。** ここは長らく
    // 「複素数・角度モード・UI・入力中の表示の 4 行」と固定で書かれており、
    // 段階 H が Rad を、段階 I が表示のトグルを踏んだ時点で嘘になった。
    // 見張っていたはずの `report.spec.ts` のテストは**この文字列がそこに
    // あること**を確かめていただけで、項目側が実データ由来になったかどうかを
    // 一切見ていない——つまり腐っても緑のままだった。
    // いま一覧は、項目の分岐と**同じ述語**から組み立てる。
    `> **完全に固定の文章なのは、${fixedItems.join("・")}の ${fixedItems.length} 行**`,
    "> である——どれもこのコーパスが 1 件も踏んでいないので、数える対象が無い。",
    `> **その ${fixedItems.length} つのどれかを踏むようになったら、ここを書き換えること。**`,
    "> 書き換えを忘れると、この報告書は実際には埋まった領域を",
    "> 「守備範囲の外」と言い続ける。**信憑性を目的とした文書でそれが起きると、",
    "> 数字が正しくても文書全体が信用を失う。**",
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

/** 実際に走った実行環境を記録する。シャードごとに呼ばれてよい(最後が残る)。 */
export function noteRuntime(coreVersion: string, browser: string): void {
  runtime.coreVersion = coreVersion;
  runtime.browser = browser;
}

/**
 * **揃っていない走行を、緑の顔で書き出さない。**
 *
 * 走行の最後(`globalTeardown`)に 1 度だけ呼ぶ。ディスクに残った集計を読み、
 * コーパスから導いた「揃っているべき集計」と突き合わせる。
 *
 * - 一枚も無い / 値ケースが一件も走っていない → **書き出さずに落ちる**。
 *   `resetRun()` が古い報告書を消してあるので、緑の顔が残ることもない。
 * - 一部が欠けている → 本文の先頭に**欠落を大書きしてから**書き出し、落ちる。
 *   「値: 0 / 不一致: 0」が正常な結果と同じ見た目になる経路を構造的に潰す。
 */
export function writeReport(): void {
  const recorded = readRecorded();
  const expected = expectedSummaryNames();
  const seen = new Set(recorded.map((entry) => entry.summary.name));
  const missing = expected.filter((name) => !seen.has(name));
  const entries = recorded.map((entry) => entry.summary);
  const valueCases = entries.reduce((sum, entry) => sum + entry.values, 0);

  if (entries.length === 0) {
    throw new Error(
      "report: no shard summary survived the run — refusing to write a " +
        "report at all. Expected " +
        `${expected.map((name) => JSON.stringify(name)).join(", ")}. ` +
        "A report written from nothing would read as '0 cases, 0 " +
        "mismatches' and look like a pass.",
    );
  }
  if (valueCases === 0) {
    throw new Error(
      "report: not a single value case was recorded. The value cases are " +
        "the only half of this layer that is checked against an outside " +
        "reference (the expectations Python produced independently); a run " +
        "of equivalence cases alone verifies nothing but the calculator's " +
        "agreement with itself. Refusing to write a report for it. " +
        `Recorded: ${[...seen].map((name) => JSON.stringify(name)).join(", ")}.`,
    );
  }

  // 素性は記録された側から拾う。ワーカーが死ぬと `runtime` はこのプロセスで
  // "unknown" のままなので、集計と一緒にディスクへ落としたものを使う。
  const known = recorded
    .map((entry) => entry.runtime)
    .filter((value) => value.coreVersion !== "unknown");
  const provenanceRuntime = known[known.length - 1] ?? runtime;

  const markdown = renderReport(
    entries,
    {
      ranAt: new Date().toISOString(),
      commit: gitDescription(),
      coreVersion: provenanceRuntime.coreVersion,
      browser: provenanceRuntime.browser,
    },
    missing,
  );
  writeFileSync(REPORT_PATH, markdown, "utf-8");
  console.log(`wrote ${REPORT_PATH}`);
  if (missing.length > 0) {
    throw new Error(
      `report: ${missing.length} expected shard summary/summaries never ` +
        `reached disk (${missing.map((name) => JSON.stringify(name)).join(", ")}). ` +
        "The report was written with the incompleteness stated at the top of " +
        "the document; do not read its numbers as this corpus's result.",
    );
  }
}

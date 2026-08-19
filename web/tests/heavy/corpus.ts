import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { KEY_TOKENS } from "../../src/calc/types";
import { type ComplexValue, magnitude, zeroComponentsAgree } from "./complex";

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

/** 電卓が持つ角度モード。**2 つだけ**——`Grad` は存在しない(`numeric/angle.rs:5`)。 */
export const ANGLE_MODES = ["Deg", "Rad"] as const;

/** そのキー列が `angle_toggle` を何回押すか。 */
function angleToggles(keys: string[]): number {
  return keys.filter((key) => key === "angle_toggle").length;
}

/**
 * ケースが宣言したモードと、キー列が実際に作るモードが一致しているか。
 *
 * **`mode` を書くだけでは嘘になる。** harness はキー列を流すだけなので、
 * `angle_toggle` を押さなければ engine は既定の `Deg` で評価する
 * ——宣言が `Rad` でも黙って `Deg` の答えと比べることになる。
 *
 * **番人を「押していれば何でも許す」に緩めない。** 押した**回数の偶奇**まで
 * 見る——`Deg` は偶数回(押していないか、押して戻した)、`Rad` は奇数回である。
 * 緩めると「2 回押して `Rad` と名乗るケース」が通り、それは `Deg` で評価される。
 */
export function assertSupportedMode(
  name: string,
  // **構造で受ける。** 本体は既に `"keys" in testCase` で鍵の有無を見ており、
  // `CorpusCase` に固定する理由が無い。固定したままだと表示のシャードが
  // この番人を通れず、**角度モードの検査だけが静かに掛からない**シャードが増える。
  cases: readonly { id: string; mode: string }[],
): void {
  const offenders: string[] = [];
  for (const testCase of cases) {
    const mode = testCase.mode;
    if (!(ANGLE_MODES as readonly string[]).includes(mode)) {
      offenders.push(
        `${testCase.id}: mode ${JSON.stringify(mode)} is not one of ${ANGLE_MODES.join(", ")}`,
      );
      continue;
    }
    const keys =
      "keys" in testCase && Array.isArray(testCase.keys)
        ? (testCase.keys as string[])
        : [
            ...((testCase as { left?: string[] }).left ?? []),
            ...((testCase as { right?: string[] }).right ?? []),
          ];
    const odd = angleToggles(keys) % 2 === 1;
    if (mode === "Rad" && !odd) {
      offenders.push(
        `${testCase.id}: declares Rad but presses angle_toggle an even number of times, so the engine evaluates it in Deg`,
      );
    }
    if (mode === "Deg" && odd) {
      offenders.push(
        `${testCase.id}: declares Deg but presses angle_toggle an odd number of times, so the engine evaluates it in Rad`,
      );
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `${name}: ${offenders.length} case(s) declare an angle mode the key ` +
        `sequence does not produce: ${offenders.slice(0, 5).join("; ")}`,
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
  const declared = shard.cases as unknown as {
    id?: string;
    kind?: string;
    tolerance?: unknown;
  }[];
  assertNoCaseTolerance(name, declared);
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
 * **ケース単位の `tolerance` を、大きな声で拒む。**
 *
 * 設計書 §4.3 は当初「必要なケースだけ個別に上書きできる」と書いていたが、
 * **ケース単位の上書きは実装されていない**。しかも書いても警告なく黙って
 * 無視される状態だった——実測で、1 件に `{abs: 1e30, rel: 1e30}` を足しても
 * 43 passed / EXIT=0、無警告。投稿者は「効いている」と思い込み、レビュアーは
 * JSON を読んで「効いている」と読む。どちらも間違っている、という壊れ方である。
 *
 * **訂正(2026-08-16、段階 3a)。** ここは以前「段階 3 のマグニチュード依存の
 * 許容と同じ機構になるので、実装はそこで一緒に行う」と書いていた。**その行き先は
 * 無い。** 段階 3a はマグニチュード依存を明示的に否定し(3a 設計書 §2——害を
 * 与えていたのは `abs` の床であって `rel` ではなかった)、ケース単位の緩和は
 * `corpus/overrides.json` として実装済みである(3a 設計書 §3.3)。
 *
 * **ケース単位の tolerance はシャードには書けない。** `corpus/generated/` は
 * 再生成一致ゲートが「生成器の出力とバイト単位で一致」を毎回確かめている領域で、
 * 人の判断を混ぜるとその保証が壊れる。人の判断による緩和は `overrides.json` に、
 * 理由つきで書く。ガードの挙動は変わらない——**黙って無視するのではなく、
 * 名指しして落ちる**。
 */
export function assertNoCaseTolerance(
  name: string,
  cases: { id?: string; tolerance?: unknown }[],
): void {
  const overriding = cases.filter((c) => c.tolerance !== undefined);
  if (overriding.length > 0) {
    const shown = overriding
      .slice(0, 5)
      .map(
        (c) => `${c.id ?? "(no id)"} carries ${JSON.stringify(c.tolerance)}`,
      );
    throw new Error(
      `${name}: ${overriding.length} case(s) declare their own tolerance: ` +
        `${shown.join(", ")}. The comparison reads the shard-level tolerance ` +
        "only, so a case-level one would be silently ignored while looking " +
        "like it applies. This is not a feature waiting to be built: a shard " +
        "under corpus/generated/ is held byte-identical to the generator's " +
        "output by the regeneration gate, so human judgement must not be " +
        "written into it. A case that genuinely needs a looser tolerance is " +
        "named, with a written reason, in corpus/overrides.json (stage 3a " +
        "design §3.3). This suite refuses the shard instead of running it " +
        "under a tolerance nobody applied.",
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

/**
 * 関数呼び出しのシャード(金融・データスケール)の名前。
 *
 * **キー列のシャードとは形も比較の仕方も違う**ので、別のローダーが読む
 * (設計書 2026-08-17 §3.1)。ここで名前を挙げているのは、`loadShards` が
 * 黙って読み飛ばして「そんなシャードは無かった」ことにしないためである。
 */
export const CALL_SHARD_PATTERN = /^(finance|data-scale)-\d+\.json$/;

/**
 * 表示のトグルのシャード。**値ではなく表示文字列を比べる。**
 *
 * `eng` と `dms` は値を変えないので、既存の「値を比べる」仕組みが使えない
 * (設計書 2026-08-17-display §3.1)。
 */
export const DISPLAY_SHARD_PATTERN = /^(display|complex-display)-\d+\.json$/;

/** 表示を主張するケース。`expect.main` は**表示文字列そのもの**。 */
export interface DisplayCase {
  kind: "display";
  id: string;
  mode: string;
  keys: string[];
  expr: string;
  expect: { main: string };
}

/**
 * 表示のシャードの同値ケース。**`expr` を必ず持つ。**
 *
 * 既存の `EquivalenceCase` は `expr` を持たない——括弧の有無だけが違う
 * 2 本のキー列で、式は 1 つしか無いからである。こちらは「この値は 60 進に
 * できないので `dms` を押しても表示が変わらない」という主張で、
 * **どの値についての主張かが読めないと不合格の報告が意味をなさない。**
 */
export interface DisplayEquivalenceCase extends EquivalenceCase {
  expr: string;
}

export interface DisplayShard {
  schema: number;
  generated_by: string;
  cases: (DisplayCase | DisplayEquivalenceCase)[];
}

/**
 * 表示のシャードを読む。**`tolerance` を持たない**——文字列の厳密一致なので
 * 許容誤差の概念が無く、持たせると「緩めれば通る」余地が生まれる。
 */
export function loadDisplayShards(): { name: string; shard: DisplayShard }[] {
  const shards = readdirSync(CORPUS)
    .filter((name) => DISPLAY_SHARD_PATTERN.test(name))
    .sort()
    .map((name) => ({
      name,
      shard: JSON.parse(
        readFileSync(join(CORPUS, name), "utf-8"),
      ) as DisplayShard,
    }));
  for (const { name, shard } of shards) {
    if (shard.schema !== KNOWN_SCHEMA) {
      throw new Error(
        `${name}: schema ${JSON.stringify(shard.schema)} is unknown`,
      );
    }
    if (!Array.isArray(shard.cases) || shard.cases.length === 0) {
      throw new Error(
        `${name}: the shard carries no cases. An empty shard runs green ` +
          "while verifying nothing, so it is refused here.",
      );
    }
    const strangers = shard.cases.filter(
      (c) => c.kind !== "display" && c.kind !== "equivalence",
    );
    if (strangers.length > 0) {
      throw new Error(
        `${name}: ${strangers.length} case(s) are neither "display" nor ` +
          '"equivalence" — they would be dropped without a warning.',
      );
    }
  }
  return shards;
}

/** 関数呼び出しのケース 1 件。 */
export interface CallCase {
  kind: "call";
  id: string;
  op: string;
  input: Record<string, string | number | boolean>;
  expect: Record<string, unknown>;
}

export interface CallShard {
  schema: number;
  generated_by: string;
  /**
   * 生成器が捨てた件数。**`reference_gave_up` は理由別の内訳を持つ**——
   * `near_yen_boundary`(意図的な棄却)・`compound_deposit_search_limit`
   * (参照実装の探索限界)・`other`(未分類。1 件でも出たら生成器が落ちる)。
   *
   * `Record<string, number>` と書いてあった。内訳が入った日にこの宣言だけが
   * 静かに嘘になる——**いま誰も読んでいなくても、宣言は実物と合っていること。**
   */
  rejections?: {
    dup: number;
    reference_gave_up: Record<string, number>;
  };
  cases: CallCase[];
}

/**
 * 関数呼び出しのシャードを読む。**期待値は厳密一致で比べる**ので、
 * `tolerance` を持たない——持たせると「緩めれば通る」余地が生まれる。
 */
export function loadCallShards(): { name: string; shard: CallShard }[] {
  const shards = readdirSync(CORPUS)
    .filter((name) => CALL_SHARD_PATTERN.test(name))
    .sort()
    .map((name) => ({
      name,
      shard: JSON.parse(readFileSync(join(CORPUS, name), "utf-8")) as CallShard,
    }));
  for (const { name, shard } of shards) {
    if (shard.schema !== KNOWN_SCHEMA) {
      throw new Error(
        `${name}: schema ${JSON.stringify(shard.schema)} is not one this ` +
          `code knows how to read (expected ${KNOWN_SCHEMA})`,
      );
    }
    if (!Array.isArray(shard.cases) || shard.cases.length === 0) {
      throw new Error(
        `${name}: the shard carries no cases. An empty shard runs green ` +
          "while verifying nothing, so it is refused here.",
      );
    }
    const strangers = shard.cases.filter((c) => c.kind !== "call");
    if (strangers.length > 0) {
      throw new Error(
        `${name}: ${strangers.length} case(s) are not of kind "call". ` +
          "A call shard read as anything else would compare the wrong things.",
      );
    }
  }
  return shards;
}

export function loadShards(): { name: string; shard: Shard }[] {
  const shards = readdirSync(CORPUS)
    .filter((name) => name.endsWith(".json"))
    .filter((name) => !CALL_SHARD_PATTERN.test(name))
    .filter((name) => !DISPLAY_SHARD_PATTERN.test(name))
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
 * **相対誤差だけで判定する。**
 *
 * 表示は有効数字 10 桁で、最下位桁の丸め幅の半分を相対で見ると 5e-11〜5e-10 に
 * 収まり、値の大きさに依らない。だから単一の相対許容が、あらゆるマグニチュードで
 * 表示の丸めをちょうど覆う(設計書 §2)。**許容をマグニチュード依存にする必要は
 * 無く、2 本立てにする必要も無い。**
 *
 * 以前はここが abs と rel の OR だった。その形は |期待値| < 1 のところで
 * abs の側が常に緩い方になり、実効的な相対許容が `abs / |期待値|` に膨らむ——
 * 1e-6 の値なら 5e-4 まで許していた。4000 件中 1315 件が表示分解能より緩く
 * 検査されており、最悪は 4.15e-4 = 有効数字 4 桁相当だった。表示は 10 桁
 * 出るのに。害を与えていたのは abs の側であって、rel ではない。
 */
export function withinTolerance(
  actual: number,
  expected: number,
  tolerance: Tolerance,
): boolean {
  const difference = Math.abs(actual - expected);
  const scale = Math.abs(expected);
  if (scale === 0) {
    // 期待値が厳密に 0。相対誤差は数学的に定義できない。**ここだけが abs の出番。**
    return difference <= tolerance.abs;
  }
  return difference / scale <= tolerance.rel;
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
   * **判定が実際に許している相対誤差の上限。**
   *
   * OR をやめたので、これは適用された `tolerance.rel` そのものである——
   * 上書きされたケースでは上書き後の値になる。以前はここが
   * `max(rel, abs / |期待値|)` で、|期待値| が 1 未満のとき abs の側が
   * 常に緩い方になり、実効的な相対許容が `abs / |期待値|` まで広がっていた
   * (4000 件中 1315 件、最悪 4.15e-4)。この値を集計しないと、報告書の
   * 「表示される桁まで正しい」が実態より強い主張になる。
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
  /**
   * 帯の目盛りに使う、**上書き前**の rel。省略時は tolerance.rel。
   * 上書きされたケースが緩い帯に落ちるのは、それが実際に緩く検査されたからで、
   * 報告書がその件数を数えられる必要がある。
   */
  baseRel: number = tolerance.rel,
): Classification {
  // **実数は虚部 0 の複素数である。** 判定を 2 本持つと片方だけ直る。
  // `magnitude` が虚部 0 のとき `Math.abs` に落ちるので、この委譲で
  // 既存 21379 件の判定は 1 件も動かない(`complex-rules.spec.ts` が検査する)。
  return classifyComplex(
    { re: actual, im: 0 },
    { re: expected, im: 0 },
    tolerance,
    baseRel,
  );
}

/**
 * 複素数 1 件の比較。**判定は複素平面上の距離で行う**
 * (設計書 2026-08-17-complex §3.3)。
 *
 * 実部と虚部を別々に相対誤差で見ると、片方が 0 のとき(純虚数など)に
 * 相対誤差が定義できなくなる。距離なら定義できる。
 *
 * **ただし距離だけでは足りない。** 小さいほうの成分の誤りは、大きいほうに
 * 隠れて距離を動かさない。いちばん重い形——あるはずの成分が消える、
 * 無いはずの成分が生える——は `zeroComponentsAgree` が別に見る。
 */
export function classifyComplex(
  actual: ComplexValue,
  expected: ComplexValue,
  tolerance: Tolerance,
  baseRel: number = tolerance.rel,
): Classification {
  const absoluteError = magnitude(
    actual.re - expected.re,
    actual.im - expected.im,
  );
  const scale = magnitude(expected.re, expected.im);
  const withinDistance =
    scale === 0
      ? // 期待値が厳密に 0。相対誤差は数学的に定義できない。**ここだけが abs の出番。**
        absoluteError <= tolerance.abs
      : absoluteError / scale <= tolerance.rel;
  const passed = withinDistance && zeroComponentsAgree(actual, expected);
  if (scale === 0) {
    return {
      passed,
      relativeError: 0,
      absoluteError,
      effectiveRelTolerance: Number.POSITIVE_INFINITY,
      bucket: "undefined",
    };
  }
  // OR をやめたので、実際に許している相対誤差は rel そのものである。
  const effectiveRelTolerance = tolerance.rel;
  return {
    passed,
    absoluteError,
    relativeError: absoluteError / scale,
    effectiveRelTolerance,
    bucket: bandOf(effectiveRelTolerance, baseRel),
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

/**
 * 二項演算子の優先順位。**判定には使わない——報告のためだけの目盛りである。**
 *
 * 正は `crates/calcarc-core/src/engine/state.rs` で、Add|Sub = 1、Mul|Div = 2。
 * ここが間違っていても合否は動かず、報告の件数がずれるだけである(合否を決めるのは
 * コーパスの期待値と `withinTolerance` で、この表は一切関与しない)。
 */
const BINARY_PRECEDENCE: Record<string, number> = {
  add: 1,
  sub: 1,
  mul: 2,
  div: 2,
};

/**
 * **このキー列は、優先順位が無ければ正しく解釈できないか。**
 *
 * 判定は「同じ括弧の**組**の中に、優先順位の異なる二項演算子が 2 つ以上現れるか」。
 * 現れれば、engine は括弧ではなく優先順位で構造を決めたことになる。
 *
 * **「組」であって「深さ」ではない。** 初版はここを「同じ括弧の深さ」で判定していたが、
 * それは誤りだった——深さが同じでも別々の括弧の中なら、その 2 つの演算子は同じ式に
 * 並んでいない。実測した反例(`scientific-000.json` の `sci-000025`、
 * `377 - ((553 / 982) / (189 - 996))`):`div` と `sub` はどちらも深さ 3 だが、
 * `(553/982)` と `(189-996)` という**別の組**である。構造は括弧が完全に決めており、
 * 優先順位は一切要らない。深さで数えると、全二項を括弧で囲んでいる既存シャードから
 * 311 件の偽陽性が出た(`scientific` 191 件 + `equivalence` 4000 キー列中 120 件)。
 * 組で数えるとどちらも 0 件になる(設計書 §3.4)。
 *
 * 実装は `lparen` で新しい組をスタックに push し、`rparen` で pop して確定させる。
 * 二項演算子は**そのとき開いている組**(スタックの先頭。無ければトップレベルの組)
 * に足す。トップレベル(どの括弧の外)も 1 つの組として扱う——`1 add 2 mul 3 eq`
 * のように、そもそも括弧が無いキー列も判定できなければならない。ただしトップ
 * レベルの組は `stack` には積まない別変数で持つ——**`rparen` で pop できてしまうと、
 * 対応する `lparen` の無い `rparen`(壊れたキー列)が、それ以降のトップレベル演算子を
 * 静かに読み捨てる経路になる**からである。壊れたキー列は捨てずに例外にする
 * (下記)。
 *
 * **双子について。** `reference/tests/test_generate_corpus.py` の `_needs_precedence`
 * が同じ規則の Python 実装で、`precedence-000.json` を生成する側のゲート
 * (`test_every_precedence_case_actually_drops_a_parenthesis`)を持つ。こちらは
 * その生成物を読んで報告書の件数を出す側である。**どちらかが変わったら両方
 * 直すこと。** ただし、二つが一致することはこの規則が正しいことの証拠には
 * ならない——深さ規則のバグは、この双子が 3 シャードで完全に一致したまま
 * 存在した(両方が同じ設計書の同じ誤った規則を実装していたから)。突き合わせは
 * 由来が独立でなければ何も保証しない。ここを正しいと確認したのは、双子の
 * 一致ではなく、シリアライザの一次原理からの導出と独立な意味論パーサ(設計書
 * 2026-08-16 のレビュー、§3.4 追記)だった。
 *
 * レポートの「まだ踏んでいない領域」をこの関数から導く。手書きの否定は、次に
 * 領域が埋まったとき黙って嘘になる(設計書 §3.4)。
 */
export function needsPrecedence(keys: string[]): boolean {
  const topLevel = new Set<number>();
  const stack: Set<number>[] = [];
  const closedGroups: Set<number>[] = [];
  for (const key of keys) {
    if (key === "lparen") {
      stack.push(new Set<number>());
      continue;
    }
    if (key === "rparen") {
      const group = stack.pop();
      if (group === undefined) {
        // **壊れた入力を静かに読み違えない。** `?.` で読み飛ばすと、この
        // rparen 以降のトップレベル演算子が黙って捨てられ、間違った(多くは
        // 偽の)答えを返す——測定済み: `["1","rparen","add","2","mul","3","eq"]`
        // は `?.` 版だと `false` を返すが、正しい答えは判定不能である。
        // Python の双子 `_needs_precedence` も同じ形(トップレベルの組を
        // `stack` に積まない別変数で持つ)に直してあり、対応の無い `rparen`
        // は常に明示的な例外(`ValueError`)を投げる(N4、review round 3——
        // 直す前は演算子が後に続くときだけ `IndexError` で偶然落ち、続かない
        // ときは静かに `False` を返す中途半端な壊れ方だった)。
        // この関数は報告専用だが、この project の約束は「壊れた入力は騒いで
        // 落ちる」であって、黙って数字がずれることではない。
        throw new Error(
          `needsPrecedence: unmatched "rparen" (more rparen than lparen) in ` +
            `${JSON.stringify(keys)}. This key sequence has no well-formed ` +
            "parenthesis structure to report on.",
        );
      }
      closedGroups.push(group);
      continue;
    }
    const precedence = BINARY_PRECEDENCE[key];
    if (precedence === undefined) {
      continue;
    }
    (stack[stack.length - 1] ?? topLevel).add(precedence);
  }
  // 閉じた組・閉じ損なった組(開いたままの `lparen`)・トップレベルの組の
  // すべてを見る。
  return [...closedGroups, topLevel, ...stack].some((group) => group.size >= 2);
}

/**
 * **同値ケース 1 件が優先順位を踏んだかどうか。**
 *
 * どちらか一方(左右)が踏んでいれば、そのケースは 1 件として数える——左右を
 * 別々に数えて足すと、両方踏んだケースが 2 件に化ける(同値ケースは 1 件が
 * 左右二本のキー列を持つだけで、依然として 1 件だからである)。
 *
 * **`corpus.spec.ts` の集計とこの関数の単体テストの両方がこれを呼ぶ。**
 * 以前はどちらも同じ式 `needsPrecedence(c.left) || needsPrecedence(c.right)`
 * を別々に書いていた——見た目は同じでも別のコピーなので、テストは自分自身の
 * コピーを検査しているだけで、本番側の集計を一切拘束していなかった(review
 * round 3、N2)。実測: 本番側の式を「左右それぞれの一致数を足す」誤りに
 * 差し替えても、そのときのテストは緑のままだった。関数を 1 つに括り出し、
 * 両方がそれを呼ぶことで、本番側を壊す変更がテストを赤くするようにする。
 */
export function equivalenceNeedsPrecedence(c: {
  left: string[];
  right: string[];
}): boolean {
  return needsPrecedence(c.left) || needsPrecedence(c.right);
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

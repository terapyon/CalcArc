import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TOLERANCE_CEILING, type Tolerance } from "./corpus";

/**
 * **緩めた例外を、名指しで、理由を添えて残す場所。**
 *
 * `corpus/generated/` の中には書かない。あそこは再生成一致ゲートが
 * 「生成器の出力とバイト単位で一致」を毎回確かめている領域で、人の判断が
 * 混ざるとその保証が壊れる。生成は機械、例外は人——境界をファイルの
 * 所有者で表す(設計書 §3.3)。
 *
 * 生成器はこのファイルの存在を知らない。読んで適用するのは比較する側だけである。
 */
export const KNOWN_OVERRIDES_SCHEMA = 1;

export interface Override {
  /** このケースにだけ許す相対誤差。シャードの rel より緩い値。 */
  rel: number;
  /**
   * **この上書きが指しているケースの式。コーパス側と一致すること。**
   *
   * 上書きを id だけで結びつけると、コーパスが総入れ替えになったときに
   * 静かに別の式へ移る。設計書 §11 が警告しているとおり、`UNARY_FNS` に
   * 1 つ足すだけで同じ種でも既存 4000 件が総入れ替えになり、段階 3b/3c は
   * それをやる。入れ替わった後の `sci-000019` がたまたま別の理由で
   * シャードの rel を超えれば、腐り検出(`assertNoStaleOverrides`)にも
   * 掛からないまま上書きが効き続け、**レポートはもう存在しない式の説明を
   * 印字する**。id ではなく式に結びつけておけば、入れ替わりは必ず赤くなる。
   */
  expr: string;
  /**
   * **なぜ緩めてよいのか。必須。**
   *
   * 理由のない上書きは、名指しの体裁をした静かな緩和である。理由が書けない
   * なら、それは上書きすべきケースではなく直すべきバグである(設計書 §3.3)。
   *
   * **理由には、読み手が再計算できる数を含めること**(ulp、導関数、上界、
   * 観測値)。散文だけの理由は、外の目に晒しても検算できない——
   * `reason` が必須でも中身が薄ければ、上書きは実質的に静かな緩和になる
   * (設計書 §6)。
   */
  reason: string;
}

/**
 * 1 件の上書きが持ってよい鍵。**ここに無い鍵は throw する。**
 *
 * 未知の鍵を黙って捨てると、この層が一度塞いだ穴を新しいファイルで開け直す
 * ことになる。`{"rel": 2e-9, "reason": "…", "abs": 1e-6}` と書いた人は
 * 「期待値 0 側も緩めた」と思い、`overrides.json` を読んだレビュアも
 * 「効いている」と読む。**どちらも間違っている**——`resolveTolerance` は
 * `abs` を `base.abs` から取るので、書かれた `abs` は完全に無視される。
 * これは `assertNoCaseTolerance` が拒んでいる「効いているように見えて
 * 効かないつまみ」そのものである(設計書 §3.3)。
 */
const OVERRIDE_FIELDS = ["rel", "expr", "reason"] as const;

/** ファイルのトップレベルが持ってよい鍵。理由は `OVERRIDE_FIELDS` と同じ。 */
const FILE_FIELDS = ["schema", "overrides"] as const;

interface OverridesFile {
  schema: number;
  overrides: Record<string, Override>;
}

const OVERRIDES_PATH = fileURLToPath(
  new URL("../../../corpus/overrides.json", import.meta.url),
);

export function loadOverrides(): Map<string, Override> {
  let raw: string;
  try {
    raw = readFileSync(OVERRIDES_PATH, "utf-8");
  } catch (cause) {
    throw new Error(
      `overrides: ${OVERRIDES_PATH} が読めない。上書きが無いときも ` +
        `{"schema": 1, "overrides": {}} を置くこと——ファイルの不在と ` +
        `「上書きが 0 件」を区別できなくなる。`,
      { cause },
    );
  }
  return parseOverridesFile(raw);
}

/**
 * 読んだ文字列を上書きの表にする。**ファイルの形も、その場で確かめる。**
 *
 * ファイルの不在には手本のようなメッセージがある一方、`{"schema": 1}`
 * (`overrides` の欠落)や `"overrides": []` は `Object.entries(undefined)` の
 * 生 TypeError になっていた。防御が非対称だと、**手で書くファイルの最も
 * ありふれた壊し方**だけが読めない例外になる。
 */
export function parseOverridesFile(raw: string): Map<string, Override> {
  const root: unknown = JSON.parse(raw);
  // **根がオブジェクトであることを、`schema` を読む前に確かめる。** `overrides`
  // 側は下で同じ形の検査をしているが、根の側だけが素の TypeError に開いていた
  // ——`null` を渡すと `parsed.schema` が `Cannot read properties of null` で
  // 落ちる(`[]` は `Array` なので `schema` が `undefined` になり、下の schema
  // 検査に自然に掛かる。壊れるのは `null` だけ)。防御が非対称だと、**手で
  // 書くファイルの最もありふれた壊し方**の一部だけが読めない例外になる。
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    throw new Error(
      "overrides: ファイルの中身は { schema, overrides } を持つオブジェクト " +
        `でなければならないが、${JSON.stringify(root)} である。`,
    );
  }
  const parsed = root as OverridesFile;
  if (parsed.schema !== KNOWN_OVERRIDES_SCHEMA) {
    throw new Error(
      `overrides: schema ${parsed.schema} は読み方を知らない ` +
        `(知っているのは ${KNOWN_OVERRIDES_SCHEMA})`,
    );
  }
  const table: unknown = parsed.overrides;
  if (typeof table !== "object" || table === null || Array.isArray(table)) {
    throw new Error(
      "overrides: overrides は id をキーにしたオブジェクトでなければ " +
        `ならないが、${String(JSON.stringify(table))} である。` +
        `上書きが無いときも {"schema": ${KNOWN_OVERRIDES_SCHEMA}, ` +
        '"overrides": {}} と書くこと。',
    );
  }
  const known: ReadonlySet<string> = new Set(FILE_FIELDS);
  const strangers = Object.keys(parsed).filter((key) => !known.has(key));
  if (strangers.length > 0) {
    throw new Error(
      `overrides: トップレベルに知らない鍵がある: ` +
        `${strangers.map((key) => JSON.stringify(key)).join(", ")}。` +
        `読む側は ${FILE_FIELDS.join(" と ")} しか見ないので、` +
        `書いた鍵は黙って無視される——効いているように見えて効かない。`,
    );
  }
  return new Map(Object.entries(table as Record<string, Override>));
}

/**
 * このケースに適用する許容を決める。上書きがあれば rel だけ差し替える。
 *
 * `abs` は差し替えない——あれは期待値が厳密に 0 のときの専用経路で、
 * 相対誤差が定義できない場合の逃げ道である。上書きが語るのは
 * 「このケースの相対誤差はここまで許す」ことだけである。
 */
export function resolveTolerance(
  caseId: string,
  base: Tolerance,
  overrides: Map<string, Override>,
): Tolerance {
  const override = overrides.get(caseId);
  return override === undefined ? base : { abs: base.abs, rel: override.rel };
}

/**
 * 上書きが正気であることを、読み込んだ時点で確かめる。
 *
 * ここで throw するのは、あとで「なぜか緩い」と気づくより、その場で
 * 名指しで落ちる方が原因に近いためである。
 */
export function assertOverridesAreSound(
  /**
   * コーパスの値ケース。**id だけでなく式も要る**——上書きは id ではなく
   * 式に結びつく(`Override.expr` の doc を見よ)。
   */
  overrides: Map<string, Override>,
  valueCaseExprs: Map<string, string>,
  equivalenceCaseIds: Set<string>,
): void {
  const complaints: string[] = [];
  const knownFields: ReadonlySet<string> = new Set(OVERRIDE_FIELDS);
  for (const [caseId, override] of overrides) {
    const strangers = Object.keys(override).filter(
      (key) => !knownFields.has(key),
    );
    if (strangers.length > 0) {
      complaints.push(
        `${caseId}: 知らない鍵がある: ` +
          `${strangers.map((key) => JSON.stringify(key)).join(", ")}。` +
          `上書きが持てるのは ${OVERRIDE_FIELDS.join(" / ")} だけである。` +
          `例えば abs を書いても resolveTolerance はシャードの abs を使う` +
          `ので、書いた値は完全に無視される——効いているように見えて効かない` +
          `つまみを、上書きの側に作らない。`,
      );
    }
    if (!valueCaseExprs.has(caseId)) {
      if (equivalenceCaseIds.has(caseId)) {
        // id はコーパスに実在する——同値ケースとして。値ケースではないだけ
        // である。「このケースはコーパスに無い」は事実に反する: 探しても
        // 見つからない、という誤った印象を読み手に与える。上書きが値ケース
        // にしか効かない理由は、同値ケースが期待値を持たず、「どこまで
        // 緩めるか」の基準が無いことにある(比較ループのコメントを見よ)。
        complaints.push(
          `${caseId}: このケースは同値ケースとして存在する。上書きは値` +
            `ケースにしか効かない——同値ケースは期待値を持たないので、` +
            `どこまで緩めるかの基準が無い。`,
        );
      } else {
        complaints.push(
          `${caseId}: このケースはコーパスに無い。` +
            `コーパスが変わって id が消えても上書きだけが残ると、` +
            `何を緩めているのか分からなくなる。`,
        );
      }
    }
    if (
      typeof override.expr !== "string" ||
      override.expr.trim().length === 0
    ) {
      complaints.push(
        `${caseId}: expr が空である。上書きは id ではなく**式**に結びつく` +
          `——id だけで結ぶと、コーパスが総入れ替えになったとき上書きが` +
          `静かに別の式へ移り、レポートはもう存在しない式の説明を印字する。`,
      );
    } else {
      const actual = valueCaseExprs.get(caseId);
      if (actual !== undefined && actual !== override.expr) {
        complaints.push(
          `${caseId}: expr がコーパスと一致しない。` +
            `上書きは ${JSON.stringify(override.expr)} と言っているが、` +
            `コーパスのこの id は ${JSON.stringify(actual)} である。` +
            `コーパスが入れ替わった可能性がある——理由が指している式が` +
            `もう無いなら、その上書きは作り直すか消すこと。`,
        );
      }
    }
    if (
      typeof override.reason !== "string" ||
      override.reason.trim().length === 0
    ) {
      complaints.push(
        `${caseId}: reason が空である。理由のない上書きは、名指しの体裁を ` +
          `した静かな緩和である。理由が書けないなら、それは上書きすべき ` +
          `ケースではなく直すべきバグである。`,
      );
    }
    if (
      typeof override.rel !== "number" ||
      !Number.isFinite(override.rel) ||
      override.rel <= 0
    ) {
      complaints.push(
        `${caseId}: rel が ${String(override.rel)} である。` +
          `正の有限値でなければならない。`,
      );
    } else if (override.rel > TOLERANCE_CEILING) {
      // シャードの許容には TOLERANCE_CEILING の正気検査が既にある
      // (corpus.ts の assertToleranceIsSane)。上書きは reason と有限性しか
      // 見ていなければ、`rel: 1e-3` にもっともらしい理由を付けるだけで
      // 全ゲートを通ってしまう——名指しの体裁をした静かな緩和になる。
      // 同じ上限を上書きにも課す。
      complaints.push(
        `${caseId}: rel が ${override.rel} である。上書きも ` +
          `${TOLERANCE_CEILING.toExponential()}(この層が主張しうる精度の外)より` +
          "緩くはできない。",
      );
    }
  }
  if (complaints.length > 0) {
    throw new Error(`overrides:\n${complaints.join("\n")}`);
  }
}

/**
 * **要らなくなった上書きを赤にする。**
 *
 * 上書きは放っておくと溜まる。溜まった上書きは、誰も見に行かないまま層の
 * 主張を削る。「ガードは緑のまま理由が嘘になる」形で腐るので、腐ったら
 * 赤くする(設計書 §3.4)。
 *
 * @param staleIds 上書き**なし**の許容で通ったケースの id
 */
export function assertNoStaleOverrides(
  staleIds: string[],
  overrides: Map<string, Override>,
): void {
  if (staleIds.length === 0) {
    return;
  }
  const lines = staleIds.map((id) => {
    const override = overrides.get(id);
    if (override === undefined) {
      // `staleIds` には呼び出し側が `overrides.has(id)` を満たしたものしか
      // 入れない。ここへ来たら、その不変条件が壊れている。黙って
      // 「(理由が読めない)」で埋めると、**理由についての嘘**を印字した
      // うえで、起こりえない状態に説明を与えてしまう。大きな声で落とす。
      throw new Error(
        `overrides: ${id} は腐った上書きとして渡されたが、上書きの表に無い。` +
          "呼び出し側の不変条件(overrides.has(id) を満たしたものだけを渡す)が" +
          "壊れている。",
      );
    }
    return `  ${id} — 記録されている理由: ${override.reason}`;
  });
  throw new Error(
    `overrides: 次の上書きは、もう無くてもシャードの rel で通る。\n` +
      `${lines.join("\n")}\n` +
      `corpus/overrides.json から消すこと。要らない上書きを残すと、` +
      `層の主張が理由なく弱いままになる。`,
  );
}

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Tolerance } from "./corpus";

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
   * **なぜ緩めてよいのか。必須。**
   *
   * 理由のない上書きは、名指しの体裁をした静かな緩和である。理由が書けない
   * なら、それは上書きすべきケースではなく直すべきバグである(設計書 §3.3)。
   */
  reason: string;
}

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
  const parsed = JSON.parse(raw) as OverridesFile;
  if (parsed.schema !== KNOWN_OVERRIDES_SCHEMA) {
    throw new Error(
      `overrides: schema ${parsed.schema} は読み方を知らない ` +
        `(知っているのは ${KNOWN_OVERRIDES_SCHEMA})`,
    );
  }
  return new Map(Object.entries(parsed.overrides));
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
  overrides: Map<string, Override>,
  knownCaseIds: Set<string>,
): void {
  const complaints: string[] = [];
  for (const [caseId, override] of overrides) {
    if (!knownCaseIds.has(caseId)) {
      complaints.push(
        `${caseId}: このケースはコーパスに無い。` +
          `コーパスが変わって id が消えても上書きだけが残ると、` +
          `何を緩めているのか分からなくなる。`,
      );
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
    const reason = overrides.get(id)?.reason ?? "(理由が読めない)";
    return `  ${id} — 記録されている理由: ${reason}`;
  });
  throw new Error(
    `overrides: 次の上書きは、もう無くてもシャードの rel で通る。\n` +
      `${lines.join("\n")}\n` +
      `corpus/overrides.json から消すこと。要らない上書きを残すと、` +
      `層の主張が理由なく弱いままになる。`,
  );
}

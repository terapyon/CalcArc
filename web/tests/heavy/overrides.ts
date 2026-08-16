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

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

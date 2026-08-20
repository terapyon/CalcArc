import type { KeyToken } from "../../src/calc";
import {
  type DisplayCase,
  loadDisplayShards,
  loadShards,
  partitionCases,
  type ValueCase,
} from "../heavy/corpus";
import { BUTTON_FOR } from "./keys";
import { REQUIRED_KEYS, type TypingPlan } from "./presses";

/**
 * **どのケースを盤面から打つか。**
 *
 * 盤面を通る走行は 1 件 0.53 秒かかるので、全件は通せない。通すのは代表で、
 * 網羅は計算コアの経路が担う。ここが決めるのは**その代表の選び方**である。
 *
 * 選び方を spec から出したのは、`globalTeardown` が「何を打つつもりだったか」
 * を同じ関数から読むためである。**選び方を写し取ると、写した側が古びても
 * 静かに緑になる。**
 */

/**
 * シャードあたり何件通すか。
 *
 * **実測 1 件あたり 0.53 秒**(50 件を 26.6 秒、2026-08-17)。クリックが
 * 1 件ごとに要るので、コアの経路(1 万件を 5 秒)とは 3 桁違う。
 */
export const SAMPLE = Number(process.env.HEAVY_UI_SAMPLE ?? "100");

/** 既定に対する比。台帳の下限をこの比で縮める(`MIN_TYPED_CASES`)。 */
export const SAMPLE_RATIO = Math.min(SAMPLE, 100) / 100;

export interface Selection<T> {
  name: string;
  /** 打鍵できるケース全部。**選ぶ前**の母集団。 */
  all: T[];
  /** 実際に打つケース。 */
  sample: T[];
}

/** 盤面から打てるキー列か。ボタンの無いトークンが 1 つでもあれば打てない。 */
export const typeable = (keys: string[]): boolean =>
  keys.every((key) => BUTTON_FOR.has(key as KeyToken));

/** 等間隔に選ぶ。先頭だけ通すと、生成の後半の形をまったく踏まない。 */
function spread(count: number, length: number): number[] {
  const step = length / count;
  return Array.from({ length: count }, (_, i) => Math.floor(i * step));
}

/** 代表を選ぶ。 */
export function selectSample<T extends { keys: string[] }>(
  items: T[],
  count: number,
): T[] {
  if (items.length <= count) {
    return items;
  }
  return spread(count, items.length).map((index) => items[index] as T);
}

export type ValueSelection = Selection<ValueCase> & {
  tolerance: ReturnType<typeof loadShards>[number]["shard"]["tolerance"];
};

export function valueSelections(): ValueSelection[] {
  return loadShards()
    .map(({ name, shard }) => {
      const { values } = partitionCases(name, shard.cases);
      const all = values.filter((testCase) => typeable(testCase.keys));
      return {
        name,
        all,
        sample: selectSample(all, SAMPLE),
        tolerance: shard.tolerance,
      };
    })
    .filter((selection) => selection.sample.length > 0);
}

export function displaySelections(): Selection<DisplayCase>[] {
  return loadDisplayShards()
    .map(({ name, shard }) => {
      const all = shard.cases.filter(
        (c): c is DisplayCase => c.kind === "display" && typeable(c.keys),
      );
      return { name, all, sample: selectSample(all, SAMPLE) };
    })
    .filter((selection) => selection.sample.length > 0);
}

/**
 * 走行が何を打つつもりだったか。**`globalTeardown` はこれを台帳と突き合わせる。**
 *
 * `inCorpus` は**母集団**から、`inSample` は**選んだ分**から導く。同じ側から
 * 両方を導くと、選ばれなくなった瞬間に期待も一緒に消えて差が出ない。
 */
export function typingPlan(): TypingPlan {
  const selections: Selection<ValueCase | DisplayCase>[] = [
    ...valueSelections(),
    ...displaySelections(),
  ];
  const cases: Record<string, number> = {};
  const inCorpus = new Set<KeyToken>();
  const inSample = new Set<KeyToken>();
  for (const { name, all, sample } of selections) {
    cases[name] = sample.length;
    for (const { token } of REQUIRED_KEYS) {
      if (all.some((c) => c.keys.includes(token))) {
        inCorpus.add(token);
      }
      if (sample.some((c) => c.keys.includes(token))) {
        inSample.add(token);
      }
    }
  }
  return {
    cases,
    inCorpus: [...inCorpus],
    inSample: [...inSample],
    totalCases: Object.values(cases).reduce((a, b) => a + b, 0),
  };
}

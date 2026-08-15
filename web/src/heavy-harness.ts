/**
 * 重量級コーパス(Layer 6)専用の入口。**配信物には入らない**——
 * vite.heavy.config.ts だけがこのエントリをビルドし、index.html からは
 * 誰も import しないので本番バンドルに到達しない(設計書 §6.4)。
 *
 * ここが存在する理由は一つだけ。本番バンドルは src/calc をグローバルに
 * 露出していないので、page.evaluate から dispatch を呼べないためである。
 * UI そのものの検証は ui 経路(本物のアプリ)が担う。
 */
import { type Calc, initCalc, type KeyToken } from "./calc";

/** 1 ケースの結果。表示は整形済み文字列で、数値は取り出せない(設計書 §6.3)。 */
export interface HarnessResult {
  main: string;
  error: string | null;
}

declare global {
  interface Window {
    __calcarc?: {
      ready: Promise<void>;
      runAll(sequences: string[][]): HarnessResult[];
    };
  }
}

let calc: Calc | null = null;

const ready = initCalc().then((instance) => {
  calc = instance;
});

/**
 * キー列の束をまとめて回す。1 束 = 1 往復に抑えることが速度の要で、
 * ケースごとに page.evaluate すると往復のコストが計算のコストを覆い隠す。
 */
function runAll(sequences: string[][]): HarnessResult[] {
  if (calc === null) {
    throw new Error("heavy-harness: runAll was called before ready resolved");
  }
  const engine = calc;
  return sequences.map((keys) => {
    // ケースごとに初期状態から始める。前のケースの残りを引きずらない。
    let step = engine.initial();
    for (const key of keys) {
      step = engine.dispatch(step.state, key as KeyToken);
    }
    return { main: step.display.main, error: step.display.error };
  });
}

window.__calcarc = { ready, runAll };

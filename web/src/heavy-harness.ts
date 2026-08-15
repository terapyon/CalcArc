/**
 * 重量級コーパス(Layer 6)専用の入口。**配信物には入らない**——
 * vite.heavy.config.ts だけがこのエントリをビルドし、index.html からは
 * 誰も import しないので本番バンドルに到達しない(設計書 §6.4)。
 *
 * ここが存在する理由は一つだけ。本番バンドルは src/calc をグローバルに
 * 露出していないので、page.evaluate から dispatch を呼べないためである。
 * UI そのものの検証は ui 経路(本物のアプリ)が担う。
 */
import { type Calc, initCalc, KEY_TOKENS, type KeyToken } from "./calc";

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
      version(): string;
    };
  }
}

const KNOWN_KEYS: ReadonlySet<string> = new Set(KEY_TOKENS);

/**
 * 知らないキーが混ざっていないことを、**回す前に**確かめる。
 *
 * calcarc-wasm の `reduce` は未知のトークンを受け取ると状態を変えずに返す
 * (crates/calcarc-wasm/src/lib.rs)。綴りが一つ違うだけで、そのキーは
 * 何事も無かったように読み飛ばされ、違う式が計算され、不一致は電卓のせいに
 * される——一番静かな壊れ方である。いまの生成器は正しいトークンしか出さない
 * が、設計書 §7.2 の「一般ユーザが corpus/contributed/ に JSON を足す」は
 * まさにこの入力経路で、手で書かれた JSON がこの罠を踏む。
 *
 * commit e00aa53 が Python 側(未知の op / fn)で潰したのと同型の罠を、
 * TypeScript 側でも潰す(レビュー修正ラウンド 2)。
 */
function refuseUnknownKeys(sequences: string[][]): void {
  const offenders: string[] = [];
  for (const [index, keys] of sequences.entries()) {
    for (const key of keys) {
      if (!KNOWN_KEYS.has(key)) {
        offenders.push(`sequence ${index}: ${JSON.stringify(key)}`);
      }
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `heavy-harness: unknown key token(s), which the engine would skip ` +
        `silently and compute a different expression — ` +
        `${offenders.slice(0, 10).join(", ")}` +
        (offenders.length > 10 ? ` (+${offenders.length - 10} more)` : ""),
    );
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
  refuseUnknownKeys(sequences);
  return sequences.map((keys) => {
    // ケースごとに初期状態から始める。前のケースの残りを引きずらない。
    let step = engine.initial();
    for (const key of keys) {
      step = engine.dispatch(step.state, key as KeyToken);
    }
    return { main: step.display.main, error: step.display.error };
  });
}

/**
 * 計算コア(wasm)の版。**報告書の素性に載せる。**
 * 外の人が判断するには、何をいつ何で回したかが要る(レビュー修正ラウンド 2)。
 */
function version(): string {
  if (calc === null) {
    throw new Error("heavy-harness: version was called before ready resolved");
  }
  return calc.version();
}

window.__calcarc = { ready, runAll, version };

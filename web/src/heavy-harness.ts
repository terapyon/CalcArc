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
import {
  compound_deposit_for,
  compound_grow,
  compound_periods_for,
  data_scale,
  loan_bonus_forward,
  loan_bonus_principal,
  loan_forward,
  loan_principal,
  loan_term,
} from "./wasm/calcarc_wasm.js";

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
      runCalls(cases: CallCase[]): unknown[];
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

/** 関数呼び出しのケース 1 件(設計書 2026-08-17 §3.1)。 */
export interface CallCase {
  op: string;
  input: Record<string, string | number | boolean>;
}

/**
 * 金融とデータスケールは**キー列ではなく関数呼び出し**である。
 *
 * 引数名は参照実装のものを使い、ここで wasm の綴りに直す(`n` → `months`)。
 * **参照実装の側を wasm に合わせて書き換えない**——あちらが独立している
 * ことが検証の土台なので、寄せるならこちら側で寄せる(設計書 §6 のリスク)。
 */
const CALLS: Record<string, (input: Record<string, never>) => unknown> = {
  data_scale: (i) =>
    data_scale(str(i, "count"), str(i, "dimensions"), str(i, "dtype")),
  loan_forward: (i) =>
    loan_forward(
      str(i, "principal"),
      str(i, "rate"),
      num(i, "n"),
      str(i, "residual"),
    ),
  loan_principal: (i) =>
    loan_principal(str(i, "payment"), str(i, "rate"), num(i, "n")),
  loan_term: (i) =>
    loan_term(str(i, "principal"), str(i, "rate"), str(i, "payment")),
  loan_bonus_forward: (i) =>
    loan_bonus_forward(
      str(i, "principal"),
      str(i, "bonus_principal"),
      str(i, "rate"),
      num(i, "n"),
    ),
  loan_bonus_principal: (i) =>
    loan_bonus_principal(
      str(i, "monthly_payment"),
      str(i, "bonus_payment"),
      str(i, "rate"),
      num(i, "n"),
    ),
  compound_grow: (i) =>
    compound_grow(
      str(i, "principal"),
      str(i, "deposit"),
      str(i, "rate"),
      num(i, "periods_per_year"),
      num(i, "periods"),
      bool(i, "tax"),
    ),
  compound_deposit_for: (i) =>
    compound_deposit_for(
      str(i, "principal"),
      str(i, "target"),
      str(i, "rate"),
      num(i, "periods_per_year"),
      num(i, "periods"),
      bool(i, "tax"),
    ),
  compound_periods_for: (i) =>
    compound_periods_for(
      str(i, "principal"),
      str(i, "deposit"),
      str(i, "target"),
      str(i, "rate"),
      num(i, "periods_per_year"),
      bool(i, "tax"),
    ),
};

/**
 * 引数を型ごとに取り出す。**欠けていたら落ちる。**
 *
 * `undefined` をそのまま wasm に渡すと、`String(undefined)` が `"undefined"` に
 * なって「構文エラー」という**もっともらしい答え**が返る——検証層が
 * 一番検出しにくい壊れ方なので、ここで大きな声を出す。
 */
function str(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string") {
    throw new Error(
      `heavy-harness: ${key} should be a string, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function num(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== "number") {
    throw new Error(
      `heavy-harness: ${key} should be a number, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function bool(input: Record<string, unknown>, key: string): boolean {
  const value = input[key];
  if (typeof value !== "boolean") {
    throw new Error(
      `heavy-harness: ${key} should be a boolean, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/** 関数呼び出しの束をまとめて回す。1 束 = 1 往復。 */
function runCalls(cases: CallCase[]): unknown[] {
  return cases.map((testCase) => {
    const call = CALLS[testCase.op];
    if (call === undefined) {
      // 未知の op を黙って飛ばすと、その領域が「全件一致」に見える。
      throw new Error(
        `heavy-harness: unknown op ${JSON.stringify(testCase.op)}. ` +
          `Known: ${Object.keys(CALLS).join(", ")}`,
      );
    }
    return call(testCase.input as Record<string, never>);
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

window.__calcarc = { ready, runAll, runCalls, version };

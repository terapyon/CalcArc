/**
 * calcarc-wasm の薄いラッパー。
 *
 * UI Framework に依存しない(base-spec §4.3)。ここに react を
 * import してはならない。
 */

import init, {
  core_version,
  initial_state,
  reduce,
  spell_keys,
} from "../wasm/calcarc_wasm.js";
import type { EngineState, KeyToken, Step } from "./types";

export type {
  AngleMode,
  BinOpName,
  DisplayForm,
  DisplayState,
  EngineState,
  KeyToken,
  Notation,
  Step,
} from "./types";
export { ANGLE_MODES, DISPLAY_FORMS, KEY_TOKENS, NOTATIONS } from "./types";

export interface Calc {
  /** 初期状態とその表示。 */
  initial(): Step;
  /** キーを 1 つ適用する。 */
  dispatch(state: EngineState, key: KeyToken): Step;
  /** 計算コアのバージョン。 */
  version(): string;
  /** キー列を式の文字列に綴る。**失敗しない。** */
  spell(keys: KeyToken[]): string;
}

let ready: Promise<Calc> | null = null;

/**
 * WASM を読み込んで Calc を返す。複数回呼んでも初期化は 1 度だけ。
 */
export function initCalc(): Promise<Calc> {
  ready ??= init()
    .then(
      (): Calc => ({
        initial: () => asStep(initial_state()),
        dispatch: (state: EngineState, key: KeyToken) =>
          asStep(reduce(state, key)),
        version: () => core_version(),
        spell: (keys: KeyToken[]) => spell_keys(keys as string[]),
      }),
    )
    .catch((cause: unknown) => {
      // 失敗した Promise を握ったままにしない。握ると以後の呼び出しが
      // すべて同じ失敗を返し、ページを再読み込みする以外に回復手段が
      // なくなる。キャッシュを捨ててから投げ直し、次の呼び出しで
      // やり直せるようにする。
      ready = null;
      throw cause;
    });
  return ready;
}

/**
 * WASM 側はシリアライズに失敗したときだけ null を返す。実際には
 * 起きない経路だが、起きたら初期状態から作り直す。
 */
function asStep(value: unknown, retry = true): Step {
  if (value !== null && typeof value === "object") {
    return value as Step;
  }
  if (retry) {
    return asStep(initial_state(), false);
  }
  throw new Error("calc: the WASM module returned an unusable state");
}

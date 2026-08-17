/**
 * 設定の読み書き。
 *
 * **Storage を引数で受ける**——localStorage を直接掴まない(P-1 設計書 §6)。
 * 壊れた JSON・知らない値・例外を投げる Storage の分岐が、すべて React の
 * 外で試せる。
 */

import { ALLOWED, defaultSettings, type Settings } from "./types";

export type {
  DataScaleSettings,
  FinanceSettings,
  PanelMode,
  PeriodsPerYear,
  Primary,
  ScientificSettings,
  Settings,
} from "./types";
export {
  defaultSettings,
  PANEL_MODES,
  PERIODS_PER_YEAR,
  PRIMARY_UNITS,
} from "./types";

export const SETTINGS_KEY = "calcarc.settings";

/**
 * 保存側の版。**STATE_SCHEMA(= 6)とは別物**である——あれは保存しない
 * EngineState の版である(P-1 設計書 §5)。
 *
 * **これは移行の仕組みではない。** 意味が変わったらキーの綴りを変える
 * ——綴りが変われば白リストが知らない値として落とす。v を残しているのは、
 * いつか「この版より古い保存は丸ごと捨てる」が必要になったときの唯一の
 * 手掛かりとしてである。
 */
export const SETTINGS_VERSION = 1;

/** localStorage と同じ形。テストから素のオブジェクトを渡せるようにする。 */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 白リストに載っていれば採り、載っていなければ初期値に倒す。 */
function pick<T>(allowed: readonly T[], value: unknown, fallback: T): T {
  return (allowed as readonly unknown[]).includes(value)
    ? (value as T)
    : fallback;
}

/** 節を取り出す。節が無い・オブジェクトでないなら空として扱う。 */
function section(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function parse(raw: string): Settings {
  const fallback = defaultSettings();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (typeof json !== "object" || json === null) return fallback;

  const root = json as Record<string, unknown>;
  const sci = section(root.scientific);
  const ds = section(root.dataScale);
  const fin = section(root.finance);

  return {
    scientific: {
      angle: pick(ALLOWED.angle, sci.angle, fallback.scientific.angle),
      form: pick(ALLOWED.form, sci.form, fallback.scientific.form),
      notation: pick(
        ALLOWED.notation,
        sci.notation,
        fallback.scientific.notation,
      ),
    },
    dataScale: {
      dtype: pick(ALLOWED.dtype, ds.dtype, fallback.dataScale.dtype),
      primary: pick(ALLOWED.primary, ds.primary, fallback.dataScale.primary),
    },
    finance: {
      mode: pick(ALLOWED.mode, fin.mode, fallback.finance.mode),
      periodsPerYear: pick(
        ALLOWED.periodsPerYear,
        fin.periodsPerYear,
        fallback.finance.periodsPerYear,
      ),
      withholding:
        typeof fin.withholding === "boolean"
          ? fin.withholding
          : fallback.finance.withholding,
    },
  };
}

export function readSettings(storage: SettingsStorage): Settings {
  let raw: string | null;
  try {
    raw = storage.getItem(SETTINGS_KEY);
  } catch {
    // Storage が使えなくても計算は続く(設計書 §6)。
    return defaultSettings();
  }
  return raw === null ? defaultSettings() : parse(raw);
}

/** 初期値と違う項目だけを残す。節が空になったらその節ごと落とす。 */
function pruned<T extends object>(actual: T, fallback: T): Partial<T> | null {
  const out: Partial<T> = {};
  let kept = false;
  for (const key of Object.keys(actual) as (keyof T)[]) {
    if (actual[key] !== fallback[key]) {
      out[key] = actual[key];
      kept = true;
    }
  }
  return kept ? out : null;
}

export function writeSettings(storage: SettingsStorage, next: Settings): void {
  const fallback = defaultSettings();
  const body: Record<string, unknown> = { v: SETTINGS_VERSION };
  const scientific = pruned(next.scientific, fallback.scientific);
  const dataScale = pruned(next.dataScale, fallback.dataScale);
  const finance = pruned(next.finance, fallback.finance);
  if (scientific) body.scientific = scientific;
  if (dataScale) body.dataScale = dataScale;
  if (finance) body.finance = finance;

  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(body));
  } catch {
    // 保存できないことは利用者に伝えない(設計書 §6)。設定が残らない
    // という副次的な不便のために、計算画面に警告を出すのは割に合わない。
  }
}

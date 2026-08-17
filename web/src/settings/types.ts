/**
 * 保存する設定の型と、取り得る値の列挙。
 *
 * **React を import しない**(CLAUDE.md の境界)。localStorage も掴まない
 * ——掴むのは web/src/ui/useSetting.ts だけである。
 */

import {
  ANGLE_MODES,
  type AngleMode,
  DISPLAY_FORMS,
  type DisplayForm,
  NOTATIONS,
  type Notation,
} from "../calc";
import { DATA_TYPE_TOKENS, type DataTypeToken } from "../datascale/types";
import { LOAN_MODES } from "../finance/loan/types";

/** 主に表示する単位系。UI だけの概念で、Rust に対応物が無い。 */
export const PRIMARY_UNITS = ["decimal", "binary"] as const;
export type Primary = (typeof PRIMARY_UNITS)[number];

/**
 * Finance が何を求めるか。**UI だけの概念**で、Rust に対応物が無い
 * ——LoanMode の 3 つに複利の 3 つを足した合成である。
 *
 * ここに置くのは、React に依存しない層が持つべきだからである。
 * FinancePanel はここから import する(逆向きにすると、設定モジュールが
 * .tsx を参照することになる)。
 */
export const PANEL_MODES = [
  ...LOAN_MODES,
  "compound",
  "deposit-for",
  "periods-for",
] as const;
export type PanelMode = (typeof PANEL_MODES)[number];

/** 年あたりの期数。 */
export const PERIODS_PER_YEAR = [1, 2, 12] as const;
export type PeriodsPerYear = (typeof PERIODS_PER_YEAR)[number];

export interface ScientificSettings {
  angle: AngleMode;
  form: DisplayForm;
  notation: Notation;
}

export interface DataScaleSettings {
  dtype: DataTypeToken;
  primary: Primary;
}

export interface FinanceSettings {
  mode: PanelMode;
  periodsPerYear: PeriodsPerYear;
  withholding: boolean;
}

/**
 * 保存する設定。**打鍵中の値は 1 つも含まない**(P-1 設計書 §3)。
 * 式・途中の数字・答・active・sexagesimal_view・error・履歴は保存しない。
 */
export interface Settings {
  scientific: ScientificSettings;
  dataScale: DataScaleSettings;
  finance: FinanceSettings;
}

/**
 * 初期値。**毎回新しいオブジェクトを返す**——共有した定数を返すと、
 * 呼び出し側の書き換えが次の呼び出しに漏れる。
 *
 * ここの値は各パネルの useState の初期値と一致していなければならない
 * (Task 3〜5 でパネル側をこちらに寄せる)。
 */
export function defaultSettings(): Settings {
  return {
    scientific: { angle: "Deg", form: "Rect", notation: "Normal" },
    dataScale: { dtype: "float32", primary: "decimal" },
    finance: { mode: "payment", periodsPerYear: 12, withholding: false },
  };
}

/** 検証に使う白リスト。**型ではなく取り得る値**で見る(P-1 設計書 §5)。 */
export const ALLOWED = {
  angle: ANGLE_MODES,
  form: DISPLAY_FORMS,
  notation: NOTATIONS,
  dtype: DATA_TYPE_TOKENS,
  primary: PRIMARY_UNITS,
  mode: PANEL_MODES,
  periodsPerYear: PERIODS_PER_YEAR,
} as const;

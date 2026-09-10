import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractKeyNames,
  findUnknownKeyNames,
  type ManualFile,
  type UnknownKeyName,
} from "../../scripts/manual/markdown.ts";
import { CONVERT_CATEGORY_IDS } from "../../src/convert/types";
import { PANEL_MODES } from "../../src/settings/types";
import { optionText } from "../../src/ui/Category/CategorySelect";
import { OPTIONS as CONVERT_OPTIONS } from "../../src/ui/Convert/ConvertPanel";
import { PRIMARY_BUTTON_LABELS } from "../../src/ui/DataScale/DataScalePanel";
import { fieldLabel, TIMING_LABELS } from "../../src/ui/Finance/FinancePanel";
import { HISTORY_LABELS } from "../../src/ui/History/History";
import {
  CATEGORY_LABELS,
  CATEGORY_LABELS_EN,
  CONVERT_SECTIONS,
  unitSections,
} from "../../src/ui/Keypad/convert";
import {
  DATA_SCALE_SECTIONS,
  DIMENSION_MANUAL_SECTIONS,
  DIMENSION_SECTIONS,
  TYPE_SECTIONS,
} from "../../src/ui/Keypad/dataScale";
import {
  COMPOUND_FIELD_SECTION,
  DEPOSIT_FOR_FIELD_SECTION,
  FINANCE_FIELDS,
  FINANCE_SECTIONS,
  PERIODS_FOR_FIELD_SECTION,
  PERIODS_SECTION,
  TAX_SECTION,
} from "../../src/ui/Keypad/finance";
import {
  CANDIDATE_SECTIONS,
  LLM_FIELD_LABELS,
  LLM_FIELD_ORDER,
  LLM_FIELD_SECTION,
  llmPad,
} from "../../src/ui/Keypad/llm";
import { SCIENTIFIC_SECTIONS } from "../../src/ui/Keypad/scientific";
import {
  BANDWIDTH_UNIT_SECTION,
  DURATION_UNIT_SECTION,
  TRANSFER_FIELD_LABELS,
  TRANSFER_FIELD_SECTION,
  TRANSFER_PAD,
} from "../../src/ui/Keypad/transfer";
import type { KeypadSection } from "../../src/ui/Keypad/types";
import { MODULES } from "../../src/ui/Nav/Nav";
import { OPTIONS as SCALE_OPTIONS } from "../../src/ui/Scale/ScalePanel";
import { UPDATE_TOAST_LABELS } from "../../src/ui/UpdateToast/UpdateToast";
import { EXPECTED_MANUALS, manualName, readManuals } from "./manuals";

/**
 * **マニュアルのキー名は、いまの画面のラベルのどれかである**（設計書
 * `2026-09-10-manuals-design.md` §6）。
 *
 * マニュアルはキー名を `【返済月額】` の形で書く。ここはその 1 つ 1 つが
 * 画面に在ることを見る——**キー名を変えたのにマニュアルが古い、を CI で止める。**
 *
 * ```
 * 承認済みの綴り（Keypad/finance.test.ts の 12 個）  ← 画面の綴りを利用者の承認に縛る
 *         ↓ 画面が変われば、こちらが先に赤くなる
 * マニュアルの【…】の番人（このファイル）             ← マニュアルを画面に縛る
 * ```
 *
 * **★ ラベルは定義元から import する。** ソースの文字列を正規表現で拾うと、
 * 組み立てて作るラベル（`llmPad` の候補、`fieldsWith` の差し替え、
 * `fieldLabel` の差し替え）を取りこぼす。**期待値をマニュアル側から組み立て
 * ない**——画面（承認済み）が正で、直すのはマニュアルである。
 */

/** 予約スロット（「—」）。**名前ではない**ので集めない。 */
function isReserved(key: {
  token: unknown;
  kind?: unknown;
  action?: unknown;
}): boolean {
  return (
    key.token === null && key.kind === undefined && key.action === undefined
  );
}

/** 2 行のラベル（`返済\n月額`）はマニュアルでは 1 語（`【返済月額】`）。 */
const oneLine = (label: string) => label.replaceAll("\n", "");

/** 予約スロットとして除いたキーのラベル。**「—」以外が混じったら取りこぼしである。** */
const reservedLabels: string[] = [];

function keyLabels<T>(sections: readonly KeypadSection<T>[]): string[] {
  const labels: string[] = [];
  for (const section of sections) {
    for (const key of section.keys) {
      if (isReserved(key)) reservedLabels.push(key.label);
      else labels.push(oneLine(key.label));
      // **Shift の第 2 面も画面のラベルである**（`asin` など）。
      if (key.shift !== undefined) {
        if (isReserved(key.shift)) reservedLabels.push(key.shift.label);
        else labels.push(oneLine(key.shift.label));
      }
    }
  }
  return labels;
}

/**
 * 定義元ごとの、画面に出るラベル。
 *
 * **盤面は差し替わる**ので、差し替わる先の区画も全部並べる（金融の複利の行、
 * 周期・税の面、単位面、候補面、項目ごとの数字面）。
 *
 * **金融の chip の見出しは `fieldLabel()` から読む。`FIELD_LABELS` を読まない**
 * ——`FIELD_LABELS.bonus` の「ボーナス」は `bonusName()` に差し替わって画面に
 * 1 度も出ない。読むと、盤面から消した「ボーナス」を今の綴りとして通す
 * （0.9.0 で盤面は「賞与」になった）。
 */
const SOURCES: Record<string, readonly string[]> = {
  "Keypad/scientific.ts": keyLabels(SCIENTIFIC_SECTIONS),
  "Keypad/finance.ts": keyLabels([
    ...FINANCE_SECTIONS,
    COMPOUND_FIELD_SECTION,
    DEPOSIT_FOR_FIELD_SECTION,
    PERIODS_FOR_FIELD_SECTION,
    PERIODS_SECTION,
    TAX_SECTION,
  ]),
  "Keypad/convert.ts": [
    ...keyLabels([
      ...CONVERT_SECTIONS,
      ...CONVERT_CATEGORY_IDS.flatMap((id) => unitSections(id)),
    ]),
    // カテゴリの選択肢は `長さ Length` のように日英を併記する（`ConvertPanel.tsx`）。
    ...Object.values(CATEGORY_LABELS),
    ...Object.values(CATEGORY_LABELS_EN),
  ],
  "Keypad/dataScale.ts": keyLabels([
    ...DATA_SCALE_SECTIONS,
    ...TYPE_SECTIONS,
    ...DIMENSION_SECTIONS,
    ...DIMENSION_MANUAL_SECTIONS,
  ]),
  "Keypad/llm.ts": [
    ...keyLabels([
      LLM_FIELD_SECTION,
      ...Object.values(CANDIDATE_SECTIONS),
      ...LLM_FIELD_ORDER.map((field) => llmPad(field)),
    ]),
    ...Object.values(LLM_FIELD_LABELS),
  ],
  "Keypad/transfer.ts": [
    ...keyLabels([
      TRANSFER_FIELD_SECTION,
      BANDWIDTH_UNIT_SECTION,
      DURATION_UNIT_SECTION,
      TRANSFER_PAD,
    ]),
    ...Object.values(TRANSFER_FIELD_LABELS),
  ],
  "Finance/FinancePanel.tsx": [
    ...PANEL_MODES.flatMap((mode) =>
      FINANCE_FIELDS.map((field) => fieldLabel(mode, field)),
    ),
    // 「方式」の chip の値（`月ごと・期末`）に畳まれる語（設計書 §6 が名指しする）。
    ...Object.values(TIMING_LABELS),
  ],
  // **盤面の外の、押せるもの**（T4 で足した）。マニュアルが名前で呼ぶので、
  // 盤面のキーと同じく定義元から読む。
  // - ナビのタブ（`Scientific` ほか。画面では英語のまま）
  "Nav/Nav.tsx": Object.values(MODULES).map((tab) => tab.label),
  // - カテゴリの選択肢。画面には `為替 Currency` のように日英が 1 つの
  //   選択肢として出るので、**組み立ては画面と同じ `optionText` を通す**
  "Category/CategorySelect.tsx": [...CONVERT_OPTIONS, ...SCALE_OPTIONS].map(
    optionText,
  ),
  // - データ量の画面の、主に表示する単位系を選ぶ 2 つのボタン
  "DataScale/DataScalePanel.tsx": Object.values(PRIMARY_BUTTON_LABELS),
  // - 履歴の画面のボタンとチェックボックス
  "History/History.tsx": Object.values(HISTORY_LABELS),
  // - 更新のお知らせのボタン
  "UpdateToast/UpdateToast.tsx": Object.values(UPDATE_TOAST_LABELS),
};

const LABELS: ReadonlySet<string> = new Set(Object.values(SOURCES).flat());

/** 3 冊のマニュアルが持つ【…】の件数の下限（実数。下の 1 本の註）。 */
const KEY_NAME_FLOOR = 625;

const format = (u: UnknownKeyName) => `${u.path}:${u.line} 【${u.name}】`;

describe("画面のラベルの集め方", () => {
  it("collects every label the screens show", () => {
    // **件数の下限を置く。** 定義元を 1 つ読み損ねても、集合が空になっても、
    // 「知らない名前 0 件」は緑になる——**空の集合で緑にしない。**
    // 数は 2026-09-10 に数えた実数（`manuals-pdf` の枝）。ラベルを減らす
    // 変更をしたら、ここを実数に下げる。
    expect(LABELS.size).toBeGreaterThanOrEqual(250);
    for (const [source, labels] of Object.entries(SOURCES)) {
      expect(labels.length, `${source} から 1 つも集まらない`).toBeGreaterThan(
        0,
      );
    }
  });

  it("holds the labels a manual is sure to name", () => {
    for (const label of [
      // 2 行のラベルは改行を除いて 1 語になる
      "返済月額",
      "借入可能額",
      "必要積立額",
      // 承認済みの綴り（Keypad/finance.test.ts）
      "賞与",
      "方式",
      "期末",
      "期首",
      // chip の見出し（`fieldLabel()` から）
      "月々の返済額",
      "ボーナス返済分（元本）",
      // ほかの盤面
      "AC",
      "DEL",
      "Shift",
      "asin",
      "手入力",
      "帯域幅",
      // 盤面の外（T4 で足した定義元から）
      "Scientific",
      "為替 Currency",
      "データ量 Data Scale",
      "10 進 (KB) を主に",
      "すべて消す",
      "再読み込み",
    ]) {
      expect(LABELS.has(label), `${label} が集まっていない`).toBe(true);
    }
  });

  it("does not hold a label the screen no longer shows", () => {
    // 0.9.0 より前の盤面の綴り（設計書 §1 が README の写真に見つけたもの）。
    // **「ボーナス」は `FIELD_LABELS` には残っているが画面には出ない**
    // ——`fieldLabel()` を通して読んでいることの確かめである。
    for (const label of ["ボーナス", "借入可能", "必要積立", "周期他"]) {
      expect(LABELS.has(label), `${label} が集まっている`).toBe(false);
    }
  });

  it("drops only the reserved slots", () => {
    // **除く規則が本物のキーを落としていないこと。** 予約スロットの判定を
    // 誤ると、そのキーの名前をマニュアルに書いた日に理由の無い赤が出る。
    expect(reservedLabels.length).toBeGreaterThan(0);
    expect(new Set(reservedLabels)).toEqual(new Set(["—"]));
  });
});

describe("マニュアルの【…】の番人", () => {
  it("flags a name the screen does not show, with file and line", () => {
    const files: ManualFile[] = [
      {
        path: "docs/manual/quick.ja.md",
        text: "# 手引き\n\n【返済月額】を押す。\n【ボーナス】を入れる。\n【借入可能】【周期他】",
      },
    ];
    expect(findUnknownKeyNames(files, LABELS).map(format)).toEqual([
      "docs/manual/quick.ja.md:4 【ボーナス】",
      "docs/manual/quick.ja.md:5 【借入可能】",
      "docs/manual/quick.ja.md:5 【周期他】",
    ]);
  });

  it("passes a current name and a two-line label written as one word", () => {
    const files: ManualFile[] = [
      {
        path: "docs/manual/quick.en.md",
        text: "Press **【返済月額】** (monthly repayment).\n【必要積立額】【賞与】【期首】",
      },
    ];
    expect(findUnknownKeyNames(files, LABELS)).toEqual([]);
  });

  it("passes the fixture manual", () => {
    // **本物の本文が入るまでの試金石。** 画面のラベルを変えるとここが赤くなる
    // （`Keypad/finance.test.ts` の承認済みの綴りも同時に赤くなる）。
    const path = "tests/unit/fixtures/manual/sample.ja.md";
    const text = readFileSync(
      join(import.meta.dirname, "fixtures", "manual", "sample.ja.md"),
      "utf8",
    );
    const unknown = findUnknownKeyNames([{ path, text }], LABELS);
    expect(unknown.map(format)).toEqual([]);
  });

  it("passes every manual in docs/manual", () => {
    // **読んだものを先に数える。** 読み損ねて 0 冊・0 件になっても、
    // 「知らない名前 0 件」は緑になる——**何も比べずに緑にしない。**
    const files = readManuals();
    expect(files.map(manualName)).toEqual(EXPECTED_MANUALS);
    for (const file of files) {
      expect(
        extractKeyNames(file.text).length,
        `${file.path} に【…】が 1 つも無い`,
      ).toBeGreaterThan(0);
    }
    // 下限は 2026-09-10 に 3 冊の草稿で数えた実数。**マニュアルからキー名を
    // 減らしたら、ここを実数に下げる**（黙って減らさない）。
    expect(
      files.flatMap((file) => extractKeyNames(file.text)).length,
    ).toBeGreaterThanOrEqual(KEY_NAME_FLOOR);
    expect(findUnknownKeyNames(files, LABELS).map(format)).toEqual([]);
  });
});

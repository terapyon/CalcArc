import { describe, expect, it } from "vitest";
import { CONVERT_CATEGORY_IDS } from "../../convert/types";
import {
  BANDWIDTH_UNIT_TOKENS,
  DATA_TYPE_TOKENS,
  DURATION_UNIT_TOKENS,
  PRECISION_TOKENS,
} from "../../datascale/types";
import { PANEL_MODES } from "../../settings/types";
import {
  CONVERT_FIELDS,
  CONVERT_SECTIONS,
  faceUnitsOf,
  unitSections,
} from "./convert";
import {
  DATA_SCALE_FIELDS,
  DATA_SCALE_SECTIONS,
  TYPE_SECTIONS,
} from "./dataScale";
import { FINANCE_FIELDS, FINANCE_SECTIONS } from "./finance";
import { CANDIDATE_SECTIONS, LLM_FIELD_ORDER, LLM_FIELD_SECTION } from "./llm";
import { parsePrefixed } from "./parse";
import {
  BANDWIDTH_UNIT_SECTION,
  DURATION_UNIT_SECTION,
  TRANSFER_FIELD_ORDER,
  TRANSFER_FIELD_SECTION,
} from "./transfer";
import type { KeypadSection } from "./types";

describe("parsePrefixed", () => {
  it("returns null for a spelling that is not in the list", () => {
    // **これが `as` との違いである。** `token.slice(…) as LlmField` は
    // どんな綴りでも通す。
    expect(parsePrefixed("field:xyz", "field:", LLM_FIELD_ORDER)).toBeNull();
    expect(parsePrefixed("field:", "field:", LLM_FIELD_ORDER)).toBeNull();
  });

  it("returns null when the prefix does not match", () => {
    expect(parsePrefixed("digit:7", "field:", LLM_FIELD_ORDER)).toBeNull();
    // **接頭辞が長いほうに引っかからない**——`unit:b` を `unit:` で解くのと
    // `bandwidth:` で解くのは別である。
    expect(
      parsePrefixed("bandwidth:bps", "duration:", DURATION_UNIT_TOKENS),
    ).toBeNull();
  });

  it("returns the value when it is in the list", () => {
    expect(parsePrefixed("field:layers", "field:", LLM_FIELD_ORDER)).toBe(
      "layers",
    );
    expect(
      parsePrefixed("precision:fp16", "precision:", PRECISION_TOKENS),
    ).toBe("fp16");
  });
});

/**
 * **盤面が出しうる接頭辞つきトークンは、1 つ残らず解ける。**
 *
 * `parsePrefixed` が `null` を返したとき、パネルは何もしない。**黙って
 * no-op にすると、盤面と一覧のずれが静かに沈む**——`KEY_TOKENS` と
 * `Key::ALL` で既に踏んだ形である(`token_parity.rs` が在るのはそのため)。
 * 同じ手を打つ: **ずれは実行時ではなく、ここで捕まえる。**
 */
describe("盤面のトークンと一覧のずれ", () => {
  /** 面の集まりから、その接頭辞で始まるトークンを集める。 */
  const tokensWith = (
    faces: readonly KeypadSection<string>[],
    prefix: string,
  ): string[] =>
    faces
      .flatMap((face) => face.keys.map((key) => key.token))
      .filter((token): token is string => token !== null)
      .filter((token) => token.startsWith(prefix));

  const CASES: [
    string,
    readonly KeypadSection<string>[],
    string,
    readonly string[],
  ][] = [
    ["LLM 項目", [LLM_FIELD_SECTION], "field:", LLM_FIELD_ORDER],
    [
      "LLM 精度",
      Object.values(CANDIDATE_SECTIONS),
      "precision:",
      PRECISION_TOKENS,
    ],
    [
      "Data Scale 項目",
      [...DATA_SCALE_SECTIONS, ...TYPE_SECTIONS],
      "field:",
      DATA_SCALE_FIELDS,
    ],
    ["Data Scale 型", TYPE_SECTIONS, "dtype:", DATA_TYPE_TOKENS],
    ["Transfer 項目", [TRANSFER_FIELD_SECTION], "field:", TRANSFER_FIELD_ORDER],
    [
      "Transfer 帯域幅の単位",
      [BANDWIDTH_UNIT_SECTION],
      "bandwidth:",
      BANDWIDTH_UNIT_TOKENS,
    ],
    [
      "Transfer 時間の単位",
      [DURATION_UNIT_SECTION],
      "duration:",
      DURATION_UNIT_TOKENS,
    ],
    ["Finance 項目", FINANCE_SECTIONS, "field:", FINANCE_FIELDS],
    ["Finance モード", FINANCE_SECTIONS, "mode:", PANEL_MODES],
    ["Convert 項目", CONVERT_SECTIONS, "field:", CONVERT_FIELDS],
  ];

  it.each(CASES)("%s は全部解ける", (_name, faces, prefix, allowed) => {
    const tokens = tokensWith(faces, prefix);
    // **件数を先に主張する。** 面の綴りが変わって 0 件になると、
    // 「解けなかったものは無い」で緑を返してしまう。
    expect(tokens.length, `${prefix} のトークンが 1 つも無い`).toBeGreaterThan(
      0,
    );
    const unresolved = tokens.filter(
      (token) => parsePrefixed(token, prefix, allowed) === null,
    );
    expect(unresolved).toEqual([]);
  });

  it("Convert の単位はカテゴリごとに解ける", () => {
    // **単位だけは一覧がカテゴリで変わる。** 為替の面で長さの単位を
    // 受け取らないことも、ここで見る。
    let checked = 0;
    for (const category of CONVERT_CATEGORY_IDS) {
      const tokens = tokensWith(unitSections(category), "unit:");
      expect(tokens.length, `${category} に単位キーが無い`).toBeGreaterThan(0);
      for (const token of tokens) {
        expect(
          parsePrefixed(token, "unit:", faceUnitsOf(category)),
          `${category}: ${token}`,
        ).not.toBeNull();
        checked += 1;
      }
    }
    // 単位 63 + 通貨 16。
    expect(checked).toBe(79);
  });
});

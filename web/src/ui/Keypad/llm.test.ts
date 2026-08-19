import { describe, expect, it } from "vitest";
import { PRECISION_TOKENS } from "../../datascale/types";
import {
  CANDIDATE_SECTIONS,
  CANDIDATE_VALUES,
  LLM_FIELD_LABELS,
  LLM_FIELD_SECTION,
  type LlmKeyToken,
  llmPad,
} from "./llm";

describe("LLM のキー集合", () => {
  it("puts all seven fields in one two-row section", () => {
    const tokens = LLM_FIELD_SECTION.keys
      .map((k) => k.token)
      .filter((t): t is LlmKeyToken => t !== null);
    expect(tokens).toHaveLength(7);
    expect(LLM_FIELD_SECTION.columns).toBe(4);
    // 4 列 × 2 段 = 8 セル。7 項目 + 恒久の空き 1。
    expect(LLM_FIELD_SECTION.keys).toHaveLength(8);
    for (const field of Object.keys(LLM_FIELD_LABELS)) {
      expect(tokens).toContain(`field:${field}`);
    }
  });

  it("says the number out loud where the label carries a suffix", () => {
    // **同じ字が 2 つの意味を持つ**(spec §4.3): パラメータ数の B は 10^9、
    // 文脈長の K は 1024。押す前に実際の数が分かるようにする。
    const params = CANDIDATE_SECTIONS.parameters.keys.filter((k) =>
      k.token?.startsWith("param:"),
    );
    expect(params.map((k) => k.label)).toEqual([
      "1B",
      "3B",
      "7B",
      "8B",
      "14B",
      "27B",
      "32B",
      "70B",
    ]);
    expect(params.map((k) => k.ariaLabel)).toEqual([
      "1000000000",
      "3000000000",
      "7000000000",
      "8000000000",
      "14000000000",
      "27000000000",
      "32000000000",
      "70000000000",
    ]);

    const context = CANDIDATE_SECTIONS.context.keys.filter((k) =>
      k.token?.startsWith("ctx:"),
    );
    expect(context.map((k) => k.label)).toEqual([
      "2K",
      "4K",
      "8K",
      "16K",
      "32K",
      "128K",
      "1M",
    ]);
    expect(context.map((k) => k.ariaLabel)).toEqual([
      "2048",
      "4096",
      "8192",
      "16384",
      "32768",
      "131072",
      "1048576",
    ]);
  });

  it("keeps the token and the spoken number in step", () => {
    // CANDIDATE_VALUES(候補の実数値そのもの)が持つ件数と、盤面の候補数が
    // 食い違っていないかも確かめる——ラベル・読み上げ・トークンをそこから
    // 起こす、という裁定(コントローラの裁定 1)を候補数の面でも見る。
    expect(CANDIDATE_VALUES.parameters).toHaveLength(8);
    expect(CANDIDATE_VALUES.kvHeads).toHaveLength(6);
    expect(CANDIDATE_VALUES.headDim).toHaveLength(5);
    expect(CANDIDATE_VALUES.context).toHaveLength(7);

    // トークンにも展開済みの数が入る。ラベル・読み上げ・トークンの 3 つが
    // ずれたら、押した数と計算した数が食い違う。
    for (const section of Object.values(CANDIDATE_SECTIONS)) {
      for (const key of section.keys) {
        const token = key.token;
        if (token === null || !/^(param|heads|dim|ctx):/.test(token)) continue;
        expect(token.split(":")[1]).toBe(key.ariaLabel);
      }
    }
  });

  it("offers int4 for the weights and not for the KV cache", () => {
    // spec §4.3 の候補表。**コアは 5 つとも受ける**が、盤面は出さない。
    const of = (name: "weight" | "kvPrecision") =>
      CANDIDATE_SECTIONS[name].keys
        .map((k) => k.token)
        .filter((t): t is LlmKeyToken => t?.startsWith("precision:") ?? false)
        .map((t) => t.slice("precision:".length));
    expect(of("weight")).toEqual(["fp32", "fp16", "bf16", "int8", "int4"]);
    expect(of("kvPrecision")).toEqual(["fp16", "bf16", "fp32", "int8"]);
    for (const token of [...of("weight"), ...of("kvPrecision")]) {
      expect(PRECISION_TOKENS).toContain(token);
    }
  });

  it("every face rides the same five-by-five frame", () => {
    for (const [name, section] of Object.entries(CANDIDATE_SECTIONS)) {
      expect(section.columns, name).toBe(5);
      expect(section.height, name).toBe("square");
      expect(section.keys.length, name).toBeLessThanOrEqual(25);
      // DEL と AC は数字面と同じ位置に居る(面が変わっても消し方が動かない)。
      expect(section.keys[3]?.token, name).toBe("del");
      expect(section.keys[4]?.token, name).toBe("ac");
    }
  });

  it("shows the B and M keys only where they mean something", () => {
    const units = (field: Parameters<typeof llmPad>[0]) =>
      llmPad(field)
        .keys.map((k) => k.token)
        .filter((t): t is LlmKeyToken => t?.startsWith("unit:") ?? false);
    // パラメータ数の手入力にだけ接尾辞キーが立つ(spec §4.3)。
    expect(units("parameters")).toEqual(["unit:b", "unit:m"]);
    // 層数は手入力だけの項目で、単位を持たない。
    expect(units("layers")).toEqual([]);
  });

  it("offers the way back only where there is a face to go back to", () => {
    const back = (field: Parameters<typeof llmPad>[0]) =>
      llmPad(field).keys.some((k) => k.token === "entry:choose");
    expect(back("parameters")).toBe(true);
    expect(back("context")).toBe(true);
    // **層数には候補面が無い**(spec §4.3)。戻る先が無いキーは出さない。
    expect(back("layers")).toBe(false);
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataScaleCalc, LlmResult, PrecisionToken } from "../../datascale";

// jsdom では WASM を読み込めないので、ラッパー層ごと差し替える
// (DataScalePanel.test.tsx と同じ流儀)。
vi.mock("../../datascale", () => ({
  initDataScale: vi.fn(),
}));

/** コアに渡った (打った文字列, 単位表) の記録。**渡していること**そのものを
 * 主張するために要る——結果だけを見ていると、`"none"` を渡していても
 * 数字だけの項目は素通りしてしまう。 */
const evaluated = vi.hoisted(() => [] as { text: string; unitSet: string }[]);

// 式の評価器も WASM なので、ラッパーごと差し替える。**単位を解釈するのは
// コア**(設計書 訂正 2)なので、ここでは打った文字列から数字だけを拾う
// 簡易版で足りる——値の正しさは golden が見る。パラメータ数の単位だけ
// (`B` = 10⁹、`M` = 10⁶)を持つ——LLM の他の項目は単位を持たない。
//
// **`unitSet` は無視しない。** 単位表そのものはコアが持ち
// (`crates/calcarc-core/src/expr/mod.rs` の `UnitSet::Params` が `27B` を
// 検査している)、WASM 境界の `unit_set_from_str` も Task 5 が検査済み
// ——鎖のうち web にだけ残っているのは「パネルがどの表を渡すか」なので、
// そこをここで見張る。`"params"` のときだけ `B`/`M` を解釈し、`"none"` で
// 来たらコアと同じく SyntaxError を返す(第 3 引数を捨てると、パネルが
// `"none"` を渡していても全テストが緑のままになる)。
vi.mock("../../expr", () => ({
  initExpr: () =>
    Promise.resolve({
      integer: (text: string, max: string, unitSet: string) => {
        evaluated.push({ text, unitSet });
        const units: Record<string, bigint> =
          unitSet === "params" ? { B: 10n ** 9n, M: 10n ** 6n } : {};
        let value = 0n;
        let digits = "";
        for (const ch of text) {
          if (/\d/.test(ch)) digits += ch;
          else if (units[ch] !== undefined) {
            value += BigInt(digits || "0") * (units[ch] as bigint);
            digits = "";
          } else return { value: null, error: "SyntaxError" };
        }
        if (text === "") return { value: null, error: null };
        value += BigInt(digits || "0");
        // **上限は着地に効く**(設計書 §5)。超えたら Overflow で、値は出ない。
        if (value > BigInt(max)) return { value: null, error: "Overflow" };
        return { value: value.toString(), error: null };
      },
      percent: (text: string) => ({ value: text, error: null }),
    }),
}));

import { initDataScale } from "../../datascale";
import { CANDIDATE_VALUES, LLM_FIELD_LABELS } from "../Keypad/llm";
import { updateSettings } from "../useSetting";
import { LlmPanel } from "./LlmPanel";

/** u128 の上限。コアの着地表と同じ境界(設計書 §8)。 */
const U128_MAX = 340282366920938463463374607431768211455n;

/** 精度トークンのビット幅。重み・KV とも同じ表を使う(spec §4.3)。 */
const BITS: Record<PrecisionToken, bigint> = {
  fp32: 32n,
  fp16: 16n,
  bf16: 16n,
  int8: 8n,
  int4: 4n,
};

function grouped(n: bigint): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const DECIMAL_UNITS: [string, bigint][] = [
  ["TB", 10n ** 12n],
  ["GB", 10n ** 9n],
  ["MB", 10n ** 6n],
  ["KB", 10n ** 3n],
];
const BINARY_UNITS: [string, bigint][] = [
  ["TiB", 1024n ** 4n],
  ["GiB", 1024n ** 3n],
  ["MiB", 1024n ** 2n],
  ["KiB", 1024n],
];

function formatUnit(bytes: bigint, units: [string, bigint][]): string | null {
  for (const [label, scale] of units) {
    if (bytes >= scale) {
      return `${(Number(bytes) / Number(scale)).toFixed(1)} ${label}`;
    }
  }
  return null;
}

function byteLines(bytes: bigint) {
  return {
    bytes: bytes.toString(),
    bytesGrouped: grouped(bytes),
    decimal: formatUnit(bytes, DECIMAL_UNITS),
    binary: formatUnit(bytes, BINARY_UNITS),
  };
}

/**
 * `calc.llm` の簡易実装。**バイト数の算数だけを再現する**——コアの
 * 移植ではない(CLAUDE.md「参照実装を Rust の移植にしない」と同じ理由で、
 * ここは「呼び出しの配線」を確かめるためのスタブであって、golden の
 * 代わりではない)。spec §5 の実測値と一致することは headline のテストが
 * 見る。
 */
function llmStub(
  parameters: string,
  weightPrecision: PrecisionToken,
  layers: string,
  kvHeads: string,
  headDim: string,
  contextLength: string,
  kvPrecision: PrecisionToken,
): LlmResult {
  const p = BigInt(parameters || "0");
  const l = BigInt(layers || "0");
  const kh = BigInt(kvHeads || "0");
  const hd = BigInt(headDim || "0");
  const cl = BigInt(contextLength || "0");
  const weightBytes = (p * BITS[weightPrecision]) / 8n;
  const kvBytes = (2n * l * kh * hd * cl * BITS[kvPrecision]) / 8n;
  // **失敗は payload を 1 つも持たない**(設計書 §0)。
  if (weightBytes > U128_MAX || kvBytes > U128_MAX) {
    return { kind: "error", code: "Overflow" };
  }
  const totalBytes = weightBytes + kvBytes;
  if (totalBytes > U128_MAX) {
    return { kind: "error", code: "Overflow" };
  }
  return {
    kind: "ok",
    weight: byteLines(weightBytes),
    kv: byteLines(kvBytes),
    total: byteLines(totalBytes),
  };
}

function stubCalc(llm?: DataScaleCalc["llm"]): DataScaleCalc {
  // compute / transfer はこのパネルでは使わない。型を満たすためだけの
  // スタブで、呼ばれたら失敗させて検知する(DataScalePanel.test.tsx と同じ)。
  return {
    compute: vi.fn(() => {
      throw new Error("stubCalc.compute is not wired in this test");
    }),
    llm: llm ?? llmStub,
    transfer: vi.fn(() => {
      throw new Error("stubCalc.transfer is not wired in this test");
    }),
  };
}

/**
 * **ボタン名は実物の aria-label(Task 8 の `llm.ts`)に合わせてある。**
 *
 * plan の brief に書かれていた文字列(「パラメータ数を選ぶ」「KV ヘッド数を
 * 選ぶ」「文脈長を選ぶ」など、および候補キーの「27B」「8K」)は、実際の
 * `FIELD_ARIA_LABELS` / `valueKey` の出力と食い違っていた:
 *
 * - 項目名は「手入力できる項目は〜を入力、選択だけの項目は〜を選ぶ」という
 *   `llm.ts` 自身の規則により、parameters/kvHeads/headDim/context は
 *   「〜を入力」になる(brief は「〜を選ぶ」と書いていた)。KV の項目名も
 *   スペースの有無が違っていた(「KV ヘッド数」ではなく「KVヘッド数」)。
 * - 候補キーの読み上げ名(`ariaLabel`)は**常に展開済みの数そのもの**
 *   (`String(value)`)で、画面の文字(`label`、"27B" や "8K")とは別物
 *   ——`Key.tsx` は `aria-label={ariaLabel ?? label}` を常に明示的に付ける
 *   ので、`getByRole("button", { name: "27B" })` は実物には存在しない。
 *   brief 自身の最後のテスト(「候補キーは声に出して数を言う」)がこの
 *   区別を正しく踏まえていたので、他の箇所は書き漏らしと判断した。
 *
 * 変えたのはボタンを探す文字列だけで、**主張(golden の数・testid・
 * エラー分類)は brief のまま**である。
 */
const FIELD_NAMES = {
  parameters: "パラメータ数を入力",
  weight: "重みの精度を選ぶ",
  layers: "層数を入力",
  kvHeads: "KVヘッド数を入力",
  headDim: "ヘッド次元を入力",
  context: "文脈長を入力",
  kvPrecision: "KVの精度を選ぶ",
} as const;

async function renderPanel(calc: DataScaleCalc = stubCalc()) {
  vi.mocked(initDataScale).mockResolvedValue(calc);
  render(<LlmPanel />);
  await screen.findByRole("button", { name: FIELD_NAMES.parameters });
  return calc;
}

async function press(names: string[]) {
  for (const name of names) {
    await userEvent.click(screen.getByRole("button", { name }));
  }
}

async function type(digits: string) {
  for (const digit of digits) {
    await userEvent.click(screen.getByRole("button", { name: digit }));
  }
}

const echo = () => screen.getByTestId("display-echo");
const main = () => screen.getByTestId("display-main");

/** 基準例(spec §5): 27B / INT4 / 62 層 / KV 16 ヘッド / 128 次元 / 8K 文脈 / KV FP16。 */
async function fillHeadline() {
  await press([FIELD_NAMES.parameters, "27000000000"]);
  await press([FIELD_NAMES.weight, "INT4"]);
  await press([FIELD_NAMES.layers, "6", "2"]);
  await press([FIELD_NAMES.kvHeads, "16"]);
  await press([FIELD_NAMES.headDim, "128"]);
  await press([FIELD_NAMES.context, "8192"]);
  await press([FIELD_NAMES.kvPrecision, "FP16"]);
}

beforeEach(() => {
  window.localStorage.clear();
  evaluated.length = 0;
});

describe("LlmPanel（電卓）", () => {
  it("computes the headline case from the spec", async () => {
    await renderPanel();
    await fillHeadline();

    const result = screen.getByTestId("llm-result");
    expect(result).toHaveTextContent("13,500,000,000 bytes");
    expect(result).toHaveTextContent("13.5 GB");
    expect(result).toHaveTextContent("4,160,749,568 bytes");
    expect(result).toHaveTextContent("17,660,749,568 bytes");
    expect(main()).toHaveTextContent("17.7 GB");
  });

  it("adds up on screen: the two lines make the total", async () => {
    // **見えている数が足し算になっている**(spec §3.4 が守っているもの)。
    // 画面から読んだ 3 つの数で確かめる——実装の式ではなく、出た数で。
    await renderPanel();
    await fillHeadline();
    const digits = (testId: string) =>
      BigInt(
        screen.getByTestId(testId).textContent?.replace(/[^0-9]/g, "") ?? "0",
      );
    expect(digits("llm-weight-bytes") + digits("llm-kv-bytes")).toBe(
      digits("llm-total-bytes"),
    );
  });

  it("says nothing until the layers are known", async () => {
    await renderPanel();
    expect(screen.queryByTestId("llm-result")).toBeNull();
    expect(main()).toHaveTextContent("");
  });

  it("follows the saved primary system, which Data Scale owns", async () => {
    // **共有結合を 1 本で固定する**(監視役の推奨、2026-08-19)。LLM は
    // 自前の設定を持たず `settings.dataScale.primary` を読む(計画時の裁定 2)
    // ——つまり **Data Scale の設定が LLM の主表示を変える**。その向きが
    // 意図であることを、ここで見えるようにしておく。
    window.localStorage.clear();
    updateSettings((current) => ({
      ...current,
      dataScale: { ...current.dataScale, primary: "binary" },
    }));
    await renderPanel();
    await fillHeadline();
    expect(main()).toHaveTextContent("16.4 GiB");
  });

  it("keeps the notice honest about the KV cache", async () => {
    // 設計書 §21 のリストをそのまま写すと、KV cache を計算に入れている
    // この画面が自分について嘘をつく(spec §5)。
    await renderPanel();
    const notice = screen.getByTestId("llm-notice");
    expect(notice).toHaveTextContent("理論値");
    expect(notice).toHaveTextContent("一時バッファ");
    expect(notice.textContent).not.toContain("KV");
  });

  it("shows an overflow as an error, not as a number", async () => {
    await renderPanel();
    await press([FIELD_NAMES.parameters, "手入力"]);
    await type("340282366920938463463374607431768211455");
    await press([FIELD_NAMES.weight, "FP32"]);
    await press([FIELD_NAMES.layers, "1"]);
    expect(main()).toHaveTextContent("Math ERROR");
    expect(main()).toHaveAttribute("data-error", "Overflow");
  });

  it("expands 27B into digits, not into a rounded display value", async () => {
    await renderPanel();
    await press([FIELD_NAMES.parameters, "手入力", "2", "7", "十億"]);
    expect(echo()).toHaveTextContent("パラメータ数 27B");
    await press([FIELD_NAMES.weight, "INT8"]);
    await press([FIELD_NAMES.layers, "1"]);
    expect(screen.getByTestId("llm-weight-bytes")).toHaveTextContent(
      "27,000,000,000 bytes",
    );
  });

  it("reads the parameter count with the params table and the rest with none", async () => {
    // **web に残っている仕事は「どの単位表で読むか」を渡すことだけ**——
    // 表そのものはコアが持つ(`crates/calcarc-core/src/expr/mod.rs` の
    // `UnitSet::Params`)。渡し方が壊れても、数字しか打たない項目は素通り
    // するので結果からは分からない。ここで渡した名前そのものを見る。
    await renderPanel();
    await press([FIELD_NAMES.parameters, "手入力", "2", "7", "十億"]);
    await press([FIELD_NAMES.layers, "6", "2"]);

    const forParams = evaluated.filter((call) => call.text === "27B");
    expect(forParams.length).toBeGreaterThan(0);
    expect([...new Set(forParams.map((c) => c.unitSet))]).toEqual(["params"]);

    // 層数は単位を持たない項目。`"62"` を読ませた呼びはすべて `"none"`。
    const forLayers = evaluated.filter((call) => call.text === "62");
    expect(forLayers.length).toBeGreaterThan(0);
    expect([...new Set(forLayers.map((c) => c.unitSet))]).toEqual(["none"]);
  });

  it("keeps every default among the candidates it says it matches", async () => {
    // `LlmPanel.tsx` の既定値は「対応する候補キーを押したのと同じ Entry」
    // だと名乗っているが、値はべた書きで `CANDIDATE_VALUES` を見ていない
    // ——片方だけ動かしても他のテストは緑のままなので、ここで membership
    // を主張して理由が黙って腐らないようにする(CLAUDE.md の「理由は静かに
    // 腐る」)。
    await renderPanel();
    for (const field of [
      "parameters",
      "kvHeads",
      "headDim",
      "context",
    ] as const) {
      await press([FIELD_NAMES[field]]);
      const label = LLM_FIELD_LABELS[field];
      const shown =
        screen.getByTestId("display-entry-active").textContent ?? "";
      expect(shown.startsWith(`${label} `), `${label} の行が読めない`).toBe(
        true,
      );
      const value = shown.slice(label.length + 1);
      expect(
        CANDIDATE_VALUES[field].map(String),
        `${label} の既定 ${value} は候補に無い`,
      ).toContain(value);
    }
  });
});

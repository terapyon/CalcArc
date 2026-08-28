import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataScaleCalc } from "../../datascale";
// トークンの一覧は WASM を触らない `types.ts` から取る——ラッパー本体
// (`../../datascale`)は下でまるごと差し替えるので、そちらから取ると
// 実物の綴りではなくモックを見ることになる。
import type {
  BandwidthUnitToken,
  DurationUnitToken,
  TransferResult,
} from "../../datascale/types";
import {
  BANDWIDTH_UNIT_TOKENS,
  DURATION_UNIT_TOKENS,
} from "../../datascale/types";

// jsdom では WASM を読み込めないので、ラッパー層ごと差し替える
// (DataScalePanel.test.tsx / LlmPanel.test.tsx と同じ流儀)。
vi.mock("../../datascale", () => ({
  initDataScale: vi.fn(),
}));

/** コアに渡った (打った文字列, 単位表) の記録。**渡していること**そのものを
 * 主張するために要る——転送の 2 つの値は数字しか打てないので、単位表を
 * 取り違えても結果からは分からない。 */
const evaluated = vi.hoisted(() => [] as { text: string; unitSet: string }[]);

// 式の評価器も WASM なので、ラッパーごと差し替える。**単位を解釈するのは
// コア**(設計書 訂正 2)。転送の帯域幅・時間は**単位を取らない**項目
// (`"none"`)なので、数字以外が来たらコアと同じく SyntaxError を返す
// ——第 3 引数を捨てると、パネルが別の表を渡していても緑のままになる。
vi.mock("../../expr", () => ({
  initExpr: () =>
    Promise.resolve({
      integer: (text: string, max: string, unitSet: string) => {
        evaluated.push({ text, unitSet });
        if (text === "") return { kind: "ok", value: "" };
        if (!/^\d+$/.test(text)) return { kind: "error", code: "SyntaxError" };
        const value = BigInt(text);
        // **上限は着地に効く**(設計書 §5)。超えたら Overflow で値は出ない。
        if (value > BigInt(max)) return { kind: "error", code: "Overflow" };
        return { kind: "ok", value: value.toString() };
      },
      percent: (text: string) => ({ kind: "ok", value: text }),
    }),
}));

import { initDataScale } from "../../datascale";
import { updateSettings } from "../useSetting";
import { TransferPanel } from "./TransferPanel";

/** u128 の上限。コアの着地表と同じ境界(設計書 §8)。 */
const U128_MAX = 340282366920938463463374607431768211455n;

/** 帯域幅の係数(bit/秒)。**10 進である**(spec §3.5)。 */
const BITS_PER_SECOND: Record<BandwidthUnitToken, bigint> = {
  bps: 1n,
  kbps: 1_000n,
  mbps: 1_000_000n,
  gbps: 1_000_000_000n,
};

/** 時間の係数(秒)。 */
const SECONDS: Record<DurationUnitToken, bigint> = {
  second: 1n,
  minute: 60n,
  hour: 3_600n,
  day: 86_400n,
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

/** コアに渡った引数の記録。**トークンの綴り**(小文字)をここで見る。 */
const calls: {
  bandwidth: string;
  bandwidthUnit: string;
  duration: string;
  durationUnit: string;
}[] = [];

/**
 * `calc.transfer` の簡易実装。**バイト数の算数だけを再現する**——コアの
 * 移植ではない(CLAUDE.md「参照実装を Rust の移植にしない」と同じ理由で、
 * ここは「呼び出しの配線」を確かめるためのスタブであって golden の代わり
 * ではない)。spec §3.5 の実測値と一致することは headline のテストが見る。
 */
function transferStub(
  bandwidth: string,
  bandwidthUnit: BandwidthUnitToken,
  duration: string,
  durationUnit: DurationUnitToken,
): TransferResult {
  calls.push({ bandwidth, bandwidthUnit, duration, durationUnit });
  const bits =
    BigInt(bandwidth || "0") *
    BITS_PER_SECOND[bandwidthUnit] *
    BigInt(duration || "0") *
    SECONDS[durationUnit];
  if (bits > U128_MAX) {
    // **失敗は payload を 1 つも持たない**(設計書 §0)。
    return { kind: "error", code: "Overflow" };
  }
  // 1 bit でも 1 byte を数える(切り上げ、spec §3.5)。
  const bytes = (bits + 7n) / 8n;
  return {
    kind: "ok",
    bytes: bytes.toString(),
    bytesGrouped: grouped(bytes),
    // **この 2 つだけは成功でも null になりうる**——単位に届かない値である。
    decimal: formatUnit(bytes, DECIMAL_UNITS),
    binary: formatUnit(bytes, BINARY_UNITS),
  };
}

function stubCalc(): DataScaleCalc {
  // compute / llm はこのパネルでは使わない。型を満たすためだけのスタブで、
  // 呼ばれたら失敗させて検知する(LlmPanel.test.tsx と同じ)。
  return {
    compute: vi.fn(() => {
      throw new Error("stubCalc.compute is not wired in this test");
    }),
    llm: vi.fn(() => {
      throw new Error("stubCalc.llm is not wired in this test");
    }),
    transfer: transferStub,
  };
}

/** ボタン名は `web/src/ui/Keypad/transfer.ts` の `ariaLabel` そのもの。
 * **画面のラベルではない**——`Key.tsx` は `aria-label` を常に明示する。 */
const FIELD_NAMES = {
  bandwidth: "帯域幅を入力",
  bandwidthUnit: "帯域幅の単位を選ぶ",
  duration: "時間を入力",
  durationUnit: "時間の単位を選ぶ",
} as const;

/** 単位キーの読み上げ名は画面の文字と同じ(spec §3.5 の表記)。 */
const BANDWIDTH_LABELS = ["bps", "kbps", "Mbps", "Gbps"] as const;
const DURATION_LABELS = ["秒", "分", "時", "日"] as const;

async function renderPanel(calc: DataScaleCalc = stubCalc()) {
  vi.mocked(initDataScale).mockResolvedValue(calc);
  render(<TransferPanel />);
  await screen.findByRole("button", { name: FIELD_NAMES.bandwidth });
  return calc;
}

async function press(names: string[]) {
  for (const name of names) {
    await userEvent.click(screen.getByRole("button", { name }));
  }
}

const echo = () => screen.getByTestId("display-echo");
const main = () => screen.getByTestId("display-main");

beforeEach(() => {
  window.localStorage.clear();
  evaluated.length = 0;
  calls.length = 0;
});

describe("TransferPanel（電卓）", () => {
  it("computes the headline case: 100 Mbps for 3 hours", async () => {
    await renderPanel();
    await press([FIELD_NAMES.bandwidth, "1", "0", "0"]);
    await press([FIELD_NAMES.bandwidthUnit, "Mbps"]);
    await press([FIELD_NAMES.duration, "3"]);
    await press([FIELD_NAMES.durationUnit, "時"]);
    expect(screen.getByTestId("transfer-result")).toHaveTextContent(
      "135,000,000,000 bytes",
    );
    expect(main()).toHaveTextContent("135.0 GB");
  });

  it("routes the kbps key to the kbps token", async () => {
    // **`kbps` のキーが `kbps` トークンとしてコアへ渡ることを見る。**
    // 出ている `115,200,000` は同ファイル `BITS_PER_SECOND` の
    // `kbps: 1_000n` ——**スタブ自身の算数**なので、この層では「k が 10 進
    // であること」は主張しようがない。それを見るのは
    // `crates/calcarc-core/src/data_scale/transfer.rs` の
    // `kilo_is_a_thousand_not_1024` と `testdata/transfer.json` である。
    // ここが守っているのは配線——別のトークン(`mbps` など)を渡せば
    // 係数が変わって落ちる。
    await renderPanel();
    await press([FIELD_NAMES.bandwidth, "5", "1", "2"]);
    await press([FIELD_NAMES.bandwidthUnit, "kbps"]);
    await press([FIELD_NAMES.duration, "3", "0"]);
    await press([FIELD_NAMES.durationUnit, "分"]);
    expect(screen.getByTestId("transfer-result")).toHaveTextContent(
      "115,200,000 bytes",
    );
  });

  it("charges a whole byte for a single bit", async () => {
    await renderPanel();
    await press([FIELD_NAMES.bandwidth, "1"]);
    await press([FIELD_NAMES.bandwidthUnit, "bps"]);
    await press([FIELD_NAMES.duration, "1"]);
    await press([FIELD_NAMES.durationUnit, "秒"]);
    expect(main()).toHaveTextContent("1 bytes");
  });

  it("starts on Mbps and hour, so the headline needs no unit key", async () => {
    // **既定は `mbps` と `hour`**(plan Task 10)。単位キーを 1 度も押さずに
    // headline が出ることで、既定が「たまたま同じ表示」ではなく実際に
    // 計算へ渡っていることを見る。
    await renderPanel();
    await press([FIELD_NAMES.bandwidth, "1", "0", "0"]);
    await press([FIELD_NAMES.duration, "3"]);
    expect(screen.getByTestId("transfer-result")).toHaveTextContent(
      "135,000,000,000 bytes",
    );
    expect(echo()).toHaveTextContent("帯域幅の単位 Mbps");
    expect(echo()).toHaveTextContent("時間の単位 時");
  });

  it("hands the core the lowercase tokens, not the labels", async () => {
    // 画面は `Mbps`・`時` と書くが、コアが受けるのは `mbps`・`hour` である
    // (`crates/calcarc-core/src/data_scale/transfer.rs` の `from_token`)。
    // **結果からは区別が付かない**——スタブが同じ係数を返してしまうので、
    // 渡した文字列そのものを見る。
    await renderPanel();
    await press([FIELD_NAMES.bandwidth, "1", "0", "0"]);
    await press([FIELD_NAMES.bandwidthUnit, "Gbps"]);
    await press([FIELD_NAMES.duration, "2"]);
    await press([FIELD_NAMES.durationUnit, "日"]);
    const last = calls.at(-1);
    expect(last, "calc.transfer was never called").toBeDefined();
    expect(last).toEqual({
      bandwidth: "100",
      bandwidthUnit: "gbps",
      duration: "2",
      durationUnit: "day",
    });
  });

  it("names every unit key in both systems", async () => {
    // **4 × 4 の候補が揃っていること。** 件数も主張する——ループだけだと
    // 候補が 0 個になった日も緑になる。
    expect(BANDWIDTH_UNIT_TOKENS).toHaveLength(BANDWIDTH_LABELS.length);
    expect(DURATION_UNIT_TOKENS).toHaveLength(DURATION_LABELS.length);
    await renderPanel();

    let seen = 0;
    await press([FIELD_NAMES.bandwidthUnit]);
    for (const label of BANDWIDTH_LABELS) {
      await press([label]);
      expect(echo(), `${label} を押しても表示に出ない`).toHaveTextContent(
        `帯域幅の単位 ${label}`,
      );
      seen += 1;
    }
    await press([FIELD_NAMES.durationUnit]);
    for (const label of DURATION_LABELS) {
      await press([label]);
      expect(echo(), `${label} を押しても表示に出ない`).toHaveTextContent(
        `時間の単位 ${label}`,
      );
      seen += 1;
    }
    expect(seen, "no unit key was ever pressed").toBe(
      BANDWIDTH_LABELS.length + DURATION_LABELS.length,
    );
  });

  it("reads both values with the table that has no units", async () => {
    // **web に残っている仕事は「どの単位表で読むか」を渡すことだけ**
    // ——表そのものはコアが持つ。転送の 2 項目は単位キーを持たないので、
    // 別の表を渡しても結果からは分からない。渡した名前そのものを見る。
    await renderPanel();
    await press([FIELD_NAMES.bandwidth, "1", "0", "0"]);
    await press([FIELD_NAMES.duration, "3"]);
    const read = evaluated.filter(
      (call) => call.text === "100" || call.text === "3",
    );
    expect(read.length, "neither value was ever evaluated").toBeGreaterThan(0);
    expect([...new Set(read.map((c) => c.unitSet))]).toEqual(["none"]);
  });

  it("follows the saved primary system, which Data Scale owns", async () => {
    // **共有結合を 1 本で固定する**(LlmPanel.test.tsx の同名の検査と
    // 同じ形)。Transfer は自前のトグルを持たず `settings.dataScale.primary`
    // を読む(計画時の裁定 2)——つまり **Data Scale の設定が Transfer の
    // 主表示を変える**。その向きが意図であることを、ここで見えるように
    // しておく。既定(`decimal`)でしか走らないテストばかりだと、読み出しを
    // 直書きに変えても全部が緑のまま通る。
    //
    // `125.7 GiB` は headline と同じ 135,000,000,000 bytes を
    // 1024³ で割った値。**主が 2 進に倒れたときだけ main に出る。**
    updateSettings((current) => ({
      ...current,
      dataScale: { ...current.dataScale, primary: "binary" },
    }));
    await renderPanel();
    await press([FIELD_NAMES.bandwidth, "1", "0", "0"]);
    await press([FIELD_NAMES.duration, "3"]);
    expect(screen.getByTestId("transfer-result")).toHaveTextContent(
      "135,000,000,000 bytes",
    );
    expect(main()).toHaveTextContent("125.7 GiB");
    expect(screen.getByTestId("transfer-primary")).toHaveTextContent(
      "2 進を主表示",
    );
  });

  it("says nothing until both values are typed", async () => {
    await renderPanel();
    expect(screen.queryByTestId("transfer-result")).toBeNull();
    await press([FIELD_NAMES.bandwidth, "1", "0", "0"]);
    expect(screen.queryByTestId("transfer-result")).toBeNull();
    expect(main()).toHaveTextContent("");
  });

  it("shows an overflow as an error, not as a number", async () => {
    await renderPanel();
    await press([FIELD_NAMES.bandwidth]);
    for (const digit of "340282366920938463463374607431768211455") {
      await press([digit]);
    }
    await press([FIELD_NAMES.duration, "9"]);
    expect(main()).toHaveTextContent("Math ERROR");
    expect(main()).toHaveAttribute("data-error", "Overflow");
    expect(screen.queryByTestId("transfer-result")).toBeNull();
  });

  it("AC puts the unit back to its default, and the value back to empty", async () => {
    await renderPanel();
    await press([FIELD_NAMES.bandwidthUnit, "Gbps"]);
    expect(echo()).toHaveTextContent("帯域幅の単位 Gbps");
    await press(["この項目を消去"]);
    expect(echo()).toHaveTextContent("帯域幅の単位 Mbps");

    await press([FIELD_NAMES.duration, "3", "0"]);
    expect(echo()).toHaveTextContent("時間 30");
    await press(["この項目を消去"]);
    expect(echo()).not.toHaveTextContent("時間 30");
  });
});

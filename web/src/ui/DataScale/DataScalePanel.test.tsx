import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DataScaleCalc, DataScaleResult } from "../../datascale";

// jsdom では WASM を読み込めないので、ラッパー層ごと差し替える
// (App.test.tsx と同じ流儀)。
vi.mock("../../datascale", () => ({
  initDataScale: vi.fn(),
}));

import { initDataScale } from "../../datascale";
import { DataScalePanel } from "./DataScalePanel";

function result(overrides: Partial<DataScaleResult> = {}): DataScaleResult {
  return {
    bytes: "307200000000",
    bytesGrouped: "307,200,000,000",
    decimal: "307.2 GB",
    binary: "286.1 GiB",
    error: null,
    ...overrides,
  };
}

function stubCalc(compute?: DataScaleCalc["compute"]): DataScaleCalc {
  return { compute: compute ?? vi.fn().mockReturnValue(result()) };
}

async function renderPanel(calc: DataScaleCalc = stubCalc()) {
  vi.mocked(initDataScale).mockResolvedValue(calc);
  render(<DataScalePanel />);
  await screen.findByRole("button", { name: "件数を入力" });
  return calc;
}

async function press(names: string[]) {
  for (const name of names) {
    await userEvent.click(screen.getByRole("button", { name }));
  }
}

const echo = () => screen.getByTestId("display-echo");
const main = () => screen.getByTestId("display-main");

/** 基準例: 100M × 768 × float32 = 307.2 GB。 */
async function fillHeadline() {
  await press([
    "件数を入力",
    "1",
    "0",
    "0",
    "百万",
    "次元数を入力",
    "7",
    "6",
    "8",
  ]);
}

describe("DataScalePanel（電卓）", () => {
  it("names the panel and its sections in Japanese", async () => {
    await renderPanel();
    expect(
      screen.getByRole("region", { name: "データスケール計算" }),
    ).toBeInTheDocument();
    for (const name of ["入力する項目", "数字と単位のキー"]) {
      expect(screen.getByRole("group", { name })).toBeInTheDocument();
    }
  });

  it("types into the active field and shows it in the echo", async () => {
    await renderPanel();
    await press(["件数を入力", "1", "0", "0", "百万"]);
    expect(echo()).toHaveTextContent("件数 100M");
  });

  it("computes the headline case", async () => {
    const calc = await renderPanel();
    await fillHeadline();
    await waitFor(() => {
      expect(main()).toHaveTextContent("307.2 GB");
    });
    // コアへ渡るのは展開後の素の数字列(base-spec §26)。
    expect(calc.compute).toHaveBeenLastCalledWith(
      "100000000",
      "768",
      "float32",
    );
  });

  it("swaps the keypad face when the type field is active", async () => {
    await renderPanel();
    expect(
      screen.getByRole("group", { name: "数字と単位のキー" }),
    ).toBeInTheDocument();
    await press(["データ型を選ぶ"]);
    expect(
      screen.queryByRole("group", { name: "数字と単位のキー" }),
    ).toBeNull();
    expect(
      screen.getByRole("group", { name: "データ型のキー" }),
    ).toBeInTheDocument();
  });

  it("starts on float32 and marks the chosen type", async () => {
    await renderPanel();
    await press(["データ型を選ぶ"]);
    expect(screen.getByRole("button", { name: "float32" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await press(["int64"]);
    expect(screen.getByRole("button", { name: "int64" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(echo()).toHaveTextContent("データ型 int64");
  });

  it("names the primary system and the active field in the status line", async () => {
    await renderPanel();
    expect(screen.getByTestId("datascale-primary")).toHaveTextContent(
      "10 進を主表示",
    );
    expect(screen.getByTestId("datascale-field")).toHaveTextContent(
      "件数を入力中",
    );
    await press(["データ型を選ぶ"]);
    expect(screen.getByTestId("datascale-field")).toHaveTextContent(
      "データ型を入力中",
    );
  });

  it("has nothing for DEL to delete on the type face", async () => {
    await renderPanel();
    await press(["データ型を選ぶ"]);
    expect(screen.getByRole("button", { name: "1文字消去" })).toBeDisabled();
  });

  it("returns the type to its default with AC", async () => {
    await renderPanel();
    await press(["データ型を選ぶ", "int64", "この項目を消去"]);
    expect(screen.getByRole("button", { name: "float32" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("closes the unit keys until a digit is there, and after a smaller unit", async () => {
    await renderPanel();
    await press(["件数を入力"]);
    expect(screen.getByRole("button", { name: "百万" })).toBeDisabled();
    await press(["1", "0", "0"]);
    expect(screen.getByRole("button", { name: "百万" })).toBeEnabled();
    await press(["百万"]);
    // M のあとに G は無い——単位は下る向きにしか置けない。
    expect(screen.getByRole("button", { name: "十億" })).toBeDisabled();
  });

  it("does not make the digits look like toggles", async () => {
    await renderPanel();
    expect(screen.getByRole("button", { name: "7" })).not.toHaveAttribute(
      "aria-pressed",
    );
  });

  it("stays neutral while the fields are empty", async () => {
    // 未入力は SyntaxError ではない。compute 自体を呼ばない。
    const calc = await renderPanel();
    expect(main()).toBeEmptyDOMElement();
    expect(calc.compute).not.toHaveBeenCalled();
  });

  it("shows both unit systems, one of them larger", async () => {
    // base-spec §17 は「両方表示する」。トグルが変えるのは**強調**だけ
    // (設計書 §6)。
    await renderPanel();
    await fillHeadline();
    await waitFor(() => expect(main()).toHaveTextContent("307.2 GB"));
    const shown = screen.getByTestId("datascale-result");
    expect(shown).toHaveTextContent("307,200,000,000 bytes");
    expect(shown).toHaveTextContent("286.1 GiB");
  });

  it("changes only which system is primary", async () => {
    const calc = await renderPanel();
    await fillHeadline();
    await waitFor(() => expect(main()).toHaveTextContent("307.2 GB"));
    const argsBefore = vi.mocked(calc.compute).mock.lastCall;

    await press(["2 進 (KiB) を主に"]);
    expect(main()).toHaveTextContent("286.1 GiB");

    // **トグルが変えるのは強調だけ**(設計書 §6/§9-3)。コアへ渡す入力も、
    // 返ってきた bytes も動かない。結果は毎レンダーで導出するので
    // compute は再度呼ばれる——見るべきは呼ばれた回数ではなく、
    // **同じ入力から同じ値が出ていること**である。
    expect(vi.mocked(calc.compute).mock.lastCall).toEqual(argsBefore);
    expect(screen.getByTestId("datascale-result")).toHaveTextContent(
      "307,200,000,000 bytes",
    );
  });

  it("falls through to the other system, then to bytes", async () => {
    // 1000 bytes 未満では両方 null(既知の非対称)。main は主 → 副 → bytes
    // の順に繰り上げる(設計書 §6)。
    await renderPanel(
      stubCalc(
        vi.fn().mockReturnValue(
          result({
            bytes: "999",
            bytesGrouped: "999",
            decimal: null,
            binary: null,
          }),
        ),
      ),
    );
    await fillHeadline();
    await waitFor(() => expect(main()).toHaveTextContent("999 bytes"));
    // 結果領域は null の行を出さない(現行のまま)。
    expect(screen.getByTestId("datascale-result")).not.toHaveTextContent("GB");
  });

  it("promotes the other system when the primary one is missing", async () => {
    await renderPanel(
      stubCalc(
        vi.fn().mockReturnValue(
          result({
            bytes: "1000",
            bytesGrouped: "1,000",
            decimal: "1.0 KB",
            binary: null,
          }),
        ),
      ),
    );
    await fillHeadline();
    await press(["2 進 (KiB) を主に"]);
    // 2 進が無いので 10 進が主に繰り上がる——空の主表示を見せない。
    await waitFor(() => expect(main()).toHaveTextContent("1.0 KB"));
  });

  it("shows an error when the core reports one", async () => {
    await renderPanel(
      stubCalc(
        vi.fn().mockReturnValue(
          result({
            bytes: null,
            bytesGrouped: null,
            decimal: null,
            binary: null,
            error: "Overflow",
          }),
        ),
      ),
    );
    await fillHeadline();
    await waitFor(() => expect(main()).toHaveTextContent("Math ERROR"));
    expect(main()).toHaveAttribute("data-error", "Overflow");
  });

  it("says so when the calculation engine cannot be loaded", async () => {
    vi.mocked(initDataScale).mockRejectedValue(new Error("wasm unavailable"));
    render(<DataScalePanel />);
    const alert = await screen.findByTestId("datascale-load-error");
    expect(alert).toHaveAttribute("role", "alert");
  });
});

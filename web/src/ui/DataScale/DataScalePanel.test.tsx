import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DataScaleCalc, DataScaleResult } from "../../datascale";

// jsdom では WASM を読み込めないので、ラッパー層ごと差し替える
// (App.test.tsx と同じ流儀)。DATA_TYPE_TOKENS は types.ts の実体を
// そのまま書き写す — wasm を import する index.ts 経由で読み込むと
// vi.mock の意味が失われる。vi.mock はファイル先頭に巻き上げられる
// ため、参照する定数も vi.hoisted で一緒に巻き上げる。
const { DATA_TYPE_TOKENS } = vi.hoisted(() => ({
  DATA_TYPE_TOKENS: [
    "int8",
    "uint8",
    "int16",
    "float16",
    "bfloat16",
    "int32",
    "float32",
    "int64",
    "float64",
  ] as const,
}));

vi.mock("../../datascale", () => ({
  DATA_TYPE_TOKENS,
  initDataScale: vi.fn(),
}));

import { initDataScale } from "../../datascale";
import { DataScalePanel } from "./DataScalePanel";

function result(overrides: Partial<DataScaleResult> = {}): DataScaleResult {
  return {
    bytes: "307200000000",
    bytesGrouped: "307,200,000,000",
    decimal: "307.2 GB",
    binary: "286.10 GiB",
    error: null,
    ...overrides,
  };
}

function stubCalc(compute: DataScaleCalc["compute"]): DataScaleCalc {
  return { compute };
}

describe("DataScalePanel", () => {
  it("connects count, dimensions and dtype to their labels", async () => {
    vi.mocked(initDataScale).mockResolvedValue(stubCalc(vi.fn()));
    render(<DataScalePanel />);
    // 読み込みの解決を待ってから抜ける。待たずに終わると、後続のテスト
    // 実行中に act() 外の state 更新が起きて警告が出る。
    await screen.findByLabelText("件数");
    expect(screen.getByLabelText("件数")).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByLabelText("次元数")).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByLabelText("データ型")).toBeInstanceOf(HTMLSelectElement);
  });

  it("names the panel in Japanese, matching the rest of the UI", async () => {
    // Display/Keypad のアクセシブルネームはすべて日本語(「角度の単位」
    // 「電卓キーパッド」等)。ここだけ英語だと読み上げの言語が揃わない。
    vi.mocked(initDataScale).mockResolvedValue(stubCalc(vi.fn()));
    render(<DataScalePanel />);
    await screen.findByLabelText("件数");
    expect(
      screen.getByRole("region", { name: "データスケール計算" }),
    ).toBeInTheDocument();
  });

  it("lists every dtype token, in order, as an option", async () => {
    vi.mocked(initDataScale).mockResolvedValue(stubCalc(vi.fn()));
    render(<DataScalePanel />);
    await screen.findByLabelText("件数");
    const options = screen.getAllByRole("option");
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual([
      ...DATA_TYPE_TOKENS,
    ]);
  });

  it("stays neutral — no error shown — while fields are empty", async () => {
    // 未入力は SyntaxError ではない(設計書 §6)。compute 自体を呼ばない。
    const compute = vi.fn();
    vi.mocked(initDataScale).mockResolvedValue(stubCalc(compute));
    render(<DataScalePanel />);
    await screen.findByLabelText("件数");
    const status = screen.getByRole("status");
    expect(status).not.toHaveTextContent("Math ERROR");
    expect(status.querySelector("[data-error]")).toBeNull();
    expect(compute).not.toHaveBeenCalled();
  });

  it("shows bytes, decimal and binary once both fields are filled", async () => {
    const compute = vi.fn().mockReturnValue(result());
    vi.mocked(initDataScale).mockResolvedValue(stubCalc(compute));
    render(<DataScalePanel />);

    await userEvent.type(screen.getByLabelText("件数"), "100000000");
    await userEvent.type(screen.getByLabelText("次元数"), "768");

    // 結果は導出値で、wasm の読み込み完了と入力の両方が揃った次の
    // 再描画で現れる。順序を仮定せず、状態が収束するまで待つ。
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "307,200,000,000 bytes",
      );
    });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("307.2 GB");
    expect(status).toHaveTextContent("286.10 GiB");
    expect(compute).toHaveBeenLastCalledWith("100000000", "768", "float32");
  });

  it("hides only the null lines on a sub-unit success (bytes but no decimal/binary)", async () => {
    // count=1, dimensions=1, int8 → 1 byte: 成功(error: null)だが最小単位
    // 未満なので decimal/binary は null(Task 3 の追補テストが保証する
    // 実際の境界)。null の行だけが消え、bytes 行は出て、エラーは出ない
    // ことを検査する — 全 null(エラー)/全非 null(単位あり)の中間形。
    const compute = vi.fn().mockReturnValue(
      result({
        bytes: "1",
        bytesGrouped: "1",
        decimal: null,
        binary: null,
        error: null,
      }),
    );
    vi.mocked(initDataScale).mockResolvedValue(stubCalc(compute));
    render(<DataScalePanel />);

    await userEvent.type(screen.getByLabelText("件数"), "1");
    await userEvent.type(screen.getByLabelText("次元数"), "1");

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("1 bytes");
    });
    const status = screen.getByRole("status");
    expect(status).not.toHaveTextContent("Math ERROR");
    expect(status.querySelector("[data-error]")).toBeNull();
    // "307.2 GB" のような単位付き表記が紛れ込んでいないこと(null の行は
    // 出ない)。GB/GiB 系の文字列が一切現れないことで確かめる。
    expect(status).not.toHaveTextContent("GB");
    expect(status).not.toHaveTextContent("GiB");
  });

  it("shows an error when the core reports one", async () => {
    const compute = vi.fn().mockReturnValue(
      result({
        bytes: null,
        bytesGrouped: null,
        decimal: null,
        binary: null,
        error: "Overflow",
      }),
    );
    vi.mocked(initDataScale).mockResolvedValue(stubCalc(compute));
    render(<DataScalePanel />);

    await userEvent.type(screen.getByLabelText("件数"), "1");
    await userEvent.type(screen.getByLabelText("次元数"), "1");

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Math ERROR");
    });
    expect(
      screen.getByRole("status").querySelector("[data-error='Overflow']"),
    ).not.toBeNull();
  });

  it("says so when the calculation engine cannot be loaded", async () => {
    vi.mocked(initDataScale).mockRejectedValue(new Error("wasm unavailable"));
    render(<DataScalePanel />);
    const alert = await screen.findByTestId("datascale-load-error");
    expect(alert).toHaveAttribute("role", "alert");
  });
});

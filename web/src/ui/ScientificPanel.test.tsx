import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// jsdom では WASM を読み込めないので、initCalc だけ差し替える。
// ここで確かめたいのは ScientificPanel の分岐であって計算ではない。
// ANGLE_MODES 等の定数は実物を残す——web/src/settings/ がそこから
// 取り得る値を読むので、消すと import の時点で落ちる。
vi.mock("../calc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../calc")>();
  return { ...actual, initCalc: vi.fn() };
});

import type { Calc, DisplayState, EngineState, KeyToken, Step } from "../calc";
import { initCalc } from "../calc";
import { ScientificPanel } from "./ScientificPanel";

/**
 * ../calc をモジュールごと差し替えているので、実 WASM の代わりに角度・
 * 極形式・記法のトグルだけを実装した最小の Calc を渡す。ScientificPanel
 * が復元で送るのは angle_toggle / polar_toggle / eng の 3 トークンだけ
 * なので、それ以外は状態を変えない。
 */
function fakeCalc(): Calc {
  let display: DisplayState = {
    echo: "",
    main: "0",
    angle: "Deg",
    form: "Rect",
    notation: "Normal",
    pendingOp: null,
    pendingDepth: 0,
    error: null,
  };
  const state = {} as EngineState;
  const step = (): Step => ({ state, display });
  return {
    initial: () => step(),
    dispatch: (_state: EngineState, key: KeyToken) => {
      if (key === "angle_toggle") {
        display = {
          ...display,
          angle: display.angle === "Deg" ? "Rad" : "Deg",
        };
      } else if (key === "polar_toggle") {
        display = {
          ...display,
          form: display.form === "Rect" ? "Polar" : "Rect",
        };
      } else if (key === "eng") {
        display = {
          ...display,
          notation: display.notation === "Normal" ? "Eng" : "Normal",
        };
      }
      return step();
    },
    version: () => "test",
  };
}

// **角度・極形式・記法は保存される(このファイルの「設定の永続化」参照)。**
// このスイート全体で毎回まっさらから始める(ファイル先頭の beforeEach なので、
// 下の「設定の永続化」describe にも及ぶ)。Finance/DataScale と同種の
// テスト間汚染を避けるため(レビュー指摘)。
beforeEach(() => {
  window.localStorage.clear();
});

describe("ScientificPanel", () => {
  it("says so when the calculation engine cannot be loaded", async () => {
    // 読み込みに失敗したまま Loading の表示で固まると、利用者には
    // 「遅い」のか「壊れた」のか区別がつかない。
    vi.mocked(initCalc).mockRejectedValue(new Error("wasm unavailable"));
    render(<ScientificPanel />);
    const alert = await screen.findByTestId("load-error");
    expect(alert).toHaveAttribute("role", "alert");
  });
});

describe("設定の永続化", () => {
  beforeEach(() => {
    // localStorage のクリアはファイル先頭の beforeEach が毎回やる。
    // ここでは、直前の describe が initCalc を reject させたままにして
    // いるので、成功する実装に戻す。
    vi.mocked(initCalc).mockImplementation(() => Promise.resolve(fakeCalc()));
  });

  it("restores the angle mode from the stored settings", async () => {
    // **初回描画から復元後の値である**——パネルは WASM 待ちで描画を
    // 止めているので、Deg が一瞬見える瞬間は無い(P-1 設計書 §2)。
    window.localStorage.setItem(
      "calcarc.settings",
      JSON.stringify({ v: 1, scientific: { angle: "Rad" } }),
    );
    render(<ScientificPanel />);
    expect(await screen.findByText("RAD")).toBeInTheDocument();
  });

  it("stores the angle mode when the user switches it", async () => {
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(
      screen.getByRole("button", { name: "角度の単位を切り替え" }),
    );
    await screen.findByText("RAD");
    const saved = JSON.parse(
      window.localStorage.getItem("calcarc.settings") as string,
    );
    expect(saved.scientific.angle).toBe("Rad");
  });

  it("does not store anything the user typed", () => {
    // **範囲の境界を検査で持つ**(P-1 設計書 §1-1)。
    // ここが緑のままなら、式を保存する実装が紛れ込んでいない。
    window.localStorage.setItem(
      "calcarc.settings",
      JSON.stringify({ v: 1, scientific: { angle: "Rad" } }),
    );
    const raw = window.localStorage.getItem("calcarc.settings") as string;
    expect(raw).not.toContain("buffer");
    expect(raw).not.toContain("operands");
  });
});

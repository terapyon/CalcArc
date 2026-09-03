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
 * 極形式・記法のトグルと数字だけを実装した最小の Calc を渡す。
 *
 * **次の表示は「渡された state」から作る。** 以前はクロージャの変数に
 * 積んでいて、`dispatch` は state 引数を無視していた。復元は 1 つ前の
 * 結果の state を次の `dispatch` に渡していく replay なので、そこを
 * 取り違えた実装(全部を `initial().state` に対して送る)でも、この
 * 偽物では結果が正しく見えてしまう——**偽物のほうが本物より寛容だと、
 * 何を書いても緑になる**(レビュー指摘)。
 *
 * **EngineState の中身は読まない**(TS 側で不透明である。types.ts:102)。
 * state の同一性だけを鍵にして、この偽物の側が表示を覚えている。
 */
function fakeCalc(): Calc {
  const displays = new WeakMap<EngineState, DisplayState>();
  const base: DisplayState = {
    echo: "",
    main: "0",
    angle: "Deg",
    form: "Rect",
    notation: "Normal",
    pendingOp: null,
    pendingDepth: 0,
    error: null,
  };
  /** 表示を 1 つの state に結び付けて返す。state は毎回新しい物である。 */
  function stepOf(display: DisplayState): Step {
    const state = {} as EngineState;
    displays.set(state, display);
    return { state, display };
  }
  return {
    initial: () => stepOf(base),
    dispatch: (state: EngineState, key: KeyToken) => {
      // 知らない state(この偽物が作った物ではない)は初期状態として扱う。
      const from = displays.get(state) ?? base;
      if (key === "angle_toggle") {
        return stepOf({ ...from, angle: from.angle === "Deg" ? "Rad" : "Deg" });
      }
      if (key === "polar_toggle") {
        return stepOf({
          ...from,
          form: from.form === "Rect" ? "Polar" : "Rect",
        });
      }
      if (key === "eng") {
        return stepOf({
          ...from,
          notation: from.notation === "Normal" ? "Eng" : "Normal",
        });
      }
      // 数字は主表示に積む。**「打った物は保存しない」を測るのに要る**
      // ——打鍵が表示に出ない偽物では、保存されていないことも言えない。
      if (/^[0-9]$/.test(key)) {
        return stepOf({
          ...from,
          main: from.main === "0" ? key : `${from.main}${key}`,
        });
      }
      return stepOf(from);
    },
    version: () => "test",
    // このスイートは ScientificPanel の分岐を確かめるためのもので、
    // 履歴の綴りはまだどこからも呼ばれていない(Task 4 時点)。
    spell: () => "",
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

  it("restores every scientific setting at once", async () => {
    // **2 つ同時に復元する。** 復元はトグルを 1 つずつ送り、その結果の
    // state を次へ渡す replay である(P-1 設計書 §4)。1 つだけ復元する
    // テストでは、どちらも `initial().state` に対して送る実装
    // ——最後の 1 つしか残らない——も緑のままになる。
    //
    // **【変更 2026-08-25、0.4.0】記法は 3 つ目ではなくなった。** 保存にも
    // 復元にも入らない——ENG はモードではなく覗くためのキーになった。
    // **保存に古い `notation` が残っていても無視されること**も、ここで
    // 一緒に見る(下の `display-notation` が空であることの主張)。
    window.localStorage.setItem(
      "calcarc.settings",
      JSON.stringify({
        v: 1,
        scientific: { angle: "Rad", form: "Polar", notation: "Eng" },
      }),
    );
    render(<ScientificPanel />);
    expect(await screen.findByText("RAD")).toBeInTheDocument();
    expect(screen.getByTestId("display-form")).toHaveTextContent("∠");
    expect(screen.getByTestId("display-notation")).not.toHaveTextContent("ENG");
  });

  it("does not store anything the user typed", async () => {
    // **範囲の境界を検査で持つ**(P-1 設計書 §1-1)。
    //
    // **打鍵してから、保存された物そのものを読む。** 以前ここは自分で
    // 書いた文字列を読み直して "buffer" を含まないと言っていただけで、
    // パネルを描画も打鍵もしていなかった——`writeSettings` が何を書いても
    // 緑のままだった(レビュー指摘)。
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    // 設定を 1 つ変える。保存キーはここで初めて生まれる。
    await userEvent.click(
      screen.getByRole("button", { name: "角度の単位を切り替え" }),
    );
    await screen.findByText("RAD");
    await userEvent.click(screen.getByRole("button", { name: "1" }));
    await userEvent.click(screen.getByRole("button", { name: "2" }));
    await userEvent.click(screen.getByRole("button", { name: "3" }));
    // 打鍵が本当に画面に届いていることを先に確かめる——届いていなければ
    // 「保存されていない」は何も言っていない。
    expect(screen.getByTestId("display-main")).toHaveTextContent("123");

    const raw = window.localStorage.getItem("calcarc.settings") as string;
    expect(raw).toContain("Rad");
    expect(raw).not.toContain("123");
    expect(raw).not.toContain("buffer");
    expect(raw).not.toContain("operands");
  });
});

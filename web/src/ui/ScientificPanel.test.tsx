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
// **偽 `spell` が呼ばれた回数。** Task 10 のブリーフ(★ Step 0)が言う
// 「呼ばれていないから空だった」と「呼ばれた結果が空だった」を区別するための
// 数取り——履歴を主張するテストのそれぞれで `spellCallCount` を確かめる。
// `fakeCalc()` はテストごとに作り直すので、数える側はここで毎回リセットする。
let spellCallCount = 0;

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
      // **`ac` は初期状態に戻す。** Task 10 の呼び戻しは `ac` を送ってから
      // 数字を送る形なので、ここが no-op のままだと呼び戻しの結果が
      // 「以前の表示に足された」ものになり、比較にならない。
      if (key === "ac") {
        return stepOf(base);
      }
      // 数字は主表示に積む。**「打った物は保存しない」を測るのに要る**
      // ——打鍵が表示に出ない偽物では、保存されていないことも言えない。
      if (/^[0-9]$/.test(key)) {
        return stepOf({
          ...from,
          main: from.main === "0" ? key : `${from.main}${key}`,
        });
      }
      // 小数点・符号・指数は「呼び戻しの等価性」(Task 10 Step 5)を測るのに
      // 要る。本物の綴り規則とは無関係で、状態を見分けられれば足りる。
      if (key === "dot") {
        return stepOf({
          ...from,
          main: from.main === "0" ? "0." : `${from.main}.`,
        });
      }
      if (key === "neg") {
        return stepOf({
          ...from,
          main: from.main.startsWith("-")
            ? from.main.slice(1)
            : `-${from.main}`,
        });
      }
      if (key === "exp") {
        return stepOf({ ...from, main: `${from.main}e` });
      }
      return stepOf(from);
    },
    version: () => "test",
    // **本物の綴り規則である必要は無い**(Task 10 ブリーフ ★ Step 0)——
    // 打鍵ごとに違う、空でない文字列を返せば足りる。数字だけを空白で
    // つないで返す: 演算子・`eq`・`ac` は式に混ざらないので、
    // 「`=` の 2 度押しは何も綴らない」(空の列 → 空文字列)も再現できる。
    spell: (keys: KeyToken[]) => {
      spellCallCount += 1;
      return keys.filter((key) => /^[0-9]$/.test(key)).join(" ");
    },
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

describe("履歴", () => {
  beforeEach(() => {
    // localStorage のクリアはファイル先頭の beforeEach が毎回やる。
    // ここでは、直前の describe が initCalc を reject させたままにして
    // いるので、成功する実装に戻す。
    vi.mocked(initCalc).mockImplementation(() => Promise.resolve(fakeCalc()));
    spellCallCount = 0;
  });

  it("records one entry when = is pressed", async () => {
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(screen.getByRole("button", { name: "2" }));
    await userEvent.click(screen.getByRole("button", { name: "掛ける" }));
    await userEvent.click(screen.getByRole("button", { name: "3" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));
    // **呼ばれたことを先に確かめる**——このあと履歴が空でも「呼ばれて
    // いないから空」と「呼ばれた結果が空」を区別できないと、この段の
    // 否定形は何も主張しない(Task 10 ブリーフ ★ Step 0)。
    expect(spellCallCount).toBeGreaterThan(0);

    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    // 偽 `spell` は数字だけを空白でつなぐ(演算子・`eq` は式に出ない)。
    expect(screen.getByText("2 3")).toBeInTheDocument();
    // 偽 `dispatch` は `mul`/`eq` を no-op として扱うので、答は数字を
    // そのまま連結した「23」になる——本物の掛け算ではない。
    expect(screen.getByText("23")).toBeInTheDocument();
  });

  it("does not record when history is switched off", async () => {
    window.localStorage.setItem(
      "calcarc.settings",
      JSON.stringify({ v: 1, history: { enabled: false } }),
    );
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(screen.getByRole("button", { name: "2" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));
    // 記録しない設定でも、綴りは呼ばれている——判断は綴った後に効く。
    expect(spellCallCount).toBeGreaterThan(0);

    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    expect(screen.getByText("まだ履歴はありません")).toBeInTheDocument();
  });

  it("keeps what was already recorded when history is switched off", async () => {
    // **切る＝これから記録しない。既存分は残る**(設計書 §7)。
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(screen.getByRole("button", { name: "2" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));

    // ここで初めて切る。
    window.localStorage.setItem(
      "calcarc.settings",
      JSON.stringify({ v: 1, history: { enabled: false } }),
    );
    await userEvent.click(screen.getByRole("button", { name: "3" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));
    expect(spellCallCount).toBeGreaterThan(0);

    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    // 切る前の 1 件だけが残る。切った後の 1 件は積まれていない。
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "2 = 2 を入力に入れる" }),
    ).toBeInTheDocument();
  });

  it("keeps the history across AC", async () => {
    // **`AC` では消えない**(設計書 §6)。
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(screen.getByRole("button", { name: "2" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));
    expect(spellCallCount).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "全消去" }));
    await screen.findByText("DEG");

    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "2 = 2 を入力に入れる" }),
    ).toBeInTheDocument();
  });

  it("does not record a second entry when = is pressed twice in a row", async () => {
    // **2 度目は空の列を綴るので式が `""` になり、`pushEntry` が積まない**
    // (ブリーフの「組み立て方」2)。
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(screen.getByRole("button", { name: "2" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));
    expect(spellCallCount).toBeGreaterThan(0);

    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("recalls a plain integer, stripping thousands separators", async () => {
    window.localStorage.setItem(
      "calcarc.history",
      JSON.stringify([
        { expression: "10!", answer: "3,628,800", angle: "Deg", error: false },
      ]),
    );
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    await userEvent.click(
      screen.getByRole("button", { name: "10! = 3,628,800 を入力に入れる" }),
    );
    expect(screen.getByTestId("display-main")).toHaveTextContent("3628800");
  });

  it("recalls a decimal", async () => {
    window.localStorage.setItem(
      "calcarc.history",
      JSON.stringify([
        { expression: "x", answer: "12.5", angle: "Deg", error: false },
      ]),
    );
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    await userEvent.click(
      screen.getByRole("button", { name: "x = 12.5 を入力に入れる" }),
    );
    expect(screen.getByTestId("display-main")).toHaveTextContent("12.5");
  });

  it("recalls a negative number", async () => {
    window.localStorage.setItem(
      "calcarc.history",
      JSON.stringify([
        { expression: "x", answer: "-6", angle: "Deg", error: false },
      ]),
    );
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    await userEvent.click(
      screen.getByRole("button", { name: "x = -6 を入力に入れる" }),
    );
    expect(screen.getByTestId("display-main")).toHaveTextContent("-6");
  });

  it("recalls exponent form", async () => {
    window.localStorage.setItem(
      "calcarc.history",
      JSON.stringify([
        {
          expression: "x",
          answer: "2.432902008e18",
          angle: "Deg",
          error: false,
        },
      ]),
    );
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    await userEvent.click(
      screen.getByRole("button", {
        name: "x = 2.432902008e18 を入力に入れる",
      }),
    );
    expect(screen.getByTestId("display-main")).toHaveTextContent(
      "2.432902008e18",
    );
  });

  it("leaves the input untouched for a shape it cannot map (a negative exponent)", async () => {
    // **マップできない形を見つけたら、それを回避する仕掛けを作らない**
    // ——触らずに残し、その挙動をテストで留める(Task 10 ブリーフ)。
    // 桁の途中(指数部)に符号があるので、先頭の 1 個だけを `neg` に写す
    // いまの実装では扱えない。
    window.localStorage.setItem(
      "calcarc.history",
      JSON.stringify([
        { expression: "x", answer: "1.5e-3", angle: "Deg", error: false },
      ]),
    );
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    await userEvent.click(
      screen.getByRole("button", { name: "x = 1.5e-3 を入力に入れる" }),
    );
    // 押しても盤面へは戻らない(何もしていない)ので、明示的に戻ってから
    // 表示が触られていないことを確かめる。
    await userEvent.click(screen.getByRole("button", { name: "< 戻る" }));
    expect(screen.getByTestId("display-main")).toHaveTextContent("0");
  });

  it("a recalled answer behaves like the same digits typed by hand", async () => {
    // **§13-8 を閉じる。** `0.5` を呼び戻した状態と、`0` `.` `5` と打った
    // 状態で、次の 1 打鍵の結果が同じかを測る。違うなら特別な状態を
    // 作っていることになる。
    window.localStorage.setItem(
      "calcarc.history",
      JSON.stringify([
        { expression: "x", answer: "0.5", angle: "Deg", error: false },
      ]),
    );
    const first = render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    await userEvent.click(
      screen.getByRole("button", { name: "x = 0.5 を入力に入れる" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "1" }));
    const recalled = screen.getByTestId("display-main").textContent;
    first.unmount();

    // 履歴だけ消して(設定はこのテストで触っていない)、まっさらに打つ側。
    window.localStorage.removeItem("calcarc.history");
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(screen.getByRole("button", { name: "0" }));
    await userEvent.click(screen.getByRole("button", { name: "小数点" }));
    await userEvent.click(screen.getByRole("button", { name: "5" }));
    await userEvent.click(screen.getByRole("button", { name: "1" }));
    const typed = screen.getByTestId("display-main").textContent;

    expect(recalled).toBe(typed);
  });
});

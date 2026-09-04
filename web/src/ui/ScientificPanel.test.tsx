import { fireEvent, render, screen } from "@testing-library/react";
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

/**
 * **偽 `spell` が字面を持つ非数字キー。**
 *
 * 二項演算子・`eq`・`ac` は**わざと持たない**——このファイルの既存の主張
 * (`"3 2"` のような行)がその形に依存しており、`=` の 2 度押しが空文字列に
 * なることもここから来る。一方 **`sqrt` と `neg` には字面を持たせる**:
 * H-4 の検査は「連鎖の左辺が補われたか」を記録された式そのもので見るが、
 * この 2 つが綴りに出ないと式が `""` になり、`pushEntry` が行ごと捨てて
 * **直っていても壊れていても緑になる**(偽物が寛容すぎて何も測れない)。
 * 字面は本物(`crates/calcarc-core/src/engine/spell.rs` の `commit_glyph`)に
 * 合わせてある。
 */
const FAKE_GLYPHS: Partial<Record<KeyToken, string>> = {
  sqrt: "\u221a",
  neg: "+/\u2212",
};

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
      // **エラー中は AC 以外を受け付けない**——`crates/calcarc-core/src/
      // engine/mod.rs:29` の規則そのもの。**この偽物がこれを持っていな
      // かったので H-3 はここで見えなかった**: engine が捨てるはずのキーを
      // 偽物は普通に処理して表示を進めていた。**偽物のほうが本物より寛容
      // だと、何を書いても緑になる**(このファイル冒頭の同じ指摘)。
      if (from.error !== null && key !== "ac") {
        return stepOf(from);
      }
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
      // 小数点・符号・指数は「呼び戻しの等価性」(Task 10 Step 5)と
      // 「仮数・指数の符号を送り分ける」(Fix round 1 finding 1)を測るのに
      // 要る。本物の綴り規則とは無関係で、状態を見分けられれば足りる。
      if (key === "dot") {
        // **2 つ目の `.` は SyntaxError**(`crates/calcarc-core/src/engine/
        // state.rs` の `Buffer::push_dot`)。**`=` を待たずに、入力の途中で
        // エラー状態へ入る経路**の見本である(H-3 の「関連」)。
        if (from.main.includes(".")) {
          return stepOf({ ...from, main: "Math ERROR", error: "SyntaxError" });
        }
        return stepOf({
          ...from,
          main: from.main === "0" ? "0." : `${from.main}.`,
        });
      }
      if (key === "neg") {
        // **`e` が既に出ていれば指数入力中——指数側の符号を切り替える。**
        // 本物と同じ順序で符号を送り分けられているかを、この偽物でも
        // 見分けられるようにする(`engine_table.rs:125` と同じ規則)。
        const eIndex = from.main.indexOf("e");
        if (eIndex === -1) {
          return stepOf({
            ...from,
            main: from.main.startsWith("-")
              ? from.main.slice(1)
              : `-${from.main}`,
          });
        }
        const head = from.main.slice(0, eIndex + 1);
        const exponent = from.main.slice(eIndex + 1);
        const toggled = exponent.startsWith("-")
          ? exponent.slice(1)
          : `-${exponent}`;
        return stepOf({ ...from, main: `${head}${toggled}` });
      }
      if (key === "exp") {
        return stepOf({ ...from, main: `${from.main}e` });
      }
      if (key === "eq") {
        // **指数の付いた値は確定のときに初めて溢れる**(`engine/mod.rs` の
        // `commit_entry`「打鍵の途中はエラーにしない」)。`1 Exp 309 =` が
        // その最短の見本で、**エラーを起こしたキーが `=` そのもの**なので、
        // この計算自体は 1 件として記録されてよい——式が答を説明している。
        if (from.main.includes("e") && !Number.isFinite(Number(from.main))) {
          return stepOf({ ...from, main: "Math ERROR", error: "Overflow" });
        }
      }
      // **`j` は写せない答の見本(Fix round 1 finding 1)。** 虚数・極形式・
      // 60 進の代わりに、この偽物では一番軽い「数字キーの列で表せない形」
      // として使う。
      if (key === "j") {
        return stepOf({ ...from, main: `${from.main}j` });
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
      return keys
        .map((key) => (/^[0-9]$/.test(key) ? key : FAKE_GLYPHS[key]))
        .filter((part): part is string => part !== undefined)
        .join(" ");
    },
    // **本物の `MAX_ENTRY_LEN`(12)と同じ値。** Fix round 3 finding の
    // テスト(13 文字は呼び戻せない・12 文字は呼び戻せる)が実物の境界と
    // 一致した状態で走るように、偽物でも実物と同じ数を返す。
    maxEntryLen: () => 12,
  };
}

/**
 * 盤面のキーを、アクセシブルネームの順に押す。
 *
 * `getByRole` の `name` に文字列を渡すと**完全一致**なので、「サイン」が
 * 「アークサイン」に当たることはない(E2E 側が `exact: true` を要るのと
 * 同じ事情を、こちらは既定で満たしている)。
 */
async function pressKeys(names: string[]): Promise<void> {
  for (const name of names) {
    await userEvent.click(screen.getByRole("button", { name }));
  }
}

/** 履歴の面を開く。**Shift は面が作り直されるたびに解ける。** */
async function openHistory(): Promise<void> {
  await pressKeys(["第2面に切り替え", "履歴"]);
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

  it("does not fold a key typed before the engine has loaded into the next recorded expression", async () => {
    // **Fix round 3 finding.** `useKeyboard(press)` はこのコンポーネントの
    // 早期リターン(`if (!calc || !step) return <p>Loading…</p>`)より前で
    // 呼ばれているので、`Loading…` が出ているあいだもグローバルな
    // キーリスナは既に貼られている。`press` が `ready`(=calcRef.current)
    // を見ずに `keysRef` へ積んでいた版では、読み込み前に打った物理キーが
    // 一度も `dispatch` されないまま握り潰され、次に押した式の先頭に
    // 紛れ込んでいた。
    let resolveCalc!: (calc: Calc) => void;
    vi.mocked(initCalc).mockImplementationOnce(
      () =>
        new Promise<Calc>((resolve) => {
          resolveCalc = resolve;
        }),
    );
    render(<ScientificPanel />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();

    // 読み込みが終わる前に、物理キーボードで "5" を打つ。
    fireEvent.keyDown(window, { key: "5" });

    resolveCalc(fakeCalc());
    await screen.findByText("DEG");

    await userEvent.click(screen.getByRole("button", { name: "3" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));
    expect(spellCallCount).toBeGreaterThan(0);

    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    // 読み込み前の "5" が紛れていれば式は "5 3" になる。紛れていない
    // ことを、記録された式が "3" だけであることで見る。
    const saved = JSON.parse(
      window.localStorage.getItem("calcarc.history") as string,
    );
    expect(saved[0].expression).toBe("3");
  });

  it("does not record when history is switched off", async () => {
    // **「切ってから最初の 1 回」だけでは何も主張しない**(Fix round 1
    // finding 3 の minor 指摘)——`pushEntry` ごと消えていても、何も
    // 積まれていなければこの形は緑のままになる。**切る前に 1 件記録して
    // おき、切ったあとにもう 1 回計算しても件数が増えないこと**を見る。
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(screen.getByRole("button", { name: "2" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));

    window.localStorage.setItem(
      "calcarc.settings",
      JSON.stringify({ v: 1, history: { enabled: false } }),
    );
    await userEvent.click(screen.getByRole("button", { name: "9" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));
    // 記録しない設定でも、綴りは呼ばれている——判断は綴った後に効く。
    expect(spellCallCount).toBeGreaterThan(0);

    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    // 切る前の 1 件だけが残る。件数は増えていない。
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "2 = 2 を入力に入れる" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "9 = 29 を入力に入れる" }),
    ).not.toBeInTheDocument();
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

  it("turns recording off from the history screen without erasing what's already there", async () => {
    // Task 14: `Settings.history.enabled` は既にこのパネルの下(line ~219)
    // が読んでいたが、誰も書いていなかった——利用者が切る手段が無かった。
    // ここでは、既定が入であること・トグルを押すと設定に書かれること・
    // **切っても既存の 1 件が消えないこと**・以後の計算が積まれなくなる
    // ことをまとめて見る。
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(screen.getByRole("button", { name: "2" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));
    expect(spellCallCount).toBeGreaterThan(0);

    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));

    const toggle = screen.getByRole("checkbox", {
      name: "今後の計算を記録する",
    });
    // 既定は入(設計書 §7)。
    expect(toggle).toBeChecked();

    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();

    // 切っても既存の 1 件は残る——「切る」と「消す」は別の操作である。
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "2 = 2 を入力に入れる" }),
    ).toBeInTheDocument();

    // 設定にも書かれている。
    const saved = JSON.parse(
      window.localStorage.getItem("calcarc.settings") as string,
    );
    expect(saved.history.enabled).toBe(false);

    // 戻って、切った後の計算は記録されない。
    // **`< 戻る` で Keypad が作り直される**ので shift は解けている
    // ——`履歴` を再び出すには「第2面に切り替え」をもう一度押す。
    await userEvent.click(screen.getByRole("button", { name: "< 戻る" }));
    await userEvent.click(screen.getByRole("button", { name: "9" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));
    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("clears every entry when すべて消す is pressed, and the clear survives a remount", async () => {
    // **全消しは押されたことが 1 度も無かった(Fix round 3 finding)。**
    // ここでは 2 つを確かめる: 押すと画面から消えること、そして
    // それが React の state から消えただけでなく `localStorage` にも
    // 書かれたこと(=作り直しても戻ってこないこと)。後者を見ないと、
    // `setEntries` だけ空にして `saveHistory` を呼ばない実装でも
    // このテストは緑になってしまう。
    const { unmount } = render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(screen.getByRole("button", { name: "2" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));
    expect(spellCallCount).toBeGreaterThan(0);

    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "すべて消す" }));
    expect(screen.getByText("まだ履歴はありません")).toBeInTheDocument();
    unmount();

    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    expect(screen.getByText("まだ履歴はありません")).toBeInTheDocument();
  });

  it("keeps the recording toggle off across a reload", async () => {
    // **持続する**(ブリーフ「turn it off, reload, still off」)。
    // 実物のリロードは試せないので、パネルを作り直して同じ形にする
    // ——localStorage はテスト間だけクリアされ、この中では残る。
    const { unmount } = render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    await userEvent.click(
      screen.getByRole("checkbox", { name: "今後の計算を記録する" }),
    );
    unmount();

    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    expect(
      screen.getByRole("checkbox", { name: "今後の計算を記録する" }),
    ).not.toBeChecked();
  });

  it("snaps the toggle back to on when storage refuses the write", async () => {
    // **Fix round finding.** `browserStorage()`(`web/src/ui/storage.ts`)は
    // `window.localStorage` への参照そのものが投げる場合(Safari の
    // プライベートモードなど、そこの docstring が名指す場合)に `null` を
    // 返す——`saveSettings` は静かに何もしない。**楽観的にミラーを
    // 更新すると、チェックボックスは「切った」と見せるのに実際は
    // 記録され続ける**(記録する effect は毎回 `loadSettings()` を
    // 直接読み、`defaultSettings()` の `enabled: true` が返り続けるため)。
    // **ミラーは、書こうとした値ではなく、実際に読める値から作る。**
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));

    const toggle = screen.getByRole("checkbox", {
      name: "今後の計算を記録する",
    });
    expect(toggle).toBeChecked();

    // `storage.ts` が捕まえる形をそのまま作る——参照そのものが投げる。
    const spy = vi
      .spyOn(window, "localStorage", "get")
      .mockImplementation(() => {
        throw new Error("storage is not available");
      });
    try {
      await userEvent.click(toggle);
      // 書けなかった。実際に読める値(既定=入)へ跳ね返る——
      // 「切れたふり」をしない。
      expect(toggle).toBeChecked();
    } finally {
      spy.mockRestore();
    }
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

  it("does not record keys the engine threw away while the display was in an error state", async () => {
    // **H-3。** `crates/calcarc-core/src/engine/mod.rs:29` が言う
    // 「エラー中は AC 以外を受け付けない。」——engine が捨てたキーを式として
    // 記録すると、**その行は自分の答を作れない**(設計書 §0 が守りたいもの
    // そのもの)。実際、`7 + 8` という式に `Math ERROR` という答が並んでいた。
    //
    // ここでの入り口は `1 Exp 309 =`(溢れ)。**エラーを起こしたキーが `=`
    // そのもの**なので、この計算自体は 1 件として記録されてよい——式が答を
    // 説明している。捨てられるのは**その後の**打鍵である。
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await pressKeys(["1", "指数入力", "3", "0", "9", "計算する"]);
    expect(screen.getByTestId("display-main")).toHaveTextContent("Math ERROR");

    // ここから先は engine が 1 打鍵も受け取らない。
    await pressKeys(["7", "足す", "8", "計算する"]);
    expect(screen.getByTestId("display-main")).toHaveTextContent("Math ERROR");
    // **綴りが呼ばれた回数で見る**(ブリーフ ★ Step 0 と同じ形)。1 なら
    // 2 度目の `=` は列を渡していない。0 だったなら「そもそも打鍵が届いて
    // いない」ことになり、この検査は何も主張していない。
    expect(spellCallCount).toBe(1);

    await openHistory();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("1 3 0 9")).toBeInTheDocument();
    expect(screen.getByText("Math ERROR")).toBeInTheDocument();
    expect(screen.queryByText("7 8")).not.toBeInTheDocument();
  });

  it("records nothing at all when the error was raised in the middle of an entry", async () => {
    // **H-3 の「関連」。** `Buffer::push_dot`
    // (`crates/calcarc-core/src/engine/state.rs`)は、入力に既に `.` が
    // あると `SyntaxError` を返す——`1 . 5 .` は **`=` を待たずに**エラー
    // 状態へ入る。エラーが `=` 以外のキーで起きたこの経路では、`=` 自体が
    // 捨てられるので **1 件も積まれない**(積めば `1 5 7 8` のような、
    // 打っていない式が残る)。
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await pressKeys(["1", "小数点", "5", "小数点"]);
    expect(screen.getByTestId("display-main")).toHaveTextContent("Math ERROR");

    await pressKeys(["7", "足す", "8", "計算する"]);
    expect(screen.getByTestId("display-main")).toHaveTextContent("Math ERROR");
    expect(spellCallCount).toBe(0);

    await openHistory();
    expect(screen.getByText("まだ履歴はありません")).toBeInTheDocument();
  });

  it("leaves no fragment of the entry that the error interrupted", async () => {
    // **中断された入力をどう扱うかの番人。** エラー中は列に積まないと決めた
    // が、**エラーの時点で既に積まれていた分**(`1` `.` `5` `.`)はそのまま
    // 残す——エラーから抜ける道は `AC` しかなく(engine/mod.rs:29)、その
    // `AC` が列を空にするので、残す/捨てるのどちらを選んでも外からは
    // 見分けられない。**見分けられないこと自体をここで見張る**: エラー →
    // AC → 次の計算、と打って、次の式に `1` も `5` も混ざらないことを見る。
    // (この検査は直す前も緑である。守っているのは「直し方」ではなく
    // 「外から見える約束」のほうで、`AC` が列を空にするのをやめた日や、
    // エラー中の打鍵を再び積むようにした日に赤くなる。)
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await pressKeys(["1", "小数点", "5", "小数点"]);
    expect(screen.getByTestId("display-main")).toHaveTextContent("Math ERROR");

    await pressKeys(["全消去", "2", "計算する"]);
    expect(spellCallCount).toBe(1);

    await openHistory();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "2 = 2 を入力に入れる" }),
    ).toBeInTheDocument();
  });

  it("prefixes a chained = with the carried answer, so the row explains itself", async () => {
    // **Fix round 3 finding 11.** `3 + j4 = × 2 =` は engine の `current`
    // を積み増して `6+8j` を計算する
    // (`crates/calcarc-core/tests/engine_table.rs`
    // `multiplies_a_complex_number_by_a_real`)が、2 度目の `=` の綴りは
    // 「× 2」だけ——それだけでは自分の答を説明できない。左辺(直前の答)
    // を補って記録する。
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(screen.getByRole("button", { name: "3" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));
    await userEvent.click(screen.getByRole("button", { name: "掛ける" }));
    await userEvent.click(screen.getByRole("button", { name: "2" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));

    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    // **偽 `dispatch` は演算子を no-op として扱う**(このファイル冒頭)ので
    // 答自体は本物の掛け算ではなく、数字を連結しただけの「32」になる——
    // ここで確かめたいのは連鎖の**綴り側の組み立て**(左辺を補うこと)で
    // あって、計算そのものではない。
    expect(screen.getByText("3 2")).toBeInTheDocument();
    expect(screen.getByText("32")).toBeInTheDocument();
  });

  it("still carries the right answer into a chain after the previous entry was deleted from the list", async () => {
    // **Fix round 3 finding 11 の核心。** 連鎖の左辺を一覧の先頭行から
    // 借りると、その行を消したあとに engine 側とずれる——ここでは
    // まさにその順で操作し、消したあとも正しい値が続くことを見る
    // (一覧から読んでいたら、消えた後は借りる先が無くなり、間違った値
    // ——あるいは前の版の実装なら別の行——を借りてしまう)。
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(screen.getByRole("button", { name: "3" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));

    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    await userEvent.click(screen.getByRole("button", { name: "3 を削除" }));
    expect(screen.getByText("まだ履歴はありません")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "< 戻る" }));
    await userEvent.click(screen.getByRole("button", { name: "掛ける" }));
    await userEvent.click(screen.getByRole("button", { name: "2" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));

    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    // 一覧はいまこの 1 件だけ(前の行は消した)。それでも左辺は "3"
    // ——engine 側(このコンポーネントが直前の `=` で見た答)から来ている
    // ことの証拠。
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("3 2")).toBeInTheDocument();
  });

  it("carries the answer through a recording-off gap, recording it once switched back on", async () => {
    // **Fix round 3 finding 11.** 記録を切っているあいだも連鎖の左辺は
    // 更新され続ける——一覧に積まれるかどうかとは無関係(engine 側の値
    // だから)。切っている区間の計算は記録されないが、その答は次に記録
    // される計算の左辺として正しく現れるはずである。
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(screen.getByRole("button", { name: "3" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));

    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    await userEvent.click(
      screen.getByRole("checkbox", { name: "今後の計算を記録する" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "< 戻る" }));

    // 記録が切れている間の連鎖(3 → 32相当)。積まれない。
    await userEvent.click(screen.getByRole("button", { name: "掛ける" }));
    await userEvent.click(screen.getByRole("button", { name: "2" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));

    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    // 切る前の 1 件("3"="3")だけが残る——切っている間の計算は積まれない。
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "3 = 3 を入力に入れる" }),
    ).toBeInTheDocument();

    // 記録を戻す。
    await userEvent.click(
      screen.getByRole("checkbox", { name: "今後の計算を記録する" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "< 戻る" }));

    // ここでの連鎖が「32」を左辺として使えば、記録が切れていたあいだも
    // 連鎖の左辺(carriedAnswerRef)が正しく更新され続けていた証拠になる。
    await userEvent.click(screen.getByRole("button", { name: "足す" }));
    await userEvent.click(screen.getByRole("button", { name: "5" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));

    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    // 切る前の 1 件("3"="3")+ いまの 1 件("32 5"="325") の 2 件。
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("32 5")).toBeInTheDocument();
    expect(screen.getByText("325")).toBeInTheDocument();
  });

  it("does not prefix a chain-shaped = right after AC", async () => {
    // **`AC` は連鎖を終える**(Fix round 3 finding 11)。`AC` のあとに
    // 来る二項演算子は、`3=` の続きではない——0 に対する操作であって、
    // 前回の答を左辺として補ってはいけない。
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(screen.getByRole("button", { name: "3" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));

    await userEvent.click(screen.getByRole("button", { name: "全消去" }));
    await screen.findByText("DEG");

    await userEvent.click(screen.getByRole("button", { name: "掛ける" }));
    await userEvent.click(screen.getByRole("button", { name: "2" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));

    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    // 左辺の補いが無い、綴っただけの "2"(数字だけをつなぐ偽 `spell`)。
    // "3" が式にも答にも混ざっていれば、この aria-label は存在しない。
    expect(
      screen.getByRole("button", { name: "2 = 2 を入力に入れる" }),
    ).toBeInTheDocument();
  });

  it("still prefixes a chain when the answer was checked in ENG notation first", async () => {
    // **Fix round 4 finding B.** 答を ENG で確認してから続きを打つのは
    // 普通の操作である。列の先頭キーだけを見ていた版は、`eng` が挟まると
    // 連鎖を見失い、`× 2` のまま記録していた。
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(screen.getByRole("button", { name: "3" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));
    await userEvent.click(
      screen.getByRole("button", { name: "工学表記に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "掛ける" }));
    await userEvent.click(screen.getByRole("button", { name: "2" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));

    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("3 2")).toBeInTheDocument();
  });

  it("still prefixes a chain when the answer was checked in polar form first", async () => {
    // **Fix round 4 finding B.** 極形式で答を確認してから続きを打つのは
    // 設計書 §0 自身が挙げている動機の例そのもの——`▸∠` が先頭に来ても
    // 連鎖は壊れない。
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(screen.getByRole("button", { name: "3" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));
    await userEvent.click(
      screen.getByRole("button", { name: "極形式と直交形式を切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "掛ける" }));
    await userEvent.click(screen.getByRole("button", { name: "2" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));

    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("3 2")).toBeInTheDocument();
  });

  it("prefixes a chain that a postfix function continued", async () => {
    // **H-4。** `√` は `apply_unary`
    // (`crates/calcarc-core/src/engine/mod.rs:269` の
    // `state.current = f(state.current)?`)で**直前の答を読む**——つまり
    // これも連鎖である。二項演算子だけを見ていた版は、`3 + 1 = √ =` の
    // 2 度目の `=` を式「√」・答「2」として記録していた: 式が答を作れない。
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await pressKeys(["3", "足す", "1", "計算する"]);
    await pressKeys(["平方根", "計算する"]);

    await openHistory();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    // 偽 `dispatch` は `add`/`eq`/`sqrt` を no-op として扱うので答は
    // 「31」のまま——ここで見たいのは綴り側、左辺が補われたかである。
    expect(screen.getByText("31 √")).toBeInTheDocument();
    expect(screen.queryByText("√")).not.toBeInTheDocument();
  });

  it("prefixes a chain that the sign key continued", async () => {
    // **H-4。** `+/−` も `apply_unary` を通る(`engine/mod.rs` の `Key::Neg`
    // ——指数入力中でなければ確定値の符号を反転する)。`3 + 4 =` のあと
    // `+/− =` は式「+/−」・答「-7」として記録されていた。
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await pressKeys(["3", "足す", "4", "計算する"]);
    await pressKeys(["符号を反転", "計算する"]);

    await openHistory();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("34 +/−")).toBeInTheDocument();
    expect(screen.queryByText("+/−")).not.toBeInTheDocument();
  });

  it("does not prefix a new calculation that merely ends with a postfix key", async () => {
    // **判定は「列の先頭の非無音キー」を見る**ので、後置関数を集合に足しても
    // `4 +/− =` のような**新しい**計算は連鎖にならない——先頭は `4` である。
    // 集合を広げたことで誤爆しないことの対照ケース(レビューの註)。
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await pressKeys(["3", "計算する"]);
    await pressKeys(["4", "符号を反転", "計算する"]);

    await openHistory();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("4 +/−")).toBeInTheDocument();
    expect(screen.queryByText("3 4 +/−")).not.toBeInTheDocument();
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

  it("recalls a decimal at exactly the engine's entry-length limit", async () => {
    // **12 文字はちょうど `MAX_ENTRY_LEN`(engine/state.rs)。** 送った桁と
    // 同じ数が入力欄に残ることを、境界そのもので確かめる(Fix round 3
    // finding のもう半分——13 文字が拒否される側は次のテスト)。
    const answer = "0.0333333333"; // 12 characters
    expect(answer).toHaveLength(12);
    window.localStorage.setItem(
      "calcarc.history",
      JSON.stringify([
        { expression: "1 ÷ 30", answer, angle: "Deg", error: false },
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
        name: `1 ÷ 30 = ${answer} を入力に入れる`,
      }),
    );
    expect(screen.getByTestId("display-main")).toHaveTextContent(answer);
  });

  it("does not offer to recall an answer longer than the engine's entry-length limit", async () => {
    // **13 文字は `MAX_ENTRY_LEN`(12)を 1 文字超える。** 送っても engine
    // 側で黙って切り詰められ、`0.03333333333` を送ったつもりが
    // `0.0333333333` という別の数が入力欄に残る——それを避けるため、
    // この長さでは行を押せる形にしない(Fix round 3 finding)。
    const answer = "0.03333333333"; // 13 characters
    expect(answer).toHaveLength(13);
    window.localStorage.setItem(
      "calcarc.history",
      JSON.stringify([
        { expression: "1 ÷ 30", answer, angle: "Deg", error: false },
      ]),
    );
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    expect(screen.getByText(answer)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /を入力に入れる/ }),
    ).not.toBeInTheDocument();
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

  it("recalls a negative exponent", async () => {
    // **Fix round 1 finding 1.** `EXP_LOW_EXPONENT = -9`
    // (`crates/calcarc-core/src/numeric/format.rs`)があるので、絶対値が
    // 1e-9 未満の答は指数が負のまま普通に出る——大きい数で割るだけで
    // 届く、ありふれた形である。`engine_table.rs:125` の
    // `the_sign_key_follows_the_exponent_while_one_is_open` が言う通り、
    // `exp` の後の `neg` は指数の符号を切り替える。
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
    expect(screen.getByTestId("display-main")).toHaveTextContent("1.5e-3");
  });

  it("recalls a negative mantissa together with a negative exponent", async () => {
    // 送り分けの規則は `mapAnswerToKeys`(`ScientificPanel.tsx` の冒頭)の
    // docstring が持つ——ここでは繰り返さず、2 つの `neg` が別の宛先に
    // 届くことだけ確かめる(Fix round 1 finding 1)。
    window.localStorage.setItem(
      "calcarc.history",
      JSON.stringify([
        { expression: "x", answer: "-1.5e-3", angle: "Deg", error: false },
      ]),
    );
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    await userEvent.click(
      screen.getByRole("button", { name: "x = -1.5e-3 を入力に入れる" }),
    );
    expect(screen.getByTestId("display-main")).toHaveTextContent("-1.5e-3");
  });

  it("recalls a negative number with thousands separators", async () => {
    window.localStorage.setItem(
      "calcarc.history",
      JSON.stringify([
        { expression: "x", answer: "-3,628,800", angle: "Deg", error: false },
      ]),
    );
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    await userEvent.click(
      screen.getByRole("button", { name: "x = -3,628,800 を入力に入れる" }),
    );
    expect(screen.getByTestId("display-main")).toHaveTextContent("-3628800");
  });

  it("marks a shape it cannot map as not recallable, without pretending it failed", async () => {
    // **写せない形は残る**(虚数・極形式・60 進)——ここでは偽物の `j` を
    // 見本に使う。回避する仕掛けは作らない代わりに、`History` へ渡す
    // `canRecall` がその答を弾き、ボタンにしない。**`error` は
    // 借りない**(Fix round 2 finding)——「計算が失敗した」と「この答は
    // 入力へ戻せない」は別の事実で、後者を前者の色(`--error-fg`)で
    // 見せると、成功した計算(`3j` は虚数として正しい答)が失敗したかの
    // ように嘘をつくことになる。
    render(<ScientificPanel />);
    await screen.findByText("DEG");
    await userEvent.click(screen.getByRole("button", { name: "3" }));
    await userEvent.click(screen.getByRole("button", { name: "虚数単位" }));
    await userEvent.click(screen.getByRole("button", { name: "計算する" }));
    expect(spellCallCount).toBeGreaterThan(0);

    // 記録された 1 件は `error: false` のまま——計算は失敗していない。
    const saved = JSON.parse(
      window.localStorage.getItem("calcarc.history") as string,
    );
    expect(saved).toHaveLength(1);
    expect(saved[0].answer).toBe("3j");
    expect(saved[0].error).toBe(false);

    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "履歴" }));
    // 見える。
    expect(screen.getByText("3j")).toBeInTheDocument();
    // でも押せない——「呼び戻す」ボタンとしては存在しない。
    expect(
      screen.queryByRole("button", { name: /を入力に入れる/ }),
    ).not.toBeInTheDocument();
    // エラーの色も付かない。`data-testid="history-entry"` で `.entry`
    // 要素そのものを取る——答の span の `parentElement` は `.result`
    // span であって `.entry` ではないので、`parentElement` だけでは
    // `data-error` を無条件で付けても落ちない検査になる(Fix round 3
    // finding)。
    const row = screen.getByTestId("history-entry");
    expect(row).not.toHaveAttribute("data-error");
    // 削除は普段どおり効く(押せないことと消せないことは別)。
    expect(
      screen.getByRole("button", { name: "3 を削除" }),
    ).toBeInTheDocument();
  });

  it("narrows whether a recalled answer behaves like the same digits typed by hand (does not close it)", async () => {
    // **§13-8 を狭める、閉じない**(Fix round 1 finding 3)。ここで確かめて
    // いるのは「呼び戻しも手打ちも同じ `press` を通る」という**コードの
    // 性質**であり、それを**この偽 `Calc`(digit/dot/neg/exp/ac だけの
    // 最小実装)に対して**確かめているだけ——実機の計算コアで両者が
    // 同じ状態に落ち着くことは確認していない(`docs/superpowers/sdd/
    // history-HANDOFF.md` に追記した「§13-8 の現在地」を参照)。
    // `0.5` を呼び戻した状態と、`0` `.` `5` と打った状態で、次の 1 打鍵の
    // 結果が同じかを測る。違うなら特別な状態を作っていることになる。
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

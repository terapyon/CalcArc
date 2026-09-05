import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// App が確かめたいのはハッシュから module を導いて出し分けることであって、
// 各パネルの中身(WASM 読み込みなど)ではない。パネルはそれぞれの
// テストファイルで検査済みなので、ここではスタブに差し替える。
vi.mock("./ui/ScientificPanel", () => ({
  ScientificPanel: () => <p data-testid="scientific-panel" />,
}));
vi.mock("./ui/Scale/ScalePanel", () => ({
  ScalePanel: () => <p data-testid="scale-panel" />,
}));
vi.mock("./ui/Convert/ConvertPanel", () => ({
  ConvertPanel: () => <p data-testid="convert-panel" />,
}));
vi.mock("./ui/Finance/FinancePanel", () => ({
  FinancePanel: () => <p data-testid="finance-panel" />,
}));
vi.mock("./ui/UpdateToast/UpdateToast", () => ({
  UpdateToast: () => <p data-testid="update-toast" />,
}));
vi.mock("./ui/Footer/Footer", () => ({
  Footer: () => <p data-testid="footer" />,
}));

import { App } from "./App";

describe("App", () => {
  afterEach(() => {
    // location.hash はテスト間で持ち越らないよう、毎回既定に戻す。
    window.location.hash = "";
  });

  it("carries the update toast in the shell, outside main", () => {
    render(<App />);
    const toast = screen.getByTestId("update-toast");
    expect(toast).toBeInTheDocument();
    // <main> はモジュールのもの。トーストはシェルのものなので外に置く。
    expect(screen.getByRole("main")).not.toContainElement(toast);
  });

  it("carries the footer in the shell, outside main", () => {
    // トーストと同じ理屈——モジュールに属さないものはシェルが持つ。
    render(<App />);
    const footer = screen.getByTestId("footer");
    expect(footer).toBeInTheDocument();
    expect(screen.getByRole("main")).not.toContainElement(footer);
  });

  it("shows Scientific by default", () => {
    render(<App />);
    expect(screen.getByTestId("scientific-panel")).toBeInTheDocument();
  });

  it("shows Data Scale when the hash says so", () => {
    window.location.hash = "#scale/data-scale";
    render(<App />);
    expect(screen.getByTestId("scale-panel")).toBeInTheDocument();
  });

  it("shows Scale for the llm category too", () => {
    // ScalePanel 自体がカテゴリを振り分ける。App が確かめるのは
    // module === "scale" のときに ScalePanel が出ることだけ。
    window.location.hash = "#scale/llm";
    render(<App />);
    expect(screen.getByTestId("scale-panel")).toBeInTheDocument();
  });

  it("shows the convert placeholder when the hash says so", () => {
    window.location.hash = "#convert";
    render(<App />);
    expect(screen.getByTestId("convert-panel")).toBeInTheDocument();
  });

  it("does not route the old #data-scale hash any more", () => {
    // **互換は作らない**(設計書 §1-4)。旧 #loan と同じ扱いである。
    window.location.hash = "#data-scale";
    render(<App />);
    expect(screen.getByTestId("scientific-panel")).toBeInTheDocument();
  });

  it("shows Finance when the hash says so", () => {
    window.location.hash = "#finance";
    render(<App />);
    expect(screen.getByTestId("finance-panel")).toBeInTheDocument();
    // 1 モジュールだけが <main> に居ること(出し分けの取りこぼしを防ぐ)。
    expect(screen.queryByTestId("scientific-panel")).toBeNull();
    expect(screen.queryByTestId("scale-panel")).toBeNull();
    expect(screen.queryByTestId("convert-panel")).toBeNull();
  });

  it("does not route the old #loan hash any more", () => {
    // 旧 URL の互換は作らない(設計書 §3、利用者が本人のみのため)。
    // 不明ハッシュの既定どおり Scientific に倒れる——これは仕様である。
    window.location.hash = "#loan";
    render(<App />);
    expect(screen.getByTestId("scientific-panel")).toBeInTheDocument();
  });

  it("falls back to Scientific for a hash it does not know", () => {
    window.location.hash = "#nope";
    render(<App />);
    expect(screen.getByTestId("scientific-panel")).toBeInTheDocument();
  });

  // **切替の通知(設計書 §5)。ここだけは jsdom で足りる。**
  // このファイルの他の a11y の主張と違って E2E に置かないのは、**見るものが
  // DOM の話だから**である——領域が在るか・空か・文面・`aria-live` の綴りは
  // どれもマークアップの検査であって、アクセシビリティツリーの組み立てを
  // 必要としない(jsdom はそれを組まない)。**「本当に鳴るか」は DOM では
  // 決められない**が、それは実ブラウザでも CI では確かめられない
  // ——読み上げソフトを走らせていない(設計書 §13)。
  //
  // **期待値はこのテストが自分で持つ**(`screenName` や `switchAnnouncement`
  // から組み立てない)。同じ定数から作ると、アプリとテストが同時に間違っても
  // 緑になる。
  const liveRegion = () =>
    screen.getByRole("status", { name: "画面の切り替え" });

  it("carries an empty live region from the very first render", () => {
    // **常設であること。** 領域と中身を同時に挿入すると読み上げは鳴らない
    // ので、空の領域が先に居ることそのものが仕様である。
    render(<App />);
    expect(liveRegion()).toBeInTheDocument();
    expect(liveRegion()).toBeEmptyDOMElement();
  });

  it("announces politely, so it does not cut off what is being read", () => {
    render(<App />);
    expect(liveRegion()).toHaveAttribute("aria-live", "polite");
  });

  it("says which screen the switch landed on", () => {
    render(<App />);
    window.location.hash = "#finance";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(screen.getByTestId("finance-panel")).toBeInTheDocument();
    expect(liveRegion().textContent).toBe("金融計算に切り替えました");
  });

  it("stays silent on the first render, even when the hash already names a screen", () => {
    // **初回は鳴らさない。** 読み込んだだけで「切り替えました」は嘘になる。
    // 既定の #scientific ではなく #finance で確かめるのは、**effect の
    // 1 回目を飛ばしているのか、たまたま既定と同じで黙っているだけなのかを
    // 見分けるため**である。
    window.location.hash = "#finance";
    render(<App />);
    expect(screen.getByTestId("finance-panel")).toBeInTheDocument();
    expect(liveRegion()).toBeEmptyDOMElement();
  });
});

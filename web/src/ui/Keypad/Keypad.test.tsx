import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Keypad } from "./Keypad";
import { SCIENTIFIC_SECTIONS } from "./scientific";
import type { KeypadSection } from "./types";

type Demo = "a" | "b";

const SECTIONS: KeypadSection<Demo>[] = [
  {
    ariaLabel: "テストの区画",
    columns: 2,
    height: "square",
    keys: [
      { token: "a", label: "A", ariaLabel: "エー", variant: "digit" },
      { token: "b", label: "B", ariaLabel: "ビー", variant: "digit" },
      { token: null, label: "—", ariaLabel: "予約", variant: "function" },
    ],
  },
];

describe("Keypad（汎用）", () => {
  it("returns whatever token type it was given", async () => {
    const onPress = vi.fn<(token: Demo) => void>();
    render(<Keypad sections={SECTIONS} onPress={onPress} />);
    await userEvent.click(screen.getByRole("button", { name: "エー" }));
    expect(onPress).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("draws a section per group, with its own column count", () => {
    render(<Keypad sections={SECTIONS} onPress={vi.fn()} />);
    expect(
      screen.getByRole("group", { name: "テストの区画" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("sends nothing from a reserved slot", async () => {
    const onPress = vi.fn();
    render(<Keypad sections={SECTIONS} onPress={onPress} />);
    const reserved = screen.getByRole("button", { name: "予約" });
    expect(reserved).toBeDisabled();
    await userEvent.click(reserved);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("lets the caller decide which keys are toggles, and which are not", () => {
    // モード行・項目行は「画面全体の状態」で押下が決まる(設計書 §4)。
    // **undefined を返したキーには aria-pressed を付けない**——数字キーに
    // "false" が付くと、読み上げが全キーをトグルボタンとして扱う。
    render(
      <Keypad
        sections={SECTIONS}
        onPress={vi.fn()}
        pressed={(token) => (token === "b" ? true : undefined)}
      />,
    );
    expect(screen.getByRole("button", { name: "ビー" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "エー" })).not.toHaveAttribute(
      "aria-pressed",
    );
  });

  it("lets the caller disable keys that exist but cannot be pressed now", async () => {
    // 予約スロット(恒久の空き)とは由来が違う無効(設計書 §4)。
    const onPress = vi.fn();
    render(
      <Keypad
        sections={SECTIONS}
        onPress={onPress}
        disabled={(token) => token === "a"}
      />,
    );
    const a = screen.getByRole("button", { name: "エー" });
    expect(a).toBeDisabled();
    await userEvent.click(a);
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "ビー" })).toBeEnabled();
  });

  it("says nothing about pressed state when the caller does not ask", () => {
    render(<Keypad sections={SECTIONS} onPress={vi.fn()} />);
    expect(screen.getByRole("button", { name: "エー" })).not.toHaveAttribute(
      "aria-pressed",
    );
  });
});

// Scientific は Keypad の実利用者であり続ける。キー集合そのものの検査は
// scientific.test.ts に置き、ここでは描画を伴う振る舞いを見る。
describe("Keypad の Shift（Scientific の盤面で）", () => {
  it("swaps the second face on, and back after one key", async () => {
    // ワンショット(設計書 §3): 1 キー押したら第 1 面へ自動で戻る。
    const onPress = vi.fn();
    render(<Keypad sections={SCIENTIFIC_SECTIONS} onPress={onPress} />);
    const shift = screen.getByRole("button", { name: "第2面に切り替え" });
    expect(shift).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(shift);
    expect(shift).toHaveAttribute("aria-pressed", "true");

    // 第 1 面の Exp が π に変わっている。
    expect(screen.queryByRole("button", { name: "指数入力" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "円周率" }));
    expect(onPress).toHaveBeenCalledExactlyOnceWith("pi");

    // 1 キーで戻る。第 1 面の Exp は S2 で有効になっている。
    expect(shift).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "指数入力" })).toBeEnabled();
  });

  it("releases the face when Shift is pressed twice, sending nothing", async () => {
    const onPress = vi.fn();
    render(<Keypad sections={SCIENTIFIC_SECTIONS} onPress={onPress} />);
    const shift = screen.getByRole("button", { name: "第2面に切り替え" });
    await userEvent.click(shift);
    await userEvent.click(shift);
    expect(shift).toHaveAttribute("aria-pressed", "false");
    expect(onPress).not.toHaveBeenCalled();
  });

  it("shows the one remaining reserved slot as reserved", () => {
    // 第 2 面の空きは S-1 で全部埋まった(sin/cos/tan の裏が asin/acos/atan に
    // なった)。残るのは第 2 関数列の 1 枠——S-4 の `°'"` が入る。
    // 無効表示の意味論はそこで守る。
    render(<Keypad sections={SCIENTIFIC_SECTIONS} onPress={vi.fn()} />);
    const empty = screen.getAllByRole("button", { name: "空き" });
    expect(empty).toHaveLength(1);
    expect(empty[0]).toBeDisabled();
  });

  it("keeps keys without a second face unchanged, and still releases", async () => {
    // 第 2 面を持たないキーを押しても、面は 1 打鍵で解除される。
    // 解除されないと、次の打鍵が意図しない第 2 面のキーになる。
    const onPress = vi.fn();
    render(<Keypad sections={SCIENTIFIC_SECTIONS} onPress={onPress} />);
    const shift = screen.getByRole("button", { name: "第2面に切り替え" });
    await userEvent.click(shift);
    // **`1` を使う。かつては `7` だった**——S-3 で 7/8/9 の裏に n!/nPr/nCr が
    // 付いたので、7 はもう「第 2 面を持たないキー」ではない。ここが見たいのは
    // 「裏の無いキーでも面が解除されること」なので、裏の無い数字に替える。
    await userEvent.click(screen.getByRole("button", { name: "1" }));
    expect(onPress).toHaveBeenCalledExactlyOnceWith("1");
    expect(shift).toHaveAttribute("aria-pressed", "false");
  });
});

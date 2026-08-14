import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KEY_TOKENS } from "../../calc";
import { Keypad } from "./Keypad";
import { SCIENTIFIC_SECTIONS } from "./scientific";

const allKeys = SCIENTIFIC_SECTIONS.flatMap((s) => s.keys);

/** 区画は名前で引く。添字だと並べ替えで黙って別の区画を見る。 */
function section(ariaLabel: string) {
  const found = SCIENTIFIC_SECTIONS.find((s) => s.ariaLabel === ariaLabel);
  if (!found) throw new Error(`no section named ${ariaLabel}`);
  return found;
}

describe("Keypad", () => {
  it("offers every key the core accepts, exactly once", () => {
    // レイアウトから漏れたキーは押しようがない。網羅をテストで固定する。
    // 第 1 面と第 2 面のどちらに出るかは問わない(π は Shift 面にある)。
    const laidOut = allKeys
      .flatMap((k) => [k.token, k.shift?.token ?? null])
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .sort();
    expect(laidOut).toEqual([...KEY_TOKENS].sort());
  });

  it("reserves the slots S2 fills, carrying no token", () => {
    // 000 と Exp は場所だけ確保する(設計書 §5)。押しても何も起きない。
    const reserved = allKeys.filter((k) => k.token === null && !k.kind);
    expect(reserved.map((k) => k.label).sort()).toEqual(["000", "Exp"]);
  });

  it("gives every key an accessible label", () => {
    for (const key of allKeys) {
      expect(key.ariaLabel.length).toBeGreaterThan(0);
      if (key.shift) expect(key.shift.ariaLabel.length).toBeGreaterThan(0);
    }
  });

  it("lays the main grid out five by five", () => {
    const main = section("数字と演算のキー");
    expect(main.columns).toBe(5);
    expect(main.keys).toHaveLength(25);
    // 先頭行と最終行だけ固定する(配置の意図が壊れたら気づく)。
    expect(main.keys.slice(0, 5).map((k) => k.label)).toEqual([
      "(",
      ")",
      "+/−",
      "DEL",
      "AC",
    ]);
    expect(main.keys.slice(20, 25).map((k) => k.label)).toEqual([
      "0",
      "000",
      ".",
      "+",
      "=",
    ]);
  });

  it("puts the function row above, half height, with DRG at its end", () => {
    const functions = section("関数キー");
    expect(functions.height).toBe("half");
    expect(functions.keys.map((k) => k.label)).toEqual([
      "Shift",
      "sin",
      "cos",
      "tan",
      "√",
      "x²",
      "DRG",
    ]);
  });

  it("renders a button per key and reports the token pressed", async () => {
    const onPress = vi.fn();
    render(<Keypad sections={SCIENTIFIC_SECTIONS} onPress={onPress} />);
    expect(screen.getAllByRole("button")).toHaveLength(allKeys.length);
    await userEvent.click(screen.getByRole("button", { name: "虚数単位" }));
    expect(onPress).toHaveBeenCalledExactlyOnceWith("j");
  });

  it("does not send anything from a reserved slot", async () => {
    const onPress = vi.fn();
    render(<Keypad sections={SCIENTIFIC_SECTIONS} onPress={onPress} />);
    const reserved = screen.getByRole("button", {
      name: "3桁のゼロ（準備中）",
    });
    expect(reserved).toBeDisabled();
    expect(reserved).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(reserved);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("Keypad の Shift", () => {
  it("swaps the second face on, and back after one key", async () => {
    // ワンショット(設計書 §3): 1 キー押したら第 1 面へ自動で戻る。
    const onPress = vi.fn();
    render(<Keypad sections={SCIENTIFIC_SECTIONS} onPress={onPress} />);
    const shift = screen.getByRole("button", { name: "第2面に切り替え" });
    expect(shift).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(shift);
    expect(shift).toHaveAttribute("aria-pressed", "true");

    // 第 1 面の Exp が π に変わっている。
    expect(
      screen.queryByRole("button", { name: "指数入力（準備中）" }),
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "円周率" }));
    expect(onPress).toHaveBeenCalledExactlyOnceWith("pi");

    // 1 キーで戻る。
    expect(shift).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "指数入力（準備中）" }),
    ).toBeDisabled();
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

  it("shows the empty second-face slots as reserved", async () => {
    // 第 2 面は今回ほぼ空(設計書 §3)。空きスロットは場所だけ示す。
    render(<Keypad sections={SCIENTIFIC_SECTIONS} onPress={vi.fn()} />);
    await userEvent.click(
      screen.getByRole("button", { name: "第2面に切り替え" }),
    );
    const empty = screen.getAllByRole("button", { name: "第2面（準備中）" });
    expect(empty).toHaveLength(3); // sin / cos / tan の裏
    for (const slot of empty) expect(slot).toBeDisabled();
  });

  it("keeps keys without a second face unchanged, and still releases", async () => {
    // 第 2 面を持たないキーを押しても、面は 1 打鍵で解除される。
    // 解除されないと、次の打鍵が意図しない第 2 面のキーになる。
    const onPress = vi.fn();
    render(<Keypad sections={SCIENTIFIC_SECTIONS} onPress={onPress} />);
    const shift = screen.getByRole("button", { name: "第2面に切り替え" });
    await userEvent.click(shift);
    await userEvent.click(screen.getByRole("button", { name: "7" }));
    expect(onPress).toHaveBeenCalledExactlyOnceWith("7");
    expect(shift).toHaveAttribute("aria-pressed", "false");
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KEY_TOKENS } from "../../calc";
import { Keypad } from "./Keypad";
import { KEYPAD_LAYOUT } from "./layout";

describe("Keypad", () => {
  it("offers every key the core accepts, exactly once", () => {
    // レイアウトから漏れたキーは押しようがない。網羅をテストで固定する。
    const laidOut = KEYPAD_LAYOUT.map((k) => k.token).sort();
    expect(laidOut).toEqual([...KEY_TOKENS].sort());
  });

  it("gives every key an accessible label", () => {
    for (const key of KEYPAD_LAYOUT) {
      expect(key.ariaLabel.length).toBeGreaterThan(0);
    }
  });

  it("renders one button per key", () => {
    render(<Keypad onPress={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(KEY_TOKENS.length);
  });

  it("reports the token of the key that was pressed", async () => {
    const onPress = vi.fn();
    render(<Keypad onPress={onPress} />);
    await userEvent.click(screen.getByRole("button", { name: "虚数単位" }));
    expect(onPress).toHaveBeenCalledExactlyOnceWith("j");
  });
});

import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { KeyToken } from "../calc";
import { useKeyboard } from "./useKeyboard";

function Harness({ onPress }: { onPress: (token: KeyToken) => void }) {
  useKeyboard(onPress);
  return <div>harness</div>;
}

describe("useKeyboard", () => {
  it("maps digits", async () => {
    const onPress = vi.fn();
    render(<Harness onPress={onPress} />);
    await userEvent.keyboard("3");
    expect(onPress).toHaveBeenCalledExactlyOnceWith("3");
  });

  it("maps the arithmetic operators", async () => {
    const onPress = vi.fn();
    render(<Harness onPress={onPress} />);
    await userEvent.keyboard("+-*/");
    expect(onPress.mock.calls.flat()).toEqual(["add", "sub", "mul", "div"]);
  });

  it("maps Enter and equals to the same key", async () => {
    const onPress = vi.fn();
    render(<Harness onPress={onPress} />);
    await userEvent.keyboard("{Enter}=");
    expect(onPress.mock.calls.flat()).toEqual(["eq", "eq"]);
  });

  it("maps editing keys", async () => {
    const onPress = vi.fn();
    render(<Harness onPress={onPress} />);
    await userEvent.keyboard("{Backspace}{Escape}");
    expect(onPress.mock.calls.flat()).toEqual(["del", "ac"]);
  });

  it("maps j in either case", async () => {
    const onPress = vi.fn();
    render(<Harness onPress={onPress} />);
    await userEvent.keyboard("jJ");
    expect(onPress.mock.calls.flat()).toEqual(["j", "j"]);
  });

  it("ignores unmapped keys", async () => {
    const onPress = vi.fn();
    render(<Harness onPress={onPress} />);
    await userEvent.keyboard("qz");
    expect(onPress).not.toHaveBeenCalled();
  });

  it("leaves browser shortcuts alone", async () => {
    // Ctrl+R などを電卓が食べてしまわないこと。
    const onPress = vi.fn();
    render(<Harness onPress={onPress} />);
    await userEvent.keyboard("{Control>}3{/Control}");
    expect(onPress).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", async () => {
    const onPress = vi.fn();
    const { unmount } = render(<Harness onPress={onPress} />);
    unmount();
    await userEvent.keyboard("3");
    expect(onPress).not.toHaveBeenCalled();
  });
});

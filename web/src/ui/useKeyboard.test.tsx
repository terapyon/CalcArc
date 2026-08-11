import { render, screen } from "@testing-library/react";
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

  it("lets a focused button handle its own Enter", async () => {
    // Tab で ▸∠ に移動して Enter を押した人に = が実行されると、
    // キーボードだけでは極形式に切り替えられない。
    const onPress = vi.fn();
    render(
      <>
        <button type="button" data-testid="other">
          other
        </button>
        <Harness onPress={onPress} />
      </>,
    );
    screen.getByTestId("other").focus();
    await userEvent.keyboard("{Enter}");
    expect(onPress).not.toHaveBeenCalled();
  });

  it("still accepts digits while a button holds focus", async () => {
    // マウスでキーを押した直後はそのボタンにフォーカスが残る。
    // そこから数字を打てなくなると操作が途切れるので、譲るのは Enter だけ。
    const onPress = vi.fn();
    render(
      <>
        <button type="button" data-testid="other">
          other
        </button>
        <Harness onPress={onPress} />
      </>,
    );
    screen.getByTestId("other").focus();
    await userEvent.keyboard("3");
    expect(onPress).toHaveBeenCalledExactlyOnceWith("3");
  });

  it("registers its listener once, not again when the callback changes", () => {
    // 貼り直しは描画の後に走るので、貼り直すたびに打鍵を取りこぼす隙間ができる。
    // CI で実際に起き、WASM 読み込み直後の先頭 2 文字が失われた。
    const spy = vi.spyOn(window, "addEventListener");
    const keydowns = () =>
      spy.mock.calls.filter(([type]) => type === "keydown").length;

    const { rerender } = render(<Harness onPress={() => {}} />);
    const afterMount = keydowns();

    // 毎回新しい関数を渡す。依存に置いていれば、ここで貼り直しが起きる。
    rerender(<Harness onPress={() => {}} />);
    rerender(<Harness onPress={() => {}} />);

    expect(keydowns()).toBe(afterMount);
    spy.mockRestore();
  });

  it("calls the newest callback, not the one it was mounted with", async () => {
    // リスナを貼り直さない代わりに、最新のコールバックへ届く必要がある。
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness onPress={first} />);
    rerender(<Harness onPress={second} />);
    await userEvent.keyboard("3");
    expect(second).toHaveBeenCalledExactlyOnceWith("3");
    expect(first).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", async () => {
    const onPress = vi.fn();
    const { unmount } = render(<Harness onPress={onPress} />);
    unmount();
    await userEvent.keyboard("3");
    expect(onPress).not.toHaveBeenCalled();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Key } from "./Key";

describe("Key", () => {
  it("renders a real button element", () => {
    render(<Key token="7" label="7" onPress={() => {}} />);
    const key = screen.getByRole("button", { name: "7" });
    // getByRole は <div role="button"> にも当たるので、それだけでは
    // 「div にクリックハンドラを付けない」(base-spec §43) を守れない。
    // タグそのものを確かめる。
    expect(key.tagName).toBe("BUTTON");
    expect(key).toHaveAttribute("type", "button");
  });

  it("uses the accessible label when the visible label is a symbol", () => {
    render(
      <Key
        token="polar_toggle"
        label="▸∠"
        ariaLabel="極形式に切り替え"
        onPress={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "極形式に切り替え" }),
    ).toHaveTextContent("▸∠");
  });

  it("reports the token it was pressed with", async () => {
    const onPress = vi.fn();
    render(<Key token="add" label="+" ariaLabel="足す" onPress={onPress} />);
    await userEvent.click(screen.getByRole("button", { name: "足す" }));
    expect(onPress).toHaveBeenCalledExactlyOnceWith("add");
  });

  it("exposes the token for tests and for the keyboard highlight", () => {
    render(
      <Key token="eq" label="=" ariaLabel="計算する" onPress={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "計算する" })).toHaveAttribute(
      "data-token",
      "eq",
    );
  });
});

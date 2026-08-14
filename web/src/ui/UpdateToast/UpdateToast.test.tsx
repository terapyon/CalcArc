import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// jsdom に Service Worker は無いので、ラッパー層ごと差し替える
// (DataScalePanel.test.tsx と同じ流儀)。
vi.mock("../../pwa", () => ({ watchForUpdate: vi.fn() }));

import { watchForUpdate } from "../../pwa";
import { UpdateToast } from "./UpdateToast";

/** 購読を張らせ、あとから「更新が来た」を発火できるようにする。 */
function arm(applyUpdate = vi.fn().mockResolvedValue(undefined)) {
  let fire = () => {};
  vi.mocked(watchForUpdate).mockImplementation(async (onNeedRefresh) => {
    fire = onNeedRefresh;
    return applyUpdate;
  });
  return { applyUpdate, needRefresh: () => fire() };
}

describe("UpdateToast", () => {
  it("says nothing until an update is waiting", async () => {
    arm();
    render(<UpdateToast />);
    await waitFor(() => expect(watchForUpdate).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("announces the update as a status, not an alert", async () => {
    // 更新は事故ではない。読み上げを割り込ませない(設計書 §2)。
    const armed = arm();
    render(<UpdateToast />);
    await waitFor(() => expect(watchForUpdate).toHaveBeenCalled());
    armed.needRefresh();

    const toast = await screen.findByRole("status", { name: "更新のお知らせ" });
    expect(toast).toHaveTextContent("新しいバージョンがあります");
    // 入力中の内容が消えることを伝える(設計書 §2)。
    expect(toast).toHaveTextContent("入力中の内容は消えます");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("switches generations only when the button is pressed", async () => {
    const armed = arm();
    render(<UpdateToast />);
    await waitFor(() => expect(watchForUpdate).toHaveBeenCalled());
    armed.needRefresh();
    await screen.findByRole("status");

    expect(armed.applyUpdate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(armed.applyUpdate).toHaveBeenCalledOnce();
  });

  it("can be dismissed without updating", async () => {
    const armed = arm();
    render(<UpdateToast />);
    await waitFor(() => expect(watchForUpdate).toHaveBeenCalled());
    armed.needRefresh();
    await screen.findByRole("status");

    await userEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(armed.applyUpdate).not.toHaveBeenCalled();
  });

  it("does not steal focus from what is being typed", async () => {
    // 打鍵の途中で奪うと計算が中断する(設計書 §2)。
    const armed = arm();
    render(
      <>
        <button type="button">計算する</button>
        <UpdateToast />
      </>,
    );
    await waitFor(() => expect(watchForUpdate).toHaveBeenCalled());
    const outside = screen.getByRole("button", { name: "計算する" });
    outside.focus();
    armed.needRefresh();
    await screen.findByRole("status");
    expect(document.activeElement).toBe(outside);
  });

  it("closes on Escape, wherever the key was pressed", async () => {
    // トーストはフォーカスを取らないので、キーは外で押される。
    const armed = arm();
    render(<UpdateToast />);
    await waitFor(() => expect(watchForUpdate).toHaveBeenCalled());
    armed.needRefresh();
    await screen.findByRole("status");

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("status")).toBeNull();
    expect(armed.applyUpdate).not.toHaveBeenCalled();
  });

  it("swallows the Escape so the calculator does not clear", async () => {
    // KEYBOARD_MAP の Escape は AC(useKeyboard.ts)。bubble まで通すと、
    // 閉じた瞬間に計算が消える。capture で止めていることを見る。
    const armed = arm();
    const bubbled = vi.fn();
    window.addEventListener("keydown", bubbled);
    render(<UpdateToast />);
    await waitFor(() => expect(watchForUpdate).toHaveBeenCalled());
    armed.needRefresh();
    await screen.findByRole("status");

    await userEvent.keyboard("{Escape}");
    expect(bubbled).not.toHaveBeenCalled();
    window.removeEventListener("keydown", bubbled);
  });

  it("stays quiet when the registration fails", async () => {
    // SW が使えない環境(古いブラウザ、file://)でも画面は壊さない。
    vi.mocked(watchForUpdate).mockRejectedValue(new Error("no service worker"));
    render(<UpdateToast />);
    await waitFor(() => expect(watchForUpdate).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
  });
});

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// jsdom に Service Worker は無いので、ラッパー層ごと差し替える
// (DataScalePanel.test.tsx と同じ流儀)。
vi.mock("../../pwa", () => ({ watchForUpdate: vi.fn() }));

import { watchForUpdate } from "../../pwa";
import { TOAST_REPROMPT_MS, UpdateToast } from "./UpdateToast";

/** 購読を張らせ、あとから「更新が来た」を発火できるようにする。 */
function arm(applyUpdate = vi.fn().mockResolvedValue(undefined)) {
  let fire = () => {};
  vi.mocked(watchForUpdate).mockImplementation(async (onNeedRefresh) => {
    fire = onNeedRefresh;
    return applyUpdate;
  });
  return { applyUpdate, needRefresh: () => fire() };
}

/** 常設の live 領域。**中身の有無に関わらずいつでも在る**(設計書 §6)。 */
const region = () => screen.getByRole("status", { name: "更新のお知らせ" });

/**
 * トーストの**中身**が描かれるのを待つ。
 *
 * **`findByRole("status")` で待たない。** 領域は常設になったので、
 * それは**最初から在るもの**を即座に返す——中身が描かれる前に次の行へ
 * 進んでしまい、待っているつもりの検査が待っていない。
 */
const findToast = () => screen.findByText(/新しいバージョンがあります/);

describe("UpdateToast", () => {
  it("keeps the region in place but empty until an update is waiting", async () => {
    // **主張が変わった**(設計書 §6・§9-2)。ここは以前
    // `queryByRole("status")).toBeNull()` ——「更新が来るまで領域は DOM に
    // 無い」と言っていた。**それでは鳴らない。「在る」と「鳴る」は別**で、
    // 多くの読み上げは live 領域が中身ごと挿入された瞬間には鳴らず、
    // **すでに在る領域の中身が変わったとき**に鳴る。**鳴らせるには先に
    // 在る必要がある**ので、領域は常設にし、空であることをここで見る。
    // 手本は `Readout` 側の `eng-notation.spec.ts:34,58,88` の `toBeEmpty()`。
    arm();
    render(<UpdateToast />);
    await waitFor(() => expect(watchForUpdate).toHaveBeenCalled());
    expect(region()).toBeEmptyDOMElement();
    // **常設にするのは領域だけである。** 中身まで常設にすると、見えていない
    // ボタンにフォーカスが入る(設計書 §6 の裁定案 6)。
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("announces the update as a status, not an alert", async () => {
    // 更新は事故ではない。読み上げを割り込ませない(設計書 §2)。
    const armed = arm();
    render(<UpdateToast />);
    await waitFor(() => expect(watchForUpdate).toHaveBeenCalled());
    armed.needRefresh();

    await findToast();
    const toast = region();
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
    await findToast();

    expect(armed.applyUpdate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(armed.applyUpdate).toHaveBeenCalledOnce();
  });

  it("can be dismissed without updating", async () => {
    const armed = arm();
    render(<UpdateToast />);
    await waitFor(() => expect(watchForUpdate).toHaveBeenCalled());
    armed.needRefresh();
    await findToast();

    await userEvent.click(screen.getByRole("button", { name: "閉じる" }));
    // **領域は残る**(常設。設計書 §6)。消えるのは中身のほうである。
    expect(region()).toBeEmptyDOMElement();
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
    await findToast();
    expect(document.activeElement).toBe(outside);
  });

  it("closes on Escape, wherever the key was pressed", async () => {
    // トーストはフォーカスを取らないので、キーは外で押される。
    const armed = arm();
    render(<UpdateToast />);
    await waitFor(() => expect(watchForUpdate).toHaveBeenCalled());
    armed.needRefresh();
    await findToast();

    await userEvent.keyboard("{Escape}");
    // **領域は残る**(常設。設計書 §6)。消えるのは中身のほうである。
    expect(region()).toBeEmptyDOMElement();
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
    await findToast();

    await userEvent.keyboard("{Escape}");
    expect(bubbled).not.toHaveBeenCalled();
    window.removeEventListener("keydown", bubbled);
  });

  it("waits an hour before showing the notice again", () => {
    // **60 分はこの設計書の決めである**(0.9.3 §3.3)。**値をここに綴る**
    // ——「再提示が在る」だけを見る検査は、**24 時間に変えても緑のまま**になる。
    expect(TOAST_REPROMPT_MS).toBe(60 * 60 * 1000);
    expect(TOAST_REPROMPT_MS).toBe(3_600_000);
  });

  it("shows the notice again after it is closed with the button", async () => {
    // **裁定は「閉じても再び出す」**(利用者、2026-09-17)。**「閉じられなく
    // する」は採らなかった**ので【閉じる】は残っている——**残っているが、
    // 終わりではない。**
    vi.useFakeTimers();
    try {
      const armed = arm();
      render(<UpdateToast />);
      // **偽の時計のもとでは `waitFor` も `userEvent` も使えない**(2026-09-17 に
      // 実際に踏んだ)——どちらも内部で待ちを挟むので、進まない時計の下では
      // 時間切れになる。購読の解決はマイクロタスクなので `act` で 1 度流し、
      // 操作は `fireEvent`(同期)で送る。
      await act(async () => {});
      act(() => armed.needRefresh());
      expect(region()).toHaveTextContent("新しいバージョンがあります");

      fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
      expect(region()).toBeEmptyDOMElement();

      // **閉じた直後には出ない。** ここで出ると「消したのにすぐ出る」になる。
      act(() => void vi.advanceTimersByTime(TOAST_REPROMPT_MS - 1));
      expect(region()).toBeEmptyDOMElement();

      act(() => void vi.advanceTimersByTime(1));
      expect(region()).toHaveTextContent("新しいバージョンがあります");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the notice again after it is closed with Escape", async () => {
    // **閉じる経路は 2 つある。** 片方だけに再提示を書くと、**もう片方が
    // 「閉じたら二度と出ない」経路として残る**——`same-defect-four-times` の形。
    vi.useFakeTimers();
    try {
      const armed = arm();
      render(<UpdateToast />);
      // 上と同じ理由で `fireEvent`(同期)を使う。**capture で受けている**ので、
      // window へ直接送れば component に届く。
      await act(async () => {});
      act(() => armed.needRefresh());
      expect(region()).toHaveTextContent("新しいバージョンがあります");

      fireEvent.keyDown(window, { key: "Escape" });
      expect(region()).toBeEmptyDOMElement();

      act(() => void vi.advanceTimersByTime(TOAST_REPROMPT_MS));
      expect(region()).toHaveTextContent("新しいバージョンがあります");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays quiet when the registration fails", async () => {
    // SW が使えない環境(古いブラウザ、file://)でも画面は壊さない。
    vi.mocked(watchForUpdate).mockRejectedValue(new Error("no service worker"));
    render(<UpdateToast />);
    await waitFor(() => expect(watchForUpdate).toHaveBeenCalled());
    // 領域は在るが空のまま。**何も知らせない**(設計書 §6)。
    expect(region()).toBeEmptyDOMElement();
  });
});

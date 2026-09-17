import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// jsdom に Service Worker は無いので、ラッパー層ごと差し替える
// (`UpdateToast.test.tsx` と同じ流儀)。
vi.mock("../pwa", () => ({ watchForUpdate: vi.fn() }));

import { watchForUpdate } from "../pwa";
import { Footer } from "./Footer/Footer";
import { UpdateToast } from "./UpdateToast/UpdateToast";

/**
 * **Escape を受け取る順**（0.9.3 設計書 §2.5、裁定 #4）。
 *
 * **2 つの部品にまたがる検査なので、どちらのファイルにも置かない。**
 * `escapeLayers.test.ts` は仕掛けそのもの（登録と譲り合い）を見て、ここは
 * **本物の 2 つを同じ画面に出して**、Escape がどちらに行くかを見る。
 *
 * **`UpdateToast.test.tsx` に足さなかった理由はもう 1 つある**: あのファイルは
 * 0.9.3 の別の枝（更新の再提示）も先頭の import を書き換えていて、**同じ行が
 * ぶつかる**。**先に測って分かった**ので（`git merge-tree`、2026-09-17）、
 * **ぶつからない置き場を選んだ。**
 */
describe("Escape の順（リンク集 → 更新のお知らせ → AC）", () => {
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

  it("leaves Escape to the links popup while it is open", async () => {
    // **裁定 #4: リンク集が開いているときの Escape は、リンク集を閉じるだけ。**
    // お知らせは閉じない。
    //
    // **ここは「危ないほうの順」で並べてある**——お知らせが**先に**出てから
    // リンク集を開く。両方とも window の capture 段にリスナを付けるので、
    // **先に付いたお知らせのリスナが先に走る**。`escapeLayers.ts` を
    // 通していなければ、この検査でお知らせも一緒に閉じる。
    const armed = arm();
    render(
      <>
        <Footer />
        <UpdateToast />
      </>,
    );
    await waitFor(() => expect(watchForUpdate).toHaveBeenCalled());
    // **`act` で包む**——`needRefresh` が起こす更新と、`watchForUpdate` の
    // 約束が解けた後の更新を同じ刻みに乗せる(包まないと React が警告する)。
    await act(async () => {});
    await act(async () => {
      armed.needRefresh();
    });
    await screen.findByText(/新しいバージョンがあります/);

    await userEvent.click(screen.getByRole("button", { name: /CalcArc/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    // **お知らせは残る。**
    expect(region()).not.toBeEmptyDOMElement();
    expect(armed.applyUpdate).not.toHaveBeenCalled();
  });

  it("gives Escape back to the update notice once the links are closed", async () => {
    // **層は閉じたら譲る。** 閉じ忘れると、**お知らせが二度と Escape で
    // 閉じられなくなる**(`escapeLayers.ts` の後始末)。
    const armed = arm();
    render(
      <>
        <Footer />
        <UpdateToast />
      </>,
    );
    await waitFor(() => expect(watchForUpdate).toHaveBeenCalled());
    await act(async () => {});
    await act(async () => {
      armed.needRefresh();
    });
    await screen.findByText(/新しいバージョンがあります/);

    await userEvent.click(screen.getByRole("button", { name: /CalcArc/ }));
    await userEvent.keyboard("{Escape}");
    expect(region()).not.toBeEmptyDOMElement();

    // 2 回目の Escape は、もう上に誰も居ないのでお知らせが受ける。
    await userEvent.keyboard("{Escape}");
    expect(region()).toBeEmptyDOMElement();
    expect(armed.applyUpdate).not.toHaveBeenCalled();
  });
});

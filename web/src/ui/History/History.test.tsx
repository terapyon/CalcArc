import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { HistoryEntry } from "../../history";
import { History } from "./History";

const ENTRIES: HistoryEntry[] = [
  { expression: "30 sin", answer: "0.5", angle: "Deg", error: false },
  { expression: "2 × 3 + 4", answer: "10", angle: "Deg", error: false },
];

describe("History", () => {
  it("shows the expression, the answer and the angle mode", () => {
    render(
      <History
        entries={ENTRIES}
        onBack={() => {}}
        onRecall={() => {}}
        onRemove={() => {}}
        onClearAll={() => {}}
      />,
    );
    expect(screen.getByText("30 sin")).toBeInTheDocument();
    expect(screen.getByText("0.5")).toBeInTheDocument();
    // **角度モードは診断のために出す**(設計書 §3)。
    expect(screen.getAllByText("Deg").length).toBeGreaterThan(0);
  });

  it("recalls the entry that was pressed, not the first one", async () => {
    const onRecall = vi.fn();
    render(
      <History
        entries={ENTRIES}
        onBack={() => {}}
        onRecall={onRecall}
        onRemove={() => {}}
        onClearAll={() => {}}
      />,
    );
    // **2 件目を押す。** 添字を固定しないと「いつも先頭」でも緑になる。
    // 削除ボタンの aria-label も式を含む(`${expression} を削除`)ので、
    // 素の式だけの正規表現だと 2 つのボタンに同時にマッチしてしまう
    // (getByRole が複数一致で例外を投げる)。呼び出しボタンだけを一意に
    // 拾うため、名前の末尾に付く " = " を含めて絞る。
    await userEvent.click(screen.getByRole("button", { name: /2 × 3 \+ 4 =/ }));
    expect(onRecall).toHaveBeenCalledWith(ENTRIES[1]);
  });

  it("removes the entry that was pressed", async () => {
    const onRemove = vi.fn();
    render(
      <History
        entries={ENTRIES}
        onBack={() => {}}
        onRecall={() => {}}
        onRemove={onRemove}
        onClearAll={() => {}}
      />,
    );
    // 添字ではなく、削除したい行の aria-label をそのまま名前に使う。
    // `getAllByRole(...)[1]` だと `noUncheckedIndexedAccess` のもとで
    // 型が `Element | undefined` になり、非 null 表明が要る——完全一致の
    // 名前で 1 件だけ引ければ、そちらの回り道は要らない。
    await userEvent.click(
      screen.getByRole("button", { name: "2 × 3 + 4 を削除" }),
    );
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it("does not recall an entry that ended in an error", async () => {
    // **§D-1 の例外。** 一覧には出るが、押しても何も入らない。
    const onRecall = vi.fn();
    const withError: HistoryEntry[] = [
      {
        expression: "1 Exp 309",
        answer: "Math ERROR",
        angle: "Deg",
        error: true,
      },
    ];
    render(
      <History
        entries={withError}
        onBack={() => {}}
        onRecall={onRecall}
        onRemove={() => {}}
        onClearAll={() => {}}
      />,
    );
    // 行は在る。
    expect(screen.getByText("1 Exp 309")).toBeInTheDocument();
    await userEvent.click(screen.getByText("1 Exp 309"));
    expect(onRecall).not.toHaveBeenCalled();
  });

  it("still removes an entry that ended in an error", async () => {
    // **押せないことと消せないことは別である。**
    const onRemove = vi.fn();
    const withError: HistoryEntry[] = [
      {
        expression: "1 Exp 309",
        answer: "Math ERROR",
        angle: "Deg",
        error: true,
      },
    ];
    render(
      <History
        entries={withError}
        onBack={() => {}}
        onRecall={() => {}}
        onRemove={onRemove}
        onClearAll={() => {}}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "1 Exp 309 を削除" }),
    );
    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it("says so when there is nothing yet", () => {
    render(
      <History
        entries={[]}
        onBack={() => {}}
        onRecall={() => {}}
        onRemove={() => {}}
        onClearAll={() => {}}
      />,
    );
    expect(screen.getByText("まだ履歴はありません")).toBeInTheDocument();
    // **空のときに全消しを出さない。** 押せる物が何も無い。
    expect(screen.queryByRole("button", { name: "すべて消す" })).toBeNull();
  });
});

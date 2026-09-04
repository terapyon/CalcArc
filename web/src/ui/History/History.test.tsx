import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { HistoryEntry } from "../../history";
import { History } from "./History";

const ENTRIES: HistoryEntry[] = [
  { expression: "30 sin", answer: "0.5", angle: "Deg", error: false },
  { expression: "2 × 3 + 4", answer: "10", angle: "Deg", error: false },
];

// **既定は「error でなければ押せる」**(直前まで History 自身が持っていた
// 判定と同じ形)。呼び戻せるかどうかを個別に確かめたいテストは、この既定を
// 上書きする(Fix round 2)。
const canRecallUnlessError = (entry: HistoryEntry) => !entry.error;

describe("History", () => {
  it("shows the expression, the answer and the angle mode", () => {
    render(
      <History
        entries={ENTRIES}
        onBack={() => {}}
        onRecall={() => {}}
        onRemove={() => {}}
        onClearAll={() => {}}
        canRecall={canRecallUnlessError}
        recordingEnabled={true}
        onRecordingEnabledChange={() => {}}
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
        canRecall={canRecallUnlessError}
        recordingEnabled={true}
        onRecordingEnabledChange={() => {}}
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
        canRecall={canRecallUnlessError}
        recordingEnabled={true}
        onRecordingEnabledChange={() => {}}
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
        canRecall={canRecallUnlessError}
        recordingEnabled={true}
        onRecordingEnabledChange={() => {}}
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
        canRecall={canRecallUnlessError}
        recordingEnabled={true}
        onRecordingEnabledChange={() => {}}
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
        canRecall={canRecallUnlessError}
        recordingEnabled={true}
        onRecordingEnabledChange={() => {}}
      />,
    );
    expect(screen.getByText("まだ履歴はありません")).toBeInTheDocument();
    // **空のときに全消しを出さない。** 押せる物が何も無い。
    expect(screen.queryByRole("button", { name: "すべて消す" })).toBeNull();
  });

  it("shows whether recording is on, even with nothing recorded yet", () => {
    // Task 14: `Settings.history.enabled` は既に `ScientificPanel` に
    // 読まれているが、書く手段が無い(誰も `updateSettings` を呼ばない)。
    // **空のときこそ見せる価値がある**——記録を切ってから 1 度も計算して
    // いない利用者は、この画面が空のまま状態を確かめに来る。
    render(
      <History
        entries={[]}
        onBack={() => {}}
        onRecall={() => {}}
        onRemove={() => {}}
        onClearAll={() => {}}
        canRecall={canRecallUnlessError}
        recordingEnabled={true}
        onRecordingEnabledChange={() => {}}
      />,
    );
    const toggle = screen.getByRole("checkbox", {
      name: "今後の計算を記録する",
    });
    expect(toggle).toBeChecked();
    // すべて消すは(既存どおり)空のときは出ない——このトグルとは別物。
    expect(screen.queryByRole("button", { name: "すべて消す" })).toBeNull();
  });

  it("reflects that recording is off", () => {
    render(
      <History
        entries={ENTRIES}
        onBack={() => {}}
        onRecall={() => {}}
        onRemove={() => {}}
        onClearAll={() => {}}
        canRecall={canRecallUnlessError}
        recordingEnabled={false}
        onRecordingEnabledChange={() => {}}
      />,
    );
    expect(
      screen.getByRole("checkbox", { name: "今後の計算を記録する" }),
    ).not.toBeChecked();
  });

  it("reports the toggle without erasing anything", async () => {
    // **切る≠消す**(設計書 §7)。トグルを押しても `onClearAll` は呼ばれない。
    const onRecordingEnabledChange = vi.fn();
    const onClearAll = vi.fn();
    render(
      <History
        entries={ENTRIES}
        onBack={() => {}}
        onRecall={() => {}}
        onRemove={() => {}}
        onClearAll={onClearAll}
        canRecall={canRecallUnlessError}
        recordingEnabled={true}
        onRecordingEnabledChange={onRecordingEnabledChange}
      />,
    );
    await userEvent.click(
      screen.getByRole("checkbox", { name: "今後の計算を記録する" }),
    );
    expect(onRecordingEnabledChange).toHaveBeenCalledWith(false);
    expect(onClearAll).not.toHaveBeenCalled();
    // 既に貯まった行はそのまま見える。
    expect(screen.getByText("30 sin")).toBeInTheDocument();
  });

  it("clears everything when すべて消す is pressed", async () => {
    // **全消しは押されたことが 1 度も無かった(Fix round 3 finding)。**
    // 「出ない」ことしか確かめていなかった——押した効果そのものは、
    // `ScientificPanel` 側の削除実装がバグっていても jsdom 側は緑のまま
    // だった。ここで初めて `onClearAll` が呼ばれることを見る。
    const onClearAll = vi.fn();
    render(
      <History
        entries={ENTRIES}
        onBack={() => {}}
        onRecall={() => {}}
        onRemove={() => {}}
        onClearAll={onClearAll}
        canRecall={canRecallUnlessError}
        recordingEnabled={true}
        onRecordingEnabledChange={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "すべて消す" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("says in words that turning it off does not erase what is stored", () => {
    render(
      <History
        entries={[]}
        onBack={() => {}}
        onRecall={() => {}}
        onRemove={() => {}}
        onClearAll={() => {}}
        canRecall={canRecallUnlessError}
        recordingEnabled={true}
        onRecordingEnabledChange={() => {}}
      />,
    );
    expect(screen.getByText(/消えません/)).toBeInTheDocument();
  });

  it("does not treat an unmappable-but-valid answer as an error", async () => {
    // **Fix round 2 finding.** `error: false` の答でも `canRecall` は
    // false を返しうる(虚数・極形式・60 進のように、計算は成功したが
    // 答の綴りをキー列に写せない場合)。これは「計算が失敗した」とは
    // 別の事実——押せなくはするが、エラーの色を借りてはいけない
    // (`History.module.css` の `.entry[data-error]` は `--error-fg`)。
    const onRemove = vi.fn();
    const unmappable: HistoryEntry[] = [
      { expression: "3", answer: "3+4j", angle: "Deg", error: false },
    ];
    render(
      <History
        entries={unmappable}
        onBack={() => {}}
        onRecall={() => {}}
        onRemove={onRemove}
        onClearAll={() => {}}
        canRecall={() => false}
        recordingEnabled={true}
        onRecordingEnabledChange={() => {}}
      />,
    );
    // 見える。
    expect(screen.getByText("3+4j")).toBeInTheDocument();
    // でも押せない——呼び戻すボタンとしては存在しない。
    expect(
      screen.queryByRole("button", { name: /を入力に入れる/ }),
    ).not.toBeInTheDocument();
    // **エラーの色は付かない。** `data-testid="history-entry"` で
    // `.entry` 要素そのものを取る——答の span の `parentElement` は
    // `.result` span であって `.entry` ではないので、`parentElement`
    // だけを見ると `data-error` がどこにも現れず、無条件で付けても
    // 落ちない検査になる(Fix round 3 finding)。
    const row = screen.getByTestId("history-entry");
    expect(row).not.toHaveAttribute("data-error");
    // 削除は普段どおり効く(押せないことと消せないことは別)。
    await userEvent.click(screen.getByRole("button", { name: "3 を削除" }));
    expect(onRemove).toHaveBeenCalledWith(0);
  });
});

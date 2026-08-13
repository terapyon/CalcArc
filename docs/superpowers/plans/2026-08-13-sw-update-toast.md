# Service Worker 更新通知トースト（S3）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新しい Service Worker が waiting になったときトーストで知らせ、**利用者が押したときだけ**世代を切り替えて再読み込みする。

**Architecture:** `registerSW` を framework 非依存の薄いラッパー（`web/src/pwa/`）に包み、`UpdateToast` がそれを購読する。`registerType: "prompt"` も `skipWaiting` を自動で呼ばない原則も変えない——変わるのは「利用者が押せば今すぐ切り替わる出口」が増えることだけ。

**Tech Stack:** React 19 + TypeScript、`vite-plugin-pwa`（`virtual:pwa-register`）、vitest、Playwright。

## Global Constraints

- **Rust の変更はゼロ**。完了時に `git diff --stat main -- crates/` が空であること。
- **`registerType` は `"prompt"` のまま**。`autoUpdate` にしない（`check:sw` の `clientsClaim` 検査が番をしている）。
- **`skipWaiting` は利用者の操作でだけ呼ぶ**。自動で世代をすり替えない（M5 の設計原則）。
- トーストは **`role="status"`**（`alert` にしない）。**フォーカスを奪わない**。ボタンは 44px 以上。
- **自前で `postMessage` を書かない**。`SKIP_WAITING` の送信と `controllerchange` の購読はプラグインが持っており、`check:sw` が生成物側のガードを検査している。
- **定期的な `update()` ポーリングは足さない**（電池と通信の割に、タブを開き直せば同じことが起きる）。
- E2E 用の入口は**本番の挙動を変えない形**にし、そう書く。
- コミットはブランチガード付き（`test "$(git branch --show-current)" = feature/sw-update-toast || exit 1`）。**`git push` と PR 作成は行わない**。Co-Authored-By を付ける。
- ベースライン（S2 完了時点）: Rust 192 / wasm 16 / vitest 72 / e2e 55 / Python 30。

---

### Task 1: 購読ラッパーとトースト本体

**Files:**
- Create: `web/src/pwa/index.ts`
- Create: `web/src/ui/UpdateToast/UpdateToast.tsx`
- Create: `web/src/ui/UpdateToast/UpdateToast.module.css`
- Create: `web/src/ui/UpdateToast/UpdateToast.test.tsx`

**Interfaces:**
- Produces:
  - `watchForUpdate(onNeedRefresh: () => void): Promise<ApplyUpdate>`
  - `type ApplyUpdate = () => Promise<void>`（押されたら `SKIP_WAITING` → reload）
  - `UpdateToast()`（引数なし。App が 1 つだけ置く）

- [ ] **Step 1: 失敗するテストを書く**

`web/src/ui/UpdateToast/UpdateToast.test.tsx`:

```tsx
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

  it("stays quiet when the registration fails", async () => {
    // SW が使えない環境(古いブラウザ、file://)でも画面は壊さない。
    vi.mocked(watchForUpdate).mockRejectedValue(new Error("no service worker"));
    render(<UpdateToast />);
    await waitFor(() => expect(watchForUpdate).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
  });
});
```

- [ ] **Step 2: 赤を確認**

Run: `cd web && pnpm test --run src/ui/UpdateToast`
Expected: FAIL（`../../pwa` も `UpdateToast` も無い）。

- [ ] **Step 3: ラッパーを書く**

`web/src/pwa/index.ts`:

```ts
/**
 * Service Worker の更新購読。**UI Framework に依存しない**——ここに react を
 * import してはならない(base-spec §4.3、datascale/loan の境界と同じ)。
 *
 * `registerType: "prompt"` のまま、prompt の本来の使い方を配線する(設計書 §1)。
 * `SKIP_WAITING` の送信と `controllerchange` の購読はプラグインが持っている
 * ので、自前で postMessage を書かない(設計書 §3)。
 */
import { registerSW } from "virtual:pwa-register";

/** 押されたときに世代を切り替えて再読み込みする。 */
export type ApplyUpdate = () => Promise<void>;

let ready: Promise<ApplyUpdate> | null = null;

/**
 * 更新の検知を購読する。複数回呼んでも登録は 1 度だけ(calc/ と同じ理由)。
 *
 * `onNeedRefresh` は waiting の SW が現れたときに呼ばれる。**呼ばれた時点では
 * 何も切り替わっていない**——切り替えるのは戻り値を呼んだときだけである。
 */
export function watchForUpdate(onNeedRefresh: () => void): Promise<ApplyUpdate> {
  ready ??= new Promise<ApplyUpdate>((resolve, reject) => {
    const updateSW = registerSW({
      onNeedRefresh,
      onRegisterError: (error: unknown) => {
        // 登録できない環境(古いブラウザ、file://)。**握ったままにしない**
        // ——解決しない Promise を返すと、呼び出し側は永久に待つ。
        ready = null;
        reject(error);
      },
    });
    // reload = true。SKIP_WAITING のあと controllerchange で再読み込みする。
    resolve(() => updateSW(true));
  });
  return ready;
}
```

- [ ] **Step 4: トーストを書く**

`web/src/ui/UpdateToast/UpdateToast.tsx`:

```tsx
import { useEffect, useState } from "react";
import { type ApplyUpdate, watchForUpdate } from "../../pwa";
import styles from "./UpdateToast.module.css";

/**
 * E2E 用の入口。**本番の挙動は変えない**——トーストを最初から見せるだけで、
 * ボタンの動きは同じである(実 SW の世代交代は自動テストで再現しない。
 * 設計書 §4)。
 */
function previewRequested(): boolean {
  return new URLSearchParams(window.location.search).get("sw-toast") === "preview";
}

export function UpdateToast() {
  const [waiting, setWaiting] = useState(previewRequested);
  const [apply, setApply] = useState<ApplyUpdate | null>(null);

  useEffect(() => {
    let cancelled = false;
    watchForUpdate(() => {
      if (!cancelled) setWaiting(true);
    }).then(
      (applyUpdate) => {
        // setState に関数を渡すと更新関数と解釈されるので包む。
        if (!cancelled) setApply(() => applyUpdate);
      },
      () => {
        // 登録できない環境では何も出さない。画面は壊さない。
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Escape で閉じる。トーストはフォーカスを取らないので、キーはどこで
  // 押されるか分からない——window で受ける(useKeyboard.ts と同じ流儀)。
  useEffect(() => {
    if (!waiting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWaiting(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [waiting]);

  if (!waiting) return null;

  return (
    <div
      className={styles.toast}
      role="status"
      aria-label="更新のお知らせ"
      // 更新は事故ではない。読み上げを割り込ませない(設計書 §2)。
      aria-live="polite"
    >
      <p className={styles.message}>
        新しいバージョンがあります。再読み込みすると入力中の内容は消えます。
      </p>
      <div className={styles.actions}>
        <button type="button" onClick={() => apply?.()}>
          再読み込み
        </button>
        <button type="button" onClick={() => setWaiting(false)}>
          閉じる
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: CSS を書く**

`web/src/ui/UpdateToast/UpdateToast.module.css`:

```css
.toast {
  position: fixed;
  right: 12px;
  bottom: max(12px, env(safe-area-inset-bottom));
  left: 12px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: var(--shell-max-width);
  margin: 0 auto;
  padding: 12px 16px;
  border-radius: var(--radius);
  background: var(--display-bg);
  color: var(--display-fg);
}

.message {
  margin: 0;
  font-size: var(--display-size-status);
}

.actions {
  display: flex;
  gap: var(--key-gap);
}

.actions button {
  /* 44px は base-spec §43。トーストのボタンは例外にしない。 */
  min-width: var(--touch-target-min);
  min-height: var(--touch-target-min);
  flex: 1;
  padding: 8px 12px;
  border: var(--key-border);
  border-radius: var(--radius);
  background: var(--key-bg);
  color: var(--key-fg);
  font-family: inherit;
  font-size: var(--key-font-size-function);
}

.actions button:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
```

- [ ] **Step 6: 緑を確認**

Run: `cd web && pnpm test --run src/ui/UpdateToast && pnpm typecheck && pnpm lint`
Expected: PASS。件数は実測。

- [ ] **Step 7: コミット**

```bash
test "$(git branch --show-current)" = feature/sw-update-toast || exit 1
git add web/src
git commit  # 件名の趣旨:「waiting を知らせ、押されたときだけ世代を替える」
```

---

### Task 2: シェルに載せる

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.test.tsx`
- Modify: `web/src/main.tsx`（`registerSW()` の直呼びをやめる）

- [ ] **Step 1: 失敗するテストを書く**

`App.test.tsx` に足す（トースト本体は自分のテストが見るので、ここでは
「シェルに 1 つ載っている」ことだけ見る）:

```tsx
vi.mock("./ui/UpdateToast/UpdateToast", () => ({
  UpdateToast: () => <p data-testid="update-toast" />,
}));
```

```tsx
  it("carries the update toast in the shell, outside main", () => {
    render(<App />);
    const toast = screen.getByTestId("update-toast");
    expect(toast).toBeInTheDocument();
    // <main> はモジュールのもの。トーストはシェルのものなので外に置く。
    expect(screen.getByRole("main")).not.toContainElement(toast);
  });
```

- [ ] **Step 2: 赤を確認**

Run: `cd web && pnpm test --run src/App`
Expected: FAIL（`update-toast` が無い）。

- [ ] **Step 3: App に載せる**

`App.tsx`:

```tsx
      <Nav current={module} />
      <main>
        {module === "scientific" && <ScientificPanel />}
        {module === "data-scale" && <DataScalePanel />}
        {module === "loan" && <LoanPanel />}
      </main>
      {/* 更新の知らせはモジュールに属さない。シェルが 1 つだけ持つ。 */}
      <UpdateToast />
```

- [ ] **Step 4: `main.tsx` の直呼びをやめる**

```tsx
// SW の登録は UpdateToast が持つ(設計書 §1)。ここで registerSW() を呼ぶと
// 登録が 2 度走り、更新の購読を持たない側が先に登録してしまう。
```

`import { registerSW } from "virtual:pwa-register";` と `registerSW();` を消す。

- [ ] **Step 5: 緑を確認**

Run: `cd web && pnpm test --run && pnpm typecheck && pnpm lint`

- [ ] **Step 6: コミット**

```bash
test "$(git branch --show-current)" = feature/sw-update-toast || exit 1
git add web/src
git commit  # 件名の趣旨:「登録はトーストが持ち、シェルがそれを 1 つ置く」
```

---

### Task 3: E2E・docs・フルスイープ

**Files:**
- Create: `web/tests/e2e/update-toast.spec.ts`
- Modify: `docs/deploy.md`（実機チェックリストに 1 行）

- [ ] **Step 1: E2E を書く**

```ts
import { expect, test } from "@playwright/test";

// 実 SW の世代交代は自動テストで再現しない(設計書 §4: 本番ビルドでしか
// 本物にならない)。ここが見るのは「出たときの形」——役割・フォーカス・
// タッチターゲット。世代交代そのものはデプロイ後の手動確認が持つ。
test.beforeEach(async ({ page }) => {
  await page.goto("/?sw-toast=preview");
});

test("the toast announces itself as a status, not an alert", async ({
  page,
}) => {
  const toast = page.getByRole("status", { name: "更新のお知らせ" });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("新しいバージョンがあります");
  await expect(toast).toContainText("入力中の内容は消えます");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("its buttons are large enough to touch", async ({ page }) => {
  for (const name of ["再読み込み", "閉じる"]) {
    const box = await page.getByRole("button", { name }).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("it does not take focus, and Escape closes it", async ({ page }) => {
  await page.getByRole("button", { name: "7", exact: true }).focus();
  await expect(page.getByRole("status", { name: "更新のお知らせ" })).toBeVisible();
  expect(
    await page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
  ).toBe("7");

  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("status", { name: "更新のお知らせ" }),
  ).toHaveCount(0);
});

test("the calculator underneath still works while the toast is up", async ({
  page,
}) => {
  // トーストは操作を妨げない(fixed で重ねるだけ)。
  for (const name of ["3", "足す", "4", "計算する"]) {
    await page.getByRole("button", { name, exact: true }).click();
  }
  await expect(page.getByTestId("display-main")).toHaveText("7");
});

test("without the preview parameter there is no toast", async ({ page }) => {
  // テスト用の入口が本番の挙動を変えていないこと。
  await page.goto("/");
  await expect(page.getByRole("status", { name: "更新のお知らせ" })).toHaveCount(
    0,
  );
});
```

**Escape の受け口**は Task 1 で `window` の `keydown` にしてある
（`role="status"` の `div` はフォーカスを取らないので、キーは外で押される。
`onKeyDown` のバブルでは届かない）。この E2E はその形を実ブラウザで確かめる。

- [ ] **Step 2: `docs/deploy.md` に 1 行**

初回確認チェックリストに足す:

```markdown
- [ ] 旧版を開いたままのタブで、更新後にトーストが出る。「再読み込み」を押すと
      新版になる（押さなければ何も起きない）。
```

- [ ] **Step 3: `check:sw` に足すかを決めて記録する**

**足さない。** `check:sw` は `dist` の成果物を見る番人で、`sw.js` に
`SKIP_WAITING` ガードがあることは既に検査している。トースト側の配線は
**ソースの話**であり、vitest（Task 1）が「`onNeedRefresh` で出て、押すと
更新関数が呼ばれる」を見ている。境目をまたぐと、どちらの層が何を保証して
いるのかが曖昧になる。この判断を `docs/superpowers/specs/2026-08-13-sw-update-toast-design.md` §4 の
該当箇所に 1 行追記して残す。

- [ ] **Step 4: フルスイープ**

**4173 を掴んでいる `vite preview` が居ないか先に確認する**
（`ss -ltnp | grep 4173`）。

Run:
```bash
cargo test --workspace   # 変更ゼロの確認込み
cd web && pnpm typecheck && pnpm lint && pnpm test && pnpm exec vite build && pnpm check:sw && pnpm e2e
```
`git diff --stat main -- crates/` が空であることを確認して報告に書く。
wasm と Python は触っていないので回さない（tiering）。

- [ ] **Step 5: コミット**

```bash
test "$(git branch --show-current)" = feature/sw-update-toast || exit 1
git add web docs
git commit  # 件名の趣旨:「出たときの形を実ブラウザで固定し、世代交代は手で見る」
```

---

# 進捗の見取り図

| タスク | 成果物 | 検証段 | spec |
|---|---|---|---|
| 1 | 購読ラッパー + トースト | vitest | §1/§2/§3 |
| 2 | シェルへの搭載と登録の一本化 | vitest | §1 |
| 3 | E2E・deploy チェックリスト・判断の記録 | 全レイヤー（wasm/Python 以外） | §4/§6 |

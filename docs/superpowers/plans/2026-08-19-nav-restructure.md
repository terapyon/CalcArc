# U-0 ナビゲーション再編 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3 タブのシェルを 4 系統（Scientific / Convert / Scale / Finance）にし、hash を 2 段にして、Convert に準備中パネルを置く。

**Architecture:** ハッシュの解釈を `web/src/route.ts` という純粋なモジュールに切り出し、`App.tsx` はそれを購読して出し分けるだけにする。既存 3 パネルの中身には触れない。Convert は中身の無いパネルを 1 つ新設する。

**Tech Stack:** TypeScript / React 19 / CSS Modules / vitest / Playwright。**Rust には触れない。**

**Spec:** `docs/superpowers/specs/2026-08-19-nav-restructure-design.md`（ユーザー承認済み 2026-08-19、Fable 事前レビュー通過）

## Global Constraints

- **`crates/` の差分は 0 行。** Task 6 の最後に `git diff origin/main --stat -- crates/` が空であることを実測して示す
- **`KEY_TOKENS`（`web/src/calc/types.ts`）と `crates/calcarc-core/tests/engine_table.rs` に触らない**
- **既存 3 パネルの中身を変えない。** 触るのは入口（`App.tsx` / `Nav`）だけ
- **旧 `#data-scale` の互換リダイレクトを作らない**（spec §1-4。知らない hash として `#scientific` に倒れる）
- **`min-height: var(--touch-target-min)`（44px）を譲らない**（base-spec §43）
- **E2E の preview ポートは 4179。** 撮影後は `fuser -k 4179/tcp` で解放する
- **コミット前に `cargo fmt` は不要**（Rust に触らないため）。**`cd web && pnpm lint` は毎タスク走らせる**（CI が `biome check` を回す）
- コミットメッセージの末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **`git push` と PR 作成はしない**

## File Structure

| ファイル | 責務 |
|---|---|
| `web/src/route.ts`（新規） | ハッシュ → `Route`。**React を import しない** |
| `web/src/route.test.ts`（新規） | 上の表 |
| `web/src/ui/Nav/Nav.tsx`（変更） | 4 タブのリンク。`ModuleId` は `route.ts` から import する |
| `web/src/ui/Convert/ConvertPanel.tsx`（新規） | 準備中の表示だけ |
| `web/src/ui/Convert/ConvertPanel.module.css`（新規） | 背景と文字色を明示的に持つ |
| `web/src/App.tsx`（変更） | `routeFromHash` を購読して出し分け |
| `web/tests/e2e/convert-placeholder.spec.ts`（新規） | 遷移・名前・**見え方**（computed style） |

`ModuleId` の定義は `Nav.tsx` から `route.ts` へ移す。**ハッシュの語彙はルーティングの持ち物**で、Nav はその利用者だからである。

---

### Task 1: ハッシュを 2 段で読む

**Files:**
- Create: `web/src/route.ts`
- Create: `web/src/route.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `export type ModuleId = "scientific" | "convert" | "scale" | "finance"`、`export type Route = { module: ModuleId; category: string | null }`、`export function routeFromHash(hash: string): Route`

- [ ] **Step 1: Write the failing test**

`web/src/route.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { routeFromHash } from "./route";

describe("routeFromHash", () => {
  it("reads the two known modules that have no category", () => {
    expect(routeFromHash("#scientific")).toEqual({
      module: "scientific",
      category: null,
    });
    expect(routeFromHash("#finance")).toEqual({
      module: "finance",
      category: null,
    });
  });

  it("reads a category out of the second segment", () => {
    expect(routeFromHash("#scale/data-scale")).toEqual({
      module: "scale",
      category: "data-scale",
    });
  });

  it("falls to the default category when the second segment is missing", () => {
    // U-0 の Scale は中身が 1 つしか無い。#scale はそこへ倒す。
    expect(routeFromHash("#scale")).toEqual({
      module: "scale",
      category: "data-scale",
    });
  });

  it("falls to the default category when the second segment is unknown", () => {
    expect(routeFromHash("#scale/nope")).toEqual({
      module: "scale",
      category: "data-scale",
    });
  });

  it("reads convert, which has no category yet", () => {
    expect(routeFromHash("#convert")).toEqual({
      module: "convert",
      category: null,
    });
  });

  it("does not route the old #data-scale hash any more", () => {
    // **互換は作らない**(設計書 §1-4、クローズドβのため)。旧 #loan と
    // 同じ扱いで、知らないハッシュとして既定に倒れる。これは仕様である。
    expect(routeFromHash("#data-scale")).toEqual({
      module: "scientific",
      category: null,
    });
  });

  it("does not route the old #loan hash any more", () => {
    expect(routeFromHash("#loan")).toEqual({
      module: "scientific",
      category: null,
    });
  });

  it("falls back to scientific for an empty or unknown hash", () => {
    expect(routeFromHash("")).toEqual({ module: "scientific", category: null });
    expect(routeFromHash("#nope")).toEqual({
      module: "scientific",
      category: null,
    });
  });

  it("ignores a third segment instead of failing", () => {
    expect(routeFromHash("#scale/data-scale/extra")).toEqual({
      module: "scale",
      category: "data-scale",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && pnpm vitest run src/route.test.ts
```

Expected: FAIL — `Failed to resolve import "./route"`

- [ ] **Step 3: Write minimal implementation**

`web/src/route.ts`:

```ts
/**
 * URL のハッシュから、いま出すモジュールとカテゴリを導く。
 *
 * **React を import しない**(web/src/calc と同じ境界の流儀)。
 *
 * ハッシュは 2 段である(設計書 §3)——先頭が系統、2 番目がカテゴリ。
 * この形にしておくと、U-1 が `#convert/length` を足すときに
 * ここの構造は変わらず、下の表に行が増えるだけになる。
 */

export type ModuleId = "scientific" | "convert" | "scale" | "finance";

export type Route = { module: ModuleId; category: string | null };

const MODULES: readonly ModuleId[] = [
  "scientific",
  "convert",
  "scale",
  "finance",
];

/** 系統ごとに存在するカテゴリ。**U-0 では scale だけが中身を持つ。** */
const CATEGORIES: Record<ModuleId, readonly string[]> = {
  scientific: [],
  convert: [],
  scale: ["data-scale"],
  finance: [],
};

/** 系統ごとの既定カテゴリ。無い・知らないときはここへ倒す。 */
const DEFAULT_CATEGORY: Record<ModuleId, string | null> = {
  scientific: null,
  convert: null,
  scale: "data-scale",
  finance: null,
};

function isModuleId(text: string): text is ModuleId {
  return (MODULES as readonly string[]).includes(text);
}

export function routeFromHash(hash: string): Route {
  const [head, category] = hash.replace(/^#/, "").split("/");
  // **知らない先頭は既定へ倒す。** 旧 `#data-scale` も `#loan` もここに
  // 落ちる——互換分岐は作らない(設計書 §1-4)。
  if (!isModuleId(head)) return { module: "scientific", category: null };
  const known =
    category !== undefined && CATEGORIES[head].includes(category);
  return { module: head, category: known ? category : DEFAULT_CATEGORY[head] };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && pnpm vitest run src/route.test.ts && pnpm typecheck && pnpm lint
```

Expected: 9 tests PASS、typecheck 緑、lint 緑。

**`pnpm typecheck` を必ず走らせること。** `tsconfig` は `noUncheckedIndexedAccess` を
有効にしているので、`split("/")` の結果を分割代入すると `head` が `string | undefined`
になる。`const [head = "", category] = ...` と既定値を置く（`""` は `ModuleId` では
ないので、既定へ倒れる振る舞いは変わらない）。

- [ ] **Step 5: 赤確認（判別力の実測）**

**変異の前に一時コミットを置く**（戻すのは変異箇所の再編集。ファイル単位の `checkout` は使わない）:

```bash
git add -A && git commit -m "wip: 赤確認"
```

`route.ts` の `CATEGORIES.scale` を `[]` にする → `#scale/data-scale` が既定カテゴリに落ちるだけなので**このテストは緑のまま**。次に `DEFAULT_CATEGORY.scale` を `null` にする → **2 件**（`#scale` と `#scale/nope`）が赤になることを確認する。

**`#scale/data-scale` は緑のままであることに注意**——カテゴリが `CATEGORIES` に明示一致するので `DEFAULT_CATEGORY` を参照しない。

**ただし「2 つの表が別々に守られている」とは言えない**（2026-08-19 訂正）。1 段目の変異（`CATEGORIES.scale` を空にする）は**9 件すべてが緑のまま**で、これは U-0 の `scale` の唯一のカテゴリが既定値と同値だからである。**この 2 段が示すのは「`DEFAULT_CATEGORY` は運動しているが、`CATEGORIES` は誰にも守られていない」**という非対称であって、両方が守られていることではない。`CATEGORIES` を分離できる最初の機会は U-1（`#convert/length` は既定と違う値になる）で、要求は U-1 の設計書 §6 に書いてある。

**両方の実出力を記録してから**、変異箇所を再編集で戻し、`git reset --soft HEAD~1` で一時コミットを解く。

- [ ] **Step 6: Commit**

```bash
git add web/src/route.ts web/src/route.test.ts
git commit -m "$(cat <<'EOF'
Read the hash in two segments instead of one

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Nav を 4 タブにする

**Files:**
- Modify: `web/src/ui/Nav/Nav.tsx`
- Modify: `web/src/ui/Nav/Nav.test.tsx`
- Modify: `web/src/App.tsx`（**2 行だけ**。下の「巻き込みについて」を読むこと）
- Modify: `web/src/App.test.tsx`（**1 行だけ**）

**巻き込みについて（当初の計画の欠陥。2026-08-19 訂正）:** `ModuleId` は型名だけでなく
**メンバの値**も変わる（`"data-scale"` → `"scale"`）。一時的な再 export が守れるのは
**型名の import** だけで、**値の改名は守れない**。したがって `App.tsx` は Task 2 の
時点で必ず巻き込まれる。**巻き込みは最小にする**:

1. `App.tsx` の `moduleFromHash` の中身を **`routeFromHash` への委譲 1 行**にする
   （判断を 2 か所に持たない）
2. パネルの出し分けの `module === "data-scale"` を `module === "scale"` にする
3. `App.test.tsx` の `#data-scale` を使うテスト 1 件を `#scale/data-scale` にする

**それ以外は Task 3 の仕事である。** 特に `#convert` の配線と Convert のパネルを
ここで足さないこと。**`#convert` を開くと `<main>` が空になるのは、Task 3 までの
正常な途中状態**である。

**旧 `#data-scale` の互換分岐を書かないこと。** `#data-scale` が Scientific に
倒れるのは**仕様**（設計書 §1-4）であり、直すべき壊れではない。

**Interfaces:**
- Consumes: `ModuleId` from `web/src/route.ts`（Task 1）
- Produces: `Nav({ current }: { current: ModuleId })`。**`Nav.tsx` は `ModuleId` を一時的に再 export する**（Task 3 で消す。理由は Step 3）

- [ ] **Step 1: Write the failing test**

`web/src/ui/Nav/Nav.test.tsx` の import 行を差し替え、リンクの検査を書き換える:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Nav } from "./Nav";

describe("Nav", () => {
  it("names the nav landmark in Japanese, matching the rest of the UI", () => {
    render(<Nav current="scientific" />);
    expect(
      screen.getByRole("navigation", { name: "計算機の切り替え" }),
    ).toBeInTheDocument();
  });

  it("links to every module by hash", () => {
    render(<Nav current="scientific" />);
    expect(screen.getByRole("link", { name: "Scientific" })).toHaveAttribute(
      "href",
      "#scientific",
    );
    expect(screen.getByRole("link", { name: "Convert" })).toHaveAttribute(
      "href",
      "#convert",
    );
    // **既定カテゴリまで書く**(設計書 §3)。`#scale` にすると同じ画面に
    // 2 つの URL ができ、押した後の URL と深いリンクが食い違う。
    expect(screen.getByRole("link", { name: "Scale" })).toHaveAttribute(
      "href",
      "#scale/data-scale",
    );
    expect(screen.getByRole("link", { name: "Finance" })).toHaveAttribute(
      "href",
      "#finance",
    );
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });

  it("marks only the current tab with aria-current", () => {
    render(<Nav current="finance" />);
    expect(screen.getByRole("link", { name: "Finance" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const name of ["Scientific", "Convert", "Scale"]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute(
        "aria-current",
      );
    }
  });

  it("marks the scale tab when that is the current one", () => {
    render(<Nav current="scale" />);
    expect(screen.getByRole("link", { name: "Scale" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: "Scientific" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("marks the convert tab when that is the current one", () => {
    render(<Nav current="convert" />);
    expect(screen.getByRole("link", { name: "Convert" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && pnpm vitest run src/ui/Nav/Nav.test.tsx
```

Expected: FAIL — `Unable to find an accessible element with the role "link" and name "Convert"`

- [ ] **Step 3: Write minimal implementation**

`web/src/ui/Nav/Nav.tsx` を次の内容にする（`ModuleId` の定義はここから消え、`route.ts` から import する）:

```tsx
import type { ModuleId } from "../../route";
import styles from "./Nav.module.css";

// **一時的な再 export。Task 3 で消す。**
// これが無いと、まだ Nav から ModuleId を取っている App.tsx が Task 2 の
// コミット時点で型検査に落ちる。**全コミットを緑に保つ**ためだけの 1 行で、
// 恒久的な依存ではない(ハッシュの語彙はルーティングの持ち物である)。
export type { ModuleId };

// タブの表示ラベルはモジュールの固有名詞なので英語のまま
// (アクセシブルネームは <nav> 側の aria-label で日本語にする)。
//
// **href は既定カテゴリまで書く**(設計書 §3)。`#scale` だと同じ画面に
// URL が 2 つでき、E2E の toHaveURL 期待がその曖昧さを引き継ぐ。
const MODULES: { id: ModuleId; href: string; label: string }[] = [
  { id: "scientific", href: "#scientific", label: "Scientific" },
  { id: "convert", href: "#convert", label: "Convert" },
  { id: "scale", href: "#scale/data-scale", label: "Scale" },
  { id: "finance", href: "#finance", label: "Finance" },
];

export function Nav({ current }: { current: ModuleId }) {
  return (
    <nav aria-label="計算機の切り替え" className={styles.nav}>
      {MODULES.map((m) => (
        <a
          key={m.id}
          href={m.href}
          aria-current={m.id === current ? "page" : undefined}
          className={styles.tab}
        >
          {m.label}
        </a>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && pnpm vitest run src/ui/Nav/Nav.test.tsx && pnpm typecheck && pnpm lint
```

Expected: 5 tests PASS、**typecheck も緑**。一時的な再 export が `App.tsx` の
既存 import を生かしているためである。**このコミットも緑のまま**で、bisect が効く。

- [ ] **Step 5: Commit**

```bash
git add web/src/ui/Nav/Nav.tsx web/src/ui/Nav/Nav.test.tsx
git commit -m "$(cat <<'EOF'
Give the shell a fourth tab and move the hash vocabulary to routing

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Convert の準備中パネルと App の出し分け

**Files:**
- Create: `web/src/ui/Convert/ConvertPanel.tsx`
- Create: `web/src/ui/Convert/ConvertPanel.module.css`
- Create: `web/src/ui/Convert/ConvertPanel.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.test.tsx`

**Interfaces:**
- Consumes: `routeFromHash`, `ModuleId`（Task 1）、`Nav`（Task 2）
- Produces: `ConvertPanel()`（引数なし）

- [ ] **Step 1: Write the failing test（パネル）**

`web/src/ui/Convert/ConvertPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConvertPanel } from "./ConvertPanel";

describe("ConvertPanel", () => {
  it("names itself as not ready yet", () => {
    render(<ConvertPanel />);
    expect(
      screen.getByRole("region", { name: "単位変換（準備中）" }),
    ).toBeInTheDocument();
  });

  it("says what will live here", () => {
    // **押して何も起きない面を作らない**(設計書 §5)。押せば画面が変わり、
    // その画面が何が来るかを言う。
    render(<ConvertPanel />);
    expect(screen.getByText("単位変換は準備中です。")).toBeInTheDocument();
    expect(
      screen.getByText("長さ・重さ・温度・通貨などの変換をここに置きます。"),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && pnpm vitest run src/ui/Convert/ConvertPanel.test.tsx
```

Expected: FAIL — `Failed to resolve import "./ConvertPanel"`

- [ ] **Step 3: Write the panel**

`web/src/ui/Convert/ConvertPanel.tsx`:

```tsx
import styles from "./ConvertPanel.module.css";

/**
 * Convert の中身が入るまでの置き場(設計書 §5)。
 *
 * **タブのリンクは生きている。** 押せば `#convert` に遷移し、この画面が出る
 * ——0.2.0 の予約スロット(押せるように見えて無反応)とは別物である。
 */
export function ConvertPanel() {
  return (
    <section aria-label="単位変換（準備中）" className={styles.panel}>
      <p className={styles.heading}>単位変換は準備中です。</p>
      <p className={styles.detail}>
        長さ・重さ・温度・通貨などの変換をここに置きます。
      </p>
    </section>
  );
}
```

`web/src/ui/Convert/ConvertPanel.module.css`:

```css
/* **見え方は自動検査では捕まらない**(設計書 §5)。0.2.0 の更新トーストは
   role も寸法もフォーカスも緑のまま、白地に白のボタンだった。だから
   背景と文字色をトークンで明示的に持ち、E2E が computed style で見る。 */
.panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: var(--shell-max-width);
  margin: 0 auto;
  padding: 24px 12px;
  border-radius: var(--radius);
  background: var(--display-bg);
  color: var(--display-fg);
}

.heading {
  font-size: 1rem;
  font-weight: var(--key-font-weight-emphasis);
}

.detail {
  font-size: 0.875rem;
  color: var(--display-status-fg);
}
```

- [ ] **Step 4: Run the panel test**

```bash
cd web && pnpm vitest run src/ui/Convert/ConvertPanel.test.tsx
```

Expected: 2 tests PASS

- [ ] **Step 5: Write the failing test（App）**

`web/src/App.test.tsx` に `ConvertPanel` のモックを足し、ハッシュの検査を差し替える。**追加するモック**（既存のモック群の隣に置く）:

```tsx
vi.mock("./ui/Convert/ConvertPanel", () => ({
  ConvertPanel: () => <p data-testid="convert-panel" />,
}));
```

**差し替えるテスト**（`shows Data Scale when the hash says so` を次の 3 件にする。他のテストはそのまま）:

```tsx
  it("shows Data Scale when the hash says so", () => {
    window.location.hash = "#scale/data-scale";
    render(<App />);
    expect(screen.getByTestId("datascale-panel")).toBeInTheDocument();
  });

  it("shows the convert placeholder when the hash says so", () => {
    window.location.hash = "#convert";
    render(<App />);
    expect(screen.getByTestId("convert-panel")).toBeInTheDocument();
  });

  it("does not route the old #data-scale hash any more", () => {
    // **互換は作らない**(設計書 §1-4)。旧 #loan と同じ扱いである。
    window.location.hash = "#data-scale";
    render(<App />);
    expect(screen.getByTestId("scientific-panel")).toBeInTheDocument();
  });
```

`shows Finance when the hash says so` の末尾の取りこぼし検査に 1 行足す:

```tsx
    expect(screen.queryByTestId("convert-panel")).toBeNull();
```

- [ ] **Step 6: Run test to verify it fails**

```bash
cd web && pnpm vitest run src/App.test.tsx
```

Expected: FAIL — `#scale/data-scale` で `datascale-panel` が見つからない（`App.tsx` がまだ 1 段の hash を読んでいる）

- [ ] **Step 7: Rewrite App.tsx**

```tsx
import { useEffect, useState } from "react";
import { type Route, routeFromHash } from "./route";
import styles from "./ui/App.module.css";
import { ConvertPanel } from "./ui/Convert/ConvertPanel";
import { DataScalePanel } from "./ui/DataScale/DataScalePanel";
import { FinancePanel } from "./ui/Finance/FinancePanel";
import { Footer } from "./ui/Footer/Footer";
import { Nav } from "./ui/Nav/Nav";
import { ScientificPanel } from "./ui/ScientificPanel";
import { UpdateToast } from "./ui/UpdateToast/UpdateToast";

export function App() {
  const [route, setRoute] = useState<Route>(() =>
    routeFromHash(window.location.hash),
  );

  useEffect(() => {
    // リンクの href がハッシュを変える。クリックハンドラは書かず、ブラウザの
    // 標準動作(履歴・共有・リロード)に任せる——この購読はその結果を
    // React の state に反映するだけ(設計書 §6)。
    const onHashChange = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <>
      <div className={styles.shell}>
        <Nav current={route.module} />
        <main className={styles.main}>
          {route.module === "scientific" && <ScientificPanel />}
          {route.module === "convert" && <ConvertPanel />}
          {route.module === "scale" && <DataScalePanel />}
          {route.module === "finance" && <FinancePanel />}
        </main>
        {/* 版数・リンク・免責もモジュールに属さない。シェルが 1 つだけ持つ。 */}
        <Footer />
      </div>
      {/* 更新の知らせはモジュールに属さない。シェルが 1 つだけ持つ。 */}
      <UpdateToast />
    </>
  );
}
```

**`Nav.tsx` の一時的な再 export（`export type { ModuleId };` とその上のコメント 4 行）を削除する。** App が `route.ts` から直接取るようになったので、役目が終わる。**消し忘れると「Nav がハッシュの語彙を持っている」という嘘が残る。**

**`App.tsx` 冒頭にあった `moduleFromHash` の長いコメント（`#loan` の互換を足さなかった経緯）は削除する。** 同じ判断の記録は `route.ts` と `docs/base-spec.md` §8（Task 6）が持つ。

- [ ] **Step 8: Run the tests**

```bash
cd web && pnpm vitest run && pnpm typecheck && pnpm lint
```

Expected: vitest 全件 PASS、typecheck 緑（Task 2 で落ちていた `ModuleId` の import が解決する）、lint 緑

- [ ] **Step 9: 赤確認**

一時コミットを置いてから、`App.tsx` の `{route.module === "convert" && <ConvertPanel />}` の行を消す → `shows the convert placeholder when the hash says so` が赤になることを確認する。**実出力を記録してから**、再編集で戻し `git reset --soft HEAD~1`。

- [ ] **Step 10: Commit**

```bash
git add web/src/App.tsx web/src/App.test.tsx web/src/ui/Convert/
git commit -m "$(cat <<'EOF'
Let Convert say it is not ready, instead of not being there

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: E2E の hash 更新と Convert の走行

**Files:**
- Modify: `web/tests/e2e/data-scale.spec.ts`（6 箇所）
- Modify: `web/tests/e2e/data-scale-keypad.spec.ts:19`
- Modify: `web/tests/e2e/footer.spec.ts:6`
- Modify: `web/tests/e2e/viewport-budget.spec.ts:9`
- Modify: `web/tests/e2e/nav.spec.ts`
- Modify: `web/tests/e2e/loan.spec.ts`（タブのラベルとリンク数）
- Modify: `web/tests/e2e/pwa.spec.ts`（タブのラベル）
- Create: `web/tests/e2e/convert-placeholder.spec.ts`

**一覧は 2 通りの grep から起こす（2026-08-19 訂正）。** 当初この一覧は
`#data-scale` の grep だけで作られており、**タブの表示ラベルとリンク数で
grep していなかった**。そのため `loan.spec.ts:32` の
`toHaveCount(3)` と、`loan.spec.ts` / `pwa.spec.ts` の
`{ name: "Data Scale" }` が漏れ、E2E が 3 件落ちた。

```bash
cd web && grep -rn '#data-scale' tests/e2e          # ハッシュ
cd web && grep -rn '"Data Scale"\|toHaveCount(3)' tests/e2e   # ラベルと本数
```

**Interfaces:**
- Consumes: Task 3 までの実装
- Produces: なし

- [ ] **Step 1: 既存 E2E の hash を置き換える**

`#data-scale` を `#scale/data-scale` にする。**`toHaveURL(/#data-scale$/)` の正規表現は 2 箇所**（`data-scale.spec.ts:40`, `:82`）あり、`/#scale\/data-scale$/` にする。

```bash
cd web && grep -rn '#data-scale' tests/e2e
```

置換後、**`grep` の結果が 0 件**になることを確認する。

- [ ] **Step 2: `footer.spec.ts` と `viewport-budget.spec.ts` のループに `#convert` を足す**

`footer.spec.ts:6`:

```ts
  for (const hash of [
    "#scientific",
    "#convert",
    "#scale/data-scale",
    "#finance",
  ]) {
```

`viewport-budget.spec.ts` の `TABS`:

```ts
const TABS = [
  ["#scientific", "Scientific"],
  ["#convert", "Convert"],
  ["#scale/data-scale", "Data Scale"],
  ["#finance", "Finance"],
] as const;
```

**`viewport-budget.spec.ts` の 2 つのループは `display-main` の表示を待つ**が、
**Convert には表示器が無い**。待ち方をヘルパーに切り出し、2 箇所から呼ぶ。

import 行を変える:

```ts
import { expect, type Page, test } from "@playwright/test";
```

`TABS` の直後にヘルパーを置く:

```ts
/**
 * パネルが描かれるのを待つ。
 *
 * **フッタは WASM と無関係に即描画される**ので、これが無いと Scientific は
 * `Loading…` のままの空のページを測って緑になる。**Convert には表示器が
 * 無い**ので、そのパネル自身の出現を待つ。
 */
async function waitForPanel(page: Page, hash: string) {
  if (hash === "#convert") {
    await expect(
      page.getByRole("region", { name: "単位変換（準備中）" }),
    ).toBeVisible();
  } else {
    await expect(page.getByTestId("display-main")).toBeVisible();
  }
}
```

**2 箇所の `await expect(page.getByTestId("display-main")).toBeVisible();` を
`await waitForPanel(page, hash);` に置き換える**——`fits in one screen at 390x844`
のループ（26 行目付近）と、`the footer sits at the same place on every tab`
のループ（37 行目付近）である。

**3 つ目の `the tallest tab still has slack inside the screen` は `#finance`
だけを見るので変えない**（`hash` 変数が無く、待つ対象も変わらない）。

- [ ] **Step 3: `nav.spec.ts` を 4 タブにする**

2 つのループの配列を `["Scientific", "Convert", "Scale", "Finance"]` にする。**さらに 360px の検査を 1 件足す**（spec §4。4 タブで 1 枚 78px になるため）:

```ts
test("every module tab still fits on one line at 360px", async ({ page }) => {
  // **4 タブにして 1 枚が 107px から 78px になった**(設計書 §4)。
  // 既定の viewport は 390px なので、いちばん狭い対応幅を名指しで測る。
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
  for (const name of ["Scientific", "Convert", "Scale", "Finance"]) {
    const lines = await page
      .getByRole("link", { name, exact: true })
      .evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getClientRects().length;
      });
    expect(lines, `${name} wrapped onto ${lines} lines`).toBe(1);
  }
});

test("the tabs keep a 44px touch target at 360px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
  for (const name of ["Scientific", "Convert", "Scale", "Finance"]) {
    const box = await page
      .getByRole("link", { name, exact: true })
      .boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("the nav does not push the page sideways at 360px", async ({ page }) => {
  // **折り返さない以上、入らなければ横にはみ出す**(Nav.module.css の
  // white-space: nowrap)。0.2.1 の 360px と同じ壊れ方をここで止める。
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, `the page overflows sideways by ${overflow}px`).toBe(0);
});
```

- [ ] **Step 4: Convert の E2E を新設**

`web/tests/e2e/convert-placeholder.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("pressing Convert changes the screen", async ({ page }) => {
  // **押して何も起きない面を作らない**(設計書 §5)。0.2.0 の予約スロットは
  // 押せるように見えて無反応だった。ここは押せば画面が変わる。
  await page.goto("/");
  await page.getByRole("link", { name: "Convert", exact: true }).click();
  await expect(page).toHaveURL(/#convert$/);
  await expect(
    page.getByRole("region", { name: "単位変換（準備中）" }),
  ).toBeVisible();
});

test("the placeholder text is actually readable", async ({ page }) => {
  // **見え方は意味の検査では捕まらない**——0.2.0 の更新トーストは role も
  // 寸法もフォーカスも緑のまま、白地に白のボタンだった。だから計算済み
  // スタイルで「背景と文字の色が違う」ことを固定する。
  await page.goto("/#convert");
  const heading = page.getByText("単位変換は準備中です。");
  await expect(heading).toBeVisible();

  const seen = await heading.evaluate((el) => {
    const own = getComputedStyle(el);
    const panel = getComputedStyle(el.parentElement as HTMLElement);
    return {
      color: own.color,
      opacity: own.opacity,
      panelBg: panel.backgroundColor,
      pageBg: getComputedStyle(document.body).backgroundColor,
    };
  });

  expect(seen.color).not.toBe(seen.panelBg);
  expect(seen.panelBg).not.toBe("rgba(0, 0, 0, 0)");
  expect(seen.panelBg).not.toBe(seen.pageBg);
  expect(Number(seen.opacity)).toBe(1);
});

test("the old #data-scale link lands on Scientific", async ({ page }) => {
  // **互換は作らない**(設計書 §1-4、クローズドβ)。知らないハッシュとして
  // 既定に倒れる——これは仕様であって、壊れているのではない。
  await page.goto("/#data-scale");
  await expect(page.getByTestId("display-main")).toHaveText("0");
  await expect(
    page.getByRole("link", { name: "Scientific", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});
```

- [ ] **Step 5: Run the E2E**

```bash
cd web && pnpm e2e
```

Expected: 全件 PASS。**落ちたら直す前に「何が落ちたか」を読む**——`viewport-budget` の `#convert` が落ちるなら、それは spec §8 が予告した「通らなければそれ自体が発見」である。**その場合は勝手に閾値を緩めず、実測値を記録して報告する。**

- [ ] **Step 6: 赤確認（2 件）**

一時コミット（`git add -A && git commit -m "wip: 赤確認"`）を置いてから、2 つ当てる。

**(a) 見え方**——`ConvertPanel.module.css` の `color: var(--display-fg)` を
`color: var(--display-bg)` にする（白地に白）→ `the placeholder text is actually
readable` が赤。**赤にならなければ、その検査は 0.2.0 のトーストを捕まえられない。**

**(b) ルーティングの退行を E2E 段が捕まえるか**——`route.ts` の `MODULES` から
`"scale"` を外す（`isModuleId("scale")` が偽になる）→ `#scale/data-scale` が
Scientific に落ち、**`data-scale.spec.ts` が赤になる**ことを確認する。

**当初この手順は `DEFAULT_CATEGORY.scale` を `null` にする変異を指定していた。
それは設計書 §8 の赤確認 1 とは別のものを壊していた**（2026-08-19 訂正）。設計書は
「`routeFromHash` の `scale` の**分岐**を落とす → `#scale/data-scale` が Scientific に
落ちて」と書いており、対象は**モジュールの分岐**である。

**`category` は U-0 では E2E から観測できない**（実測）——`route.category` を読む実装が
1 つも無く、1 系統に 1 カテゴリしか無いので DOM が変わらない。**カテゴリ側の表を
守るのは `route.test.ts`（単体）だけ**であり、E2E 段では原理的に検出できない。
この空洞を埋めるのは U-1（`#convert/length` で 2 つ目のカテゴリが来る）で、
要求は U-1 の spec §6 に記載済みである。

**(b) が要る理由**: spec §8 の赤確認 1 は「`routeFromHash` の `scale` の分岐を落とす
→ **E2E が赤**」と、**E2E 段の判別力**を主張している。Task 1 の赤確認は vitest 段の
話なので、**それだけでは spec の主張を実測していない**。`data-scale.spec.ts` は
hash を移行した側の安全網であり、**その安全網が本当に張れているか**がここの対象である。

**両方とも実出力を記録してから**、変異箇所を再編集で戻し `git reset --soft HEAD~1`。

- [ ] **Step 7: Commit**

```bash
git add web/tests/e2e/
git commit -m "$(cat <<'EOF'
Walk the new tab in a real browser, and look at whether it can be read

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 360px の幅を実測し、必要なら譲る

**Files:**
- Modify（必要なら）: `web/src/ui/Nav/Nav.module.css` または `web/src/ui/tokens.css`
- Modify: `docs/superpowers/specs/2026-08-19-nav-restructure-design.md`（§4 に実測値を追記）

**Interfaces:**
- Consumes: Task 4 までの実装
- Produces: なし

- [ ] **Step 1: 実測する**

Task 4 の `nav.spec.ts` の 360px 3 件が緑なら**何も変えない**。落ちたら、落ちた実測値（`scrollWidth − innerWidth` と各タブの `getClientRects().length`）を記録する。

- [ ] **Step 2: 譲る（落ちた場合のみ）**

**順序は 0.2.1 の 360px 修正と同じ**（spec §4）:

1. **まず `gap`** ——`Nav.module.css` の `.nav { gap: var(--key-gap) }` を小さい値にする。3 つの隙間で最大 24px が浮く
2. 足りなければ **`--nav-font-size`**（`tokens.css`、いま `1rem`）を下げる
3. **ラベルの短縮は最後**
4. **`min-height: var(--touch-target-min)` は譲らない**

**1 段ずつ試し、そのつど `nav.spec.ts` を回す。** 効いた時点で止める。

- [ ] **Step 3: 撮って見る**

```bash
cd web && pnpm exec vite build && pnpm preview &
```

`web/` に一時スクリプトを置き、**4 枚**撮る——**2 つの幅（390×844 / 360×640）× 2 つの画面（`#scientific` / `#convert`）**（`chromium.launch()` → `setViewportSize` → `goto` → `screenshot`）。

（spec §8 は「2 枚」と書いているが、**それは幅の数であって枚数ではない**。準備中の見えを両方の幅で見るなら 4 枚になる。**spec §8 の「2 枚」を「2 つの幅 × 2 画面 = 4 枚」に訂正印つきで直す**——Step 4 で spec を触るので、そこで一緒に。）

`Read` で開き、**4 タブがはみ出していないか**（`#scientific` の両幅）と**準備中が読めるか**（`#convert` の両幅）を目で見る。

**撮り終えたら preview を落とす:**

```bash
fuser -k 4179/tcp && ss -ltn | grep 4179
```

（`grep` が何も出さないこと。**`pkill -f "vite preview"` では落ちない**——張っているのは `node` プロセスである。）一時スクリプトは消す。

- [ ] **Step 4: spec に実測値を追記**

`2026-08-19-nav-restructure-design.md` §4 の「どれを採ったかは、実測値と一緒に実装時に spec へ追記する」に応える。**採らなかった段（例: font-size は下げずに済んだ）も書く。**

**あわせて §8 の「撮る: 390×844 と 360×640 の 2 枚」を「2 つの幅 × 2 画面 = 4 枚」に直す**（Step 3 の訂正）。

- [ ] **Step 5: Commit**

```bash
git add web/src/ui docs/superpowers/specs/2026-08-19-nav-restructure-design.md
git commit -m "$(cat <<'EOF'
Measure what four tabs do to 360px, and write the number down

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 版数 0.3.0 と docs

**Files:**
- Modify: `Cargo.toml`（workspace の `version`）
- Modify: `web/package.json`（`version`）
- Modify: `README.md`（「現在の版」）
- Modify: `README.en.md`（「Current version」）
- Modify: `CHANGELOG.md`（`## 0.3.0` の節を先頭に足す）
- Modify: `docs/base-spec.md`（§8）

**Interfaces:**
- Consumes: Task 5 までの実装
- Produces: なし

- [ ] **Step 1: 5 箇所を 0.3.0 に揃える**

`Cargo.toml:7` と `web/package.json:4` を `0.3.0` に。`README.md:14` の「**0.2.1（ベータ）**」と `README.en.md` の対応行を `0.3.0` に。

- [ ] **Step 2: CHANGELOG に節を足す**

`## 0.2.1 — 2026-08-17` の直前に置く。**書くのは利用者から見えた変更だけ**（そのファイルの冒頭がそう宣言している）:

```markdown
## 0.3.0 — 2026-08-XX

計算機の並べ方を変えた。計算は 1 つも変わっていない。

### 変えたもの

- **タブが 4 つになった。** `Scientific` / `Convert` / `Scale` / `Finance`。
  `Convert`（単位変換）は**まだ準備中**で、開くとその旨が出る
- **Data Scale が `Scale` の下に入った。** 計算の中身は同じ
- **`#data-scale` のブックマークは効かなくなった。** 開くと Scientific が
  出る。新しい場所は `#scale/data-scale`
```

**日付は出荷時に確定する**（`2026-08-XX` のままにせず、コミット時点の日付を入れる）。

- [ ] **Step 3: base-spec §8 を直す**

モジュール木に `Convert` と `Scale` を足し、**ハッシュが 2 段になったこと**と**旧 `#data-scale` の互換を作らなかったこと**を書く。**置き場と様式は既存の【訂正 2026-08-15】（`#loan` の記録、`docs/base-spec.md:250`）に倣う。**

- [ ] **Step 4: 検査**

```bash
cd web && pnpm check:version && pnpm test && pnpm typecheck && pnpm lint && pnpm e2e
```

**`pnpm check:version` が見るのは `Cargo.toml` と `web/package.json` だけで、どちらの README も CHANGELOG も見ない**（CLAUDE.md）。**残り 3 箇所は目で確かめる:**

```bash
grep -n "0\.3\.0" Cargo.toml web/package.json README.md README.en.md CHANGELOG.md
```

- [ ] **Step 5: `crates/` の差分が 0 行であることを実測する**

```bash
git fetch && git diff origin/main --stat -- crates/
```

Expected: **出力が空**。1 行でも出たら Global Constraints を破っている。

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml web/package.json README.md README.en.md CHANGELOG.md docs/base-spec.md
git commit -m "$(cat <<'EOF'
Call it 0.3.0 in five places, and say the tabs moved

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 完了時に報告すること

- **`pnpm test` / `pnpm typecheck` / `pnpm lint` / `pnpm e2e` の件数**（実出力から。記憶で書かない）
- **`git diff origin/main --stat -- crates/` が空であること**
- **360px で採った手**（gap を詰めたか、font-size まで下げたか、何もしなくて済んだか）と実測値
- **スクリーンショット 2 枚を見た結果**
- **赤確認 4 件の実出力**（Task 1 の 2 段 / Task 3 / Task 4 の (a) と (b)）。**赤にならなかったものがあれば正直に報告する**

# Loan → Finance 改名（F0）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** UI 上の `Loan` を `Finance` に改め、ハッシュを `#finance` にする。表示層だけを変え、計算コアと内部名は触らない。

**Architecture:** 変更は 8 ファイルの機械的置換 + `ModuleId` の値変更 + base-spec の訂正印 2 か所。新しい機能は無い。**テストの期待値を先に変えて赤を見てから実装を直す**（`engine_table.rs` を仕様書として先に変える流儀と同じ）。

**Tech Stack:** React / TypeScript / Vitest / Playwright。Rust は触らない。

**正本:** [`docs/superpowers/specs/2026-08-14-finance-rename-design.md`](../specs/2026-08-14-finance-rename-design.md)（ユーザー裁定済み、2026-08-15）。

## Global Constraints

- **`crates/` `testdata/` `reference/` の差分ゼロ。** 完了報告に
  `git diff --stat <分岐点> -- crates/ testdata/ reference/` が空であることを書く。
- **旧 `#loan` の互換分岐は作らない**（spec §3、ユーザー裁定 Q2）。旧ハッシュは
  不明ハッシュとして `scientific` に倒れる。**それを仕様として固定する検査を置く。**
- **内部名は改名しない**（spec §1）。`web/src/loan/`、`web/src/ui/Loan/`、
  `LoanPanel`、`crates/.../loan`、`data-testid` の `loan-*` はすべて据え置き。
  **唯一の例外が `ModuleId` の値**（Task 1 で扱う）。
- タブの表示ラベルは英語のまま、パネルの region 名は日本語（`Nav.tsx` の既存の規律）。
- **分岐元は `docs/finance-expansion` の先端 `5fb084f`**。main ではない
  ——`LoanPanel.tsx` と loan の E2E は L が全面的に書き換えており、main から
  分岐すると衝突する（spec §7 Q3）。ブランチ名 `feature/finance-rename`。
- 検証段は **web 段のみ**（spec §6）。`cargo` と `reference` は回さない。
- コミットはブランチガード付き
  （`test "$(git branch --show-current)" = feature/finance-rename || exit 1`）。
  **`git push` と PR 作成は行わない。** Co-Authored-By を付ける。
- ベースライン（D 完了時点）: vitest 136 / e2e 81。**改名で件数は増減しない**
  ——増えるのは Task 2 の新規 2 本（vitest 1 / e2e 1）のみ。

---

### Task 1: ルーティングとタブ

**Files:**
- Modify: `web/src/ui/Nav/Nav.tsx:3,10`
- Modify: `web/src/App.tsx:9-13`
- Test: `web/src/ui/Nav/Nav.test.tsx`、`web/src/App.test.tsx`

**Interfaces:**
- Consumes: なし（既存コードのみ）
- Produces: `ModuleId = "scientific" | "data-scale" | "finance"`。`App.tsx` と
  `Nav.tsx` の 2 ファイルだけがこの型を使う（実測済み）。Task 2 はこの型に
  依存しない。

- [ ] **Step 1: テストの期待値を先に変える**

`web/src/ui/Nav/Nav.test.tsx` の 3 箇所:

```tsx
    expect(screen.getByRole("link", { name: "Finance" })).toHaveAttribute(
      "href",
      "#finance",
    );
```

```tsx
  it("marks only the current tab with aria-current", () => {
    render(<Nav current="finance" />);
    expect(screen.getByRole("link", { name: "Finance" })).toHaveAttribute(
      "aria-current",
      "page",
    );
```

`web/src/App.test.tsx` の該当テストを書き換え、**旧ハッシュの固定を足す**:

```tsx
  it("shows Finance when the hash says so", () => {
    window.location.hash = "#finance";
    render(<App />);
    expect(screen.getByTestId("loan-panel")).toBeInTheDocument();
    // 1 モジュールだけが <main> に居ること(出し分けの取りこぼしを防ぐ)。
    expect(screen.queryByTestId("scientific-panel")).toBeNull();
    expect(screen.queryByTestId("datascale-panel")).toBeNull();
  });

  it("does not route the old #loan hash any more", () => {
    // 旧 URL の互換は作らない(設計書 §3、利用者が本人のみのため)。
    // 不明ハッシュの既定どおり Scientific に倒れる——これは仕様である。
    window.location.hash = "#loan";
    render(<App />);
    expect(screen.getByTestId("scientific-panel")).toBeInTheDocument();
  });
```

**`data-testid` は `loan-panel` のまま**（内部名据え置き。`App.test.tsx` の
モックが `LoanPanel` を差し替えている）。

- [ ] **Step 2: 赤を確認する**

Run: `cd web && pnpm test --run src/ui/Nav src/App`
Expected: FAIL。3 種類の赤が出るはず——

1. `Finance` という名前のリンクが無い（`getByRole` が
   `Unable to find an accessible element`）。
2. `#finance` では `loan-panel` が出ない（不明ハッシュとして Scientific に
   倒れるため）。
3. **`does not route the old #loan hash` も赤**。現状の `App.tsx:11` は
   `#loan` を `loan` に倒すので `scientific-panel` は出ない。
   **ここが緑なら期待値の書き方が間違っている。**

`pnpm typecheck` はこの段では通らない（`current="finance"` が `ModuleId` に
無い）。**これは想定どおり**で、Step 3 で解消する。

- [ ] **Step 3: 実装を直す**

`web/src/ui/Nav/Nav.tsx`:

```tsx
export type ModuleId = "scientific" | "data-scale" | "finance";
```

```tsx
  { id: "finance", href: "#finance", label: "Finance" },
```

`web/src/App.tsx`:

```tsx
// 不明・空ハッシュは "scientific" に倒す(base-spec §6 のデフォルト規定)。
// 旧 #loan もここに落ちる——互換分岐は作らない(設計書 §3)。
function moduleFromHash(hash: string): ModuleId {
  if (hash === "#data-scale") return "data-scale";
  if (hash === "#finance") return "finance";
  return "scientific";
}
```

```tsx
        {module === "finance" && <LoanPanel />}
```

**`LoanPanel` の import 名は変えない**（内部名据え置き。`ModuleId` だけが例外で、
理由は「この型は URL の写しであってドメイン名ではない」——spec §5）。

- [ ] **Step 4: 緑を確認する**

Run: `cd web && pnpm test --run src/ui/Nav src/App`
Expected: PASS。

- [ ] **Step 5: コミット**

```bash
test "$(git branch --show-current)" = feature/finance-rename || exit 1
git add web/src/ui/Nav/Nav.tsx web/src/ui/Nav/Nav.test.tsx web/src/App.tsx web/src/App.test.tsx
git commit
```

メッセージの要点: タブとハッシュを Finance に。`ModuleId` は URL の写しなので
値も変える（内部名据え置きの明示的な例外）。旧 `#loan` は互換を作らず、
Scientific に倒れることを検査で固定した。

---

### Task 2: パネルの名前と E2E

**Files:**
- Modify: `web/src/ui/Loan/LoanPanel.tsx:405`
- Modify: `web/src/ui/Loan/LoanPanel.test.tsx:105`
- Modify: `web/tests/e2e/loan.spec.ts`（`nav` の型・`panel`・`#loan` の URL 検査・
  `nav(page, "Loan")` 10 箇所）
- Modify: `web/tests/e2e/loan-keypad.spec.ts:3,13`

**Interfaces:**
- Consumes: Task 1 の `#finance` ルーティング（E2E が `/#finance` へ goto するため）
- Produces: region 名 `金融計算`。以後この名前が E2E のセレクタになる。

- [ ] **Step 1: テストの期待値を先に変える**

`web/src/ui/Loan/LoanPanel.test.tsx`:

```tsx
      screen.getByRole("region", { name: "金融計算" }),
```

`web/tests/e2e/loan.spec.ts` の先頭:

```ts
const nav = (page: Page, label: "Scientific" | "Data Scale" | "Finance") =>
  page.getByRole("link", { name: label, exact: true });

const panel = (page: Page) => page.getByRole("region", { name: "金融計算" });
```

以下、`nav(page, "Loan")` → `nav(page, "Finance")`（10 箇所）、
`/#loan$/` → `/#finance$/`、`page.goto("/#loan")` → `/#finance`、
タブ列挙 `["Scientific", "Data Scale", "Loan"]` → `[..., "Finance"]`。

`web/tests/e2e/loan-keypad.spec.ts`:

```ts
const panel = (page: Page) => page.getByRole("region", { name: "金融計算" });
```

```ts
  await page.goto("/#finance");
```

**新規 E2E を `loan.spec.ts` に 1 本足す**（spec §5）:

```ts
test("the old #loan hash is no longer a route", async ({ page }) => {
  // 旧 URL の互換は作らない(設計書 §3、利用者が本人のみのため)。
  // 「効かなくなった」ではなく「そう決めた」と読めるよう仕様として固定する。
  // 第三者が使い始めたら互換分岐を足す——そのときは判断の誤りではなく
  // 状況の変化への対応である(設計書 §3)。
  await page.goto("/#loan");
  await expect(page.getByTestId("display-main")).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
});
```

- [ ] **Step 2: 赤を確認する**

Run: `cd web && pnpm test --run src/ui/Loan`
Expected: FAIL（region 名 `金融計算` が見つからない）。

E2E は Task 1 が入っているので `#finance` へは行けるが、region 名がまだ
`ローン計算` なので落ちる:

Run: `cd web && pnpm e2e tests/e2e/loan.spec.ts`
Expected: FAIL（`panel` が見つからない）。

- [ ] **Step 3: 実装を直す**

`web/src/ui/Loan/LoanPanel.tsx:405`:

```tsx
    <section className={styles.panel} aria-label="金融計算">
```

**これ 1 行だけ。** ファイル名・コンポーネント名・`data-testid`・
`styles.panel` は据え置き（内部名据え置きの原則）。

- [ ] **Step 4: 緑を確認する**

```bash
cd web && pnpm test --run src/ui/Loan
cd web && pnpm e2e tests/e2e/loan.spec.ts tests/e2e/loan-keypad.spec.ts
```
Expected: PASS。E2E は既存 + 新規 1 本。

- [ ] **Step 5: 新規 E2E の判別力を確かめる**

`App.tsx` に `if (hash === "#loan") return "finance";` を**一時的に足して**
`the old #loan hash is no longer a route` が赤になることを見る。
**赤にならなければ検査に判別力が無い**ので、その場で書き直す
（否定的結論を出す検査は、先に陽性を出せることを確かめてから信じる)。
確認したら足した行を戻す。

- [ ] **Step 6: コミット**

```bash
test "$(git branch --show-current)" = feature/finance-rename || exit 1
git add web/src/ui/Loan/LoanPanel.tsx web/src/ui/Loan/LoanPanel.test.tsx web/tests/e2e/loan.spec.ts web/tests/e2e/loan-keypad.spec.ts
git commit
```

---

### Task 3: base-spec の訂正印と仕上げ

**Files:**
- Modify: `docs/base-spec.md`（189 行付近・240 行付近）
- Test: web 段のフルスイープ + スクリーンショット

**Interfaces:**
- Consumes: Task 1・2 の成果
- Produces: なし（最終タスク）

- [ ] **Step 1: base-spec に訂正印を入れる**

189 行付近（モジュール木の `finance`）と 240 行付近（`Loan / Finance`）に、
**UI のタブが `Finance` であること**と**`finance` の枠が埋まる予定**であることを
1 行ずつ注記する。

**触ってはいけない場所**（spec §4）:
- **§20〜§22（Loan Calculator）** — ローンは Finance の中の 1 機能として残り、
  仕様も変わらない。
- **§50（Definition of Done）** — 「Loan Calculator動作」は達成済みの項目で、
  表示名が変わっても達成は取り消されない。書き換えると履歴が読めなくなる。

- [ ] **Step 2: 置換の取りこぼしを機械的に確かめる**

```bash
cd /home/terapyon/dev/CalcArc
grep -rn "ローン計算\|\"Loan\"\|#loan" web/src web/tests --include=*.ts --include=*.tsx
```

Expected: **残ってよいのは 2 種類だけ**——(1) 旧ハッシュを固定する検査の中の
`#loan`（`App.test.tsx` と `loan.spec.ts`）、(2) コメント内の説明。
それ以外が出たら置換漏れである。

- [ ] **Step 3: web 段のフルスイープ**

**先に 4173 を掴んでいる `vite preview` が居ないか確認する**
（`ss -ltn | grep 4173`）。

```bash
cd web && pnpm typecheck && pnpm lint && pnpm test && pnpm e2e
```

Expected: vitest 137（136 + 新規 1）、e2e 82（81 + 新規 1）。

`cargo` と `reference` は回さない。代わりに:

```bash
git diff --stat 5fb084f -- crates/ testdata/ reference/
```
Expected: **空**。

- [ ] **Step 4: 実機ビルドを撮って見る**

`pnpm build` → `pnpm preview` → Playwright で 390×844 のスクリーンショット。
**見るのは 3 タブが 1 行に収まっているか**（`Finance` は `Loan` より
3 文字長い。`Data Scale` が最長のままのはずだが、実測しないと分からない）。

撮ったら **preview を落とし、`ss -ltn | grep 4173` で解放を確かめる**。
`pkill -f "vite preview"` では落ちない（preview を張っているのは `node`
プロセス）。`fuser -k 4173/tcp` まで打つ。

- [ ] **Step 5: コミット**

```bash
test "$(git branch --show-current)" = feature/finance-rename || exit 1
git add docs/base-spec.md
git commit
```

---

# 完了条件（spec §8 の写し）

1. タブが `Finance`、region 名が `金融計算`、ハッシュが `#finance`。
2. 旧 `#loan` が Scientific に倒れることを固定した検査（vitest 1 + e2e 1）が緑。
   **互換分岐は無い。** 新規 E2E の判別力を Task 2 Step 5 で実測している。
3. `git diff --stat 5fb084f -- crates/ testdata/ reference/` が空。
4. web 段のフルスイープが緑（vitest 137 / e2e 82）。
5. 390×844 のスクリーンショットで 3 タブが 1 行に収まっていることを目視。
   4173 の解放を `ss` で確認。
6. base-spec の訂正印 2 か所。**§20〜§22 と §50 は無変更**（`git diff` で示す）。

# 進捗の見取り図

| タスク | 成果物 | 検証段 | spec |
|---|---|---|---|
| 1 | ルーティングとタブ（`ModuleId` の例外を含む） | vitest | §2/§3/§5 |
| 2 | region 名と E2E（旧ハッシュの固定 + 判別力の実測） | vitest + e2e | §3/§5 |
| 3 | base-spec の訂正印 + フルスイープ + 実機確認 | web 段全部 | §4/§6/§8 |

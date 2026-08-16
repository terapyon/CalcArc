# Loan → Finance 改名（F0）— 設計

日付: 2026-08-14（**裁定 2026-08-15**）
対象: 表示層のみ。タブ表記・パネルの region 名・ハッシュ・base-spec の訂正印。
前提: **L・D のマージを待たない。** D（`feature/data-scale-calculator-ui`）の
上に縦積みで始める——L が書き換えた `LoanPanel.tsx` と loan の E2E を土台に
するため、main から分岐すると衝突する（§7 Q3）。
**状態: ユーザー裁定済み（2026-08-15）。** §7 の 3 点は確定した。

## §0 位置づけ — なぜ改名するか

ユーザー発意で方向は確定している（「ローンを金融計算（英語表記）に変えたい。
ローンは含む。資産形成/複利を想定」）。**改名は将来の器を先に作る作業**である
——複利・積立（F1）が入るとき、そのタブが `Loan` では名前が嘘になる。

L には混ぜない（ユーザー確認済み）。L のブランチは電卓化という別の主題を
持っており、改名を同乗させると「盤面の変更」と「名前の変更」が同じ diff に
混ざってレビュー不能になる。

**base-spec は既に改名を予期している**: 240 行のプラットフォーム構成は
`Loan / Finance` と書かれ、189 行のモジュール木には `finance` が**名前だけ
空き枠として**存在する。F0 はこの空き枠に表示を合わせる作業であり、
仕様の変更ではない。

## §1 変えること・変えないこと

**変える（表示層のみ）**

| 対象 | 現在 | 変更後 |
|---|---|---|
| タブの表示ラベル | `Loan` | §7 Q1 で確定（推奨 `Finance`） |
| ハッシュ | `#loan` | §7 Q2 で確定（推奨 `#finance` + 旧 `#loan` リダイレクト） |
| パネルの region 名 | `ローン計算` | `金融計算` |
| base-spec | — | 訂正印（§4） |

**変えない（内部名）**

`web/src/loan/`、`web/src/ui/Loan/`、`crates/calcarc-core/src/loan/`、
`ModuleId` の `"loan"`、`LoanPanel`、`LoanKeyToken` ——**すべて据え置く**。

根拠は **`testdata/finance.json` の前例**である。M6 の時点で golden の
ファイル名は既に `finance.json` で、中の op は `loan_forward` / `loan_term` /
`loan_principal` だった。「外側は Finance、中身は loan」という共存は
このリポジトリで既に動いている形であり、F0 はそれを UI 側へ広げるだけである。

内部改名は**名前の嘘が生じてから**、API 整理（PR #19）と同じ方式で別 spec に
する。嘘が生じる条件は具体的に言える: **F1 が `loan` モジュールの中に
複利計算を置いたとき**。その時点で `calcarc_core::loan::compound` は嘘になる
ので、F1 の §7（モジュール構造）で `finance::{loan, compound}` への再配置を
判断する——F0 では判断しない。

## §2 タブ表記（Q1）

タブのラベルは `Scientific` / `Data Scale` と並ぶ。**推奨は `Finance`**:

- 短く、390px 幅の 3 タブに収まる（現在 `Data Scale` が最長で、`Finance` は
  それより短い。レイアウト検証は不要）。
- `Scientific` / `Data Scale` と語感が揃う（分野名の名詞）。
- `Financial` は形容詞で、単独のタブ名としては据わりが悪い。

タブは英語のまま（`Nav.tsx` のコメントが規律を持っている——「タブの表示
ラベルはモジュールの固有名詞なので英語のまま。アクセシブルネームは `<nav>`
側の `aria-label` で日本語にする」）。パネルの region 名は日本語なので
`ローン計算` → `金融計算` に変える。

## §3 URL（Q2）【裁定: `#finance` に変える。**リダイレクトは作らない**】

```ts
function moduleFromHash(hash: string): ModuleId {
  if (hash === "#data-scale") return "data-scale";
  if (hash === "#finance") return "finance";
  return "scientific";
}
```

**旧 `#loan` は受けない。** 不明なハッシュとして `scientific` に倒れる
（`web/src/App.tsx:9-13` の既存の規定）。

**リダイレクトを捨てた根拠（ユーザー裁定 2026-08-15）: 利用者がまだ本人
だけだから。** 検討時の懸念は「実機の PWA アイコンが `#loan` を指していると、
**開かないのではなく Scientific が開く**という静かな壊れ方をする」ことだった。
この懸念自体は正しいが、**被害を受けうる人が本人 1 人**なら、本人がアイコンを
貼り直せば済む。互換のコードを恒久的に抱える方が高い。

**この判断が変わる条件を書いておく**: 第三者が使い始めたら（公開告知・
リポジトリの公開・URL の共有）、`#loan` を指すブックマークが本人の手の
届かない所に生まれる。**その時点で互換分岐を足す**——ただしそのときは
「今いる利用者を壊さない」ためであって、本 spec の判断の誤りではない。

**【訂正 2026-08-16】** **この条件は 0.2.0 の公開告知で発火した。それでも
互換分岐は足していない**（[0.2.0 設計書 §2.1](2026-08-16-release-0-2-0-design.md)）。
条件が守ろうとしたのは「今いる利用者を壊さない」ことであって `#loan` という
綴りではなく、**守る対象の集合が空だった**ためである——`#loan` を指す
ブックマークを持てるのは改名（2026-08-15）より前にアプリへ到達した第三者
だけで、到達経路は「リポジトリ経由」と「本人が URL を渡す」の 2 つしかない。
前者は公開 URL がリポジトリに 1 度も書かれていないため成立せず、後者は
本人が否定した（2026-08-16）。**条件そのものは生かしてある**——今後 URL を
第三者へ渡す場面が来れば、また別の話になる。

## §4 base-spec の訂正印

- **240 行**（プラットフォーム構成の `Loan / Finance`）: 表記はそのままで
  よい。**UI のタブが `Finance` であることを 1 行注記**する。
- **189 行**（`finance` モジュール枠）: 空き枠が埋まる予定であることを注記。
  実際に `finance` モジュールを作るのは F1 の判断（§1 参照）。
- **§20〜§22（Loan Calculator）**: **触らない**。ローンは Finance の中の
  1 機能として残り、仕様も変わらない。
- **§50（Definition of Done）**: **触らない**。「Loan Calculator動作」は
  達成済みの項目で、表示名が変わっても達成は取り消されない。DoD を
  書き換えると「達成済み」の履歴が読めなくなる。

## §5 影響範囲（機械的置換の全量）

`Loan` / `loan` / `ローン計算` / `#loan` を含み、**表示層に属する**箇所のみ。

| ファイル | 変える箇所 |
|---|---|
| `web/src/ui/Nav/Nav.tsx` | `label: "Loan"`、`href: "#loan"`、`ModuleId` の `"loan"` |
| `web/src/App.tsx` | `moduleFromHash` の分岐（§3） |
| `web/src/ui/Loan/LoanPanel.tsx` | `aria-label="ローン計算"` |
| `web/src/ui/Nav/Nav.test.tsx` | タブ名の期待値 |
| `web/src/App.test.tsx` | `window.location.hash = "#loan"` とタブ名 |
| `web/src/ui/Loan/LoanPanel.test.tsx` | region 名 |
| `web/tests/e2e/loan.spec.ts` | `nav(page, "Loan")`、`panel` の region 名、`/#loan$/` |
| `web/tests/e2e/loan-keypad.spec.ts` | 同上（`page.goto("/#loan")` を含む） |

**`ModuleId` の値を `"loan"` から `"finance"` に変えるかは 1 つだけ迷う点**
——これは内部名だが、`Nav.tsx` と `App.tsx` の 2 ファイルに閉じており、
ハッシュ文字列と対応が付いていた方が読みやすい。**推奨は変える**（内部名
据え置きの原則の例外。理由: この型は URL の写しであって、ドメイン名では
ないため）。plan でこの 1 点を明示的に扱う。

**新規の E2E は無い**（Q2 の裁定でリダイレクトを作らないため）。ただし
**`#loan` が Scientific に倒れることは E2E で明示的に固定する**——「旧 URL は
もう効かない」は仕様であって事故ではない、と読める形にしておく:

```ts
test("the old #loan hash is no longer a route", async ({ page }) => {
  // 旧 URL の互換は作らない(設計書 §3、利用者が本人のみのため)。
  // 不明ハッシュの既定どおり Scientific に倒れる——これは仕様である。
  await page.goto("/#loan");
  await expect(page.getByTestId("display-main")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "金融計算" }),
  ).toHaveCount(0);
});
```

## §6 検証段（tiering、ci.yml 導出）

表示層のみなので **web 段だけ**:

```bash
cd web && pnpm typecheck && pnpm lint && pnpm test && pnpm e2e
```

- `cargo` 段は回さない（**`git diff --stat <分岐点> -- crates/ testdata/` が
  空であることを完了報告に書く**——これが「表示層のみ」の証明である）。
- `reference` 段は回さない。
- **スクリーンショット確認は必要**（タブの文字幅が変わる。390×844 で 3 タブが
  1 行に収まっていること）。撮ったら preview を落とし、`ss` で 4173 の解放を
  確かめる。

## §7 裁定（ユーザー、2026-08-15）

| | 論点 | 裁定 |
|---|---|---|
| Q1 | タブ表記 | **`Finance`**（§2） |
| Q2 | URL | **`#finance` に変える。リダイレクトは作らない**（§3） |
| Q3 | 時期 | **L・D のマージを待たない。D の上に縦積みで着手する** |

**Q3 について**: ドラフト時の推奨は「L・D 両方のマージ後」だったが、
ユーザーの裁定は**マージを待たずに始められる形**である。したがって

- 分岐元は **D の HEAD**（`feature/data-scale-calculator-ui`）。**main では
  ない**——`LoanPanel.tsx` と loan の E2E は L が全面的に書き換えており、
  main から分岐すると改名の差分がその書き換えと衝突する。
- PR の base は D のブランチ（縦積みの 4 段目。spec ドラフトの
  `docs/finance-expansion` を挟む場合は 5 段目）。
- マージ順は L → D → （spec）→ F0。**F0 が先に main へ入ることはない。**

## §8 完了条件

1. タブが `Finance`、region 名が `金融計算`、ハッシュが `#finance`。
2. 旧 `#loan` が Scientific に倒れることを固定した E2E（§5）が緑。
   **互換分岐は無い。**
3. `git diff --stat <分岐点> -- crates/ testdata/ reference/` が空。
4. web 段のフルスイープが緑（§6）。
5. 390×844 のスクリーンショットで 3 タブが 1 行に収まっていることを目視。
6. base-spec の訂正印 2 か所（§4）。§20〜§22 と §50 は無変更。

## §9 スコープ外

- 内部名（`loan` モジュール、`LoanPanel`、core の `loan`）の改名 → §1 の条件が
  満たされたとき、F1 の §7 で判断する。
- 複利・積立の機能追加 → F1（`2026-08-14-finance-compound-design.md`）。
- Finance タブ内のモード切替 UI → F1 の §10。F0 の時点ではローンしか無いので
  モードは不要である。

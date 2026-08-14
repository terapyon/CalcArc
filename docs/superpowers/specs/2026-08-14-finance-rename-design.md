# Loan → Finance 改名（F0）— 設計

日付: 2026-08-14
対象: 表示層のみ。タブ表記・パネルの region 名・ハッシュ・base-spec の訂正印。
前提: L（`feature/loan-calculator-ui`）と D（`feature/data-scale-calculator-ui`）が
main にマージされた後の main から始める。時期は §7 Q3 で確定する。
**状態: 未承認のドラフト。** 未裁定 3 点（§7）はユーザーの選択を待つ。

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

## §3 URL とリダイレクト（Q2）

**推奨: `#finance` に変え、旧 `#loan` を受理して `#finance` へ書き換える。**

PWA としてホーム画面に追加され、`#loan` を指すブックマークが既に実機に
存在しうる（ユーザーは 2026-08-13 に実機 DoD 確認を済ませている）。
リダイレクトが無いと、そのブックマークは Scientific に落ちる
——`moduleFromHash` は不明なハッシュを `scientific` に倒すからである
（`web/src/App.tsx:9-13`）。**壊れ方が静かなのが問題**で、「ブックマークが
効かない」ではなく「別の電卓が開く」という形で出る。

実装の形（F0 の plan で確定）:

```ts
// 旧 #loan は受け入れる。history を汚さないよう replaceState で書き換える
// ——戻るを押したときに #loan → #finance の往復に閉じ込めない。
function moduleFromHash(hash: string): ModuleId {
  if (hash === "#data-scale") return "data-scale";
  if (hash === "#finance" || hash === "#loan") return "finance";
  return "scientific";
}
```

`#loan` で入ってきたときに URL 自体を `#finance` へ揃えるかは plan の判断。
揃えるなら `replaceState`（`pushState` ではない——戻るの履歴に旧 URL を
残さない）。

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

**新規の E2E 1 本**（機械的置換ではないので見落としやすい）:

```ts
test("an old #loan bookmark still opens the finance panel", async ({ page }) => {
  // PWA のホーム画面アイコンが古い URL を指しうる。リダイレクトが無いと
  // Scientific に落ちる——「開かない」ではなく「別の電卓が開く」形で
  // 壊れるので、検査が無いと気付けない(設計書 §3)。
  await page.goto("/#loan");
  await expect(
    page.getByRole("region", { name: "金融計算" }),
  ).toBeVisible();
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

## §7 未裁定（ユーザーの選択待ち）

| | 論点 | 選択肢 | 推奨 |
|---|---|---|---|
| Q1 | タブ表記 | (a) `Finance` (b) `Financial` (c) その他 | **(a)**（§2） |
| Q2 | URL | (a) `#finance` + 旧 `#loan` リダイレクト (b) `#loan` のまま | **(a)**（§3） |
| Q3 | 時期 | (a) L マージ直後・D の前 (b) D の後 (c) **L・D 両方のマージ後** | **(c)** |

**Q3 の推奨が変わった経緯**: 当初の推奨は (a) だった（D の E2E を新 region 名で
書けるので二重書き換えを避けられる、という理由）。しかし **L と D は既に
両方とも実装完了で push 待ち**であり、D の E2E は `ローン計算` ではなく
`データスケール計算` を引くので、そもそも D は F0 の影響を受けない。
(a) を採ると L と D のあいだに改名ブランチを挟むことになり、**縦積みの
積み順が増えるだけで得が無い**。(c) なら main が一度平らになってから
小さな改名 1 本を積める。

## §8 完了条件

1. タブ・region 名・ハッシュが Q1/Q2 の裁定どおりに変わっている。
2. 旧 `#loan` の E2E（§5）が緑。
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

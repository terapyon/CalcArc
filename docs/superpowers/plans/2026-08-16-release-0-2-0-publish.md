# 0.2.0 第 2 部「公開物」 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 0.2.0 を公開ベータとして人に見せられる状態にする——README（日英）・Issue の窓口・OGP・CHANGELOG・古い記述の修正。

**Architecture:** アプリのコードには触れない。触るのは Markdown、`web/index.html` の `<head>`、`web/public/ogp.png`、`.github/` の 2 つ（Issue テンプレートと deploy のスモーク URL）だけである。計算・UI・テストの挙動は一切変わらない。

**Tech Stack:** Markdown / GitHub Issue Forms（YAML）/ GitHub Actions / PNG（1200×630）

設計書: [2026-08-16-release-0-2-0-design.md](../specs/2026-08-16-release-0-2-0-design.md) の **§11 以降**（§4〜§10 は第 1 部で実装済み）

**このブランチは第 1 部（`feature/release-0-2-0-ui`）の上に積む。** PR の base は
main ではなくそのブランチにする——base をブランチにする積み方なら、push で
rebase されて SHA が変わる事故が起きない（#45 → #47 の前例）。

## Global Constraints

- **公開 URL は `https://calc.terapyon.net/`。** `calcarc.pages.dev` は書かない
- **リポジトリは `https://github.com/terapyon/CalcArc`**
- **版数は `0.2.0`**
- **免責の全文は逐語で** `計算結果は無保証です。重要な判断の根拠にしないでください。`
- **手順書は直す。履歴文書は据え置く**（設計書 §11）。`docs/superpowers/{specs,plans}/` の
  過去の文書は**訂正印を足す以外に触らない**
- **設計書・base-spec の訂正は、元の記述を消さずに追記する**
- **コミットメッセージ末尾に** `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **`git push` と PR 作成は行わない。** ユーザーが行う
- **アプリのコードに触らない。** `web/src/` 配下は `index.html` を除いて変更しない
- テストは影響範囲で段付けする（`CONTRIBUTING.md`）。この計画はほぼ Markdown なので、
  各タスクでは `pnpm check:sw` / `pnpm check:version` / ビルドが通ることだけを見る。
  フルスイープは Task 9 で 1 回

## 第 1 部で確定した数字（このブランチで使う）

| | |
|---|---|
| `cargo test --workspace` | 301 件 |
| `wasm-pack test --headless --firefox` | 28 件 |
| `pnpm test`（vitest） | 159 件 |
| `pnpm e2e`（Playwright） | 122 件 |
| `uv run pytest` | 83 件 |
| golden 再生成の差分 | ゼロ |

スクリーンショットは `docs/images/{scientific,data-scale,finance}.png`（390×844）に
ある。**第 1 部で撮ったものをそのまま使う。**

## File Structure

| ファイル | 責務 | Task |
|---|---|---|
| `.github/workflows/deploy.yml` | スモークの向け先を実際の公開 URL にする | 1 |
| `docs/deploy.md` | 手順書の URL を直す | 1 |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | **新規。** 不具合の報告（日英併記） | 2 |
| `.github/ISSUE_TEMPLATE/question.yml` | **新規。** 質問・要望（日英併記） | 2 |
| `CHANGELOG.md` | **新規。** 0.2.0 の詳細と 0.1.0 の 1 段落 | 3 |
| `docs/definition-of-done.md` | 0.2.0 時点で作り直す | 4 |
| `web/index.html` | OGP と description のメタ | 5 |
| `web/public/ogp.png` | **新規。** 1200×630 | 5 |
| `README.md` | 全面書き直し（日本語） | 6 |
| `README.en.md` | **新規。** 英語版 | 7 |
| `CONTRIBUTING.md` | 外部からの参加の節を足す | 8 |
| `CLAUDE.md` | 版数の更新手順を「守ること」に足す | 8 |
| `docs/base-spec.md` | 訂正印（§46 の名称確定ほか） | 8 |

---

## Task 1: 公開 URL を実際のものにする

**Files:**
- Modify: `.github/workflows/deploy.yml`（`base=` の 3 箇所）
- Modify: `docs/deploy.md`（4 箇所）

**Interfaces:**
- Consumes: なし
- Produces: なし（以降のタスクは URL を `https://calc.terapyon.net/` と書く）

**背景:** 公開サイトは `https://calc.terapyon.net/` だが、**リポジトリのどこにも
書かれていない**。デプロイ後スモークは 3 箇所とも `calcarc.pages.dev` を叩いており、
**カスタムドメインだけが壊れても緑のまま**になる。

2026-08-16 に実測で安全を確認済み——両ドメインが同じビルドを配っており、
`calc.terapyon.net` も `_headers` を尊重している（`sw.js` に `no-cache`）。

- [ ] **Step 1: スモークの向け先を変える**

`.github/workflows/deploy.yml` の 3 箇所（`base="https://calcarc.pages.dev"`）を
すべて次に変える。

```yaml
          base="https://calc.terapyon.net"
```

**インデントを既存の行と厳密に揃えること。** ワークフローの yml は手元で完全には
検証できない。

- [ ] **Step 2: 変え忘れが無いことを確かめる**

```bash
grep -rn "calcarc.pages.dev" .github/
```

期待: **0 件**。

- [ ] **Step 3: 手順書の URL を直す**

`docs/deploy.md` の 4 箇所を直す。

| 行 | 変更前 | 変更後 |
|---|---|---|
| 3 | `main への push が calcarc.pages.dev に届くまでの経路` | `main への push が calc.terapyon.net に届くまでの経路` |
| 12 | `実 URL（calcarc.pages.dev）へ` | `実 URL（calc.terapyon.net）へ` |
| 30 | `https://calcarc.pages.dev` を開き | `https://calc.terapyon.net` を開き |

3 箇所を直したあと、**「仕組み要約」の節の末尾に 1 段落足す**:

```markdown
**スモークは公開 URL（`calc.terapyon.net`）を叩く。** Cloudflare Pages が持つ
`calcarc.pages.dev` ではない——利用者が見る URL を検査しないと、**カスタム
ドメイン側だけが壊れたときに緑のまま気づけない**。両方が同じビルドを配って
いることと、カスタムドメインでも `_headers` が効いていることは
2026-08-16 に実測で確認した。
```

- [ ] **Step 4: 履歴文書に触っていないことを確かめる**

```bash
git status --short
```

期待: 変更は `.github/workflows/deploy.yml` と `docs/deploy.md` の 2 つだけ。
**`docs/superpowers/` 配下が出てきたら間違い**——過去の設計書と計画書は履歴なので
据え置く（設計書 §11）。

- [ ] **Step 5: コミット**

```bash
git add .github/workflows/deploy.yml docs/deploy.md
git commit -m "$(cat <<'EOF'
Point the smoke at the URL people actually open

公開サイトは calc.terapyon.net だが、この URL はリポジトリのどこにも
書かれていなかった。デプロイ後スモークは 3 箇所とも pages.dev を叩いて
おり、カスタムドメインだけが壊れても緑のままになる。

両方が同じビルドを配っていること、カスタムドメインでも _headers が
効いていることは実測した。

手順書は直し、過去の設計書と計画書は据え置く。あれは履歴である。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Issue の窓口を作る

**Files:**
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/question.yml`

**Interfaces:**
- Consumes: なし
- Produces: Issue テンプレート 2 つ。Task 6 / 7 の README がこれを案内する

**背景:** 公開ベータの目的は反応を得ることで、その入口が Issue である。
`.github` にテンプレートは 1 つも無い。

**キー列を最初から聞くことに意味がある。** `crates/calcarc-core/tests/engine_table.rs`
がキー列と表示の対応表そのものなので、その形で報告が届けば**そのまま 1 行の
テストになる**。

**日英併記。** 1 つのフォームの中に両方書く——言語ごとにフォームを分けると
2 種 × 2 言語で 4 つになり、報告する人が最初に「どれを選ぶか」で迷う。

- [ ] **Step 1: 不具合の報告フォームを作る**

`.github/ISSUE_TEMPLATE/bug_report.yml`:

```yaml
name: 不具合の報告 / Bug report
description: 計算結果や画面の不具合を報告する / Report a wrong result or a broken screen
labels: ["bug"]
body:
  - type: markdown
    attributes:
      value: |
        ありがとうございます。**押したキーの順**を書いていただけると、そのまま 1 件のテストになります。
        Thank you. If you include **the keys you pressed, in order**, your report becomes a test case directly.

  - type: dropdown
    id: tab
    attributes:
      label: どのタブ / Which tab
      options:
        - Scientific
        - Data Scale
        - Finance
        - わからない / Not sure
    validations:
      required: true

  - type: textarea
    id: keys
    attributes:
      label: 押したキーの順 / Key sequence
      description: |
        押したキーを順に、左から書いてください。例: `3 + 4 =`
        List the keys you pressed in order, left to right. Example: `3 + 4 =`
      placeholder: "3 + 4 ="
    validations:
      required: true

  - type: textarea
    id: expected
    attributes:
      label: 期待した表示 / What you expected to see
      placeholder: "7"
    validations:
      required: true

  - type: textarea
    id: actual
    attributes:
      label: 実際の表示 / What you actually saw
      placeholder: "8"
    validations:
      required: true

  - type: input
    id: environment
    attributes:
      label: 端末とブラウザ / Device and browser
      description: |
        わかる範囲で構いません。ホーム画面から起動した場合はその旨も。
        Whatever you know is fine. Mention if you launched it from the home screen.
      placeholder: "iPhone 15 / Safari / ホーム画面から起動"
    validations:
      required: false

  - type: input
    id: version
    attributes:
      label: 版数 / Version
      description: |
        画面のいちばん下に出ています（例: CalcArc 0.2.0 @terapyon）。
        It is at the very bottom of the screen (e.g. CalcArc 0.2.0 @terapyon).
      placeholder: "0.2.0"
    validations:
      required: false
```

- [ ] **Step 2: 質問・要望のフォームを作る**

`.github/ISSUE_TEMPLATE/question.yml`:

```yaml
name: 質問・要望 / Question or request
description: 使い方の質問、機能の要望、仕様への疑問 / Ask how to use it, request a feature, question a decision
labels: ["question"]
body:
  - type: markdown
    attributes:
      value: |
        数値の扱いと丸めの規則は [docs/numerical-policy.md](../../docs/numerical-policy.md) にあります（日本語）。
        The numerical policy and rounding rules are in [docs/numerical-policy.md](../../docs/numerical-policy.md) (Japanese only).

  - type: textarea
    id: body
    attributes:
      label: 内容 / What is it
      description: |
        自由に書いてください。計算に関わる話なら、押したキーの順があると早いです。
        Write freely. If it involves a calculation, the keys you pressed will speed things up.
    validations:
      required: true
```

- [ ] **Step 3: YAML として妥当か確かめる**

```bash
python3 -c "import yaml,sys; [yaml.safe_load(open(p)) for p in sys.argv[1:]]; print('ok')" .github/ISSUE_TEMPLATE/bug_report.yml .github/ISSUE_TEMPLATE/question.yml
```

期待: `ok`。落ちたらインデントか引用符を直す。

**注意: GitHub の Issue Forms のスキーマ適合は手元では検証できない。** 実際に
効くのはマージ後である。**`type` / `id` / `attributes` / `validations` の綴りを
上のとおり正確に**書くこと。

- [ ] **Step 4: コミット**

```bash
git add .github/ISSUE_TEMPLATE/
git commit -m "$(cat <<'EOF'
Ask for the key sequence, in both languages

公開ベータの目的は反応を得ることで、その入口が Issue である。テンプレートは
1 つも無かった。

不具合の報告では、押したキーの順を最初に聞く。engine_table.rs がキー列と
表示の対応表そのものなので、その形で届けばそのまま 1 行のテストになる。
テンプレート無しで受けると、聞き直す往復が必ず発生する。

日英は 1 つのフォームの中に併記する。言語ごとに分けると 2 種 x 2 言語で
4 つになり、報告する人が最初にどれを選ぶかで迷う。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: CHANGELOG を作る

**Files:**
- Create: `CHANGELOG.md`

**Interfaces:**
- Consumes: なし
- Produces: `CHANGELOG.md`。Task 6 / 7 の README がここへリンクする

**背景:** **0.1.0 のタグは存在しない。** 遡って詳細を捏造せず、正直な形にする。
区切りは `docs/definition-of-done.md` が MVP 達成を記録した **2026-08-13** とする。

- [ ] **Step 1: 書く**

`CHANGELOG.md`:

```markdown
# 変更履歴

このファイルは利用者から見えた変更を記録する。開発の詳細は
[docs/superpowers/](docs/superpowers/) の設計書と計画書にある。

## 0.2.0 — 2026-08-16

最初の公開ベータ。

### Scientific

- **関数を実数に閉じた。** 実数の答が一意に決まらない入力（`sqrt(-4)`、`ln(0)`、
  `asin(2)` など）はエラーを返す。複素数は入力・四則・表示の機能として残る
- `1/x` `xʸ` `eˣ` `ln` `log` `asin` `acos` `atan` を追加した。`xʸ` は右結合
  （`2^3^2 = 512`）で、このエンジンで右結合はこれだけである
- **`n!` `nPr` `nCr` を追加した。** 非負整数の上でのみ定義する。優先順位は
  `× ÷` より先、`xʸ` より後で、左結合
- **60 進の入出力（`°'"`）を追加した。** 経過時間と角度の両方に使える。
  値は 10 進の実数のままで、**四則演算は 1 つも足していない**——`1:30 + 2:45` は
  `1.5 + 2.75` である。度分秒で入れた角度をそのまま `sin` に渡せる
- **ENG（工学表記）と 3 桁カンマを追加した**

### Finance

- **複利を追加した。** 一括預入と毎月積立を 1 つのモードで扱う。税（源泉分離
  課税）の有無を選べる
- **複利の逆算を追加した。** 目標額から必要な積立額、または必要な年数を求める。
  **手取りは期数について単調でない**ため、必要年数は二分探索ではなく前進で解く
- タブ名を Loan から **Finance** に変えた（ハッシュも `#finance`）。ローンは
  Finance の中の 1 機能になった
- **全項目で四則演算が打てる**ようになった

### 画面

- **表示エリアの高さを固定した。** 入力・確定で盤面が上下しなくなった
- **3 タブの高さを揃えた。** タブを切り替えても縦が動かない
- タブのラベルが 2 段になるのを直した
- Finance の 4 文字ラベル（「借入可能」など）がボタンから溢れるのを直した
- **`n!` `nPr` `nCr` の置き場所を `(` `)` `+/−` の第 2 面に移した。** 以前は
  数字 `7` `8` `9` の裏にあり、Shift 中に数字が打てなかった
- **版数・リポジトリへのリンク・免責を全タブの下部に出した**

### 開発

- 版数の出所を `web/package.json` に一本化し、`Cargo.toml` との一致を CI が検査する
- デプロイ後スモークの向け先を公開 URL（`calc.terapyon.net`）にした
- Issue テンプレート（不具合の報告 / 質問・要望）を追加した

## 0.1.0 — 2026-08-13

**タグは打っていない。** [base-spec §50](docs/base-spec.md) の Definition of Done
14 項目を満たした時点で、記録は
[docs/definition-of-done.md](docs/definition-of-done.md) にある。

Scientific（四則・複素数・極形式・角度）、Data Scale（要素数 × 次元 × データ型の
メモリ量）、Loan（元利均等の月額・借入可能額・返済期間の逆算・ボーナス併用）の
3 モジュールが動き、PWA としてインストールでき、オフラインで計算できる状態。
計算コアは Rust/WASM、期待値は Python の独立実装が生成している。
```

- [ ] **Step 2: リンクが壊れていないか確かめる**

```bash
ls docs/base-spec.md docs/definition-of-done.md docs/superpowers/
```

期待: 3 つとも存在する。

- [ ] **Step 3: コミット**

```bash
git add CHANGELOG.md
git commit -m "$(cat <<'EOF'
Write down what changed, without inventing what 0.1.0 was

0.1.0 のタグは存在しない。遡って詳細を捏造せず、「MVP が揃った時点、
タグは打っていない」と 1 段落だけ書く。区切りは definition-of-done.md が
MVP 達成を記録した 2026-08-13 とした。

0.2.0 は利用者から見えた変更を書く。開発の詳細は設計書と計画書にある
ので、ここには持ち込まない。

日本語のみにする。2 言語で保守すると、次のリリースから確実に片方が腐る。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Definition of Done を 0.2.0 で作り直す

**Files:**
- Modify: `docs/definition-of-done.md`（全面）

**Interfaces:**
- Consumes: 第 1 部のフルスイープの件数
- Produces: なし

**背景:** いまの表は 2026-08-13 の Loan 時点で、件数（Rust 185 / wasm 15 /
vitest 59 / E2E 41 / pytest 30）が全部古い。公開 URL も `calcarc.pages.dev` の
ままである。

**根拠は「実装」「テスト」「実機確認」の別を書く**という既存の規約を守る——
テストが緑であることと、実機で動いたことは別の主張である。

- [ ] **Step 1: 全面的に書き直す**

`docs/definition-of-done.md` を次の内容で置き換える。

```markdown
# Definition of Done — 0.2.0 の総点検

base-spec §50 の 14 項目に、根拠を 1 つずつ付ける。**根拠は「実装」「テスト」
「実機確認」の別を書く**——テストが緑であることと、実機で動いたことは別の
主張である。

日付: 2026-08-16（0.2.0 公開ベータ）
公開先: https://calc.terapyon.net/

| # | 項目 | 根拠 | 別 |
|---|---|---|---|
| 1 | Smartphone で利用可能 | ユーザー本人が iPhone / Safari で `calc.terapyon.net` を操作。E2E も 390×844 の viewport で 122 件緑 | 実機確認 + テスト |
| 2 | Tablet で利用可能 | シェル寸法規約（`--shell-max-width`、タッチ target 44px）を全パネルが使う。E2E がタッチ target を検査 | 実装 + テスト |
| 3 | Desktop で利用可能 | 同上（幅は `--shell-max-width` で頭打ち）。開発時のブラウザ確認 | 実装 |
| 4 | PWA としてインストール可能 | ユーザー本人が iPhone / Safari でホーム画面に追加し standalone 起動を確認（2026-08-13）。`pnpm check:sw` が manifest と precache を検査 | 実機確認 + テスト |
| 5 | Offline で基本計算可能 | ユーザー本人が機内モードで 3 モジュールすべての動作を確認（Scientific / Data Scale は 2026-08-13、Finance は 2026-08-16） | 実機確認 |
| 6 | Rust/WASM で計算 | 3 モジュールとも計算は `calcarc-core`。境界は `calcarc-wasm` の純関数で、`crates/calcarc-wasm/tests/web.rs` 28 件が実ブラウザで往復を確認 | 実装 + テスト |
| 7 | Scientific Calculator 動作 | `tests/engine_table.rs`（キー列と表示の仕様表）、`scientific.json` の言語間検証、E2E | テスト |
| 8 | Polar / Rectangular 変換動作 | `tests/roundtrip.rs`、`complex.json`、E2E の `▸∠` | テスト |
| 9 | Data Scale Calculator 動作 | `data_scale.json`、vitest、E2E | テスト |
| 10 | Loan Calculator 動作 | `finance.json`（完全一致）、コア単体、wasm、vitest、E2E。複利と逆算も同じ経路で検証 | テスト |
| 11 | Python Reference Validation あり | `reference/` の実装が `complex/scientific/data_scale/finance` の期待値を生成。再生成の byte 一致を CI が検査 | 実装 + テスト |
| 12 | CI ですべてのテストが成功 | `.github/workflows/ci.yml`。ローカルのフルスイープは下記のとおり全段緑（wasm 境界のみ Firefox。ローカルの Chrome と wasm-pack が持つ chromedriver が噛み合わないため。CI は自前の組を固定している） | テスト |
| 13 | README に Numerical Policy を説明 | `README.md` の Numerical Policy 節と `docs/numerical-policy.md` | 実装 |
| 14 | OSS License 明記 | `LICENSE`（Apache 2.0）と README の License 節 | 実装 |

## ローカルのフルスイープ（2026-08-16、ci.yml から導出）

| コマンド | 結果 |
|---|---|
| `cargo fmt --check` | 緑 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 緑 |
| `cargo test --workspace` | 301 件 緑 |
| `wasm-pack test --headless --firefox crates/calcarc-wasm` | 28 件 緑 |
| `pnpm typecheck` / `pnpm lint` | 緑 |
| `pnpm test`（vitest） | 159 件 緑 |
| `pnpm exec vite build` / `pnpm check:sw` / `pnpm check:version` | 緑 |
| `pnpm e2e`（Playwright） | 122 件 緑 |
| `uv run ruff check .` / `ruff format --check` | 緑 |
| `uv run pytest` | 83 件 緑 |
| `generate.py` ×2 | byte 一致、`uv.lock` 不変 |

## 0.2.0 で作った例外と、繰り越したもの

**タッチ標的の例外が 2 つある**（base-spec §43 の 44px を割る）。どちらも
理由を設計書に書いてある。

| 場所 | 高さ | 理由 |
|---|---|---|
| Scientific の関数列 | 34px | 誤爆しても DEL で戻せる（S1 設計書 §4） |
| フッタのリンク | 約 10px | 広げる縦が無い。押せなくても計算に影響しない（0.2.0 設計書 §5） |

**Finance のモード行と項目行は、0.2.0 で例外から外れた**（34px → 68px）。

**繰り越した表示の問題**（計算結果には影響しない。0.2.1 以降で直す）:

- **360px 幅で関数列のボタンが 8px 横に溢れる。** 0.2.0 より前からある。
  Android の多くが 360px なので踏む人が出る
- **`env(safe-area-inset-top)` を誰も吸っていない。** standalone 起動で Nav が
  ステータスバーに潜る可能性がある。実機確認が要る
- **更新のトーストがフッタに重なる。** 一過性
```

- [ ] **Step 2: 件数が第 1 部の実測と一致しているか確かめる**

`/home/terapyon/dev/CalcArc/.superpowers/sdd/2026-08-16-release-0-2-0-ui/task-9-report.md`
の件数表と突き合わせる。**食い違ったら、そこで止めて報告すること**——この表は
「実際に測った」という主張そのものなので、数字が違うと表全体の信用が落ちる。

- [ ] **Step 3: コミット**

```bash
git add docs/definition-of-done.md
git commit -m "$(cat <<'EOF'
Re-take the Definition of Done, with the numbers actually measured

表は 2026-08-13 の Loan 時点のままで、件数も公開 URL も古かった。0.2.0 の
実測で埋め直す。

「残っている確認」は消える。Loan をオフラインで動かす実機確認はユーザー
本人が済ませた。

代わりに、0.2.0 で作った例外と繰り越した表示の問題を書いた。44px を割る
のは関数列とフッタのリンクの 2 つで、Finance のモード行と項目行は今回
例外から外れた。360px の溢れと safe-area-inset-top は計算に影響しないので
0.2.1 以降に送る——送ったことを書いておかないと、忘れたのと区別が付かない。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: OGP を足す

**Files:**
- Modify: `web/index.html`
- Create: `web/public/ogp.png`（1200×630）

**Interfaces:**
- Consumes: なし
- Produces: `https://calc.terapyon.net/ogp.png`

**背景:** いまの `<head>` は `<title>CalcArc` だけである。X に URL を貼ると
**タイトルすら出ないカード**になる。貼る先は日本語圏なので文面は日本語。

- [ ] **Step 1: 画像を作る**

`web/public/icon.svg` を土台に、1200×630 の PNG を作る。中身は
**プロダクト名 + 一言 + アイコン**の単純な図でよい。

既存の `web/scripts/generate-icons.mjs` がアイコン生成の前例なので、**同じ流儀で
`web/scripts/generate-ogp.mjs` を作ってもよいし、SVG を書いて 1 回だけ変換しても
よい**。判断は実装者に任せる。**ただし生成物（`ogp.png`）は必ずコミットする**
——ビルド時に作る仕組みにすると、`check:sw` の precache 判定と噛み合わせる作業が
増える。

図に入れる文字（逐語）:

```
CalcArc
ブラウザで動く計算ツール群
Rust + WebAssembly / オフライン対応
```

- [ ] **Step 2: 寸法を確かめる**

```bash
python3 -c "
import struct
d = open('web/public/ogp.png','rb').read(33)
w, h = struct.unpack('>II', d[16:24])
print(w, h)
"
```

期待: `1200 630`。

- [ ] **Step 3: メタタグを足す**

`web/index.html` の `<head>` の `<link rel="icon" ...>` の直後に足す。

```html
    <meta
      name="description"
      content="ブラウザで動く計算ツール群。関数電卓・データ量計算・金融計算。計算は端末内で完結し、サーバへ送信しません。"
    />
    <!-- OGP。og:image は絶対 URL でないと多くのクローラが拾わない。 -->
    <meta property="og:type" content="website" />
    <meta property="og:title" content="CalcArc" />
    <meta
      property="og:description"
      content="ブラウザで動く計算ツール群。関数電卓・データ量計算・金融計算。計算は端末内で完結し、サーバへ送信しません。"
    />
    <meta property="og:url" content="https://calc.terapyon.net/" />
    <meta property="og:image" content="https://calc.terapyon.net/ogp.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="https://calc.terapyon.net/ogp.png" />
```

- [ ] **Step 4: precache に載っていないことを確かめる**

```bash
cd web && pnpm exec vite build && pnpm check:sw
```

期待: 緑。加えて、**`ogp.png` が precache に入っていないこと**を確かめる:

```bash
grep -c "ogp.png" web/dist/sw.js
```

期待: **0**。オフラインで要らないものをキャッシュに積む理由がない。

**1 以上だった場合は止めて報告すること。** `vite.config.ts` の
`globPatterns` は `{js,css,html,wasm,svg}` なので `.png` は入らないはずだが、
プラグインが manifest のアイコンを自動注入する経路があるため確認する。

- [ ] **Step 5: コミット**

```bash
git add web/index.html web/public/ogp.png web/scripts/
git commit -m "$(cat <<'EOF'
Give the link something to show when someone pastes it

head は title だけだった。X に URL を貼るとタイトルすら出ないカードに
なる。貼る先は日本語圏なので文面は日本語にした。

og:image は絶対 URL で書く。相対だと多くのクローラが拾わない。

画像はコミットする。ビルド時に作る仕組みにすると、precache の判定と
噛み合わせる作業が増える。precache に載っていないことは確認した——
オフラインで要らないものを積む理由がない。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: README を書き直す（日本語）

**Files:**
- Modify: `README.md`（全面）

**Interfaces:**
- Consumes: `CHANGELOG.md`（Task 3）、`docs/images/*.png`（第 1 部）
- Produces: `README.md`。Task 7 の英語版がこれを対にする

**背景:** いまの README は開発者向けの構成（構成表 → Numerical Policy → 開発）で、
**使う人が最初に欲しいもの（動くリンク・何ができるか）が無いか下にある**。
「現状」節は Loan Calculator のままで、複利・ENG・60 進・関数 9 つが書かれていない。

- [ ] **Step 1: 全面的に書き直す**

`README.md` を次の内容で置き換える。

````markdown
# CalcArc

**[English](README.en.md)**

ブラウザで動く計算ツール群。関数電卓・データ量計算・金融計算。
計算は端末内で完結し、サーバへ送信しない。

## ▶ 使ってみる

**https://calc.terapyon.net/**

インストールは不要。ホーム画面に追加すればアプリとして起動し、オフラインでも動く。

## 現在の版

**0.2.0（公開ベータ）** — 変更点は [CHANGELOG.md](CHANGELOG.md) に、
リリースごとの記録は [Releases](https://github.com/terapyon/CalcArc/releases) にある。

**公開ベータである。** 計算結果は無保証で、重要な判断の根拠にしないでほしい。
気づいたことは [Issue](https://github.com/terapyon/CalcArc/issues) で教えてもらえると助かる。

## 画面

| Scientific | Data Scale | Finance |
|---|---|---|
| ![Scientific](docs/images/scientific.png) | ![Data Scale](docs/images/data-scale.png) | ![Finance](docs/images/finance.png) |

## できること

### Scientific — 関数電卓

四則演算・括弧・符号反転に加えて、

- **複素数と極座標変換。** `3 + j4` を打って `5 ∠ 53.130102°` に変換できる
- `sqrt` `x²` `xʸ` `1/x` `eˣ` `ln` `log` と三角関数・逆三角関数。
  **関数は実数に閉じている**（実数の答が一意に決まらない入力はエラーを返す）
- `n!` `nPr` `nCr`（非負整数の上でのみ定義）
- **60 進の入出力**（`°'"`）。経過時間と角度の両方に使える。度分秒で入れた角度を
  そのまま `sin` に渡せる
- ENG（工学表記）、3 桁カンマ、Degree / Radian

### Data Scale — データ量の計算

要素数 × 次元 × データ型から、必要なメモリ量を 10 進（KB / MB / GB / TB）と
2 進（KiB / MiB / GiB / TiB）の両方で出す。ベクトル検索や機械学習の規模感を
掴むためのもの。

### Finance — 金融計算

- **ローン**（元利均等）— 月額、借入可能額、返済期間の逆算。残価・ボーナス併用に対応
- **複利** — 一括預入と毎月積立。税（源泉分離課税）の有無を選べる
- **複利の逆算** — 目標額から必要な積立額、または必要な年数

**実額の機関一致は目標にしていない。** 返す値は決定的な概算である（画面にも
免責を常設している）。

## 特徴

- **端末内で完結する。** 入力した数値を計算目的で外部へ送らない
- **PWA。** ホーム画面に追加でき、オフラインで動く
- **計算コアは Rust、ブラウザでは WebAssembly として動く**
- **Python の独立実装で検証している。** Rust のテストだけに頼らず、SymPy /
  mpmath / `decimal.Decimal` による別実装が生成した期待値と突き合わせる。
  同じアルゴリズムを両方に書くと同じバグが両方に入るので、**実装方法を変えている**

## 免責

**計算結果は無保証です。重要な判断の根拠にしないでください。**

このツールは Apache License 2.0 で提供され、同ライセンスの定めるとおり、
明示・黙示を問わずいかなる保証も伴わない。

## 質問・要望・不具合

**[Issue](https://github.com/terapyon/CalcArc/issues) へどうぞ。** 日本語でも英語でも構わない。

不具合の報告では、**押したキーの順**を書いてもらえると助かる（例: `3 + 4 =`）。
このプロジェクトはキー列と表示の対応表をテストとして持っているので、
**その形で届くとそのまま 1 件のテストになる**。テンプレートが聞くようになっている。

## Numerical Policy

数値の扱いは [docs/numerical-policy.md](docs/numerical-policy.md) に定める。要点は次のとおり。

- **モジュールごとに数値の扱いが違う。** Scientific は浮動小数点、Data Scale は
  厳密整数、Finance は決定的概算（着地の 1 回だけ丸める）
- すべての値を複素数として保持する。実数は虚部 0 の複素数である
- 表示は有効数字 10 桁、丸めは round-half-to-even
- **表示のための丸めを、保持している値に書き戻さない。** 極形式への切り替えは
  表示の変更であって計算ではないので、丸めた値が次の計算に入り込まない
- **計算コアは panic しない。** すべてのエラーは `Result` を通り、UI には
  戻り値として届く

## 開発

必要なもの: Rust (stable)、wasm-pack、Node.js + pnpm、uv。

```bash
# 計算コアのテスト
cargo test --workspace

# WASM 境界のテスト
wasm-pack test --headless --chrome crates/calcarc-wasm

# Web（新しいクローンでは先に pnpm wasm が要る）
cd web && pnpm install && pnpm wasm && pnpm dev

# 参照実装と期待値の再生成
cd reference && uv sync && uv run pytest
cd reference && uv run python scripts/generate.py
```

`crates/calcarc-core` の数値を変更したときは期待値の再生成が必要になる。
**再生成せずに `testdata/` を手で書き換えないこと。**

版数を上げるときは `Cargo.toml` と `web/package.json` の **2 箇所**を同じ値にし、
`README.md` の「現在の版」も直す。前 2 つの不一致は `pnpm check:version` が
検査する。

詳しくは [CONTRIBUTING.md](CONTRIBUTING.md) と
[docs/base-spec.md](docs/base-spec.md)（全体仕様）を参照。

## ライセンス

Apache License 2.0。[LICENSE](LICENSE) を参照。
````

- [ ] **Step 2: リンクが全部生きているか確かめる**

```bash
for f in README.en.md CHANGELOG.md LICENSE CONTRIBUTING.md \
         docs/numerical-policy.md docs/base-spec.md \
         docs/images/scientific.png docs/images/data-scale.png docs/images/finance.png; do
  [ -e "$f" ] && echo "ok   $f" || echo "MISS $f"
done
```

期待: **`README.en.md` 以外はすべて `ok`**。`README.en.md` は Task 7 で作るので
この時点では `MISS` でよい。

- [ ] **Step 3: コミット**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
Rewrite the README for the person who just arrived

GitHub の Top で上から読まれる前提に組み直す。これまでは開発者向けの
構成で、使う人が最初に欲しいもの——動くリンクと、何ができるか——が
無いか下にあった。公開 URL に至っては 1 度も書かれていなかった。

「現状」節は Loan Calculator のままで、複利・ENG・60 進・関数 9 つが
書かれていなかった。現状に合わせた。

現在の版と変更履歴を、動くリンクの直後に置く。「これは何か」の次に来る
問いが「いまどの段階か」で、公開ベータではとくにそうなる。

免責は全文を独立した節にした。画面のフッタは 390px の 1 行に収めるため
8px まで小さくしてあるので、読ませる場所はここである。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: README の英語版を作る

**Files:**
- Create: `README.en.md`

**Interfaces:**
- Consumes: `README.md`（Task 6）
- Produces: なし

**背景:** 日本語版の冒頭に `English` へのリンクを既に置いた（Task 6）。
**リンク先が無いと行き止まりになる。**

**docs/ 配下は日本語のまま**とし、**英語版にその旨を明記する**——
書いておかないと、リンクを踏んだ人が黙って行き止まりに当たる。

- [ ] **Step 1: 書く**

`README.en.md` を作る。**`README.md` と同じ節の並び**にし、忠実に英訳する。
次の 3 点は**逐語で**入れること。

1. 冒頭に日本語版へのリンク:

```markdown
# CalcArc

**[日本語](README.md)**
```

2. **ドキュメントが日本語のみであることの明記**（`Numerical Policy` の節と
   `Development` の節の両方から辿れる位置に、独立した注記として）:

```markdown
> **Note on language.** The detailed specifications under `docs/` — the numerical
> policy, the base specification, and the design documents — are written in
> Japanese only. Translating them is out of scope for 0.2.0. Issues and pull
> requests are welcome in either language.
```

3. 免責（`Disclaimer` の節）:

```markdown
## Disclaimer

**Results come with no warranty. Do not rely on them for decisions that matter.**

This tool is provided under the Apache License 2.0 and, as that license states,
without warranties or conditions of any kind, either express or implied.
```

**残りの節は `README.md` の内容を忠実に訳す。** 訳しにくい 3 つを次のとおりにする:

| 日本語 | 英語 |
|---|---|
| 公開ベータ | public beta |
| 決定的な概算 | a deterministic approximation |
| 実額の機関一致は目標にしていない | Matching the exact figures of any particular lender is not a goal |

スクリーンショットの表、`▶ Try it`（`https://calc.terapyon.net/`）、
Issue の案内（**押したキーの順 = the keys you pressed, in order**）、
開発手順のコマンド群は日本語版と同じものを載せる。

- [ ] **Step 2: 相互リンクが成立しているか確かめる**

```bash
grep -n "README.en.md" README.md && grep -n "README.md" README.en.md
```

期待: **両方ヒットする**（日本語版 → 英語版、英語版 → 日本語版）。

- [ ] **Step 3: コミット**

```bash
git add README.en.md
git commit -m "$(cat <<'EOF'
Add the English README, and say where English stops

日本語版の冒頭から English へ張ったので、リンク先が無いと行き止まりに
なる。

docs/ 配下は日本語のままにする。numerical-policy が 606 行、base-spec が
1358 行あり、訳すのは 0.2.0 の範囲を超える。**その旨を英語版に明記した**
——書いておかないと、リンクを踏んだ人が黙って行き止まりに当たる。

Issue と PR はどちらの言語でもよい、と書いた。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 残りの古い記述を直す

**Files:**
- Modify: `CONTRIBUTING.md`
- Modify: `CLAUDE.md`
- Modify: `docs/base-spec.md`

**Interfaces:**
- Consumes: なし
- Produces: なし

- [ ] **Step 1: `CONTRIBUTING.md` に外部からの参加の節を足す**

**既存の開発規約は正確なので触らない。** `## 原則` の**直後**に新しい節を挟む。

```markdown
## 参加のしかた

**入口は [Issue](https://github.com/terapyon/CalcArc/issues) である。** 質問・要望・
不具合の報告はそこへどうぞ。日本語でも英語でも構わない。

**不具合の報告では、押したキーの順を書いてほしい**（例: `3 + 4 =`）。
`crates/calcarc-core/tests/engine_table.rs` がキー列と表示の対応表そのものなので、
その形で届くとそのまま 1 件のテストになる。Issue テンプレートが聞くようになっている。

**Pull Request の前に Issue で相談してほしい。** このプロジェクトは
「計算仕様が明確であること」を機能の数より優先しており（上の原則）、実装より先に
仕様の判断が要ることが多い。先に書いてもらったコードを仕様の理由で断るのは、
書いた人にとってもこちらにとっても損である。

下の「守ってほしいこと」は、その判断の多くを既に文書にしたものである。
```

- [ ] **Step 2: `CLAUDE.md` に版数の更新手順を足す**

`## 守ること` の箇条書きの**末尾**に足す。

```markdown
- **版数を上げるときは 3 箇所を揃える。** `Cargo.toml`（workspace）、
  `web/package.json`、`README.md` の「現在の版」。前 2 つの不一致は
  `pnpm check:version` が検査する（README は自由文なので検査しない）。
  画面に出る版数は `web/package.json` からビルド時に埋まる。
```

- [ ] **Step 3: `docs/base-spec.md` に訂正印を足す**

**§46 Branding**（「正式名称はMVP実装後に決定してもよい」）の直後に足す。

```markdown
**【訂正 2026-08-16】** **正式名称は `CalcArc` に確定した。** リポジトリ名・
PWA の manifest（`name` / `short_name`）・画面のフッタ表記が同じ綴りで揃っている。
公開先は https://calc.terapyon.net/ である。
```

- [ ] **Step 4: 他に嘘になっている箇所が無いか grep で洗う**

```bash
grep -n "Loan Calculator\|calcarc.pages.dev\|仮称" docs/base-spec.md README.md CLAUDE.md CONTRIBUTING.md
```

見つかったものを 1 つずつ判断する。**判断の基準は次のとおり:**

- `docs/base-spec.md` の **§20〜§22（Loan Calculator）** と §1 の列挙は
  **触らない**——ローンは Finance の中の 1 機能として残り、仕様も変わっていない。
  §8 に既に訂正印がある
- **`calcarc.pages.dev` が残っていたら直す**（Task 1 で `.github/` と
  `docs/deploy.md` は済んでいる）。ただし `docs/superpowers/` 配下は履歴なので触らない
- **「仮称」が残っていたら §46 の訂正印から辿れるので触らない**

**判断に迷うものが出たら、そこで止めて報告すること。**

- [ ] **Step 5: コミット**

```bash
git add CONTRIBUTING.md CLAUDE.md docs/base-spec.md
git commit -m "$(cat <<'EOF'
Tell an outsider how to take part, and settle the project's name

CONTRIBUTING は開発規約としては充実していたが、「外の人がどう参加するか」
——入口はどこか、PR の前に何をしてほしいか——が書かれていなかった。
公開ベータで Issue を受けるなら、そこが要る。

PR の前に Issue で相談してほしい理由も書いた。このプロジェクトは実装より
先に仕様の判断が要ることが多く、書いてもらったコードを仕様の理由で断るのは
双方の損である。

版数の更新は 3 箇所になった。CLAUDE.md に書く。README は自由文なので検査
しない——形を縛ると次に書き換えたい人の邪魔になる。

base-spec §46 は「正式名称は MVP 実装後に決めてよい」で止まっていた。
CalcArc に確定している。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: フルスイープと最終確認

**Files:** なし（検査のみ）

**Interfaces:**
- Consumes: Task 1〜8
- Produces: PR に添える事実

- [ ] **Step 1: リンク切れが無いか確かめる**

```bash
grep -ohrE "\]\(([^)#]+)\)" README.md README.en.md CHANGELOG.md CONTRIBUTING.md CLAUDE.md \
  | sed -E 's/^\]\((.*)\)$/\1/' | grep -v "^http" | sort -u \
  | while read -r p; do [ -e "$p" ] && echo "ok   $p" || echo "MISS $p"; done
```

期待: **`MISS` が 0 件。**

- [ ] **Step 2: `calcarc.pages.dev` が手順書と設定から消えたことを確かめる**

```bash
grep -rn "calcarc.pages.dev" --include="*.md" --include="*.yml" . \
  | grep -v "docs/superpowers/" | grep -v node_modules
```

期待: **0 件**（`docs/superpowers/` 配下の履歴文書には残っていてよい）。

- [ ] **Step 3: Web のビルドと自前検査**

```bash
cd web && pnpm typecheck && pnpm lint && pnpm test \
  && pnpm exec vite build && pnpm check:sw && pnpm check:version
```

期待: すべて緑。**vitest は 159 件**（このブランチはテストを増やしていない）。

- [ ] **Step 4: 残りの段**

```bash
cd /home/terapyon/dev/CalcArc
cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
wasm-pack test --headless --firefox crates/calcarc-wasm
cd web && pnpm e2e
cd ../reference && uv run --no-config ruff check . && uv run --no-config ruff format --check . && uv run --no-config pytest
```

期待: Rust 301 / wasm 28 / E2E 122 / pytest 83、すべて緑。

**`pnpm e2e` を回す前に 4179 を握っている古い preview が居ないか確認すること**
（`lsof -ti:4179`）。居たら落とす。**4173 は別プロジェクトなので触らない。**

- [ ] **Step 5: golden の再生成で差分が出ないことを確かめる**

```bash
cd reference && uv run --no-config python scripts/generate.py && cd .. && git status --short testdata/
```

期待: **`testdata/` に変更なし**。このブランチは計算に触れていないので当然だが、
確認する。

- [ ] **Step 6: ユーザーに渡すものをまとめる**

report に次を書く。**ユーザーが push と PR 作成を行う**ので、そのまま使える形にする。

1. ブランチ名（`feature/release-0-2-0-publish`）と**積んだコミット数**
2. **PR の base は `feature/release-0-2-0-ui`**（main ではない）
3. フルスイープの結果（5 段の件数）
4. **ユーザーが GitHub 側で行う設定**（設計書 §18）:
   - タグ `v0.2.0` を main に打つ（**第 1 部・第 2 部の両方がマージされてから**）
   - GitHub Release を作る。ノートは `CHANGELOG.md` の 0.2.0 節
   - リポジトリの description を、何ができるか分かる 1 行に
   - homepage に `https://calc.terapyon.net/` を設定（**現在未設定**）
   - topics: `calculator` `rust` `webassembly` `pwa` `react` `typescript` `offline-first`
5. **マージ後に実機で確かめてほしいこと**:
   - X に URL を貼ってカードが出るか（OGP は実際に配られるまで確かめられない）
   - Issue テンプレートが出るか（Issue Forms のスキーマ適合は手元で検証できない）
   - デプロイ後スモークが緑か（向け先を変えたので、初回は必ず見る）
   - **360px 幅の Android で関数列が溢れるか**（0.2.1 送りの既知の問題）
   - **standalone 起動で Nav がステータスバーに潜らないか**（`safe-area-inset-top`）

---

## この計画の外にあるもの

- **状態の永続化**（base-spec §40）。0.3.0 以降
- **`docs/` 配下の英訳**
- **360px の関数列の溢れ**と **`safe-area-inset-top`** と **更新トーストの重なり**。
  いずれも計算結果に影響しないので **0.2.1 送り**（ユーザー裁定 2026-08-16）
- **Issue #4 の残り**（`is_tan_pole` の複素数引数の仕様化）

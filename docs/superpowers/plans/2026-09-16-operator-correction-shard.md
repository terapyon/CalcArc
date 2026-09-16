# 0.9.2 検査側 PR C——演算子の押し直しのシャード（実装計画）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 外部監査 F1（演算子の押し直し）の修正を、重量級のコーパスで見張る。

**Architecture:** 押し直しのキー列を持つ 21 枚目のシャードを作る。期待値は、公開の優先順位で組んだ式の木を mpmath で独立に評価して出す。赤の確認は修正前のエンジンで取り、検出力の変異で見張りを固定する。

**Tech Stack:** Python（`reference/`、mpmath、uv）・Rust（`calcarc-core` の統合テスト）・TypeScript（`heavy/`、Playwright の corpus 設定・vitest）

**Spec:** `docs/superpowers/specs/2026-09-12-calc-fixes-verification-design.md` の §3（押し直しのシャード）と §3.10（F5）。§6.2 の文も直す。起点は calcarc-3d の枝 A（`fix/engine-correction`）の最終の先端。

## Global Constraints

- **期待値はエンジンの移植にしない**（設計書 §0-1）。読むのは `docs/base-spec.md`:333-343 と
  `docs/numerical-policy.md`:673 の公開の約束だけである——**`+ −` = 1 / `× ÷` = 2 は
  numerical-policy.md、`nPr nCr` = 3 と `xʸ` = 4・右結合は base-spec.md**（base-spec:333-343 は
  `× ÷` が `+ −` より先とは述べていない。2026-09-16 の全枝レビュー I-1）。
  - 優先順位は低い順に `+ −` < `× ÷` < `nPr nCr` < `xʸ`。
  - **`xʸ` だけが右結合**で、ほかは左結合。
  - `engine/mod.rs` は、変異の文字列を書くとき以外は読まない。
- **公開関数の docstring に `独立: 別手順／不可能／一部／未確認` を 1 行書く**（CLAUDE.md）。
- **許容はテストコードに書かない。** シャードの `tolerance` は、既存の値シャードと同じ出どころ（5e-10）から取る。
- **検査は比べた件数に下限を置き、壊して赤くなるのを見てから緑にする。**
  - 赤の確かめの戻しは、再編集か再生成で行う。
  - ファイル単位の `git checkout`・`stash` は使わない。
- `uv` は `--no-config` を付ける（`run` も）。
- **重い段**（`pnpm heavy`・`pnpm wasm`・`heavy:power`・`wasm-pack test`・E2E）は、回す前に監視役 calcarc-e3 に知らせる。**`heavy:ui` はこの機で全走しない**（segfault）。確かめるのは `playwright test --list` と型検査まで。
- 共有ワークツリー `/home/terapyon/dev/CalcArc` には触らない。`git push` と PR は利用者の手番。
- コミットの末尾は次の 2 行:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NbSckxyibTw2mVbKW34pYp
  ```
- **マージの条件**（PR の説明に書く）:
  - **マージの前に、PR C の先端で CI の Heavy corpus を手動で回す**（門 3 と同じ受け入れ条件）。
  - 枝 A と PR C は続けてマージし、その間にタグを打たない。

## 計画を書く段の裁定（設計書との関係）

- **R1** 設計書 §3.2 は「木を作ってから平坦にする」と書く。これを「平坦な列（項と演算子の鎖。項は葉か括弧の中の鎖）を作り、公開の優先順位で木に組む」とする。
  - 出てくる木は同じ `Num`/`Bin` の木で、評価は既存の `evaluate()`。
  - 組み方は、公開の表からの優先順位の登り（再帰）である。エンジンの演算子スタックの畳み込みとは別の手順になる。
  - 誤ると期待値がずれるが、アンカーの 4 例（Task 1）で赤くなる。
- **R2**「訂正前の読み」は、正しい演算子を、**最初に押した誤りの演算子**の優先順位と結合の向きで読んだ木とする。
  - 修正前のエンジンは、最初の誤りの押下で畳み込みを決めていたからである。
  - 監査の 3 例と `2 + 3 + × 4`（20）が合う。
- **R3** 訂正前の読みの評価が `OutOfShard` を投げたら、「読みが違う」として `discriminating` に入れる。
- **R4** `entry-000033` はキー列を変える: `1 2 neg 3` → **`1 2 neg add 3 eq`、表示 `-9`**。
  - heavy:ui は `.click()` で押す。拒まれたキーは `Key.tsx:90` で本物の `disabled` になるので、元の列は盤面で打てない。
  - 拒否そのものは `engine_table.rs`:1200 `refused_after(&["1","2","neg"], "3")` と 3d の E2E が見張る。
  - id と並び順は保つ（`corpus_entry.py` の「並びを変えない」）。
- **R5** 番人は「コミット済みの全コーパスのキー列に、製品の `engine::refuses` が拒む押下が 0」。
  - 製品の定義を import する（calcarc-1e の注記）。
  - `cargo test` に置くので、毎回の PR の CI で走る。重量級は手動でしか走らない。
- **R6** 新しいシャードは `levels` を持たない。
  - `test_corpus_science.py` は `NINE_SHARDS` だけを見る。heavy は `levels` を読まない。
  - 新しいシャードは `SCIENCE_SHARDS` に入れない（§3.7）。
- **R7** 検出力の変異は `match state.replace_base.take() {` → `match None::<ReplaceBase> {`。
  - `Some(base)` の枝に届かなくなり、`None` の枝（演算子の末尾の差し替え＝修正前の挙動）だけが走る。
- **R8** §3.8 の赤の確認は、使い捨ての作業木で取る。
  - 作業木は main の `eb94e72`（修正前のエンジン）。そこに PR C の `reference/`・`corpus/`・`heavy/` だけを載せる。

---

### Task 0: 枝 A の最終の先端へ積み直す（コードに入る前に 1 度）

**Files:** なし（git の操作だけ）

- [ ] 3d の知らせた先端 `<A_TIP>` を、次の手順で当てる。
  1. `git -C wt-092c log --oneline -1 <A_TIP>` で先端を確かめる。
  2. `git -C wt-092c rebase <A_TIP>` で積み直す（この時点で PR C の上は計画のコミットだけ）。
- [ ] 当て直す:
  - `grep -c "match state.replace_base.take() {" crates/calcarc-core/src/engine/mod.rs` が **1** であること。
  - `engine_table.rs` に `refused_after(&["1", "2", "neg"], "3")` があること。
  - 違えば止めて報告する。

### Task 1: 公開の優先順位で鎖を木に組む（独立の評価の土台）

**Files:**
- Create: `reference/src/calcarc_reference/corpus_opcorr.py`
- Test: `reference/tests/test_corpus_opcorr.py`

**Interfaces:**
- Produces:
  - `LEVEL: dict[str, int]`: `{"+":1,"-":1,"*":2,"/":2,"nPr":3,"nCr":3,"^":4}`
  - `RIGHT_ASSOCIATIVE = frozenset({"^"})`
  - `Chain = tuple[Term, ...]` と `ops: tuple[str, ...]`。項は `int` か、括弧の中の `Group(terms, ops)`。
  - `build_tree(terms, ops, override: dict[int, str] | None = None) -> Node`。`override` は「位置 i の演算子を、この演算子の段と結合で読む」。
  - `chain_keys(terms, ops) -> list[str]`（括弧は `Group` の所だけ）

- [ ] **Step 1: 失敗するテストを書く。** アンカー:
  - `8 − 3 × + 2` は、正しい読み（`+`）で 7、訂正前の読み（位置 1 を `*` の段で）で 3。
  - `3 − 3 ÷ − 3` は、正しい読み −3（左結合）、訂正前の読み 3。
  - `8 ÷ 2 xʸ × 2` は、正しい読み 8、訂正前の読み（`^` の段・右結合）で 2。
  - `2 + 3 + × 4` は、正しい読み 14、訂正前の読み（位置 1 を `+` の段で）で 20。
  - 結合: `2 ^ 3 ^ 2` = 512、`8 − 3 − 2` = 3、`12 ÷ 3 ÷ 2` = 2、`5 nPr 2 nCr 2` = 190（左結合）。
  - 混在: `2 + 3 × 4` = 14、`2 × 3 ^ 2` = 18、`2 × 5 nCr 2` = 20、`(2 + 3) × 4` = 20（`Group`）。
  - 値は `evaluate(build_tree(...))`（既存の `corpus_eval.evaluate`）で比べる。
- [ ] **Step 2:** `cd reference && uv run --no-config pytest tests/test_corpus_opcorr.py -q` が FAIL（モジュールが無い）。
- [ ] **Step 3: 実装する。** 優先順位の登りを再帰で書く。
  - `override` の位置では、その演算子の段と結合の向きを使う。演算は元の演算子のまま。
  - docstring に `独立: 別手順（公開の表からの優先順位の登り。エンジンの演算子スタックの畳み込みとは別）` を書く。
- [ ] **Step 4:** 同じコマンドで PASS。`uv run --no-config ruff check && uv run --no-config ruff format --check && uv run --no-config mypy`。
- [ ] **Step 5:** 赤の確認。`xʸ` を左結合にすると 512 のテストが FAIL する。再編集で戻す。
- [ ] **Step 6:** コミット `Build a key chain into a tree by the documented precedence, independently of the engine`

### Task 2: 押し直しのシャードを生成する（21 枚目）

**Files:**
- Modify: `reference/scripts/generate_corpus.py`（`build_operator_correction_shard` と `_shards` の最後の 1 行）
- Test: `reference/tests/test_generate_corpus.py`（`len(written) == 20` → 21、新しいテスト）
- Create: `corpus/generated/operator-correction-000.json`（生成物）

**Interfaces:**
- Consumes: Task 1 の `build_tree`・`chain_keys`・`LEVEL`。既存の `_within_range`・`OutOfShard`・`evaluate`・`BINARY_KEYS`。
- Produces: `build_operator_correction_shard(seed: int, count: int) -> dict`。`_shards` は `yield "operator-correction-000.json", build_operator_correction_shard(seed=20260916, count=count)` を**最後に**足す（ほかのシャードのバイトを動かさない）。

**ケースの形**（`build_assoc_shard` と同じ骨格。`levels` は持たない——R6）:
```json
{"kind": "value", "id": "opc-000000", "stratum": "discriminating" | "same-level" | "control",
 "mode": "Deg", "keys": [...], "expr": "...", "expect": {"re": ..., "im": 0.0},
 "correction": {"at": 5, "wrong": ["mul"], "pending": "add-sub" | "mul-div" | "comb" | "pow" | "none",
                "wrong_level": "...", "right_level": "...", "context": "flat" | "paren" | "after-close",
                "depth": 1, "count": 1, "commits": true}}
```
- `correction.at` は `keys` の中の正しい演算子の位置。`wrong` は、その直前に差し込んだ誤りの演算子の列。
- `pending` は、同じ括弧の深さで左隣にある演算子の段（無ければ `none`）。
- `commits` は、最初の誤りの段が `pending` の段以下（左結合の意味で畳まれる）かどうか。
- `depth` は、組んだ木で、選んだ位置の左の被演算子を右の枝に持つ祖先の演算子の数。
- `control` のケースは、対になる訂正ケースと同じ正しい列から誤りを除いたもの。`correction` は持たない。

**作り方**（設計書 §3.2〜§3.6）:
- 葉は 1〜99。`xʸ` の底は 2〜9、指数は 2〜3。`nPr`/`nCr` の `n` は 4〜20、`r` は 2〜4。
  - 組んだ木で、`^`・`nPr`・`nCr` の子が葉でない候補は捨てる（F4 を踏まない、§3.5）。
- 全部の部分木を `_within_range` に通す。`OutOfShard` は捨てる。
- 誤りは 1〜3 個。どれも正しい演算子と違い、隣どうしも違う。
- 誤りと正しいが同じ段なら `same-level`（ふるいなし）。違う段なら、訂正前の読み（R2・R3）との相対差が `ASSOC_MIN_RELATIVE_GAP`（1e-3）以上のものだけを `discriminating` に入れ、残りは捨てる。
- **格子**: 段の 3 つ組（保留 5 × 誤り 4 × 正しい 4 = 80）× 文脈 3 × 回数 {1, 2} = 480 セル。
  - **【訂正 2026-09-16】格子は 480 ではなく 348 セル（除外 132）。** 80 組のうち 22 組（3 つ組の水準）は
    案件を作れない（72 セルは組合せの被演算子が葉だけという規則、60 セルは訂正前・訂正後の読みが
    同じ木にしかならない構造上の理由）。除外は `opcorr_reachable_triples()` / `opcorr_cells()` が
    上の 2 つの規則から計算し、両方向で assert する。設計書 §3.3 の同日訂正と台帳の裁定 E を見よ
    （`docs/superpowers/sdd/2026-09-12-calc-fixes-verification.md`:794、2026-09-16 の全枝レビュー I-2）。
  - どのセルにも 1 件以上。先に狙って埋め、残りを乱択で埋める。
  - 1 セルでも空なら `AssertionError`（生成器が落ちる）。
  - 深さ {1, 2, 3} と回数 3 も、それぞれ 1 件以上ある。
- 件数は、訂正 1,000 件と対照 1,000 件で計 2,000 件。

- [ ] **Step 1: 失敗するテストを書く**（`test_generate_corpus.py`）:
  - 件数（1,000 と 1,000）。
  - **348 セル**（除外 132）の充足を、シャードを読み直して数える。
  - 対照の `expect` は、対の訂正ケースと同じ。
  - 対照の `keys` に二項演算子の隣接が無い。
  - 訂正ケースの `keys` は、`correction.at` の直前に `wrong` がちょうど並ぶ。
  - `discriminating` は相対差 ≥ 1e-3 を満たす（テストの中で `build_tree` を再計算して確かめる）。
  - `same-level` は同じ段だけ。
  - `^`・`nPr`・`nCr` の子は葉だけ。
  - `len(written) == 21`。
- [ ] **Step 2:** FAIL を見る。
- [ ] **Step 3: 実装して生成する。** `cd reference && uv run --no-config python scripts/generate_corpus.py`。
  - `git status --porcelain corpus/` は、新しいファイル 1 本だけ。**ほかのシャードは 1 バイトも動かない。**
- [ ] **Step 4:** `uv run --no-config pytest -q`（全体）・ruff 2 つ・mypy が緑。
  - `test_corpus_reproducibility.py` も緑（コミットする JSON が生成の出力と一致）。
- [ ] **Step 5:** 赤の確認。格子の充足の assert から 1 セルを抜いた生成が落ちることを確かめる（テストか、生成器の assert の反転で）。戻しは再編集。
- [ ] **Step 6:** コミット `Add the operator-correction shard: corrected presses against an independent reading`

### Task 3: entry-000033 と、拒まれる押下の番人

**Files:**
- Modify: `reference/src/calcarc_reference/corpus_entry.py`（`sign_toggle_cases` の 1 件）
- Create: `crates/calcarc-core/tests/corpus_refused_presses.rs`
- Modify（生成物）: `corpus/generated/entry-000.json`

- [ ] **Step 1: 番人を先に書く（赤）。** `corpus_refused_presses.rs` を作る。中身は次のとおり:
  - `corpus/generated/*.json` の全ケースの `keys`・`left`・`right` を、`EngineState::initial()` から `engine::reduce` で畳む。
  - 各押下の前に `engine::refuses(&state, key)` を見る。
  - 拒まれた押下を `id:位置:トークン` で集め、**空であること**を assert する。
  - 下限: 畳んだ列の数が 33,391 以上（新しいシャードの後は増える）。未知のトークンは 0 件。
  - `serde_json` は dev-dependency にある。読み方は `loan_boundary_golden.rs` の `CARGO_MANIFEST_DIR/../..` に倣う。
  - この時点で `entry-000033:3:3` の 1 件で FAIL することを見る（R5）。
- [ ] **Step 2:** `corpus_entry.py` の `["1", "2", "neg", "3"]` → `"3"` を、`["1", "2", "neg", "add", "3", "eq"]` → `"-9"` に変える。
  - 説明: 「+/- の答えは手元の値で、次の演算の左の被演算子になる（直後の数字は拒まれる——0.9.2 F5、`engine_table.rs` の `refused_after`）」。
  - 再生成する。`git status --porcelain corpus/` は `entry-000.json` だけ。差分は `entry-000033` の 1 件だけ。
- [ ] **Step 3:** `cargo test -p calcarc-core --test corpus_refused_presses` が PASS。
  - `cargo fmt --all` と `cargo clippy --workspace --all-targets -- -D warnings`。
  - reference の pytest（entry の検査を含む）が緑。
- [ ] **Step 4:** 赤の確認は Step 1 の FAIL で済んでいる（戻す前の列で赤）。
- [ ] **Step 5:** コミット `Retype entry-000033 so every key can be pressed, and guard the whole corpus against refused presses`

### Task 4: 重量級に登録する

**Files:**
- Modify: `heavy/tests/corpus/report.ts`（`areaOfShard` の scientific の接頭辞に `operator-correction` を足す）
- Modify: `heavy/scripts/detection-power.mjs`（`ALL_SHARDS` に `"operator-correction-000.json (values)"`）
- Modify: `heavy/tests/unit/detection-power.test.ts`（`toHaveLength(20)` と `size).toBe(20)` → 21）

- [ ] **Step 1:** 登録の前に `cd heavy && pnpm test` を回し、`ALL_SHARDS` の長さが赤いことを見る（コーパスに 21 枚目がある）。
  - `areaOfShard` の単体テストが無ければ、`operator-correction-000.json` → `scientific` のテストを 1 本足して赤を見る。
- [ ] **Step 2:** 3 か所を直す。`pnpm test && pnpm typecheck && pnpm lint`（`&&` だけ）。
- [ ] **Step 3（重い段・監視役に知らせる）:** `ss -ltnp | grep -E ':(4180|4181)\b'` が空。`pnpm heavy` が全件緑。通過数を報告に写す。
- [ ] **Step 4:** `pnpm exec playwright test --config playwright.ui.config.ts --list` で、heavy:ui が新しいシャードを読み込むことを確かめる。盤面は開かない。
- [ ] **Step 5:** コミット `Register the operator-correction shard with the heavy report and detection power`

### Task 5: 修正前のエンジンで赤くなることを測る（§3.8、controller が回す）

**Files:**
- Modify: 設計書 §3.8（日付つきの実測）

- [ ] 使い捨ての作業木を `eb94e72` に作る（切り離し）。
  - `git checkout heavy/operator-correction -- reference corpus heavy`（PR C の非 Rust 部分だけを載せる）。
  - `web`・`heavy` の `pnpm install --frozen-lockfile`。
- [ ] **重い段・監視役に知らせる:** `pnpm heavy`。
  - 新しいシャードの要約（`.heavy-summaries/operator-correction-000.json*`）から、層ごとの不一致を数える。
  - **止める条件**: `same-level` か `control` に 1 件でも赤があれば止めて報告する（今回の失敗の形の外の欠陥）。
  - 期待: `discriminating` が赤、`control` と `same-level` は 0。数は実測で書く。
  - `entry-000033` の新しい列は、修正前でも `-9` で緑のはず（`neg` の後の演算子は拒まれない）。
- [ ] 作業木を除く。
- [ ] 設計書 §3.8 に日付つきで書き戻す（層ごとの件数、走らせた先端）。PR C の枝にコミット `Record that the new shard is red on the engine before the fix`。

### Task 6: 検出力の変異（§3.8、`heavy:power` は約 11 分・監視役と調整）

**Files:**
- Modify: `heavy/scripts/detection-power.mjs`（`MUTATIONS` に 1 件、既存の `expectShards` を実測で直す）
- Modify: `docs/corpus-measurements.md`（日付つきの節）

- [ ] 新しい変異を足す:
  ```js
  {
    id: "operator-correction-revert",
    what: "演算子の押し直しを、演算子スタックの末尾の差し替えに戻す（修正前の F1）",
    file: "crates/calcarc-core/src/engine/mod.rs",
    from: "match state.replace_base.take() {",
    to: "match None::<ReplaceBase> {",
    expectShards: [/* heavy:power の実測で入れる */],
    minRate: {/* 実測の率を 1/1000 で切り捨て */},
  },
  ```
  - `from` が 1 回だけ現れることを `grep -c` で確かめる。
  - 変異を当てた状態で `cargo build -p calcarc-core` が通ることも確かめる（未使用の警告は可）。
- [ ] **重い段:** `heavy:power`。次の 3 つを読む:
  - 新しい変異の、シャードごとの検出数;
  - 既存の `precedence-collapse`・`associativity-flip` が新しいシャードで何件赤くなるか;
  - どの変異の検出数も、前の走行（`docs/corpus-measurements.md` の最新）より減っていないこと。
- [ ] `expectShards`・`minRate` を実測で入れる。既存の変異に新しいシャードが反応したら、その `expectShards`・`minRate` も実測で足す。推測で書かない。
- [ ] `cd heavy && pnpm test && pnpm typecheck && pnpm lint`。
- [ ] `docs/corpus-measurements.md` に節を足す（数と走らせた先端）。
- [ ] コミット `Measure how strongly the new shard catches a reverted operator correction`

### Task 7: 文書の訂正と PR の説明

**Files:**
- Modify: 設計書 §3.10（`【訂正 2026-09-16】`）と §6.2（注記 B）
- Modify: `docs/superpowers/sdd/2026-09-12-calc-fixes-verification.md` §8（持ち越しの状態）

- [ ] **§3.10**: 表の「関数の答え → 数など 244／`)` → 数など 22（計 266）」は、私が規則を読んで写した数え方で、誤りだった。次の内容を日付つきで足す:
  - 製品の定義（枝 A の `engine::refuses`）で数えると 33,391 列のうち 1 本（`entry-000033`）で、PR C の後は 0 本（R4・R5）。
  - `heavy:ui` の標本の単体テストの案は、全コーパスの Rust の番人（Task 3）に置き換えた。
- [ ] **§6.2**: 「表と `areaOfShard` の一覧が食い違ったら赤くなる単体テスト」を、実装どおりに書き換える:
  - 一覧は `comparisonOf(area: Area)` の型と、`areaOfShard` が未知の接頭辞を拒むことで縛る;
  - 単体テストが見るのは、厳密の領域が相対誤差を測ったら報告書を落とすこと。
- [ ] 台帳 §8: PR C で閉じた項目（entry-000033、§6.2、§3.10）を印し、残り（PR D）を残す。
- [ ] `node tools/check-citations.mjs`。
- [ ] コミット `Correct the F5 count and the verdict-table sentence to what the code does`
- [ ] PR の説明の下書きを scratchpad に書く（利用者の手番）。書く内容:
  - 受け入れ条件（先端での Heavy corpus の手動起動）
  - A → C の順
  - 赤の確認の数と検出力の数

### Task 8: 枝の末尾のフルスイープ（controller、監視役に知らせる）

- [ ] PR C の先端で、PR A のときと同じ段を回す:
  1. cargo fmt・clippy・test --workspace（新しい番人を含む）
  2. web typecheck・lint・test
  3. ポートの確認
  4. heavy test・typecheck・lint・`pnpm heavy`
  5. reference ruff 2 つ・mypy・pytest
  6. tools 3 本
  7. 作業木が空
- [ ] `wasm-pack test` は回さない（PR C は `crates/*/src` を変えない）。変えたなら回す。

## 残り（別の計画）

- **PR D**（3d の枝 D の上）: 次の 3 つ。
  - 10 億円を超える月額の `Overflow` の見張り（native と wasm32、理論 ≥ 上限 + 2）
  - 年 0.0001%・2 回の B の上位 1 割の件
  - 数値方針の「上限の範囲」の一文（`:177` の 3d の文と合わせる）

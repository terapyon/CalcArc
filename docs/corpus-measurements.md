# コーパスの実測値

設計書 `2026-08-15-heavy-corpus-e2e-design.md` §6.3 / §11 の未知を実測した記録。

## 括弧を省いたシャードが実際に掛かった費用（2026-08-16 実測、段階 3c Task 4）

設計書 `2026-08-16-corpus-precedence-design.md` の実装（`corpus/generated/precedence-000.json`）
が掛けた費用の記録。**この節の数字はすべて、本タスクで実際に走らせたコマンドの出力である。**
予想・見積り・過去のレポートからの転記は無い。測れなかったものは「測れなかった」と書いてある。

計測環境: worktree `/home/terapyon/dev/CalcArc-e2e`、ブランチ `feature/e2e-corpus`、
HEAD `a89bec4`、ブランチ基点 `ec13beb`（`git merge-base HEAD origin/main` と一致）。

### 件数

| シャード | 件数 | 種別 |
|---|---|---|
| `scientific-000.json` | 2000 | value |
| `equivalence-000.json` | 2000 | equivalence |
| `precedence-000.json` | **2000**（本段階で追加） | value |

value ケースは 2000 → **4000** に倍増した。全 3 シャード合計 6000 件。

### 棄却の内訳（`precedence-000.json`、seed=20260817、count=2000）

`build_precedence_shard` の採択ループを 1 行も変えずに複製し（`generate_corpus.py` を
`importlib` で読み込んで `random_node` / `to_keys_minimal` / `to_keys` / `_within_range` /
`evaluate` / `to_expr_text` をそのまま呼ぶ）、棄却理由ごとに数えた。**複製が正しいことは
自己検査で確かめている**——複製したループが積んだ 2000 件は、コミット済み
`corpus/generated/precedence-000.json` の `cases` と Python の `==` で完全一致した
（`True`）。生成器側に `print` を仕込む必要はなく、`reference/` は 1 バイトも触っていない。

```
attempts=18897 accepted=2000 rejected=16897 (acceptance 10.58%, rejection 89.42%)
  bare            : 6695  (35.43% of attempts, 39.62% of rejections)
  dropped_nothing : 10100 (53.45% of attempts, 59.77% of rejections)
  out_of_range    : 70    ( 0.37% of attempts,  0.41% of rejections)
  out_of_shard    : 32    ( 0.17% of attempts,  0.19% of rejections)
  dup             : 0     ( 0.00% of attempts,  0.00% of rejections)
  cap は count*200 = 400000 attempts。使ったのは 4.72%。
```

- **「省ける括弧が無い」（`dropped_nothing`）で捨てた割合: 全試行の 53.45%、全棄却の 59.77%。**
  最大の棄却理由である。
- 2 番目は「最上位が裸のリテラル」（`bare`）の 35.43%。これは既存 2 シャードと共通の棄却で、
  この段階が新しく足した費用ではない。
- 採択率は 10.58%。既存 `scientific-000.json` の採択率は 62.2%（2000 件時点）だったと
  この文書の下の節が記録している——**そちらは本タスクで測り直していない、下の節からの引用**
  である。両者を並べると約 6 分の 1 で、落ちた分はほぼすべて `dropped_nothing` に対応する。
- 上限にはまだ 21 倍の余裕がある。件数を伸ばすときに最初に効いてくるのはここ。

### 生成時間

`time.perf_counter` で `build_*` を直接測った（CLI のプロセス起動を含まない）。
**ディスクには書いていない**——メモリ上の shard を `write()` と同じ
`json.dumps(shard, indent=2, sort_keys=True) + "\n"` で直列化し、コミット済みファイルと
文字列比較して 3 枚とも `byte-identical: True` を確認した。

| シャード | 2000 件の生成時間 | 1 件あたり | コミット済みファイルと一致 |
|---|---|---|---|
| `scientific-000.json` | 119.62ms | 0.0598ms | True |
| `equivalence-000.json` | 163.35ms | 0.0817ms | True |
| `precedence-000.json` | **211.31ms** | **0.1057ms** | True |
| 3 枚合計（6000 件） | **494.27ms** | — | — |

- 新シャードは全体の **42.8%** を占める。追加前の 2 枚合計は 282.96ms だった。
- 1 件あたりの生成コストは既存シャードの約 1.3〜1.8 倍。棄却率が 62%→10.58% に落ちた分の
  再抽選コストが、そのまま時間に出ている。
- それでも 2000 件で 0.2 秒であり、この文書の下の節が書いた「生成時間は事実上 O(件数) の
  定数倍」という結論は変わらない。

### 優先順位を踏んだ件数と、意味が変わる件数

**この 2 つは違うものである。混ぜてはいけない。**

- **踏んだ件数: 2000 / 2000。** 同じ括弧の組の中に優先順位の異なる二項演算子が 2 つ以上
  並ぶキー列の数。`pnpm heavy` が走行ごとにシャードから live で数え、
  `web/heavy-report.md` に「括弧を省いた式——2000 件が踏んでいる」として出す。
  engine は括弧ではなく優先順位で構造を決めた——この 2000 件すべてについて言える。
- **意味が変わる件数: 1101 / 2000。** 優先順位を捨てて一様・左結合で読み直すと**別の木**に
  なる件数。つまり「優先順位が無ければ誤答になる」件数。残る 899 件は、優先順位を
  無視しても同じ木になる（踏んではいるが、それだけでは差が出ない）。
- **1101 は自分で導き直していない。** 出所は
  `reference/tests/test_generate_corpus.py:435` の
  `assert changes_meaning == 1101`（テスト関数は同ファイル :370 の
  `test_precedence_shard_reports_how_many_cases_change_meaning_without_precedence`）。
  このテストはコミット済みシャードを読み、本物の優先順位表で読み直した木が `expr` に
  往復することを先に確かめてから、一様表での再パースと構造比較する。本タスクで実行:
  `UV_NO_CONFIG=1 uv run --no-config pytest tests/test_generate_corpus.py -k change_meaning`
  → **1 passed**。

### 実行時間の変化（2000 件増えた分）

`CI=1` を付けて **毎回 wasm を作り直し、4180 のプレビューも立て直した**走行で測った
（`reuseExistingServer` で古いものを掴んでいない、という保証のため。レビュー round 4 が
「未実施」として残していた項目でもある）。

```
cd web && CI=1 pnpm heavy   → 93 passed (4.1s)   ← 1 回目
cd web && CI=1 pnpm heavy   → 93 passed (4.0s)   ← 3 回目（報告書を作り直すため）
```

テスト単位の所要時間は、同じ設定に `--reporter=json` を付けた 2 回目の走行から取った
（`stats.duration` = 4003ms、全 93 テスト `passed`）:

| テスト | 所要時間 |
|---|---|
| `both routes agree in equivalence-000.json` | 588ms |
| **`every case in precedence-000.json matches the reference`** | **527ms** |
| `every case in scientific-000.json matches the reference` | 416ms |
| 93 テストの所要時間の合計 | 2312ms |
| その走行の wall clock | 4003ms |

新シャードを外した走行との比較:

```
CI=1 pnpm exec playwright test --config playwright.heavy.config.ts \
     --grep-invert "precedence-000.json"   → 92 passed (3.5s)
```

**2000 件の追加が掛けた実行時間は 527ms（テスト単位）、wall clock で約 0.5 秒。**
1 件あたり約 0.26ms で、既存 `scientific-000.json` の 416ms / 2000 件 = 0.21ms/件 と
同じ桁である。往復は 1 回のままなので、固定コスト（ページ起動・wasm 初期化）は増えていない。
（`--grep-invert` の走行は `globalTeardown` が「揃うはずのシャードが 1 枚足りない」と
エラーを出す。これは集計の健全性検査が働いた結果で、テストの失敗ではない。）

### キートークンの被覆——このコーパス最大の穴

`corpus/generated/*.json` の全ケースで実際に押されているキートークンを数えた
（value ケースは `keys`、equivalence ケースは `left` と `right` の両方）。

- 押されている distinct トークン: **23**。3 シャードとも同じ 23 で、シャードごとの違いは無い。
  `0`〜`9` `add` `sub` `mul` `div` `eq` `lparen` `rparen` `sqrt` `sqr` `sin` `cos` `tan` `neg`
- ブランチ基点の `web/src/calc/types.ts` の `KEY_TOKENS` は **32**。
  → **一度も押されないトークンは 9 / 32（押されているのは 71.9%）**:
  `dot` `zeros3` `exp` `pi` `j` `polar_toggle` `ac` `del` `angle_toggle`

**これはこのコーパスの被覆の穴として最大のものである。** 小数点も、定数も、指数入力も、
複素数の入口も、クリア／訂正キーも、角度モードの切り替えも、6000 件を通して 1 度も
押されていない。緑であることは、これらについて何も言っていない。
（`web/heavy-report.md` はこの 9 / 32 を走行ごとに実データから導いて出している。本タスクの
独立集計はその値と一致した。）

### main が入ったとき、この被覆がどうなるか

`origin/main`（`b63362d`）と `feature/sexagesimal`（ローカル `45e477d`。別セッションの
完了済みの仕事で、このリポジトリの共有オブジェクトストアから `git show <branch>:<path>` で
読んだ。**チェックアウトはしていない**）は、どちらも `KEY_TOKENS` を伸ばしている。

| 地点 | `KEY_TOKENS` | 押されている | **一度も押されない** | 被覆率 |
|---|---|---|---|---|
| このワークツリーの基点（`ec13beb`） | 32 | 23 | **9** | 71.9% |
| `origin/main`（`b63362d`） | 46 | 23 | **23** | 50.0% |
| `feature/sexagesimal`（`45e477d`） | 46 | 23 | **23** | 50.0% |

両者が同じ 46 なのは偶然ではない。`origin/main` の直近のコミットが
`Merge pull request #47 from terapyon/feature/sexagesimal` であり、ローカルの
`feature/sexagesimal` は push 時に rebase された同じ仕事の push 前の姿だからである
（`git merge-base --is-ancestor feature/sexagesimal origin/main` は偽を返す——SHA は
別だが中身は同じ、という縦積みブランチのいつもの壊れ方）。両者が足すトークンは同一の 14 個:
`eng` `pow` `ln` `log10` `exp_e` `recip` `asin` `acos` `atan` `e` `n_fact` `n_p_r` `n_c_r` `dms`

**追加が append-only であることを自分で確かめた。** 証拠は 2 つ:

1. 基点の 32 トークンのリストは、`origin/main` / `feature/sexagesimal` の 46 トークンの
   リストの**先頭 32 要素と順序込みで完全一致**する（Python の `o[:len(base)] == base` が
   両方 `True`）。既存トークンの削除も並べ替えも改名も無い。
2. `git diff ec13beb origin/main -- web/src/calc/types.ts` の `KEY_TOKENS` 配列に掛かる
   hunk は `angle_toggle` の直後に `+` 行が 14 本並ぶだけで、配列内に `-` 行が 1 本も無い。
   `feature/sexagesimal` 側の同じ diff の `-` 行は全体で 2 本、うち 1 本は `--- a/…` の
   ヘッダで、実体は `BinOpName` の 1 行のみ（`KEY_TOKENS` ではない）。

つまり **main が入っても既存の 23 件は押され続けるが、穴は 9 個から 23 個に広がる。**
被覆率は 71.9% → 50.0% に落ちる。コーパスの中身が悪くなるのではなく、電卓が伸びた分だけ
コーパスが置いていかれる。

### 3 桁カンマが入った瞬間に赤くなる件数（既知・計画済みの破壊）

`origin/main` の `66c1fc4`「Group the integer part in threes, and nothing else」が
`format_real` を変え、**平坦表示のときだけ整数部を 3 桁ごとにカンマで区切る**ようになった
（小数部にも指数部にも入れない）。一方 `web/tests/heavy/display.ts` の `parseDisplay` は
`/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/` で、カンマを含む文字列を**読まずに throw する**。

判定条件は `format_real` の構造から一意に決まる: 有効数字 10 桁に丸めた後の 10 進指数を
`e` とすると、平坦表示は `-9 <= e < 10`、カンマが入るのは整数部が 4 桁以上、すなわち
`e >= 3`。これを各シャードの値に当てた結果:

| シャード | 全件 | **カンマが付く件数** | 割合 |
|---|---|---|---|
| `scientific-000.json` (value) | 2000 | **555** | 27.75% |
| `precedence-000.json` (value) | 2000 | **943** | 47.15% |
| value 合計 | 4000 | **1498** | 37.45% |
| `equivalence-000.json` (左右どちらかに付く) | 2000 | **483** | 24.15% |

数え方と、その健全性:

- value シャードはコミット済み JSON の `expect.re` をそのまま使った。虚部が 0 でない
  ケースは両シャードとも **0 件**、指数表記になるケースも両シャードとも **0 件**
  （生成器が `1e-6 <= |x| < 1e9` に閉じ込めているため、全件が平坦表示）。
- equivalence シャードは `expect` を持たないので、コミット済みの `left` / `right` の
  キー列を `test_generate_corpus.py` の `_parse_with_precedence` に本物の優先順位表で
  通し、`corpus_eval.evaluate` で評価した。**自己検査**として左右の値が一致することを
  全件で確かめた——**不一致 0 / 2000**。
- **境界の曖昧さは無い。** 1e3 / 1e10 の閾値に相対 1e-8 以内まで近いケースは全 6000 件で
  1 件だけ（`sci-000935`、式 `(552 + 448)`、値ちょうど `1000.0`）。厳密な整数なので
  丸めの向きに依存せず「1,000」と表示される。engine 側の値が参照値から 5e-10 ずれても
  判定は動かない。

**したがって main を取り込んだ時点で、少なくとも value 1498 件と equivalence 483 件が
`parseDisplay` の throw で赤くなる。** これは計画された破壊であり、対処は
`2026-08-16-corpus-precedence.md`「この計画が積み残すもの」の方針どおり
**main に入ってから直す**。未観測の書式に備えるコードを先に書かない。

なお、本タスクの `CI=1 pnpm heavy` の `measure.spec.ts` が撮った 9 本の表示（`3`,
`1.414213562`, `8.1e13` ほか）にはカンマが 1 つも出ていない。このブランチの engine は
まだ `66c1fc4` を持っていない、ということが走行の出力から読める。

**同時に入る `DomainError` の方は、このコーパスに当たらない。** 両 value シャードの
`expect.im` は全件 0 で、負数の平方根は生成時に `OutOfShard` で捨てられている
（`precedence-000.json` の棄却内訳で 32 件）。

### 非干渉——このブランチが他を壊していないこと

**`crates/` は 1 バイトも触っていない。**

```
$ git diff --stat f436438 HEAD -- crates      # 段階 3c の設計書をコミットした地点から
（出力なし）
$ git diff --stat ec13beb HEAD -- crates      # ブランチ基点から。ブランチ全体を覆う
（出力なし）
```

ブリーフが指定した `f436438` は段階 3c が始まった地点にすぎないので、ブランチ基点
`ec13beb` からも取り、両方が空であることを確かめた。

**`web/src/` の差分は 1 ファイルだけ。**

```
$ git diff --stat ec13beb HEAD -- web/src
 web/src/heavy-harness.ts | 99 ++++++++++++++++++++++++++++++++++++++++++++++++
 1 file changed, 99 insertions(+)
```

出ているのは新規追加の `web/src/heavy-harness.ts` 99 行のみで、既存ファイルの変更行は
0 である（`-` 行が無い）。重量級専用の 2 つの設定ファイル
（`web/playwright.heavy.config.ts` 56 行、`web/vite.heavy.config.ts` 20 行）は
`web/src/` の外なので、この diff には現れない。どちらも新規追加である。
`web/` の残りの差分は、このブランチ自身の試験ディレクトリ `web/tests/heavy/`（13 ファイル、
全て新規）と、`web/heavy-harness.html`（新規 10 行）、`web/package.json`（`heavy` スクリプトを
1 行追加）、`web/tsconfig.json`（`include` の 1 行を書き換えて `vite.heavy.config.ts` を追加）
である。**既存ファイルに掛かった変更は `web/` 全体でこの 2 行だけ**で、あとはすべて新規追加である。

**既存 `playwright test`（設定なし）は heavy を 1 件も拾わない。**

```
$ cd web && pnpm exec playwright test --list | grep -c heavy
0
$ cd web && pnpm exec playwright test --list | tail -1
Total: 82 tests in 10 files
```

**走らせた検査（`.github/workflows/ci.yml` の 5 ジョブのうち 4 つ）**

| CI ジョブ | コマンド | 結果 |
|---|---|---|
| Rust core | `cargo fmt --check` | exit 0 |
| Rust core | `cargo clippy --workspace --all-targets -- -D warnings` | 警告 0 |
| Rust core | `cargo test --workspace` | 12 スイート **223 passed / 0 failed / 0 ignored** |
| Web | `pnpm typecheck` | 出力なし（clean） |
| Web | `pnpm lint` | `Checked 86 files in 22ms. No fixes applied.` |
| Web | `pnpm test`（vitest） | **16 files / 141 passed** |
| Web | `pnpm exec vite build` | 成功（`precache 10 entries (557.61 KiB)`） |
| Web | `pnpm check:sw` | `check:sw OK` |
| End-to-end | `pnpm e2e` | **82 passed (10.9s)** |
| Python reference | `uv sync --locked` | `Resolved 10 packages / Checked 9 packages` |
| Python reference | `uv run ruff check .` | `All checks passed!` |
| Python reference | `uv run ruff format --check .` | **失敗——下記参照** |
| Python reference | `uv run pytest` | **104 passed** |
| Python reference | `uv run python scripts/generate.py` → golden 一致 | 再生成後 `git status --porcelain` 空 |

`reference` の全コマンドは `UV_NO_CONFIG=1 uv run --no-config` で走らせた。
全走行のあと `git status --porcelain` は空で、`reference/uv.lock` に差分は無い。

**「全レイヤー緑」とは書けない。** CI は 5 ジョブあり、走らせられたのは 4 つである。

- **`WASM boundary`（`wasm-pack test --headless --chrome`）はこの環境で走らせられない。**
  ChromeDriver と Chrome の版が食い違う（CLAUDE.md が「踏んだ罠」に書いている既知のもの）。
  **走らせていないので、通ったとは書かない。** 代わりに置くのは上の
  `git diff --stat ec13beb HEAD -- crates` が空であるという事実、すなわち
  **境界層の入力が 1 バイトも変わっていない**という**構造的な論拠**である。
  テストを走らせた結果ではない。差分が無い以上このブランチが境界層を壊す経路は無い、
  という推論であって、境界層が今日実際に緑であることの観測ではない。
- `pnpm heavy`（Layer 6）は CI のジョブではない。本タスクでは `CI=1 pnpm heavy` を
  走らせて **93 passed / 不一致 0** を確認した。

**見つかった赤: `ruff format --check` が落ちる。**

```
$ cd reference && UV_NO_CONFIG=1 uv run --no-config ruff format --check .
unformatted: File would be reformatted
   --> tests/test_generate_corpus.py:225:79
   ...
1 file would be reformatted, 21 files already formatted
```

- 対象は `reference/tests/test_generate_corpus.py` の 2 箇所——:225 の `ValueError` の
  f-string 連結（1 行に繋げるべきところを 2 行に割っている）と、:286 の 79 文字の
  テスト関数名 `test_operators_in_different_parenthesis_groups_at_the_same_depth_do_not_need_precedence`
  の折り返し。ruff 0.16.1（`uv.lock` が固定している版）。
- **このブランチが入れたものである。** ファイルの各コミット時点の中身を
  `ruff format --check --stdin-filename tests/test_generate_corpus.py -` に流して二分した:
  `f436438` `33096b3` `33abf2f` `d7f94c9` `dcee3e3` は exit 0、
  **`02c5f4b`（"Count operators in the same parenthesis group, not at the same depth"）から
  exit 1** になり、`d6ee6ed` `36ec4f6` `a89bec4` も 1 のまま。
  （ブランチ基点 `ec13beb` にこのファイルは存在しない。段階 3 で新設されたファイルである。）
- **このまま push すれば CI の `Python reference` ジョブは `ruff format --check` で落ちる。**
  本タスクの差分は `docs/corpus-measurements.md` に限る決まりなので、ここでは直さずに
  記録だけ残す。直すのは `uv run ruff format reference/tests/test_generate_corpus.py`
  1 回で済むが、それは別のコミットの仕事である。

### 測れなかったもの

- **WASM 境界層（`wasm-pack test --headless --chrome`）。** ChromeDriver と Chrome の
  版が合わない。上に書いたとおり、代わりに置いたのは差分ゼロという構造的な論拠であって、
  テストの結果ではない。
- **カンマ導入後の実際の赤の件数。** 上の 1498 / 483 は、コミット済みの期待値と
  `format_real` の分岐条件から数えた「カンマが付く件数」である。`origin/main` の engine を
  実際に動かして `parseDisplay` に食わせた観測ではない（この worktree の engine には
  まだ `66c1fc4` が入っていない）。カンマが付けば `parseDisplay` は必ず throw するので
  下限としては固いが、main を取り込んだ後の実測で確かめ直すこと。
- **`equivalence-000.json` の表示値を engine から直接。** シャードが `expect` を
  持たないため、コミット済みキー列を参照実装側で読み直して評価した。左右一致 0 不一致
  という自己検査は通っているが、engine が画面に出す文字列そのものを見たわけではない。

## 許容判定を相対誤差だけに締め直した結果（2026-08-16 実測、Task 5）

設計書 `2026-08-16-corpus-tolerance-design.md` の実装後、`cd web && pnpm heavy` が
書き出した `web/heavy-report.md` からそのまま写す（予想や見積りではない）。

- **表示分解能より緩く検査されたケース**: 1315 → **2**（全 4000 件中 0.1%。以前は
  32.9%）
- **最悪の実効相対許容**: 4.15e-4 → **2.00e-9**
- **名指しで緩めたケース（上書き）**: 2 件
  - `scientific-000.json (values)` **sci-000019** — rel 1.00e-9（シャードの
    5.00e-10 の **2 倍**）。巨大角度の三角関数
    `tan(rad(376 × 788²))`（角度 233,474,944 度）。観測された相対誤差
    7.65e-10
  - `scientific-000.json (values)` **sci-001332** — rel 2.00e-9（シャードの
    5.00e-10 の **4 倍**）。巨大角度の三角関数
    `cos(rad((815×412)×(747+422)))`（角度 392,526,820 度）。観測された相対誤差
    1.34e-9
  - 理由の全文は `corpus/overrides.json` と `web/heavy-report.md` の
    「名指しで緩めたケース」節にある
- **観測された最大相対誤差**: 1.34e-9（上と同じ `sci-001332`。上書き後の rel
  2.00e-9 の内側）
- **観測された最大絶対誤差**: 4.36e-2
- **判定ロジックは変えたが、コーパス自身は 1 バイトも変わっていない。**
  `{abs: 5e-10, rel: 5e-10}` という値は生成時のままで、変わったのは判定側の
  解釈（`abs` が OR の片側から「期待値が厳密に 0 のときの専用経路」に
  格下げされたこと）だけである。再生成一致ゲート
  （`reference/tests/test_corpus_reproducibility.py`）は無変更のまま緑だった。
  経緯は `docs/superpowers/specs/2026-08-16-corpus-tolerance-design.md` §5 の
  訂正を見よ。

## 表示書式（2026-08-15 実測）

`cd web && pnpm exec playwright test --config playwright.heavy.config.ts tests/heavy/measure.spec.ts`
の出力 9 行をそのまま記録する（`web/tests/heavy/measure.spec.ts` の `PROBES`）。

| 探り | キー列 | 表示（生の JSON） |
|---|---|---|
| 整数 | `3 =` | `{"main":"3","error":null}` |
| 2 の平方根 | `2 √` | `{"main":"1.414213562","error":null}` |
| 1 ÷ 3 | `1 ÷ 3 =` | `{"main":"0.3333333333","error":null}` |
| 円周率 | `π` | `{"main":"3.141592654","error":null}` |
| 負の数 | `5 ±` | `{"main":"-5","error":null}` |
| 大きい数 | `9 000 000 × 9 000 000 =` | `{"main":"8.1e13","error":null}` |
| 小さい数 | `1 ÷ 9 000 000 =` | `{"main":"0.0000001111111111","error":null}` |
| sin 30 度 | `30 sin` | `{"main":"0.5","error":null}` |
| 負数の平方根 | `4 ± √` | `{"main":"j2","error":null}` ※ |

※ **2026-08-16 の main 取り込みで変わった。** いまは
`{"main":"Math ERROR","error":"DomainError"}`。この表は段階 1 の実測記録なので
書き換えず、末尾の「**main 取り込み後の再実測**」に新しい値を置いた。

## 決めた値

- **有効桁数**: 10 桁。`2 の平方根`(`1.414213562`)・`1 ÷ 3`(`0.3333333333`)・
  `円周率`(`3.141592654`)・`小さい数`(`0.0000001111111111`、先頭の 0 を除くと
  `1111111111`)がいずれも 10 桁で揃っている。`docs/numerical-policy.md` の
  「有効数字 10 桁」という既存の仕様記述と一致する。`大きい数`が
  `8.1e13`と 2 桁しか出ないのは有効桁数が減ったのではなく、
  `9,000,000 × 9,000,000 = 81,000,000,000,000`が末尾すべて 0 の厳密な整数で、
  10 桁目まで埋めると残りが全部ゼロだから表示上省かれているだけである。
- **tolerance**: `{"abs": 5e-10, "rel": 5e-10}` — 10 有効桁の最後の 1 桁の
  半分(round-half-to-even の丸め幅)を許容の目安とした。これより細かい差は
  表示に現れないので、主張できない。絶対誤差は 0 近傍(`main` が
  `0` や極小値になる場合)を、相対誤差はそれ以外の桁数の大きい値をカバーする
  ために両方持たせた。
- **平坦表示の範囲**: `docs/numerical-policy.md` に既に明記されている規則
  (`|x| >= 1e10` または `0 < |x| < 1e-9` で指数表記)と、今回の実測が一致する。
  `大きい数`(8.1e13 ≒ 8.1×10^13 ≥ 1e10)は指数表記、`小さい数`
  (≒1.11×10^-7、1e-9 より大きい)は平坦表示だった。したがって縦の 1 本では
  生成器を **1e-9 <= |x| < 1e10** の範囲に閉じ込める。この境界ちょうど
  (1e-9 や 1e10 に極めて近い値)の解釈は段階 3 に送る。

## 副次的な発見（設計への申し送り）

- **`負数の平方根`は指数表記ではなく複素数表示だった。** ブリーフはこの探りを
  「指数表記の可能性」を疑う目的で置いていたが、実際に返ったのは `j2`
  ——虚数単位を前置する CalcArc 独自の複素数表記である。`docs/numerical-policy.md`
  「実軸は演算で閉じている」節に、`sqrt(-4)` が `j2` を返すことは既存仕様として
  明記されている。**バグではない。** ただし `j2` は `Number()` で読める実数
  ではないため、`parseDisplay` は実数専用として素直にエラーを投げる
  (`display.spec.ts` の 3 件目のテストが検証する)。コーパス生成器が実数以外
  (複素数値になりうる)キー列を生成する場合は、`parseDisplay` に通す前に
  実数か複素数かを別途判定する必要がある。この判定ロジックは本タスクの
  範囲外であり、次のタスクへの申し送りとする。
- 負号は ASCII の `-`(U+002D)だった。桁区切りのカンマは今回の探りには現れ
  なかった(Data Scale 系のフォーマットではなく Scientific のフォーマットの
  ため)。

## 生成時間（2026-08-15 実測、レビュー修正ラウンド 1 後に更新）

`cd reference && UV_NO_CONFIG=1 uv run python scripts/generate_corpus.py 2000` の生の
CLI 出力（レビュー指摘を受けてミリ秒単位表示に直した後。以前は `%.1f` 秒表示で
1000〜2000 件が `0.0s` に丸まっていた）:

```
wrote .../corpus/generated/scientific-000.json (2000 cases)
generated 2000 cases in 125.85ms (0.0629ms each)
```

`build_shard` を `time.perf_counter` で直接計測した値（CLI のプロセス起動オーバーヘッドを
含まない、より安定した数字）:

- 1000 件: 60.42ms（0.0604ms/件）
- 2000 件: 112.73ms（0.0564ms/件）

**設計書 §11 が想定した「SymPy の生成時間」は、この生成器には当てはまらない。**
`generate_corpus.py` は式の評価に `mpmath.evaluate` だけを使い、SymPy は
`_provenance()` の版文字列取得にしか登場しない（`sympy.solve` のような重い呼び出しを
経路上に持たない）。そのため生成時間は事実上 O(件数) の定数倍で、目標総件数を
1 万件・10 万件に伸ばしても以下の外挿どおり数秒で収まる見込みである:

- 目標総件数 2,000 件（本タスクで実際に生成した件数）に必要な生成時間: 0.15 秒未満
- 外挿: 10,000 件 ≈ 0.6 秒、100,000 件 ≈ 6 秒

この時間はリリース時にしか払わない（毎 PR の再生成一致チェックには乗せない）。
段階 3 で電卓の種類ごとにジェネレータを増やし、コーパスを横に広げる際に SymPy を
使う生成器が加わるなら、そのときはこの節と同じ手順で改めて実測すること。

### 裸のリテラルを最上位ノードから除外した（レビュー修正ラウンド 1）

初回生成（2026-08-15）のシャードは 2000 件中 529 件（26.45%）が演算子も関数も
持たない裸の整数リテラル（`769 => 769.0` の形）で、二項演算子ゼロが 792/2000、
単項関数ゼロが 902/2000 だった。これは `random_node` が最上位でも確率 0.35 で
葉を返すことが原因で、「押した桁が返る」ことしか確かめておらず、
`crates/calcarc-core/tests/engine_table.rs` が既に仕様として持っている領域と
重複していた。この重量級コーパスの仕事ではないため、`build_shard` の採択ループで
最上位が `Num` そのものだったら即座に捨てるよう直した（`Un("neg", Num(5))` の
ような単項 1 つだけのケースは残る — `neg` キーを実際に叩いているので）。

修正後の分布（`corpus/generated/scientific-000.json`、2000 件、seed=20260815 実測。
以下は JSON から機械的に再集計した数字で、生成器のコードとは独立に検算できる）:

- 裸のリテラル: **0/2000**（修正前 529/2000 から解消）
- 二項演算子の出現回数: `+` 871, `-` 864, `*` 790, `/` 831 — ほぼ均等
- 単項関数の出現回数: `sqrt` 404, `sqr` 422, `sin` 445, `cos` 459, `tan` 476,
  `neg` 440 — ほぼ均等
- 期待値がちょうど 0: 4/2000。負の期待値: 705/2000
- 期待値の絶対値レンジ: 最小 `1.2052e-6`（`MIN_ABS=1e-6` の内側）、最大
  `8.0276e8`（`MAX_ABS=1e9` の内側）— 範囲逸脱なし
- id は `sci-000000`〜`sci-001999` で連番かつ一意

### 棄却率（seed=20260815、レビュー修正ラウンド 1 後に再計測）

`build_shard` のループ本体を複製し、`attempts` / `bare_literal`（最上位が `Num` で
即棄却）/ `out_of_shard`（`OutOfShard`: ゼロ除算・負数の平方根）/
`out_of_range`（`_within_range` 不成立）/ `dup`（`expr` 重複）を内訳として数えた:

| 目標件数 | 試行回数 | 採用 | bare_literal | out_of_shard | out_of_range | 重複 | 採用率 |
|---|---|---|---|---|---|---|---|
| 1000 | 1575 | 1000 | 524 | 25 | 25 | 1 | 63.5% |
| 2000 | 3213 | 2000 | 1104 | 48 | 55 | 6 | 62.2% |

`attempts > count * 200` の上限（2000 件なら 400,000 回）に対して実際の試行回数は
依然として 2 桁少なく、余裕がある。採用率自体は修正前の 85.7%（2000 件時点）から
62.2% に下がったが、これは意図した棄却（裸のリテラル）が増えたためであり、
分布の質が悪化したわけではない。むしろ **修正前に主因だった `expr` 重複が
257 件から 6 件に激減した**（申し送りどおり、裸のリテラルは 1000 通りしかなく
飽和しやすいことが重複の主因だった、という以前の懸念が的中し、そのまま解消した）。
段階 3 で件数を大きく伸ばす場合は `bare_literal` 棄却の比率（現状 1000〜2000 件で
約 33〜34%）が上限をどう圧迫するかを監視すること。生成時間そのものは依然として
無視できる小ささである。

## 突き合わせの実行時間・不一致（2026-08-15 実測、Task 6）

`corpus/generated/scientific-000.json` の 2000 件を、`web/tests/heavy/corpus.spec.ts`
の「every case in scientific-000.json matches the reference」テスト 1 本で、
`runAll` により 1 往復にまとめて実ブラウザ（Chromium, headless）へ流した。

```
cd web && pnpm heavy -- corpus.spec.ts
```

Playwright が報告したこのテストの所要時間: **425ms**（2000 件、1 往復。
`page.evaluate` 呼び出し 1 回）。スイート全体（harness / display / corpus の
9 テスト）は 2.7 秒。

- **不一致件数**: 0/2000
- **観測された最大相対誤差**: `1.3421946031736659e-9`
  （`sci-001332`、`cos(rad(((815 * 412) * (747 + 422))))`。期待値
  `-0.17364817766693036` に対し絶対誤差は `2.33e-10` 相当で、`tolerance.abs`
  （`5e-10`）の内側に収まっているため一致と判定される。角度を度単位で巨大な
  値まで畳み込んでからの三角関数評価で、相対誤差が `tolerance.rel` の `5e-10`
  をわずかに超えても、値そのものが小さいため絶対誤差では十分に余裕がある。
  これは想定内の挙動であり、電卓・参照実装のどちらの誤りでもない）
- **観測された最大絶対誤差**: `0.04356551170349121`
  （`sci-000283`、`(-(cos(rad(999))) - ((933)^2 * 615))`。期待値
  `-535350735.1564345` という 1e8 級の値に対する絶対誤差で、相対誤差に直すと
  `8.1e-11` と `tolerance.rel` の内側に十分収まる。減算を含む式だが、
  相殺は 1e8 級から 1e-2 級までの約 10 桁にとどまり、`tolerance` が
  想定する f64 の相対誤差 `1e-16` 由来の増幅の範囲内）

いずれのケースも `withinTolerance` の abs/rel いずれかの基準内に収まっており、
桁落ちや実装差を疑う必要のある不一致は 0 件だった。2000 件を 1 往復・425ms で
処理できたことから、数万件規模へ拡張しても実行時間は線形以下で収まる見込みが強い
（1 件あたり約 0.2ms。ページ起動や wasm 初期化などの固定コストは往復回数を
増やさない限り 1 回しか払わない）。

## main 取り込み後の再実測（2026-08-16）

`origin/main` を取り込んだ（マージコミット `2fe1d18`、base から 82 コミット）。
**テキスト上の衝突は 0 件**——`git merge-tree` で事前に確認し、実際そのとおりだった。
変わったのは意味論の側だけである。

### 変わったこと 2 つ（どちらも仕掛けが赤くして教えた）

| | 段階 1 の実測 | いまの実測 | 誰が教えたか |
|---|---|---|---|
| `9 9 9 9 9 9 9 9 9 9 eq` | `9999999999` | **`9,999,999,999`** | `measure.spec.ts` の `FORMAT_FACTS` |
| `4 neg sqrt` | `{"main":"j2","error":null}` | **`{"main":"Math ERROR","error":"DomainError"}`** | `measure.spec.ts` の除外理由テスト |

**どちらも「赤くなったら記録を更新せよ」という仕掛けとして置いたもので、
予告どおり赤くなった。** 黙って新しい値に合わせるのではなく、
**何がなぜ変わったか**をここに残してから緑に戻した。

### 3 桁区切りの影響（マージ前に測り、マージ後に確認した）

`format_real` が `group_integer_part` を通るようになった（`numeric/format.rs`、
commit `66c1fc4`）。**整数部だけを 3 桁ごとに区切る**——小数部にも指数部にも入らない
（`1,234.5678`、`1e10` は無傷）。

マージ前の予測: 値ケース 4000 件のうち **1498 件**（37.45%）がカンマを持つ。
シャード別に scientific 555 / precedence 943。同値シャードは両辺に同じカンマが
付くので影響なし。

マージ後の実測: **`pnpm heavy` が 5 件赤くなり、`parseDisplay` を直して 95 passed に戻った。**
赤の内訳は 3 シャード + `FORMAT_FACTS` + 除外理由テストで、**予測どおり**だった。

**`parseDisplay` はカンマを単純に除去していない。** `1,2,3` を 123 として通すと
区切り位置の壊れをこの層が二度と検出できなくなるので、**整数部が 3 桁ごとに
区切られているという書式を検証してから外す**。`1,23,456` `1,2345` `,123` `1.234,5`
はいずれも投げる（`display.spec.ts` が固定。正規表現を「カンマをどこでも許す」形に
緩めると、このテストが赤くなることを実測で確認した）。

### 投機的コードを落としてあったことが効いた

`parseDisplay` には当初案の時点で**桁区切りを剥がす行**があったが、
「一度も観測されていない書式に備えるコード」としてレビューで落とし、
**「実際に観測されたら実測付きで足す」という条件を裁定に書いておいた**。

そのときが来た。落としてあったので **1498 件が赤くなり、実測付きで足し直せた**。
持っていたら、この変化は**無検証のまま通っていた**——備えてあるコードは、
その領域の変化を検出器から隠す。

### キー網羅（マージで分母が動いた）

| | `KEY_TOKENS` | 押されている | 未押下 |
|---|---:|---:|---:|
| マージ前 | 32 | 23 | 9（28.1%） |
| **マージ後** | **46** | **23** | **23（50.0%）** |

追加された 14 個: `eng pow ln log10 exp_e recip asin acos atan e n_fact n_p_r n_c_r dms`。
**既存 32 個は順序込みで不変**（機械的に確認済み）。

**このコーパスは、いまや電卓のキーの半分を一度も押していない。** 分子が動かず
分母だけが増えたためで、押していないキーが増えたのではない。**それでも読み手に
とっては「半分が未検証」という事実があるだけ**なので、そう書く。

`heavy-report.md` の当該行は**レポート生成時にデータから導いている**ので、
手を入れずに 9/32 から 23/46 に更新された。手書きの一覧なら、ここで嘘になっていた。

### まだ測れていないこと

- **WASM 境界層**（ChromeDriver と Chrome の版が合わず手元で回せない）。
  `crates/` に差分が無いことを示す**構造的論証**であって、テスト実行ではない
- **入力側の表示レジーム**。`dot` が一度も押されないので、`Buffer::text()` が
  打った通りを返す経路が未検証のまま。main 取り込みで**入力レジームは 3 つに増えた**
  （仮数のみ / 仮数+指数 / 60 進）。しかも相互排他で、他方のキーは無視される

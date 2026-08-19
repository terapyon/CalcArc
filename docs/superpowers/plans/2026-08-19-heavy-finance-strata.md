# 実装計画 — Heavy corpus 改善 B+C（Finance の層別化と Finance 変異）

設計書: [`docs/superpowers/specs/2026-08-19-heavy-finance-strata-design.md`](../specs/2026-08-19-heavy-finance-strata-design.md)

**A（`feature/heavy-power-measure`、`b223bde..e9d2387`）の上に積む。** §6 の変異は
A が作った `expectShards` / `minRate` / 完全一致判定の枠組みに載る。

## この計画の並べ方

**測れるものから順に**並べた。層の骨格（Task 3）を入れる前に、いま何が起きて
いるかを固定する（Task 1）と、参照実装の探索の穴を塞ぐ（Task 2）を先に置く。
理由は 2 つある。

1. **`reference_gave_up` の分類（Task 1）と種の改善（Task 2）は、層別化と
   独立に効く。** 先に入れておけば、層を組み替えたあとで「探索限界が 0 件に
   ならないのは層のせいか種のせいか」を切り分けずに済む。
2. **層別最低件数のテスト（Task 3）は、現在のコーパスに対して赤くなる**
   （残価 0 が実測 2 件、ボーナス 0 が実測 1 件）。赤を先に見てから直す。

コーパスの再生成は、**中身が増える系の変更については Task 9 で 1 回だけ**行う。
層を足すたびに再生成すると golden の差分が読めなくなる。それまでの Task は
生成器とテストだけを触り、テストは「生成器を直接呼んで数える」形で書く。

**ただし、書き出す JSON の形が変わる Task では、その Task の中で再生成する。**
再現性ゲート（`test_corpus_reproducibility.py`）は「コミット済みの golden が
いまの生成器から出るか」を見るので、形を変えた時点で赤くなる。赤いテストを
8 つの Task にまたいで抱えると、ゲートはその間ずっと何も主張しない。該当するのは
**Task 1（`rejections` の形）と Task 3（`stratum` の追加）**の 2 つで、どちらも
差分はメタデータの数行に収まる（Task 1 の実測: 5 行）。件数と中身の変更に伴う
再生成は Task 9 のままである。

これは実装中に分かったことで、最初の計画には書いていなかった。Task 1 の実装者が
「再現性ゲートだけが赤いが、これは Task 9 まで想定内」と正直に申告してきたので、
**想定内にしない**ことにした。

## 守ること（各 Task 共通）

- **`crates/` を変更しない。** 変異は `detection-power.mjs` が一時的に当てる
  もので、コミットしない。Task 11 の走行後に `git diff -- crates/` が空である
  ことを必ず確かめる。
- **走行の前に一時コミットを打つ。** `heavy:power` が kill されたとき、
  `git status` の差分＝変異残骸、と一意に読めるようにする。
- **`uv` は `--no-config` を付ける。** `uv lock` / `uv sync` で
  `~/.config/uv/uv.toml` の `exclude-newer` がロックファイルに漏れる。
  `uv run` は `reference/uv.lock` を書き換えることがあるので、各 Task の
  最後に `git status` を見て、意図しない `uv.lock` の差分は戻す。
- **参照実装を Rust の移植にしない。** Task 2 の種の改善も、Rust がやっている
  二分探索への置き換えではなく**種の式を直す**だけである。
- **許容誤差をテストに書かない。** Finance は整数の厳密一致なので、そもそも
  許容誤差が要らない——要ると思ったら設計を間違えている。

---

### Task 1: `ReferenceGaveUp` に理由を持たせ、`other` を落とす

**Files:**
- Modify: `reference/src/calcarc_reference/corpus_calls.py`
- Modify: `reference/tests/test_generate_corpus.py`

**Interfaces:**

```python
class GaveUpReason(str, Enum):
    NEAR_YEN_BOUNDARY = "near_yen_boundary"
    COMPOUND_DEPOSIT_SEARCH_LIMIT = "compound_deposit_search_limit"
    OTHER = "other"

class ReferenceGaveUp(Exception):
    def __init__(self, message: str, reason: GaveUpReason) -> None: ...
    reason: GaveUpReason
```

`build_finance_shard` の `rejections` を
`{"dup": int, "reference_gave_up": {"near_yen_boundary": int, "compound_deposit_search_limit": int, "other": int}}`
に変える。**`other` が 1 件でも出たら `RuntimeError` で落とす。**

- [ ] **Step 1: 理由を判別する箇所を実物から起こす**

`_finance_entry` が `ValueError` を `ReferenceGaveUp` に変換している。
`loan_ref._guard_boundary` と `compound_ref.deposit_for` の投げる例外を読み、
**メッセージ照合ではなく型か属性で**分けられるようにする。文字列一致で
分類すると、メッセージを直した日に静かに `other` へ落ちる。

Run: `cd reference && grep -n "raise ValueError" src/calcarc_reference/loan_ref.py src/calcarc_reference/compound_ref.py`
Expected: 棄却を投げる箇所がすべて名指しできる

- [ ] **Step 2: 分類を書く**

- [ ] **Step 3: `other` で落ちることをテストする**

`_finance_entry` を単体で呼び、分類できない `ValueError` を投げる op を
モンキーパッチで作って、`RuntimeError` が上がることを確かめる。

- [ ] **Step 4: 現状の内訳をテストで固定する**

`build_finance_shard(seed=20260821, count=2000)` を呼び、
`near_yen_boundary == 3` / `compound_deposit_search_limit == 10` / `other == 0`
を assert する。**この数字は Task 2 で 10 → 0 に変わる。**変わることが分かる
ように、テストの名前に「いまの生成器では」と書く。

Run: `cd reference && uv run pytest tests/test_generate_corpus.py -k gave_up -q`
Expected: PASS（3 / 10 / 0）

- [ ] **Step 5: commit**

```
Split "the reference gave up" into reasons, and refuse the unclassified one
```

---

### Task 2: `deposit_for` の種に税を織り込む

**Files:**
- Modify: `reference/src/calcarc_reference/compound_ref.py`
- Modify: `reference/tests/test_compound_ref.py`
- Modify: `reference/tests/test_generate_corpus.py`（Task 1 で固定した 10 を 0 に）

**Interfaces:** 公開シグネチャは変えない。`deposit_for` の内部の種だけを直す。

- [ ] **Step 1: 失敗する 10 件を名指しで取り出す**

Task 1 の分類を使って、`compound_deposit_search_limit` になる入力を
`build_finance_shard` から拾い、そのまま `tests/test_compound_ref.py` に
定数として書く。**実測から来た入力なので、再発すれば必ず赤くなる。**

Run: `cd reference && uv run python -c "..."`（生成器を呼んで棄却された入力を印字）
Expected: 10 件、すべて `tax: True`

- [ ] **Step 2: 赤を見る**

その 10 件を現在の `deposit_for` に食わせるテストを書き、**落ちることを確かめる**。

Run: `cd reference && uv run pytest tests/test_compound_ref.py -k tax_seed -q`
Expected: **FAIL**（`MAX_WALK` を使い切る）

- [ ] **Step 3: 種に税を織り込む**

税 ON のとき目標と比べるのは `残高 − 国税 − 地方税` で、税は利息にかかる。
円未満切り捨てを無視した連続近似 `net ≈ balance − 0.20315 × (balance − 投入合計)`
を `d` について Decimal で解く。**二分探索にはしない**（設計書 §4.9）。

- [ ] **Step 4: 下向きの歩きにも上限を掛ける**

`while d > 0 and ...` は現在上限を持たない。`MAX_WALK` を掛け、超えたら
`compound_deposit_search_limit` として数える。

- [ ] **Step 5: 緑を見る。歩数も見る**

10 件が解けるだけでなく、**歩数が数歩に収まる**ことを assert する
（「解けた」だけだと、種が悪いまま `MAX_WALK` を上げても緑になる）。

Run: `cd reference && uv run pytest tests/test_compound_ref.py -q`
Expected: PASS

- [ ] **Step 6: 生成器側の期待を 10 → 0 にする**

Task 1 Step 4 のテストの `compound_deposit_search_limit` を 0 にする。

Run: `cd reference && uv run pytest -q`
Expected: PASS

- [ ] **Step 7: commit**

```
Seed the deposit search from the after-tax target, not the pre-tax one
```

---

### Task 3: 層（Stratum）の骨格と `stratum` ラベル

**Files:**
- Modify: `reference/src/calcarc_reference/corpus_calls.py`
- Modify: `reference/tests/test_generate_corpus.py`

**Interfaces:**

```python
@dataclass(frozen=True)
class Stratum:
    op: str
    name: str
    expect: str          # "ok" | "SyntaxError" | "Overflow"
    minimum: int
    build: Callable[[random.Random, int], dict]

    @property
    def key(self) -> str:  # "loan_forward/residual_zero"
        ...

FINANCE_STRATA: tuple[Stratum, ...] = (...)
```

**層の一覧は 1 か所にしか置かない。** §9 のテスト・§6 の変異・D+E のレポートが
同じ文字列を別々に組み立てると、片方だけ直る事故が起きる。

- [ ] **Step 1: `Stratum` と `key` を書く。層はまだ 1 つも足さない**

- [ ] **Step 2: 既存の `FINANCE_BOUNDARIES` を層に移す**

いまの名指し境界は既に「名前の付いた層」である。`stratum` を持たせるだけで
中身は変えない。**この Task ではケースの内容を 1 件も変えない**——次の Task から
足す。

- [ ] **Step 3: 全 finance ケースに `stratum` を付ける**

乱択で作られたケースは `"{op}/random"` に入る。`_finance_entry` の戻り値に
`"stratum"` を足す。**`SCHEMA` は 1 のまま上げない**（設計書 §4.8）。

- [ ] **Step 4: 4.11 の 1 と 10 をテストにする**

- 全 finance ケースが `stratum` を持ち、その値が `FINANCE_STRATA` の
  `key` 集合（＋ `"{op}/random"`）に存在する
- 全層について `count >= minimum`

- [ ] **Step 5: この Task では緑で終える**

`minimum` は骨格の段階では**すべて 0** にする。`loan_forward/residual_zero` に
100、`loan_bonus_forward/bonus_zero` に 30 を入れると現在の生成器では落ちるが
（実測 2 件・1 件）、その赤を直すのは Task 6 である。**赤いテストを抱えたまま
コミットしない**ので、値は Task 6 Step 1 で入れて、そこで赤を見る。

仕組み側は先に固定できる: `minimum` を 1 つでも満たさない層があれば落ちる、
という**テスト自身の反証可能性**を、架空の層を足して確かめる。

Run: `cd reference && uv run pytest tests/test_generate_corpus.py -k stratum -q`
Expected: PASS（下限はまだ 0。テストが働くことは架空の層で確かめてある）

- [ ] **Step 6: commit**

```
Give every finance case a stratum, and a place to state its minimum
```

---

### Task 4: 因子と水準・名指し異常系

**Files:**
- Modify: `reference/src/calcarc_reference/corpus_calls.py`
- Modify: `reference/tests/test_generate_corpus.py`

**Interfaces:**

```python
RATE_LEVELS: tuple[tuple[str, str], ...]      # (値, "ok" | "SyntaxError")
TERM_LEVELS: tuple[tuple[int, str], ...]      # 16 種
PERIODS_PER_YEAR_OK = (1, 2, 12)
PERIODS_PER_YEAR_BAD = (0, 4, 13)
ERROR_PATHS: tuple[tuple[str, str], ...]      # (経路名, 発生元)
```

- [ ] **Step 1: 水準表を設計書 4.2 から 1 文字ずつ写す**

金利 11 種、期間 16 種、周期 3+3 種。**`4` は乱択層から外す**
（`PERIODS_PER_YEAR` を `PERIODS_PER_YEAR_OK` に差し替える）。

- [ ] **Step 2: 設計書 4.5 の 16 経路に各 5 件以上の層を作る**

経路の一覧は Rust のガードから起こしたものが設計書にある。**推測で足さない。**

- [ ] **Step 3: 4.11 の 4・5・6・7 をテストにする**

- 16 経路すべてが 1 件以上現れる
- 乱択層に `periods_per_year = 4` が 1 件も無い
- 正常の 1・2・12 がほぼ均等（最小 ≥ 最大 × 0.8）
- `0 < r < 0.1` の正常が 1 件以上、小数 4 桁が 1 件以上
- 名指し期間 16 種がすべて 1 件以上

- [ ] **Step 4: 期待どおりのエラーが出ることを確かめる**

エラー層は `expect` に `SyntaxError` / `Overflow` を宣言している。
**参照実装が返した種別と宣言が食い違ったら落とす**——「エラーになるはず」と
書いた入力が実は正常だった、を緑のまま許さない。

Run: `cd reference && uv run pytest tests/test_generate_corpus.py -q`
Expected: PASS

- [ ] **Step 5: commit**

```
Name the levels and the error paths, instead of drawing for them
```

---

### Task 5: 税の境界層

**Files:**
- Modify: `reference/src/calcarc_reference/corpus_calls.py`
- Modify: `reference/tests/test_generate_corpus.py`

- [ ] **Step 1: 設計書 4.6 の 7 つの利息を構成で作る**

`ppy=1, periods=1, deposit=0, rate="0.0001"` なら利息は `floor(元本 / 1e6)`。
狙う利息 0 / 1 / 6 / 7 / 10 / 19 / 20 に対応する元本を層にする。

- [ ] **Step 2: 跳び目を主張するテストを書く**

**「7 件入っている」ではなく「跳び目を挟んでいる」を主張する。**
国税は 6 → 7 で 0 → 1、地方税は 19 → 20 で 0 → 1。参照実装の税計算を呼んで
その 2 つの跳びを assert する。件数だけ見ると、値を書き間違えても緑になる。

- [ ] **Step 3: 一括切り捨てと個別切り捨てが 1 円ずれる値を決定的に探索する**

`crates/calcarc-core/src/finance/tax.rs` のユニットテストが持つ `2,648,906` を
起点に、**決定的な走査**で見つける。見つけた値は層に焼き付く（再生成一致
ゲートが固定する）。**探索は生成のたびに走ってよいが、乱数を使わない。**

Run: `cd reference && uv run pytest tests/test_generate_corpus.py -k tax -q`
Expected: PASS

- [ ] **Step 4: commit**

```
Build the tax boundaries from the interest they produce
```

---

### Task 6: 構成による正常生成（逆算 op と残価・ボーナス）

**Files:**
- Modify: `reference/src/calcarc_reference/corpus_calls.py`
- Modify: `reference/tests/test_generate_corpus.py`

- [ ] **Step 1: Task 3 で保留した `minimum` を入れて、赤を見る**

`loan_forward/residual_zero` に 100、`loan_bonus_forward/bonus_zero` に 30。

Run: `cd reference && uv run pytest tests/test_generate_corpus.py -k stratum -q`
Expected: **FAIL**（2 / 100、1 / 30）

- [ ] **Step 2: 残価 7 層とボーナス 9 層を設計書 4.2 から作る**

残価は `0` / `1` / 40% / 50% / 元本 − 1 / **元本ちょうど（SyntaxError）** /
**元本超（SyntaxError）**。ボーナスの 50% ちょうどは
`bonus_principal * 2 > principal` なので**正常側**である（`loan_ref.py:289`）。

- [ ] **Step 3: 逆算 op の入力を正算の答から作る**

| op | 構成 |
|---|---|
| `loan_term` | 元本・金利・`n` → `loan_forward` の月額を `payment` に |
| `loan_principal` | 同上 |
| `compound_deposit_for` | 積立額 → `compound_grow` の到達値を `target` に |
| `compound_periods_for` | 期数 `n` → `compound_grow` の到達値を `target` に |

**これは移植ではない。** 作っているのは入力で、期待値はこれまでどおり
参照実装が独立に出す。

- [ ] **Step 4: 逆算の答が 480 / 600 / 1200 付近に落ちる層を作る**

`n` にその値を選べばよい。**乱択で「答がたまたま 600 になる入力」を引く必要が
ない**というのが構成の効き目である。

- [ ] **Step 5: 4.11 の 2 をテストにする**

各 op の正常が 100 件以上。残価 0 の正常 100 件以上、ボーナス 0 の正常 30 件以上。

Run: `cd reference && uv run pytest tests/test_generate_corpus.py -q`
Expected: PASS（Step 1 の赤が消える）

- [ ] **Step 6: commit**

```
Compose the inputs for the inverse ops from the forward answers
```

---

### Task 7: ペアワイズ割付（IPOG）

**Files:**
- Modify: `reference/src/calcarc_reference/corpus_calls.py`
- Modify: `reference/tests/test_generate_corpus.py`

**Interfaces:**

```python
def pairwise(factors: dict[str, Sequence[object]]) -> list[dict[str, object]]:
    """2 因子網羅の行を決定的に返す。**乱数を使わない。**"""
```

- [ ] **Step 1: IPOG を書く。乱数を使わない**

同じ因子表からは常に同じ行が同じ順で出ること。

- [ ] **Step 2: 網羅そのものをテストする**

任意の 2 因子について、その水準の組がすべて 1 回以上現れる。
**「ペアワイズで作った」という主張を見張るのがこのテストの仕事である。**
小さな因子表（3×3×3）で全交差と突き合わせる単体テストも書く。

- [ ] **Step 3: 正常値だけで組む**

エラー水準（`100.0001`、期間 `0`、周期 `4`）を交ぜない。交ぜると行の大半が
エラーになり、2 因子網羅が**正常計算の**網羅にならない。

- [ ] **Step 4: 8 op に割り付ける**

- [ ] **Step 5: 4.11 の 3 をテストにする**（コーパス全体に対して）

Run: `cd reference && uv run pytest tests/test_generate_corpus.py -k pairwise -q`
Expected: PASS

- [ ] **Step 6: commit**

```
Cover the pairs on purpose, and make a test say so
```

---

### Task 8: 非単調層の決定的探索

**Files:**
- Modify: `reference/src/calcarc_reference/corpus_calls.py`
- Modify: `reference/tests/test_generate_corpus.py`

- [ ] **Step 1: `到達 → 未達 → 再到達` の形を決定的に探索する**

期数が 19/20/21 ちょうどとは限らない。**形で探して、見つかった期数を焼き付ける。**

- [ ] **Step 2: `compound_periods_for/non_monotone_net` 層に入れる**

- [ ] **Step 3: 層が空でないことをテストで固定する**

**この層が空になったら §6 の #9（二分探索化）は静かに検出力を失う。**
テストのコメントにその因果を書く——数を守るテストではなく、
**別の場所の検出力を守るテスト**である。

- [ ] **Step 4: 谷であることを assert する**

「3 点の到達／未達が `True, False, True` になっている」ことを、参照実装を
呼んで確かめる。件数だけ見ると、単調なケースが入っていても緑になる。

Run: `cd reference && uv run pytest tests/test_generate_corpus.py -k monotone -q`
Expected: PASS

- [ ] **Step 5: commit**

```
Find the valley that a bisection would jump over, and keep one
```

---

### Task 9: 件数 3,500 と再生成

**Files:**
- Modify: `reference/scripts/generate_corpus.py`
- Modify: `corpus/generated/finance-000.json`（再生成）
- Modify: `docs/corpus-measurements.md`

- [ ] **Step 1: finance だけ独自の件数にする**

`main()` は 15 シャードすべてに同じ `count` を渡している。finance の行だけ
`count` を使わない。**他の 14 枚を 3,500 件にすると golden が全部書き換わり、
B+C と無関係な差分になる。**

- [ ] **Step 2: 層の下限の合計が総件数を超えたら落ちることを確かめる**

**黙って層を削らない。** 総件数を定数で決め打たない（設計書 §4.7）。

- [ ] **Step 3: 再生成する**

Run: `cd reference && uv run python scripts/generate_corpus.py`

**`scripts/generate.py` ではない。** あれは `testdata/*.json`（言語間検証の
golden）を作る別の入口で、Heavy のコーパスは `generate_corpus.py` が作る。

- [ ] **Step 4: 差分が finance の 1 枚だけであることを確かめる**

Run: `git status --short corpus/ && git diff --stat corpus/`
Expected: `corpus/generated/finance-000.json` のみ

**他の 14 枚に 1 バイトでも差分が出たら止まる。** `SCHEMA` を上げていないか、
共有の乱数列に触れていないかを疑う。

- [ ] **Step 5: 再現性ゲートを回す**

Run: `cd reference && uv run pytest tests/test_corpus_reproducibility.py -q`
Expected: PASS

- [ ] **Step 6: 変更前後を記録する**

`docs/corpus-measurements.md` に、2,000 → 3,500 の内訳、op 別の正常件数、
層別の件数、`reference_gave_up` の理由別内訳（10 → 0）を書く。
**設計書 §1 の実測表と同じ形で並べる**——前後が比べられなければ記録の意味がない。

- [ ] **Step 7: commit**

```
Regenerate finance at 3,500, and leave the other fourteen untouched
```

---

### Task 10: Heavy の逆算証明書

**Files:**
- Modify: `web/tests/heavy/calls.spec.ts`
- Modify: `docs/corpus-measurements.md`

- [ ] **Step 1: 設計書 4.10 の 4 つの証明書を書く**

既存のハーネス呼び出しだけで組む。**新しい wasm API も、ハーネスへの計算の
追加も要らない。**比べる値は税 ON なら手取り、OFF なら残高。

- [ ] **Step 2: 正常な逆算ケースだけに掛ける**

エラーを期待するケースには答が無い。

- [ ] **Step 3: 実行時間を測る**

必要期間の証明書だけが O(n)（`n ≤ 1200`）。

Run: `cd web && pnpm heavy`
Expected: 全緑。**現在 26.3 秒からの増分を記録する。10 秒を超えたら
設計書 4.10 の但し書きに従い、層の代表に絞る。判断は測ってから設計書に追記する。**

- [ ] **Step 4: 証明書が反証可能であることを確かめる**

証明書の比較を 1 つ壊すと落ちることを見る（赤確認）。戻しは再編集で行う。

- [ ] **Step 5: commit**

```
Prove the inverse answers are the boundary, not just a number
```

---

### Task 11: Finance 用の欠陥注入 10 種

**Files:**
- Modify: `web/scripts/detection-power.mjs`
- Modify: `docs/corpus-measurements.md`
- Modify: `docs/superpowers/specs/2026-08-19-heavy-finance-strata-design.md`（実測の追記）

- [ ] **Step 1: 設計書 §5 の表から 10 種を書く**

`expectShards` はすべて `["finance-000.json (calls)"]`。#4 #5 #9 はブロック置換。
`from` は**実物のバイト列と一致させる**——A が入れた「変異元不在は明示的に
失敗」が守っているので、ずれれば赤くなる。

- [ ] **Step 2: 「変異中に `cargo test` を走らせない」注記を書く**

変異は Rust の finance を壊すので `cargo test` は当然赤くなる。
`detection-power` は wasm ビルドと heavy しか回さないので影響しない。

- [ ] **Step 3: 一時コミットを打ってから走らせる**

Run: `cd web && pnpm heavy:power`
Expected: 18 変異（既存 8 + Finance 10）。1 変異あたり約 34 秒なので**約 10 分**。

- [ ] **Step 4: 10 種すべてが finance だけを赤くすることを確かめる**

**他のシャードが反応したら、それは Finance の変更が科学計算に漏れている
ということで、それ自体が報告に値する。**期待を実測に合わせる前に理由を突き止める。

- [ ] **Step 5: `minRate` を実測の半分にする。#9 は最低 1 件で担保**

- [ ] **Step 6: 変異が残っていないことを確かめる**

Run: `git status --short && git diff --stat -- crates/`
Expected: 空

- [ ] **Step 7: 実測を記録して commit**

```
Measure what the finance corpus detects, and pin the floors
```

---

### Task 12: B+C のフルスイープ

**Files:** なし（検証のみ）

- [ ] **Step 1: Rust**

Run: `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
Expected: PASS。**`crates/` は変更していないので、ここが赤いなら変異が残っている。**

- [ ] **Step 2: Python**

Run: `cd reference && uv run ruff check . && uv run ruff format --check . && uv run pytest`
Expected: PASS

- [ ] **Step 3: web**

Run: `cd web && pnpm typecheck && pnpm lint && pnpm test && pnpm heavy`
Expected: PASS

- [ ] **Step 4: 差分の範囲を確かめる**

Run: `git diff --stat e9d2387..HEAD -- crates/ corpus/`
Expected: `crates/` 空、`corpus/` は `finance-000.json` のみ

- [ ] **Step 5: `uv.lock` が汚れていないことを確かめる**

Run: `git status --short reference/`
Expected: 空

- [ ] **Step 6: `pnpm heavy:ui` は回さない**

B+C は UI を触っていない。フルスイープは縦積みの末尾（D+E の完了時）に 1 回。

---

## 完了の定義

設計書 §8 をそのまま持ってくる。

- [ ] Finance の正常・異常・Overflow が層として分離されている
- [ ] 残価 0 の正常 ≥ 100、ボーナス 0 の正常 ≥ 30
- [ ] 正の 0.1% 未満と小数 4 桁の金利がコーパスに入る
- [ ] `periods_per_year = 4` が乱択正常群から外れる
- [ ] 税あり必要積立額の探索限界棄却が 0 件
- [ ] 逆算証明書が Heavy 対象にも適用される
- [ ] Finance 変異 10 種が `finance-000.json` だけを赤くする
- [ ] 非単調ケースが層として存在し、#9 が最低 1 件を検出する
- [ ] 層別件数がテストで固定される
- [ ] 再生成後、`finance-000.json` 以外に差分が無い
- [ ] Rust / Python / web の全検査が緑

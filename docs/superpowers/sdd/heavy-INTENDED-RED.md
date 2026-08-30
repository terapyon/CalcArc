# いま `pnpm heavy` は意図して赤い（2026-08-30〜）

**踏んだ人へ: これはあなたの変更が壊したのではない。** 試験空間モデル
`scientific-v1` が、**コーパスに 1 件も入力が無いセル**を指している。

## 赤の文面

```
angle-mode-000.json/inverse_trig/angle_mode-band-function/one_way+pairs:
試験空間モデル「scientific-v1」が、データに無いセルを 4 件指している:
  inverse_trig/angle_mode=Rad
  inverse_trig/function=acos,angle_mode=Rad
  inverse_trig/function=asin,angle_mode=Rad
  inverse_trig/function=atan,angle_mode=Rad
  **これはあなたの変更が壊したのではない可能性が高い。**
  モデルが「ここに入力が 1 件も無い」と言っている。
  (この対象には「まだ測れない軸」に起因する未達も 5 件あるが、それでは
   落としていない。落としたのは上の分だけである)
```

## いつから

**2026-08-30、`scientific-v1` の Task 5**（受け入れ門を値シャードと表示シャードへ
広げた時点）。**Task 4 までは赤くならなかった**——門が呼び出しシャードにしか
掛かっておらず、科学計算は値シャードだからである。

## なぜ赤にしたか

**穴が緑で通るなら、このモデルを作った意味が無い。**

未達は 37 件あるが、**種類が 2 つある**:

| 種類 | 数 | 門 |
|---|---:|---|
| **測れない軸に起因**（帯・文法クラス・演算種別・表示境界） | 30 | **落とさない**。「踏んでいるか分からない」だけで「無い」ではない |
| **本当の穴**（データに無い） | **7** | **落とす** |

**本当の穴 7 件:**

```
inverse_trig/angle_mode=Rad                       Rad で逆三角を計算するケースが
inverse_trig/function=asin,angle_mode=Rad         コーパス 18 枚のどこにも無い
inverse_trig/function=acos,angle_mode=Rad
inverse_trig/function=atan,angle_mode=Rad
combinatorics/path=domain                         組合せの 2,000 件はすべて `ok`。
combinatorics/path=overflow_near                  定義域エラーと溢れは
                                                  `errors-000.json`(9 領域の外)に在る
complex/zero_part=both_zero                       実部も虚部も 0 のケースが無い
```

**`Rad × 逆三角` は着手前に見つけていた**（構造的な穴。`angle-mode` の生成器は
`("sin","cos","tan")` しか通さない）。**残る 3 件はモデルが先に見つけた**
——人が気づいていなかったものである。

## いつ解けるか

**★ 段 B の終わりでは、まだ緑にならない**（2026-08-30 訂正）。

| いつ | 何が消えるか | 残り |
|---|---|---:|
| **段 B**（Task 6〜10。`angle-mode` + `inverse_trig`） | **Rad の逆三角 4 件** | **3** |
| **段 C**（Task 11〜17。残り 7 領域） | `combinatorics` 2 件・`complex` 1 件 | **0** |

**緑になるのは、段 C で `combinatorics` と `complex` を終えたとき**である。

**当初この文書は「段 B が 7 件を埋めるまで」と書いていた**——**段 B は 2 領域
しか扱わないので、7 件と対応しない。** **赤が「減る」ことと「解ける」ことは
別で、あの書き方だと段 B の終わりに緑になると読まれる**——**踏んだ人が
「まだ赤い、何かおかしい」と調べ始める。**

計画は `docs/superpowers/plans/2026-08-30-coverage-model-scientific.md`。

**順序を守ること**——**「モデルが穴を指す」→「それから埋める」**である。
先に埋めると、**モデルが穴を見つけられることを誰も確かめていない**まま先へ進む。

## その間、何が止まるか

**リリースが止まる。マージは止まらない。**

- `heavy-corpus.yml` が走るのは **`workflow_dispatch`（手動）と `workflow_call`
  （`release.yml` から）だけ**である（2026-08-30 に現物で確認）
- **毎回の CI（`ci.yml`）が回す `heavy` は、型検査・lint・vitest だけ**——
  コーパス本体は走らない
- したがって **`v*` タグを打つと重量級の段で落ち、本番へは出ない**

**代償の向きは正しい**——**「モデルが本当の穴を指しているあいだは出荷しない」**は、
`unmet > 0` の門が言いたかったことそのものである。

## 急いで出荷したくなったら

**門を緩めない。** 選べるのは 2 つだけである:

1. **穴を埋める**（段 B）
2. **理由付き除外にする**——ただし**理由は実際に走った手順だけを書く**。
   「作れない」と書けるのは、**作ろうとして作れなかったとき**だけである
   （第 1 段階で 2 回踏んだ型）

**「測れない軸」に振り替えるのは禁じ手である。** 宣言には番人が付いており
（`test_a_declared_unmeasurable_axis_is_never_observed`）、**観測できる軸を
「測れない」と宣言すると落ちる。**

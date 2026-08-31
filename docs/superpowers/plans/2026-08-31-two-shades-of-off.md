# 押せないキーを 2 段に分ける — 実装計画（0.7.0）

**設計書**: [`specs/2026-08-31-two-shades-of-off.md`](../specs/2026-08-31-two-shades-of-off.md)
（**裁定 2 件とも決着済み**。実行者が決められないものは残っていない）

**Goal**: **押せないキーを「この盤面では使えない」と「いまだけ使えない」の 2 段に分け、
散文でしか守っていなかった区別を、型と見た目に上げる。** **計算は 1 行も動かない。**

**基点**: `origin/main` = `2ef7a7b`（**着手時に当て直すこと**——この SHA は書いた日の座標）

---

## この計画が立っている実測（2026-08-31、着手前）

```
淡さは 1 種類          .key:disabled { opacity: 0.4 }（Key.module.css）
漏斗は 3 段            盤面 keyDisabled → Keypad.tsx:20 → Key.tsx:29
「永久」は静的         DEAD_OPERATOR_TOKENS 7 個 ∪ token === null
呼ぶ盤面は 3           DataScalePanel:123 / TransferPanel:139 / LlmPanel:216
keyDisabled は 5 盤面  Convert:207 / DataScale:122 / Transfer:138 / LLM:215 / Finance:406
                       （Scientific は持たない＝押せないキーが 0 個）
既存の見た目の検査は 1 本  convert.spec.ts:721 shows unpressable currency keys as unpressable
その中の読み方          `opacity=${style.opacity} cursor=${style.cursor}` の Set 一致
```

**★ `vertical-slice.spec.ts` に押せない／`opacity` の主張は 0 行**である（grep で確認）。
**最初この計画の元になった spec は、存在しないテストを引いていた。**

---

## Global Constraints

- **計算ロジックを触らない。** `crates/` は 1 行も動かない
- **キーの増減をしない。** どのキーが在るかは変えず、**見せ方と型だけ**
- **枠（5×5）を触らない。** `panel-sizing.spec.ts` の 366px / 67px は動かさない
- **`--amend` しない**（押し出し後は特に）
- **コミット前に `git update-index --really-refresh` → `git diff HEAD`**
  ——**この機械は 2026-08-30 に 3 バイト化けており、`git status` は「変更なし」と言った**
- **長い Playwright（`heavy:ui`）は手元で回さない**（**3 回とも segfault**）。**GitHub で**
- **node は `.nvmrc`**（24.19.0）。`nvm use`（引数なし）で木の pin を読む

---

## 段構成（3 段・7 Task）

```
段 A  型を通す        Task 1〜3   見た目は変えない。全部緑のまま通る
段 B  見た目を分ける   Task 4〜5   ここで初めて画が変わる
段 C  固める          Task 6〜7   検査と対比
```

**段 A だけで止めても、製品は壊れない**（型が増えるだけで挙動は同じ）。

---

## 段 A: 型を通す

### Task 1: 表を**導出**する（測らない）

**やること**: `isDeadOperator` ∪ `token === null` から、**盤面ごとの永久／一時の表**を
機械的に出す。**打鍵しない。**

```
永久 = token === null
     ∪ DEAD_OPERATOR_TOKENS（lparen rparen div mul sub add eq）
       ただし isDeadOperator を呼ぶ 3 盤面（DataScale / Transfer / LLM）でのみ
一時 = それ以外の keyDisabled の true
```

**★ 打鍵は検算に回す。** **導出が「一時」と言ったキーが、実際に生き返る操作を
1 つ見つける**。**見つからなければ導出が疑わしい**（あるいは到達不能な一時である
——**そう分かったら書き留める。直さない**）。

**止まる点**: **導出と検算が食い違ったら止めて報せる。** **これは設計の分岐である**
——「到達不能な一時」が在るなら、それを永久に寄せるかどうかは裁定が要る。

**赤確認**: この Task はコードを変えないので**置けない**。**代わりに Task 2 のテストが
守る**——表が間違っていれば、そこで赤くなる。

### Task 2: 表を固定するテストを置く（**まだ型は変えない**）

**やること**: `web/src/ui/Keypad/offness.test.ts`（新規、名前は任意）に、
**Task 1 の表を主張として書く**。**この時点では `keyDisabled` を読んで、
「永久であるべきキー」が全部 true であることまで**——2 段の区別はまだ無い。

**赤確認**: **`DEAD_OPERATOR_TOKENS` から 1 つ落とす** → 該当の盤面で赤くなる。
**`isDeadOperator` の呼び出しを 1 盤面から消す** → その盤面で赤くなる。

**止まる点**: **`Set` の一致で書く**（件数だけにしない）。**同じキーが 2 つ在って
別のキーが 1 つ欠けても数は合う**——昨夜これで 1 度やり直した。

### Task 3: 型を置き換える（漏斗 3 段とも）

**やること**:

```
5 盤面        keyDisabled(token): boolean
              → keyOff(token): null | "permanent" | "transient"
Keypad.tsx:20 disabled?: (token: T) => boolean
              → off?: (token: T) => null | "permanent" | "transient"
Keypad.tsx:77 受け渡しを新しい形へ
Key.tsx:29    disabled?: boolean → off?: "permanent" | "transient"
Key.tsx:50    const off = reserved || disabled === true
              → reserved は "permanent" に合流（§1.1 の裁定 A）
```

**★ `disabled?: boolean` を廃したこと自体を検査で固定する。** **残っていれば、
A1 と同じ「永続を一時の口に入れる」事故がまた通る。**

**置き方（案）**: `tools/check-boundary.mjs` と同じ流儀で、**`Key.tsx` と `Keypad.tsx` に
`disabled?: boolean` の宣言が無いこと**を見る 1 行の検査。**`grep` の否定なので、
「無いこと」を主張する形になる**——**そう書く。**

**赤確認**: **`Key.tsx` に `disabled?: boolean` を戻す** → その検査が赤くなる。

**止まる点**: **見た目はまだ変えない。** 段 A が終わった時点で
**`opacity: 0.4` は 1 種類のまま**で、**全部の検査が緑**であること。

---

## 段 B: 見た目を分ける

### Task 4: 形と読み上げを足す（**濃さは補助**）

**やること**:

- `Key.module.css` に **`"permanent"` の段**を足す（**形**——破線の縁など）
- `Key.tsx` が **`aria-describedby`** で説明を付ける（**`aria-label` に足さない**
  ——`getByRole("button", { name })` でキーを拾うテストが広範に壊れ、
  `vertical-slice.spec.ts:99` の「全キーに accessible name」も揺れる）
- **濃さは補助**として併用してよい

**赤確認**: **`"permanent"` の段を消す** → Task 6 の検査が赤くなる（**Task 6 が先に
無いと赤確認が置けないので、Task 4 と 6 は続けて進める**）。

### Task 5: 撮って判断する（**条件つきの裁定がここで解ける**）

**やること**: **before と after を同じ画角で撮り、67px のキーで形の差が見えるかを
判断する。**

```
cd web && pnpm exec vite build && pnpm preview &     # 4179
390×844、6 route（#scientific #convert/length #scale/data-scale
                  #scale/llm #scale/transfer #finance）
display-main が出るまで待ってから撮る
ss -lptn 'sport = :4179' の pid を kill  ← pkill -f "vite preview" では落ちない（実測）
```

**★ before は撮り直す。** 2026-08-31 に撮ったものは `/tmp` に在り、
**この機械は 2026-08-30〜31 に 2 回不正常停止している**——**再起動で消える。**

**止まる点**: **見えなければ、そこで止めて報せる。** **設計書の条件どおり
「濃さ ＋ 読み上げ」に落とす**——**これは裁定済みの分岐なので、勝手に決めてよい。
ただし「見えなかった」を報告に書く。**

---

## 段 C: 固める

### Task 6: 見た目の検査を 3 群に広げる

**やること**: `convert.spec.ts:721` の `currencyKeyLooks` と**同じ流儀**で、
**3 群が computed style で分かれることを主張する**:

```
生きている        opacity=1   cursor=pointer   border-style=...
永久に押せない     opacity=... cursor=default   border-style=dashed など
いまだけ押せない   opacity=... cursor=default   border-style=...
```

**★ `border-style` を読む**（形で分けるなら）。**`opacity` と `cursor` しか読まないと、
「見た目で分けた」と書いてある検査が、見た目の差を見ていない。**

**件数も主張する**（Task 1 の表の数）。**ループが 0 周でも緑にならないように。**

**★ jsdom では見ない**（CLAUDE.md の規律）。**E2E で実ブラウザに。**

**赤確認**: **2 群を同じ見た目に戻す** → 集合が 3 でなく 2 になって赤くなる。

### Task 7: 対比と、押下台帳の確認

**やること**:

- **before / after を並べる**（**Transfer が分かりやすい**——5×5 の右 2 列。
  **Scientific は 25/25 が生きている**ので対照）
- **押下台帳は不変のはず**——**キーの数も配置も変えない**。**走行前に予測を固定し**、
  **`heavy:ui` は GitHub で**（**この作業台では 3 回とも segfault**）
- **フルスイープ 1 回**（`cargo` / `wasm-pack` / `web` / `heavy` / `reference`）

**止まる点**: **押下台帳が動いたら止めて報せる。** **動かない前提が崩れている。**

---

## この計画が持っている見込み（**すべて実測前**）

| | 見立て |
|---|---|
| Task 1・2 | **小**。導出と、それを固定する 1 ファイル |
| Task 3 | **中**。5 盤面 ＋ `Keypad.tsx` ＋ `Key.tsx` の署名 |
| Task 4・5 | **小**。CSS の 1 段と `aria-describedby`。**撮影は往復 1 回** |
| Task 6 | **中**。E2E を 3 群へ |
| Task 7 | **小**。ただし `heavy:ui` は GitHub 待ち |

**全体: 中。** **計算は 1 行も動かない。**

---

## Self-Review（この計画を書いた側の点検）

- **Task 1 の赤確認が置けない**——コードを変えないため。**代わりに Task 2 が守る**と書いた
- **Task 4 の赤確認は Task 6 に依存する**——**先に赤くする対象が無い**ので、
  **4 と 6 を続けて進める**と書いた。**分けて出すと、4 の時点で「置けない」が出る**
- **「到達不能な一時」が出たら設計の分岐**——Task 1 の止まる点に書いた
- **`—` を永久側に合流させる**ので、**`reserved` の分岐が `Key.tsx` から消えるわけではない**
  （`token === null` は残る）。**消えるのは「別の見た目」だけ**である

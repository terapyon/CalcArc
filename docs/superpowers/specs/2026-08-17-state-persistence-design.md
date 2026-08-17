# P-1 設定の永続化 — 設計

日付: 2026-08-17
対象: `web/src/settings/`（新設）、`web/src/ui/useSetting.ts`（新設）、
`ScientificPanel.tsx` / `DataScalePanel.tsx` / `FinancePanel.tsx`、
`crates/calcarc-core/src/{numeric/angle.rs, engine/state.rs}`（`ALL` の追加のみ）、
`crates/calcarc-wasm/tests/token_parity.rs`。
前提: **main（`796f522` = `v0.2.0`）から**。同じ 0.2.1 の `fix/keypad-360px` とは
独立で、触るファイルが重ならない。
状態: **設計承認済み（ユーザー、2026-08-17）。未実装。**

## §0.0 この spec が守ること

**新しい節を書くときは、全節を読み直さず、この 5 行とだけ突き合わせる。**

1. **計算に 1 行も触らない。** `calcarc-core` の変更は enum に `ALL` を足すことだけ
2. **`EngineState` の不透明さを壊さない。** TS 側は中身を読み書きしない
   （`web/src/calc/types.ts:93`）
3. **`web/src/settings/` に React を import しない。** `web/src/calc/` と同じ境界
4. **保存できなくても計算は 1 つも損なわれない。** 保存は副次的な機能である
5. **入力した数値を 1 バイトも保存しない。** 保存するのは設定だけ

**破っているものは無い。**

## §0 位置づけ

base-spec §40（Local Storage）は「設定・表示モード・Calculator State・必要に応じて
履歴」を保存可能とする、と書いたまま **0.2.0 まで 1 行も実装されていなかった**
（`localStorage` / `IndexedDB` の grep が 0 件）。`EngineState` は
`STATE_SCHEMA`（`engine/state.rs:14`、現在 6）を持っており、その doc comment は
「**本スライスでは保存しないが、後から足すと既存データが扱えなくなるため最初から
持たせておく**」と書いている。**受け皿は Scientific にだけ用意されていて、
他の 2 タブには無い。**

0.2.1 でここに手を付ける。**ただし §40 の全部ではなく、設定だけ。**

## §1 裁定（ユーザー、2026-08-17）

1. **保存するのは設定だけ。** 打ちかけの式・途中の数字・答は**保存しない**。
   リロードで式が消えるのは、直さない
2. **読めないときは項目ごとに検査し、読めるものだけ使う。** 1 項目が壊れても
   他の項目は生き残る
3. **構成は案 A** ——純粋なモジュール（`web/src/settings/`）＋薄い React の糊
   （`web/src/ui/useSetting.ts`）
4. **0.2.1 に含める**（360px の修正と同じリリース）

## §2 いま在るもの

**3 タブは状態の持ち方がまったく違う。**

| タブ | 状態 | 版数 |
|---|---|---|
| Scientific | `EngineState` 1 個。serde で直列化でき、WASM 境界を素の JS オブジェクトで往復する | `STATE_SCHEMA = 6` |
| Data Scale | `useState` 5 個（`active` / `count` / `dimensions` / `dtype` / `primary`。`DataScalePanel.tsx:52-59`） | 無し |
| Finance | `useState` 7 個（`mode` / `periodsPerYear` / `withholding` / `active` / `amounts` ほか。`FinancePanel.tsx:221-233`） | 無し |

**`EngineState` は TS 側で不透明である**（`types.ts:93`）。web 層は中身を読めず、
受け取ってそのまま返すだけ。**この設計は壊さない**（§4 でその必要が無いことを示す）。

**`DisplayState` は `angle` / `form` / `notation` を TS へ渡している**
（`types.ts:81-83`）。**保存する文字列は Rust の serde が書いたものである。**
ここが §5 の parity が効く経路になる。

**タブを移ると状態は消える。** `App.tsx` は条件描画（`module === "scientific" &&
<ScientificPanel />`）なので、タブを移った時点で unmount する。つまり
「リロードで消える」は症状の半分で、**タブを往復しても消える**。設定の永続化は
この両方に効く。

**描画を止めているのは Scientific だけである**（`ScientificPanel.tsx:60` の
`if (!calc || !step)`）。**Data Scale と Finance は即描画する**——`failed` の
ときだけ差し替えるが、読み込み中は止めない。

**それでも復元が 1 フレーム遅れて見える瞬間は無い。理由は 2 つに分かれる:**

- **Scientific**: 復元は WASM の読み込み完了後に走るが、その間パネルは
  描画されていない
- **Data Scale / Finance**: 復元は `useState` の遅延初期化で、**同期的に**
  最初の描画より前に読み終わる

（2026-08-17 訂正。当初この節は「3 パネルとも WASM 待ちで止める」と
書いていたが、実際に止めているのは 1 つだけだった。結論は変わらないが、
理由が違う——そして §3 の `localStorage` を選ぶ理由が、この訂正で変わる。）

## §3 保存する物と形

### 保存する（設定のみ）

| タブ | 項目 | 取り得る値 | 出どころ |
|---|---|---|---|
| Scientific | `angle` | `Deg` \| `Rad` | Rust `AngleMode` |
| Scientific | `form` | `Rect` \| `Polar` | Rust `DisplayForm` |
| Scientific | `notation` | `Normal` \| `Eng` | Rust `Notation` |
| Data Scale | `dtype` | `DATA_TYPE_TOKENS` の 9 件 | Rust `DataType` |
| Data Scale | `primary` | `decimal` \| `binary` | UI のみ（`DataScalePanel.tsx:44`） |
| Finance | `mode` | `PanelMode` の列挙 | UI のみ（`FinancePanel.tsx:107`） |
| Finance | `periodsPerYear` | `1` \| `2` \| `12` | UI のみ |
| Finance | `withholding` | `true` \| `false` | UI のみ |

### 保存しない（理由付き）

- **打鍵中の値**（`buffer` / `operands` / `count` / `dimensions` / `amounts`）
  ——§1-1 の裁定
- **`active`**（どの項目にフォーカスしているか）——入力状態であって設定ではない
- **`sexagesimal_view`**——S-4 設計書 §3.1 が「設定ではなく覗いている一時状態、
  AC でも解除される」と裁定済み
- **`error`**——一時状態
- **表示中のタブ**——URL のハッシュが既に持っている。二重に持つと食い違う
- **履歴**——§1-1 の範囲外。base-spec §40 の「必要に応じて履歴」は未着手のまま

### 形

`localStorage` のキー **1 本**（`calcarc.settings`）に JSON を 1 つ。

```json
{ "v": 1, "scientific": { "angle": "Rad" }, "dataScale": { "primary": "binary" }, "finance": { "mode": "compound" } }
```

**タブごとにキーを分けない。** 3 本に分けると版数が 3 つになり、片方だけ上げ忘れる
余地ができる。

**初期値と同じ項目は書かない**（上の例に `notation` が無いのはそのため）。保存が
小さくなるだけでなく、**「一度も触っていない設定」と「初期値に戻した設定」を
区別しないと決めること**でもある。区別する必要が出たら、そのときに設計し直す。

### `localStorage` を選ぶ理由

base-spec §40 は `localStorage` と `IndexedDB` を候補に並べている。**`localStorage`
を採る。理由は 2 つある。**

1. **`IndexedDB` なら Data Scale と Finance は初期値が一瞬見える。** あの 2 つは
   WASM を待たずに描画するので（§2）、非同期に読んだ設定は**最初の描画より後**に
   届く。`float32` が出てから `int8` に変わる。同期で読める `localStorage` には
   この段が無い
2. **数十バイトのために非同期の待ち行列をもう 1 本増やす利益が無い。** 読み書きが
   同期で済み、復元経路が分岐しない

（2026-08-17 訂正。当初この節は「1 は起きないので理由は 2 だけ」と書いていた。
§2 の事実誤りに引きずられた誤りで、**1 のほうが決定的な理由である**。）

## §4 復元の経路

### Scientific — キーを replay する

`AngleToggle` / `PolarToggle` / `EngToggle` は、**どれも自分の欄だけを入れ替える
トグル**である（`engine/mod.rs:387` の comment:「表示の切り替えであって計算では
ないので `commit_entry` を呼ばない」）。取り得る値も 2 つずつしかない。

したがって復元はこうなる:

1. `initial()` を呼ぶ
2. `step.display.angle` が保存値と違えば `angle_toggle` を 1 回送る。
   `form` は `polar_toggle`、`notation` は `eng` で同様
3. 一致していれば何も送らない

**最大 3 回の `dispatch` で済み、`EngineState` の中身に触らない。**
Rust も WASM の輸出も 1 行も変わらない。**復元後の状態は定義上「利用者が押して
到達できる状態」**になり、engine が知らない状態が生まれる余地が無い。

**キーの綴りは `KEY_TOKENS` にある既存のもの**（`angle_toggle` / `polar_toggle` /
`eng`。`key.rs:88,97,98`）を使う。新しいトークンは足さない。**盤面のラベル
（`DRG` / `▸∠` / `ENG`）とトークンの綴りは別物である**——ラベルで書くと、
実装のときに存在しないトークンを探すことになる。

### Data Scale / Finance — `useState` の遅延初期化

`useState<Primary>(() => loadSettings().dataScale.primary)` のように、読んだ値を
そのまま初期値にする。**遅延初期化（関数を渡す形）にする**——値を渡す形
（`useState(loadSettings().dataScale.primary)`）だと、**描画のたびに
`localStorage` を読み直す**ことになる。

**初回描画から復元後の値になる。理由は「描画を止めているから」ではない**
——止めているのは Scientific だけである（§2）。この 2 つは WASM を待たずに
描画するが、`useState` の遅延初期化は**同期的に**、最初の描画より前に読み終わる。

（2026-08-17 訂正。当初この節は「パネルは WASM 待ちで描画を止めているので」と
書いていた。§2 で訂正した事実誤りが、この節に残っていた——結論は変わらないが、
理由が違う。）

**`active`（打っている項目）は保存しないが、復元したモードから導く。**
保存しない値でも、**保存した値と食い違ってはいけない**——借入可能額モードでは
借入額が答なので入力できず、`active` を既定の `principal` のまま始めると、
無効なタブが押下状態で「借入額を入力中」と名乗り、打鍵が計算に使われない欄に
落ちる。モードキーの handler が切り替えのときにやっている正規化
（`fieldEnabledIn` で最初に打てる項目へ移す）を、復元にも掛ける。

## §5 検証と `v` の契約

### 項目ごとの白リスト

検証は**型ではなく、取り得る値の列挙**と突き合わせる。`"Rad"` は通り、`"Zzz"` は
落ちる。**落ちた項目だけが初期値になり、他の項目は生き残る**（§1-2）。

白リストは実行時に列挙できる配列でなければならない。現状:

- `DATA_TYPE_TOKENS` は**既に配列としてある**（`web/src/datascale/types.ts:9`）。
  そのまま使う
- `AngleMode` / `DisplayForm` / `Notation` は **TS 側が型の union だけ**
  （`web/src/calc/types.ts:2-8`）で、実行時に列挙できない。**配列を新設する**
- `primary` / `mode` / `periodsPerYear` / `withholding` は UI のみの概念。
  配列は `web/src/settings/types.ts` に置く

### `v` は移行の仕組みではない

**移行関数は 1 つも書かない。** 将来「意味は変わったが綴りは有効なまま」という値が
出たときは、**版を上げるのではなくキーの綴りを変える**——綴りが変われば白リストが
知らない値として落とすので、それ以上の仕掛けが要らない。

`v` を残すのは、いつか「**この版より古い保存は丸ごと捨てる**」が必要になったときの
唯一の手掛かりとしてである。`v` は `1` から始める。

**`STATE_SCHEMA`（= 6）は使わない。** あれは保存しない `EngineState` の版である。

### 知らないキーは捨てる

書き戻しは「いま知っている設定」から作り直す。知らないトップレベルのキーは消える。
旧いビルドへ戻る経路が実質無い（Service Worker は前へしか進まない）ので、持ち越しの
複雑さに見合わない。

**Convert / Scale のタブが増えたとき**（`docs/unit-data-sscal-spec.md`）は、
**そのタブの節を足すだけ**で、既存の節は影響を受けない。

## §6 書き込みと失敗

**契機**: 設定が変わったその場で書く。デバウンスしない——設定の変更は人間がボタンを
押す速度でしか起きず、書くのは数十バイトである。

**失敗は飲む。** `localStorage` は使えないことがある（Safari のプライベートモード、
ストレージ無効、容量超過）。読み書きは例外を飲み、**失敗しても計算は 1 つも
損なわれない**（§0.0-4）。

**「保存に失敗しました」の通知は出さない。** 設定が残らないという副次的な不便の
ために、計算画面に警告を出すのは割に合わない。

**`Storage` は引数で受ける。** `readSettings(storage)` / `writeSettings(storage, next)`
とし、`localStorage` を直接掴まない。壊れた JSON・知らない値・例外を投げる `Storage`
の分岐が、**すべて React の外で試せる**。

## §7 プライバシー（base-spec §41）

保存するのは設定だけで、**入力した数値は 1 バイトも保存しない**。
「Calculation data stays on the user's device」に対して、そもそも計算データを保存
しない側に倒している。README の「計算は端末内で完結し、サーバへ送信しない」も
変わらない。

**base-spec §40 に「実装した範囲」を追記する**——設定は実装済み、Calculator State と
履歴は未着手、と書き分ける。

## §8 検証

**4 段に分ける**（毎回全レイヤーは回さない）。

| 段 | 何を守るか |
|---|---|
| **vitest（純粋）** | 白リストで落ちる／落ちない、壊れた JSON、`v` 違い、`Storage` が例外を投げる、初期値と同じ項目を書かない、知らないキーが消える |
| **vitest（パネル）** | 保存された設定が**初回描画から**効いている |
| **cargo（parity）** | `AngleMode` / `DisplayForm` / `Notation` の白リストと Rust の enum の一致。**3 件を新設** |
| **E2E** | リロードで**設定が残ること**と、**打った式が残らないこと**の両方。タブ往復でも設定が残ること |

### E2E の 2 本目が今回いちばん大事

**「設定が残る」だけを測ると、うっかり全部保存してしまった実装も緑になる。**
今回の範囲は設定だけなので、**残らない側にも番人を置く**——リロード後に
`display-main` が `0` に戻っていること、Finance の金額欄が空に戻っていることを
測る。これが無いと、§1-1 の裁定が検査に写らない。

### parity の作り方

`token_parity.rs` は既に `KEY_TOKENS` と `DATA_TYPE_TOKENS` の 2 件を守っている
（TS のソースを `include_str!` で読み、Rust 側と突き合わせる）。**同じ形で 3 件足す。**

Rust 側の文字列は**手で書かず serde に書かせる**。保存されるのは
`DisplayState` 経由で TS へ渡った Rust の serde の出力（§2）なので、
**「serde が書く綴り」と「白リストが受け付ける綴り」を直接突き合わせる**ことに
なり、経路と検査が一致する。

そのために `AngleMode` / `DisplayForm` / `Notation` に `ALL` を足す
（`Key::ALL` と同型）。**core の変更はこれだけで、計算には触らない。**

### 赤確認

実装前に、次の 2 つが赤くなることを確認する:

1. **書き込みを外す** → E2E の「設定が残る」が赤くなる
2. **白リストの 1 項目を緩める**（未知の値を通す）→ vitest が赤くなる

## §9 スコープ外

- **打ちかけの式の保存**（`EngineState` 丸ごと、Data Scale / Finance の入力値）
  ——§1-1。ここに手を出すときは `STATE_SCHEMA` の出番になる
- **履歴**——base-spec §40 の「必要に応じて履歴」と「利用者が無効化できる設計」。
  表示 UI・削除手段・件数上限・無効化トグルが全部必要になる
- **設定を消す UI**——保存するのが設定だけなら、ブラウザのサイトデータ削除で足りる
- **複数のブラウザタブで同時に開いたときの同期**——最後に書いたほうが勝つ。
  `storage` イベントは購読しない
- **縦が短い画面の溢れ**——`docs/definition-of-done.md` に実測値付きで繰り越し済み。
  0.2.1 の 360px 修正とも、この spec とも独立

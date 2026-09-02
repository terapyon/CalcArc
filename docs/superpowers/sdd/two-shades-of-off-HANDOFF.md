# 引き継ぎ — 押せないキーを 2 段に分ける（0.7.0）

**最初に読むのはこの 1 枚。** 2026-08-31 に段 A まで終えて中断した
（**レビュー役のクレジット切れで 1 日空ける**、というユーザー裁定）。

**あなたが誰であっても、まずここを読んでから設計書と計画書へ。**

- 設計書 [`specs/2026-08-31-two-shades-of-off.md`](../specs/2026-08-31-two-shades-of-off.md)
- 計画書 [`plans/2026-08-31-two-shades-of-off.md`](../plans/2026-08-31-two-shades-of-off.md)
- **枝**: `feature/two-shades-of-off`（**未 push**）。設計書と計画書は別枝
  `docs/two-shades-of-off`（**これも未 push**）

---

## いまどこ

| 段 | Task | 状態 |
|---|---|---|
| **A** | 1 導出 | **完了**（裁定 1 件を消化） |
| **A** | 2 表を固定 | **完了**（`a8c2c93`） |
| **A** | 3 型の置き換え | **完了**（`cda0e68`） |
| B | 4 見た目（形 ＋ 読み上げ） | **未着手。ここから** |
| B | 5 撮って判断 | 未着手 |
| C | 6 検査を 3 群へ | 未着手 |
| C | 7 対比と押下台帳 | 未着手 |

**段 A が終わった時点で、見た目は 1 種類のまま**（`opacity: 0.4`）。
**全部の検査が緑**である——`typecheck 0 / lint clean / check:boundary OK /
vitest 380 / e2e 192`。

---

## ★ 済んだ裁定（蒸し返さないこと）

1. **予約スロット `—` は「永久に使えない」と同じ段**（ユーザー、2026-08-31）
   ——利用者にとって、予約スロットと死んだ演算子の違いは意味を持たない
2. **分け方は「形 ＋ 読み上げ、濃さは補助」**（同）。**67px で形が見えなければ
   濃さ ＋ 読み上げに落とす**、という**条件つき**
3. **★ 通貨キーは「いまだけ使えない」側**（同）
   ——**`—` は永久に何も来ないが、通貨キーは数秒後に押せるかもしれない。
   同じ絵にするのは事実に反する。**
   **守れていない道**: **レートが永久に届かない環境**（オフラインのまま、
   プロバイダが落ちている、レート表に無い通貨）**では、利用者は「永久に押せない
   キー」を「いまだけ」の見た目で見続ける**——**承知のうえで採った。**
   **「あれは永久にすべきでは」と思ったら、この行を読んでから。**

---

## 次の一手（Task 4）

**`Key.module.css` に `"permanent"` の段を足し、`aria-describedby` で説明を付ける。**

- **`aria-label` に足さない**——`getByRole("button", { name })` でキーを拾う
  テストが広範に壊れ、`vertical-slice.spec.ts` の「全キーに accessible name」も揺れる
- **`aria-describedby` はこのリポジトリに 0 件**。**id の振り方も決める**
  （**盤面ごとに 1 つの説明要素を置いて全永久キーが同じ id を指す**形を推す）
- **読み上げ側の検査も同じ Task で置く**（jsdom でよい）——**付いている／id が実在の
  要素を指す／一時には付かない**の 3 つ。**フォールバックに落ちたら、これが
  唯一の区別になる**

**Task 4 の赤確認（形）は Task 6 に依存する**ので、**4 と 6 は続けて進める。**

---

## ★ 止まる点

**段 B の終わり（Task 5 のあと）で必ず止まる。** **そこで初めて画が変わり、
before/after が揃う**——**ユーザーが見てから段 C へ。**
**公開後の最初の版なので、画を見ずに検査まで固めると、直すときに検査ごと
書き直しになる。**

---

## この作業台のこと

- **`git status` を健全性の根拠にしない。** **2026-08-30 に 3 バイト化けて、
  `git status` は「変更なし」と言った。** **コミット前に
  `git update-index --really-refresh` → `git diff HEAD`**
- **長い Playwright（`heavy:ui`）は回さない**——**手元で 3 回とも segfault。
  GitHub では完走する。** **短い e2e（192 件・14 秒）は通る**
- **走行が SIGSEGV / ICE で落ちたら**、**中身で健全性を確かめてから走り直し、
  落ちたこと自体を報告に書く**
- **node は `.nvmrc`（24.19.0）。`nvm use`（引数なし）で木の pin を読む**
- **撮影のあとはプレビューを落とす**——**`pkill -f "vite preview"` では落ちない。**
  `ss -lptn 'sport = :4179'` で pid を特定して kill（2026-08-31 に実測）

---

## 段 A で分かったこと（次に効くもの）

- **「永久」は測る性質ではなく、コードが静的に決めている。** 1 手プローブは
  **一時側を過小に数えることしかできない**——**1 手で生き返らない一時が、
  全部「永久」に化ける。** 旧 §1.4 はそれで 3 件取り違えていた
- **`operators.test.tsx` が既に 3 盤面を描き、漏斗 3 段を通していた**
  （0.5.0 の A1）。**新しいファイルを作らず、そこへ足した**
- **「`data-token` が無い＝予約スロット」は偽。** `Key.tsx` は
  `token === null && !onActivate` を予約と見るので、**面を切り替えるキーも
  `data-token` を持たない**。**盤面（`Keypad` が包む `div`）の中に絞る**
- **番人の否定 grep は、行頭の prop 宣言だけを見る。** **JSX は複数行に割れる**
  ので「`<button` を含む行を除く」では足りない

---

## 段 C: 押下台帳の予測（**走行前に固定した。2026-09-02**）

**`heavy:ui` はこの作業台では回さない**（3 回とも segfault）。**GitHub で回す。**
**走る前に予測を書いておく**——**後から数字を見てから理由を書けば、どんな数字にも
理由が付いてしまう。**

| | 予測 |
|---|---:|
| テスト | **37** |
| 総押下 | **19,960** |
| 打鍵ケース | **1,279** |
| 指摘 | **0** |
| 46 トークン全押下 | **✓** |

**基準は `87502d1`（main）の GitHub 走行**（`docs/corpus-measurements.md`。
コーパスは `cancellation` 2002 件）。

### 導出（**「盤面が動いていないから不変」ではない**）

**押下台帳は盤面の不変量ではなくコーパスの関数である**——**これは 3 回外して
いて、うち 2 回は「不変」と書いて外した**（`docs/corpus-measurements.md` の
「押下台帳が動いた」）。**だからコーパスの側を測った:**

1. **枝はコーパスに触れていない。** `git diff --name-only main...HEAD` は
   `web/src/ui/` の Key・Keypad・トークン、`web/tests/e2e/keypad-shell.spec.ts`、
   `tools/check-boundary.mjs`、docs だけ——**`heavy/` `reference/` `testdata/`
   `crates/` は 0 件**
2. **基準走行から枝の基点（`2ef7a7b`）までの間も、生成器は動いていない。**
   `git diff 87502d1..2ef7a7b -- reference/ heavy/ testdata/ crates/` に出るのは
   4 ファイルだが、**`cases.py` の +24 行は全部コメント**（**非コメントの
   追加行 0 行**を実測）、**`find_convert_*.py` の 2 本は生成器から呼ばれない**
   （`generate_corpus.py` に grep して 0 件）、**`heavy/package.json` は
   `engines.node` の 1 行**である
3. **したがってコーパスは 2002 件のまま**で、`selectSample` の刻みも同じ。
   **選ばれるケースが同じなら、押下の合計も同じ**

### 盤面の側も交わらない（**別の根拠**）

- **`heavy` はキーを `aria-label` で拾う**（`reachability.spec.ts`）。
  **予約スロットの `aria-label="空き"` は変えていない**
- **予約スロットは `BUTTON_FOR` に居ない**（トークンを持たない）ので、
  **押下の対象ではない**。**文字を消したのは表示だけ**である
- **押せる／押せないの判定は変えていない**——段 A は `boolean` を
  `"permanent" | "transient" | null` に置き換えただけで、**どのキーが
  押せなくなるかは動かしていない**

### ★ 外れたら

**「予測が外れた」ではなく「導出のどこが間違っていたか」を書く。**
**上の 3 段は検算できる形にしてある**ので、**どの段で外したかが分かる。**

---

## 段 C: 対比（**3 世代ある**）

**画は `/tmp/calcarc-shots-0902/`**（**`/tmp` である。再起動で消える**）。
390×844、fullPage、6 route ＋ 暗いテーマ 2 枚。

| 綴り | 何 | 意味 |
|---|---|---|
| `<route>-before.png` | 0.6.0 の見た目 | **押せないキーは全部 `opacity: 0.4`。予約スロットは `—`** |
| `<route>-after.png` | **破線を入れた版** | **一度採って、撮って、取り下げた証拠**。「逆に目立って押せそう」 |
| `<route>-after3.png` | **結論** | 破線なし・濃さ 1 段・**予約スロットは薄い箱で空欄** |
| `llm-dark.png` / `transfer-dark.png` | 暗いテーマ | **向き（キーより暗い）が保たれていること** |

**`after2` は残していない**（**空欄にして箱が消えた版**）——**`after3` との差は
`--key-empty-bg` の有無だけ**で、**その差は spec の表（差 7 と 4）が数で持っている**。

**Scientific は before と after3 が同じバイト数**（35381）。**押せないキーが
0 個**という当てが、そこで取れている。

---

## 段 C: フルスイープ（**2026-09-02、`78b2f21`**）

```
cargo fmt --check          緑
cargo test --workspace     396
cargo clippy -D warnings   0
wasm-bindgen-test          57   ★ 下記
reference pytest           473
reference mypy             14 files / ruff check / ruff format
web typecheck 0 / biome 139 / vitest 381 / e2e 194
web check:version 5 箇所一致 / check:sw / check:boundary
heavy typecheck / biome 45 / pnpm heavy 250（29.4 秒）
```

**`heavy:ui` は回していない**——**この作業台では 3 回とも segfault**。
**GitHub で回す**（予測は上の「押下台帳の予測」）。

### ★ `wasm-pack test` は、そのままでは通らない（**コードの赤ではない**）

```
Error: failed to create a Chrome session: session not created:
This version of ChromeDriver only supports Chrome version 152
Current browser version is 135.0.7049.52
```

**`wasm-pack` が入れた driver は 152、この機械の Chrome は 135** である。
**キャッシュに 135 用の driver が在った**ので、**`cargo` を直に叩いて通した**:

```bash
cd crates/calcarc-wasm
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER=~/.cache/.wasm-pack/wasm-bindgen-*/wasm-bindgen-test-runner \
CHROMEDRIVER=~/.cache/.wasm-pack/chromedriver-d65213741bcf1a26/chromedriver \
WASM_BINDGEN_TEST_ONLY_WEB=1 cargo test --target wasm32-unknown-unknown
```

**`CHROMEDRIVER` を export しても `wasm-pack` は自分の driver を使う**
（実測——自分でコマンド行に立てるので、環境変数は効かない）。

**★ これは環境の問題であって、直してはいない。** **CI は自前で入れる**ので
向こうでは出ない。**次にここで赤を見た人へ: 版のずれを先に疑う。**

---

## 段 C: 検査が見ていない所（**レビュー指摘、2026-09-02**）

- **e2e の群分けは自己参照である。** 検査 2 本目は「永久＝`aria-describedby` が
  付いている」で群を分けており、**分け方そのものが検査対象の機構**である。
  **`aria-describedby` が全滅したら vacuity guard が捕まえる**が、**一部が
  取り違わったら e2e は鳴らない**——**そこは jsdom（`operators.test.tsx` の
  件数の主張）が守る。★ この 2 本は対である。片方を消すときは、もう片方が
  何を失うかを見ること。**（実証: Transfer の `"permanent"` を `"transient"` に
  1 語変えると、e2e は緑のまま jsdom が
  `no permanent key was described: expected 27 to be 34` で落ちる）
- **★ known gap: `--key-empty-bg` の 3 テーマのうち、検査が見ているのは
  明テーマだけである。** **暗テーマと高コントラストは画で見ただけ**
  （`llm-dark.png` / `transfer-dark.png`。高コントラストは**画も撮っていない**）。
  **Playwright は既定で明テーマ**なので、`colorScheme` / `forcedColors` を
  指定した走行を足さない限り、**あの 2 つのトークンは誰も見張っていない。**
- **`transparent` は数だけ読むと逆に出る。** `rgba(0,0,0,0)` を `[0,0,0]` と
  読むと「黒に向かって合成した」ことになり、**完全に透けているのに地から
  遠い**という答が出る。**`alphaOf` で掛けて塞いだ**（2026-09-02）。
  **この木の色では、直す前も赤にはなっていた**——ただし**上限側**
  （「生きたキーと同じくらい目立つ」）で落ちる、**理由の違う赤**である。
  **地が黒い側（暗テーマ）なら `apart` は 0 になり、正しく下限で落ちる。**

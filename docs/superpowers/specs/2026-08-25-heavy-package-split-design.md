# 重量級テストを独立パッケージへ切り出す（設計書）

2026-08-25

## 1. 何を解くか

**重量級の検証が実装側のパッケージの中に入り込んでいる。** `web/` は
アプリのパッケージだが、その中に重量級だけが使うファイルが **43 本**ある。

| 置き場所 | 本数 |
|---|---|
| `web/tests/heavy/` | 18 |
| `web/tests/heavy-ui/` | 10 |
| `web/scripts/{detection,exact}-power.mjs` | 2 |
| `web/src/heavy-harness.ts` / `web/heavy-harness.html` | 2 |
| `web/vite.heavy.config.ts` / `web/playwright.heavy{,-ui}.config.ts` | 3 |
| **小計（13,241 行）** | **37** |
| `web/tests/unit/` の重量級 6 本（1,374 行） | 6 |

**依存の向きはすでに片方向である。** アプリ側から重量級を参照している箇所は
**0 件**（`web/src/heavy-harness.ts` は `vite.heavy.config.ts` だけがビルドし、
`index.html` からは誰も辿らない）。つまりこれは**解きほぐす仕事ではなく、
移して配線し直す仕事**である。

## 2. 決めたこと

| 論点 | 決定 | 理由 |
|---|---|---|
| パッケージの境界 | **独立パッケージ `heavy/`**（自前の `package.json` と `pnpm-lock.yaml`） | `web/` の lockfile と `setup-web` に一切触らずに済む。workspace 化は lockfile が根へ移り、CI 3 本と `CLAUDE.md` の pnpm 版数の説明まで波及する |
| ハーネスの入口 | **`heavy/` へ移す** | web が重量級の存在を 1 バイトも知らなくなる |
| 重量級のユニットテスト 6 本 | **`heavy/` へ移し、重量級の走行のときだけ回す**（ユーザ裁定） | 毎回の CI からは消える。代わりに**重量級の走行のいちばん最初**に置き、11 分の変異を回す前に数十秒で落とす |
| コマンド名 | **変えない**（`pnpm heavy` / `heavy:ui` / `heavy:power` / `heavy:power:exact`） | 測定記録・報告書・引き継ぎがこの名前で書かれている。変えると文書側が静かに腐る |

## 3. 形——深さを合わせるのが要である

| いま | あと |
|---|---|
| `web/tests/heavy/` | `heavy/tests/corpus/` |
| `web/tests/heavy-ui/` | `heavy/tests/ui/` |
| `web/tests/unit/` の 6 本 | `heavy/tests/unit/` |
| `web/scripts/{detection,exact}-power.mjs` | `heavy/scripts/` |
| `web/src/heavy-harness.ts` | `heavy/harness/heavy-harness.ts` |
| `web/heavy-harness.html` | `heavy/harness/heavy-harness.html` |
| `web/vite.heavy.config.ts` | `heavy/vite.harness.config.ts` |
| `web/playwright.heavy.config.ts` | `heavy/playwright.corpus.config.ts` |
| `web/playwright.heavy-ui.config.ts` | `heavy/playwright.ui.config.ts` |

**この配置は好みではない。** 重量級は**根までの相対パスを 12 箇所**持っていて、
すべて `import.meta.url` から `..` を数えて根を出している。

| 何を読む・書く | どこから | 数え方 |
|---|---|---|
| `corpus/generated/` | `tests/heavy/corpus.ts:47` | `join(HERE, "..", "..", "..")` |
| `corpus/overrides.json` | `tests/heavy/overrides.ts:68`、`report.spec.ts:682` | `../../../` |
| `docs/corpus-measurements.md` | `tests/heavy/report.spec.ts:1840` | `../../../` |
| `reference/tests/test_generate_corpus.py` | `report.spec.ts:912` | `../../../` |
| `reference/tests/test_corpus_entry.py` | `report.spec.ts:2197` | `../../../` |
| `heavy-report.md` / `heavy-run.json` / `heavy-ui-run.json` / `.heavy-summaries/` | `tests/heavy/report.ts:181-198` | `../../` |
| `.heavy-ui-presses/` / `heavy-ui-run.json` | `tests/heavy-ui/presses.ts:34,37` | `../../` |
| 変異対象の `crates/` | `scripts/{detection,exact}-power.mjs:20-26` | `dirname(dirname(...))` の親 |

`heavy/tests/corpus/` は `heavy/` から見て `web/tests/heavy/` と**根から同じ
深さ**にある。だから **12 箇所を 1 文字も変えずに移せる**。`scripts/` も
同じ深さなので、`const WEB` を `const HEAVY` に読み替えるだけで済む
（変数名は意味が変わるので直すが、計算は変わらない）。

**移動を機械的に保てるのはこの一点のおかげであり、深さを崩す配置を選ぶと、
12 箇所が静かに別の場所を指す。**

## 4. パッケージの境界

`heavy/package.json`:

- `name: "calcarc-heavy"`, `private: true`
- `packageManager` は **web と同じ `pnpm@10.32.1`**（CI の `pnpm/action-setup`
  がここを見る）
- 依存: `@playwright/test` / `vite` / `vite-plugin-wasm` /
  `vite-plugin-top-level-await` / `vitest` / `typescript` / `@types/node` /
  `@biomejs/biome`
- スクリプト: `heavy` / `heavy:ui` / `heavy:power` / `heavy:power:exact` /
  `test`（vitest。6 本）/ `typecheck` / `lint`

自前の `pnpm-lock.yaml` / `tsconfig.json` / `biome.json` を持つ。

**web の依存は 1 つも減らない。** `web/tests/e2e` の 27 本が
`@playwright/test` を使い、アプリ自身が `vite-plugin-wasm` と
`vite-plugin-top-level-await` を使っている。**減るのはファイルであって
依存ではない**——「普段の CI が軽くなる」という見込みは成り立たない。

**`heavy/tsconfig.json` は `../web/src` を型検査に引き込む。** ハーネスが
そこから import する以上避けられない。遅くはなるが、**web 側の型が変わったら
heavy の `typecheck` が落ちる**ということでもあり、これは望ましい壊れ方である。

## 5. 実行の経路

### 5.1 wasm は 1 つしか作らない

`web/src/calc/index.ts` は `../wasm/calcarc_wasm.js` を import している。
ハーネスが `../../web/src/calc` を読む以上、**`web/src/wasm` が建っている
必要がある**。

**heavy 側に wasm の複製を作ってはならない。** wasm モジュールが 2 つになると
計算機の状態も 2 つになり、ハーネスが答える値と `calc` が持つ状態がずれる。
heavy は `pnpm --dir ../web wasm` で `web/src/wasm`（生成物、`.gitignore:8`）を
建て、**それを共有する**。

その代償として、**heavy は自立しない**——回すには web の依存も入っている
必要がある。これは設計上の妥協ではなく、盤面を叩く以上避けられない。

### 5.2 コーパス（`pnpm heavy`）

`vite.harness.config.ts` が `harness/heavy-harness.html` を建て、4180 で配る。
ハーネスの import は 2 本とも `../../web/src/…` になる:

```
import { type Calc, initCalc, KEY_TOKENS, type KeyToken } from "../../web/src/calc";
import { compound_deposit_for, …, loan_term } from "../../web/src/wasm/calcarc_wasm.js";
```

`outDir` は `dist-harness`（`web/dist-heavy` の置き換え）。

### 5.3 盤面（`pnpm heavy:ui`）

Playwright の `webServer` に **`cwd: "../web"`** を付け、**web に本物のアプリを
建てさせる**。コマンドは今と同じ `pnpm exec vite build && pnpm exec vite
preview --port 4181 --strictPort`。ポート 4180 / 4181 と
`reuseExistingServer: !process.env.CI` はそのまま——**4180 に別物が居れば
それを掴む**という既知の穴も、その説明ごとそのまま持っていく。

### 5.4 変異（`pnpm heavy:power` / `heavy:power:exact`）

触るのは `crates/` だけなので、根の出し方が同じである限り動く。
`runOneMutation(mutation, { root, measure, verdict })` の注入口も変わらない。

## 6. web 側から消えるもの・残るもの

**消える**:

- 上の 43 ファイル
- `web/package.json` の `heavy` / `heavy:ui` / `heavy:power` /
  `heavy:power:exact` の 4 スクリプト
- `web/tsconfig.json` の `include` から `vite.heavy.config.ts` /
  `playwright.heavy.config.ts` / `playwright.heavy-ui.config.ts` の 3 行

**残る**:

- `web/tests/unit/` は**空にならない**。`check-version.test.ts` が居るので、
  `vite.config.ts` の `test.include` の `tests/unit/**/*.test.ts` と、
  そこに書かれた「Playwright の testDir の外に置く」という理由づけは
  **そのまま生きる**
- `web/src/wasm/`（heavy が使う）

## 7. CI

`heavy-corpus.yml` の `corpus` ジョブの**先頭**に 4 段を足す:

```
- run: pnpm install --frozen-lockfile   (working-directory: heavy)
- run: pnpm typecheck                   (working-directory: heavy)
- run: pnpm lint                        (working-directory: heavy)
- run: pnpm test                        (working-directory: heavy)   ← 例の 6 本
```

pnpm と node は既存の `./.github/actions/setup-web` が用意するので、
**新しい複合アクションは作らない**（版の固定を 2 箇所に写さない）。

`version` ジョブ（`ecb4ad4` で入れた版数ゲート）はそのまま先頭に立つ。
**`ci.yml` と `deploy.yml` は触らない。**

## 8. 文書と `.gitignore`

**生きている案内は直す。** 日付のある記録は直さない。

| 何 | どうする |
|---|---|
| `.gitignore` の **8 行**（`:4,5,7,18,20,22,24,26`） | `web/` → `heavy/`。`web/dist-heavy/` は `heavy/dist-harness/` に。**`web/dist/`（`:3`）と `web/src/wasm/`（`:8`）は動かさない**——どちらも web 自身の生成物である |
| `CLAUDE.md` の構成表とコマンド節 | `heavy/` の行と `cd heavy && pnpm heavy` を**足す**（いま重量級への言及が無い） |
| `docs/base-spec.md:876` | 「Layer 6 … `corpus/` 配下」は**そのまま正しい**（`corpus/` は動かさない） |
| `docs/corpus-measurements.md` | **直さない。** 日付のついた測定記録であり、当時のパスが当時の事実である。**冒頭に 1 行だけ**「2026-08-25 に重量級は `heavy/` へ移った。以下のパスは測定当時のもの」と置く |
| `docs/heavy-corpus-implementation-report.md` | 同上。ただし**現在形の案内が 1 つある**（`:5` の「読むのは `web/heavy-report.md` のほう」）ので、そこだけ直す |

**実装のとき、この一覧を grep で当て直すこと。** 行番号はこの設計書を書いた日の
座標であり、実装の日には動いている。

## 9. 検証——移動が正しいことを何が証明するか

**重量級そのものが証明する。** 移動のあと、通しで 1 回回し、**移動前の数字と
突き合わせる**:

| 検査 | 実測時間 | 何が動いていなければ正しいか |
|---|---|---|
| `pnpm heavy` | 32 秒 | 195 passed / 33,567 件 / 不一致 0 |
| `pnpm heavy:power:exact` | 4 分 | 10/10 ok、赤の本数 |
| `pnpm heavy:power` | 11 分 | 18/18 ok、**各変異の検出率**（下限のちょうど 2.00 倍） |
| `pnpm heavy:ui` | 12 分 | 36 passed / 指摘 0 / **46 トークン全押下** |

**12 の相対パスが 1 つでもずれていれば、ここで落ちる。** 別途にパス検査を
足さない——**在る検査が捕まえるものを、もう一度書かない**。

加えて `cd heavy && pnpm typecheck && pnpm lint && pnpm test`、
`cd web && pnpm typecheck && pnpm lint && pnpm test && pnpm e2e`
（web 側が何も失っていないこと）。

## 10. やらないこと

- **`corpus/` `testdata/` `reference/` は動かさない。** すでに `web/` の外に
  あり、実装側に入り込んでいない
- **`web/tests/e2e` は動かさない**
- **計算コードは 1 行も変えない**（`crates/` も `web/src/calc` も）
- **コマンド名を変えない**
- **workspace 化しない**

## 11. 危険と、その扱い

| 危険 | 扱い |
|---|---|
| 12 の相対パスが静かにずれる | 深さを保つ配置にする。通しの走行が証明する |
| wasm が 2 つになる | heavy 側に複製を作らない。`web/src/wasm` を共有する |
| 4180 / 4181 に別物が居るのを掴む | いまと同じ穴。設定も説明もそのまま移す（**この移動で直そうとしない**） |
| 重量級の型検査が普段の CI から消える | 重量級の走行の**先頭**に置き、変異の前に落とす |
| 実装側セッションとの衝突 | 着手時に手が空いていることを確認済み（2026-08-25）。`web/` に対する変更は削除と設定 3 行のみ |

## 12. 未確認のまま残ること

- **CI で実際に通るかは、次に重量級を回すまで分からない。** 手元で 4 本すべてを
  通しても、runner の上での `pnpm install` 2 回ぶんの時間と、
  `webServer` の `cwd` がランナーで効くかは実測していない
- **`heavy/tsconfig.json` が `../web/src` を引き込んだときの型検査の時間**は
  測っていない。遅すぎるなら `skipLibCheck` の外側で調整する

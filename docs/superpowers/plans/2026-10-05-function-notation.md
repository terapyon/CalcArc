# 計画 — 関数の書き方を `sin(30)` にする（1.2.1）

**設計書（仕様）**: [`specs/2026-10-04-function-notation-design.md`](../specs/2026-10-04-function-notation-design.md)
（第 3 版 `8151da5`、レビュー役が承認。阻止 0・条件 0）。**計画と設計書が食い違えば、設計書が勝つ。**

**枝**: `feat/function-notation`（`docs/function-notation-design` の上）。作業木は scratchpad の `wt-fn`。

## Global Constraints

- **仕様の表を先に赤くする**（engine_table・spell_table）。**赤の印字を、コミットメッセージかタスクの報告に残す。**
- **赤の確認（変異）は、変異の前に一時コミットを置き、戻すときは再編集する。`git checkout -- <file>` を使わない。**
- **コミットの前に揃える**（前段は `&&` だけでつなぐ。`;` や `| grep` を挟まない）:
  `cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings`、
  web を触ったら加えて `cd web && pnpm test && pnpm lint && pnpm typecheck`。
  **この作業木には `web/node_modules` が無い**——web に触る最初のタスクで `cd web && pnpm install --frozen-lockfile && pnpm wasm` を先に回す。
- **`calcarc-core` は panic しない**（`unwrap`/`expect` は `cfg(not(test))` で禁止）。**許容誤差をテストに書かない。**
- **計算ロジックは core に置く。** `calcarc-wasm` と `web` に綴りの規則を書かない（web は値を写すだけ）。
- **WASM 境界は例外を投げない。**
- **テストは影響の範囲で段を付ける。** フルスイープは枝の最後に 1 回（コントローラが回す）。
  **E2E は `--project mobile` を明示**（この機では webkit が起動しない）。**`wasm-pack test` は回さない**
  ——手元では `cargo check -p calcarc-wasm --target wasm32-unknown-unknown --tests` まで。
- **重い段（E2E 全走・wasm/vite build）を他のセッションと重ねない。** E2E の前に `ss -ltnp | grep -E ':(4173|4179)'` で
  他人の preview が居ないことを確かめ、居れば止まって報告する（kill しない）。
- **コミットメッセージの末尾**: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。**push と PR はしない。**
- **版数は上げない**（別の枝）。
- コメントと文書は日本語で、まわりの註の書き方（理由を書く・行番号より綴りで指す）に合わせる。
- **数を書くときは印字からコピーする**（手で丸めない、記憶から書かない）。

---

## Task 1: core の綴り（表を先に赤く → `spell.rs` → A′）

**設計書の §2（規則）・§3（境目の表）・§4.1（実装の形）・§5.1-5.2 を読むこと。**

1. **engine_table に 2 行を足す**（設計書 §5.3.2 の規則 2）: `( ) =` → `0`、`3 + ( =` → `3`
   （`main_of`）。engine の振る舞いは既にそうなので緑のまま入る（**表を仕様書にするための行**）。
2. **core の API**:
   - `pub fn spell_line(carry: Option<&str>, keys: &[Key], screens: &[&str]) -> String`
     （`screens[i]` は `keys[i]` を押す直前の画面 `main`）。
   - `pub fn spell(keys: &[Key]) -> String` は `spell_line(None, keys, &[])` として残す。
   - **画面の値が要る場所に列が無い（長さが足りない）ときは `…` を書く。panic しない。**
   - **綴りが空なら carry も付けない**（web の `lineOf` の約束を core に移す）。
3. **spell_table.rs を先に書き換えて赤を撮る**: 設計書 §3.1・§3.2・§3.3 の全行、§2.1 の `,`
   （`1234 × 1000 =` のあと `x²` → `1,234,000²`。carry を使う行）、§4.1 の `( 3 +/− xʸ 2 ) sin` →
   `sin((−3) ^ 2)`、§2.6 の副作用の 2 行、既存の期待値（関数・括弧）を新しい書き方に。
   **`spell_of` は engine を歩いて各キーの前の `render(&state).main` を積み、`spell_line` に渡す**
   （engine_table の `spell_of` も同じ。engine_table の `:60` の期待値 `"30 sin × 2"` を `"sin(30) × 2"` に）。
   **carry を使う行**（`3 =` のあと `sin` など）は、表の側で「`=` までを engine に打ち、その答えの
   `main` を carry、残りのキーを keys」として `spell_line` を呼ぶ小さな補助を置く。
   **赤の印字（どの行が何と出たか）を報告に残す。**
4. **`spell.rs` を設計書 §4.1 のとおりに直す**: `Part { text, kind: Atom | Group | Other }`、
   後置関数で範囲を畳む、`^` の左の包みと括弧の空白は**字面を作る 1 つの関数**（`render`）で、
   原子の判定は `Buffer` から（文字列でしか来ない carry と画面の値だけ文字列判定。§2.1 の 2 つの正規表現——
   正規表現の crate は足さず、手で書く）。`commit_glyph` の `xʸ` を `^` に、`BINARY_GLYPHS` も（`:334` の単体テスト）。
   **ファイル頭の註**（打った順にラベルを並べる、の段落）を新しい規則に合わせて書き直す。`独立: 不可能` は残す。
5. **`spell_differential.rs` の `check` を A′ に置き換える**（設計書 §5.2）。ファイル頭の註も。下限 `421_383` が
   動いたら印字で据え直す（動かない見込み）。
6. **A′ の再実測**（設計書 §5.2 の最後）: 使い捨てのテスト
   `/tmp/claude-1000/-home-terapyon-dev-CalcArc/a64db8f3-d834-4f2a-8c82-953f7bd31143/scratchpad/a_prime_probe.rs`
   を `crates/calcarc-core/tests/` に一時的に置き、**新しい `spell.rs` で**回す。そのうえで、**新しい
   `spell.rs` に欠陥 2 の形（`Del` でバッファが無いとき末尾の二項演算子を消し、直前の数を打ちかけに戻す）を
   変異として入れ**、`3 + DEL 4` で A′ が赤くなること（綴り `34` / 表示 `4`）を印字で撮る。
   変異は一時コミットの上で入れて再編集で戻す。probe はコミットしない（終わったら scratchpad に戻す）。
   **結果を設計書 §5.2 の末尾に「実装後の再実測」として書き足す。**
7. **`engine_values.rs` の `keys_of_spelling` が `(3`・`4)` のように括弧の付いた語を `(` `3` に切り出すようにする**
   （読み方の規則は変えない）。**括弧の空白を無くすと、既存の 2 本
   （`every_sequence_closed_by_equals_matches_an_independent_evaluator`・
   `spellings_in_a_paren_heavy_net_read_back_to_the_engines_answer`）が赤くなる——その赤を撮ってから直す。**
   （計画の事前点検で Task 2 から移した。Task 1 を緑で閉じるため。）
8. 段の検査: `cargo test -p calcarc-core`（全部）、fmt、clippy。

## Task 2: 読み直しの網（`SIGN_NET` と読み手）・`PAREN_LENGTH` の註

**設計書の §5.3（5.3.1〜5.3.3）と §6 の engine_values の行を読むこと。**

1. （`keys_of_spelling` の括弧の切り出しは Task 1 の 7 に移した。）
2. `SIGN_NET`（`3 + − × ( ) = DEL +/− x²`、長さ 7）と、文字列を慣例で読む読み手（設計書 §5.3.2 の字句・文法・
   省略の規則 3 つ。規則ごとに engine_table の行を名指しする註）。網の歩き方は既存の `walk` の前置の判定
   （`=` で区間を切る・画面の値を使うキーで前置を決める）を流用し、**web と同じく各キーの前の画面 `main` を
   積んで `spell_line` に渡す。** 比べた回数・食い違いを数え、**下限は実測値で assert**。
   **`Typed` は使わない**（理由は設計書 §5.3.2）。
3. **変異で赤を確かめる**（設計書 §5.3.3 の表の 5 本。`^` の行は SIGN_NET が黙ることの確認）。
   一時コミット → 変異 → 赤の印字 → 再編集で戻す。**結果の表を報告に残す。**
4. **`PAREN_LENGTH` の註（`engine_values.rs` の `PAREN_LENGTH` の直前）と `NET` の `LENGTH` の註、
   `SIGN_NET` の註を、同じ日の実測で書く**——測り方を添える（`cargo test -p calcarc-core --test engine_values -- <名前>` を
   1 本ずつ、debug）。**予算の言い直し**: 「15 秒」を前提にした文を、実測値と「網は狭めない（監視役の裁定 2026-10-05）」に置き換える。
   **伸びた理由**（10-03 から比べる列が増えた）を、値の照合と読み直しの回数の印字で添える。
5. 段の検査: `cargo test -p calcarc-core --test engine_values`、fmt、clippy。

## Task 3: wasm と web（画面の列・`lineOf` を core へ）

**設計書の §2.5・§2.7.1・§4.1 の「web の画面の列は `keysRef` の鏡にする」表・§5.4・§5.5 を読むこと。**

1. wasm: `spell_keys(tokens: Vec<String>, carry: Option<String>, screens: Vec<String>) -> String`。
   知らないトークンは今どおり飛ばす——**飛ばしたトークンの画面も一緒に飛ばして、長さを揃える。**
   `crates/calcarc-wasm/tests/web.rs` の 2 本を新しい書き方に、**列が無い・長さが違うときに panic しない 1 本**を足す。
   検査は `cargo check -p calcarc-wasm --target wasm32-unknown-unknown --tests`（`wasm-pack test` は CI）。
2. web: `web/src/calc/index.ts` の `spell` の型と実装を `(keys, carry, screens)` に。
   `ScientificPanel.tsx` の `keysRef` の 5 か所の隣に画面の列（`screensRef`・`pendingScreensRef`）を置く
   （設計書 §4.1 の表のとおり。`push` は `keysRef.current.push(token)` と同じ文か隣の文）。
   `lineOf` は core の `spell_line` を呼ぶ形にする（**規則を web に残さない**。`lineOf` を消すか、
   carry と画面の列を渡すだけの薄い関数にする）。`closedLineOf`（`=` を足す）は触らない。
3. vitest: 偽 `spell` の型を合わせ、**偽 `spell` が受け取った `screens` の長さが `keys` と同じであること**を
   主張する（設計書 §5.4）。`FAKE_GLYPHS` の註を設計書 §5.5 のとおりに直す（偽物の上の主張は変えない）。
   `lineOf` の単体テストがあれば合わせる。
4. 段の検査: `cd web && pnpm install --frozen-lockfile && pnpm wasm && pnpm test && pnpm lint && pnpm typecheck`（`pnpm wasm` で `web/src/wasm/` を作り直す）、
   cargo の fmt・clippy。

## Task 4: E2E

**設計書の §6 の E2E の行を読むこと。**

1. `web/tests/e2e/entry.spec.ts`・`history.spec.ts`・`trail-overflow.spec.ts`・`scientific-functions.spec.ts` の
   期待値と、綴りを引いている註を新しい書き方に（行番号は設計書 §6。当て直してから）。
   `trail-overflow` の長い行は、括弧の空白も無くなる。**横にはみ出すことを主張している検査が、短くなった行でも
   はみ出しているか**を確かめる（はみ出さなくなったら列を伸ばす。理由を註に）。
2. **新しい 1 本**: `2 × 3 + x² =` の行が `2 × 3 + 6² =` であること（実 wasm）（設計書 §5.4）。
3. 段の検査: 触ったファイルだけを `cd web && pnpm e2e <ファイル>` で（`e2e` の script は `pnpm wasm && playwright test --project mobile`）。**全走はしない**（枝の最後にコントローラが回す）。

## Task 5: マニュアル 3 冊と CHANGELOG

**設計書の §8 を読むこと。**

1. `docs/manual/quick.ja.md`・`quick.en.md`・`detail.ja.md` を §8.1 のとおりに直す。**`detail.ja.md:221` は意味が逆になる**
   ——符号の文を書き換え、前後の段落を盤面の印字で当て直す（数値例は実物で。E2E か vitest の実 wasm の印字、
   または `cargo run` の使い捨ての probe で `spell_line` を回した印字。probe はコミットしない）。
   英語版に同じ文が在るかを grep し、在れば直す。
2. `CHANGELOG.md` の先頭に **「未リリース」の節**を作り（見出しの書式は既存の未リリースの節の前例を
   `git log -p CHANGELOG.md` で探して合わせる。`tools/check-version.mjs` が見出しをどう読むかも確かめる）、
   §8.2 の文案を入れる。**版数は上げない。**
3. 段の検査: マニュアルの番人（`package.json` の scripts と `.github/workflows/` で、`docs/manual` を見ている
   検査を grep し、手元で回せるものを回す。`check-manual-freshness` は版を上げる枝で効くので、ここで赤くても
   理由を報告する）。

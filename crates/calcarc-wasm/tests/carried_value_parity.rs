//! **`web/src/ui/ScientificPanel.tsx` の `CARRIED_VALUE_TOKENS` は、
//! engine の `apply()` の中で `state.current` を**読む**キーを手で並べた
//! 集合である(同ファイルの docstring 参照——`git grep -n
//! 'state\.current' crates/calcarc-core/src/engine/mod.rs` を読んで
//! 23 個に導いたと書いてある)。**手で並べたものは engine が変わっても
//! 追随しない。** `token_parity.rs` / `label_parity.rs` と同じく Rust から
//! TypeScript のソースをテキストで読むが、比較の相手が違う——ここは
//! **engine のソーステキストではなく engine の振る舞いから独立に集合を
//! 導き**、その集合を `CARRIED_VALUE_TOKENS` と突き合わせる。
//!
//! 比較の選び方と、それが見逃すものは
//! `carried_value_tokens_match_the_engine_that_derives_them` の docstring
//! に書く。

use std::collections::BTreeSet;

use calcarc_core::{EngineState, Key, reduce};

/// 実際の打鍵列で状態を作る。手で `EngineState` を組み立てない
/// (`EngineState` のフィールドは互いに独立でないので、手で組み立てると
/// engine が実際には作れない形を作ってしまいかねない)。
///
/// セットアップの途中でエラーが起きたら、以降の判定の前提(この状態が
/// current だけ違う 2 通りとして意味を持つこと)が壊れているので、ここで
/// 止める。
fn press(mut state: EngineState, keys: &[Key]) -> EngineState {
    for &key in keys {
        let (next, _) = reduce(&state, key);
        assert!(
            next.error.is_none(),
            "セットアップの打鍵 {key:?} がエラーを起こした: {:?}",
            next.error
        );
        state = next;
    }
    state
}

/// `a` と `b` が本当に `current` だけで違うことを確かめる。
///
/// 違えば「2 状態の差はぜんぶ current から来ている」という、以降の判定の
/// 土台そのものが崩れる——`current` を戻して等しくなるかで確認する。
fn assert_differs_only_in_current(a: &EngineState, b: &EngineState) {
    let mut unified = a.clone();
    unified.current = b.current;
    assert_eq!(
        unified, *b,
        "current 以外の場所で 2 状態が食い違っている(探りの組み立てが壊れている)"
    );
    assert_ne!(
        a.current, b.current,
        "current 自体が同じでは、読んだかどうかを何も測れない"
    );
}

/// `current` / `buffer` / `operands` / `operators` / `error` のどれかが
/// 打鍵の前後で動いたか。
///
/// **`angle` / `form` / `notation` / `sexagesimal_view` / `operator_pending`
/// は見ない。** これらは表示・モードの状態であって、値を運ぶ場所ではない
/// ——ここに含めると、値には無関係な副作用(例: `ENG` 以外のキーは毎回
/// `notation` を `Normal` に戻す)まで「値を触った」と数えてしまう。
fn touched_value_fields(before: &EngineState, after: &EngineState) -> bool {
    before.current != after.current
        || before.buffer != after.buffer
        || before.operands != after.operands
        || before.operators != after.operators
        || before.error != after.error
}

/// 1 組の探り(`a`, `b`)で、キー `key` が `current` を読んだと言えるか。
///
/// 2 条件の**両方**を要求する。
/// - `touched`: `key` が `a` / `b` それぞれの値関連フィールドを 1 つでも
///   動かしたか。これが無いと、「`current` に一切触れないが、探りの
///   `current` が最初から違うのでそのまま画面に出てしまう」キー
///   (`angle_toggle` など)まで拾ってしまう——`a` と `b` は `current` から
///   違うので、素通りするだけでも `reduce` の返す表示は違って見える。
/// - `shown_a != shown_b`: 動いた結果が 2 状態で違うか。これが無いと、
///   「`current` を無視して固定値に上書きする」キー(`pi` `e` `lparen`
///   `ac` など)まで拾ってしまう。
fn reads_in_trial(key: Key, a: &EngineState, b: &EngineState) -> bool {
    let (next_a, shown_a) = reduce(a, key);
    let (next_b, shown_b) = reduce(b, key);
    let touched = touched_value_fields(a, &next_a) || touched_value_fields(b, &next_b);
    touched && shown_a != shown_b
}

/// 整数の探り。`3 + 4` / `3 + 5` を確定させずに `Sqr` で畳んで、
/// 開き括弧を残したまま current だけ違う 2 状態を作る。
///
/// **開き括弧を残す理由。** `)`(`rparen`)は演算子スタックの先頭が
/// 開き括弧でなければ `SyntaxError` になり、その道では `current` を畳む
/// 前に止まる——`=` の直後(列の先頭)には開き括弧が無いので、`rparen` は
/// 「列の先頭キーとしては起こらない」(このファイルの docstring、
/// `ScientificPanel.tsx` の同じ註)。それでも `rparen` は `current` を
/// **読む**キーである(開き括弧の中で押せば読む)ので、その形を実際に
/// 作って確かめる。
///
/// **`Sqr` で畳む理由は整数を保つため。** `n_fact` は非負整数しか
/// 受け付けない(`scientific::factorial` の `non_negative_integer`)。
/// `4² = 16`、`5² = 25` はどちらも非負整数で、この後押す `n_fact` が
/// `DomainError` にならずに済む。
fn integer_probe() -> (EngineState, EngineState) {
    let a = press(
        EngineState::initial(),
        &[
            Key::LParen,
            Key::Digit(3),
            Key::Add,
            Key::Digit(4),
            Key::Sqr,
        ],
    );
    let b = press(
        EngineState::initial(),
        &[
            Key::LParen,
            Key::Digit(3),
            Key::Add,
            Key::Digit(5),
            Key::Sqr,
        ],
    );
    assert_differs_only_in_current(&a, &b);
    (a, b)
}

/// 分数の探り。`integer_probe` と同じ形だが、`Recip` で畳んで
/// `[-1, 1]` に収まる値にする。
///
/// **要る理由。** `asin` / `acos` の定義域は `[-1, 1]`(`scientific::asin`
/// / `acos`)——`integer_probe` の 16 / 25 はどちらも範囲外で、両方とも
/// 同じ `DomainError` に潰れて `asin` / `acos` を見逃す。`1/4 = 0.25`、
/// `1/8 = 0.125` はどちらも範囲に収まる(実際には `Digit(4)` ではなく
/// `Digit(5)` / `Digit(8)` を使って `0.2` / `0.125` にした——値そのものに
/// 意味は無く、「範囲に収まり、かつ 2 つが異なる」ことだけが要る)。
///
/// **2 つの探りが要る理由(逆方向)。** `n_fact` は非負整数しか受け付け
/// ない——`0.2` と `0.125` はどちらも整数でないので、`integer_probe` を
/// 使わなければ `n_fact` も同じ `DomainError` に潰れて見逃す。
fn fraction_probe() -> (EngineState, EngineState) {
    let a = press(
        EngineState::initial(),
        &[
            Key::LParen,
            Key::Digit(3),
            Key::Add,
            Key::Digit(5),
            Key::Recip,
        ],
    );
    let b = press(
        EngineState::initial(),
        &[
            Key::LParen,
            Key::Digit(3),
            Key::Add,
            Key::Digit(8),
            Key::Recip,
        ],
    );
    assert_differs_only_in_current(&a, &b);
    (a, b)
}

/// engine の振る舞いだけから「current を読むキー」の集合を作る。
/// `Key::ALL` の全キーを 2 組の探りに掛け、**どちらか一方**が読んだと
/// 言えばその集合に入れる(2 組を用意した理由は `fraction_probe` の
/// docstring)。
fn derive_carried_value_tokens() -> BTreeSet<String> {
    let (int_a, int_b) = integer_probe();
    let (frac_a, frac_b) = fraction_probe();

    Key::ALL
        .iter()
        .copied()
        .filter(|&key| reads_in_trial(key, &int_a, &int_b) || reads_in_trial(key, &frac_a, &frac_b))
        .map(|key| key.token().to_owned())
        .collect()
}

/// `web/src/ui/ScientificPanel.tsx` の `CARRIED_VALUE_TOKENS` を文字列
/// として読む。`token_parity.rs` の `tokens_in_ts_array` と同じ流儀
/// ——「マーカーの直後、次の `]` までの引用符内」という構造依存の抽出で
/// あって TS のパースではない。マーカーが見つからなければ即 panic する
/// ので、ファイルの形が変わればこのテスト自体が落ちて知らせる。
///
/// # **`//` を解さない**(2026-09-05、再レビューの指摘)
///
/// 引用符の中身を拾うだけなので、**行をコメントアウトした場合だけ素通り
/// する**——`// "sqrt",` と書き換えると、TypeScript の `Set` からは消えて
/// いるのにこちらは在ると読み、番人は緑のままになる。**削除・改名なら
/// 捕まる**(どちらも引用符の中身が変わる)。現実の劣化は削除・改名の側
/// なので塞いでいないが、**塞いでいないことは書いておく**。塞ぐなら TS の
/// パースが要り、この抽出の流儀(`token_parity.rs` と同じ「構造依存の
/// 文字列切り出し」)ごと変えることになる。
fn carried_value_tokens_in_ts(src: &str) -> BTreeSet<String> {
    let marker = "const CARRIED_VALUE_TOKENS: ReadonlySet<KeyToken> = new Set([";
    let after = src
        .split(marker)
        .nth(1)
        .unwrap_or_else(|| panic!("{marker} が見つからない"));
    let body = after
        .split(']')
        .next()
        .unwrap_or_else(|| panic!("CARRIED_VALUE_TOKENS の配列が閉じていない"));
    body.split('"')
        .skip(1)
        .step_by(2)
        .map(str::to_owned)
        .collect()
}

/// `CARRIED_VALUE_TOKENS`(TypeScript、手で並べた)と、engine の振る舞い
/// から導いた集合(Rust、このファイル)が一致するかを見張る。
///
/// # 比較の選び方
///
/// 2 つの `EngineState` を、**実際の打鍵列で** `current` だけが違うように
/// 作り(`integer_probe` / `fraction_probe`)、探りたいキーを両方に適用
/// して `reduce` が返す `DisplayState` を比べる。`EngineState` そのものの
/// 等値比較ではなく `DisplayState` を選んだのは、**`buffer` に隠れて
/// `current` が見えなくなる**状態まで込みで「利用者に見える差」を測り
/// たいからである——数字キーを押した直後は `current` が古いまま残るが
/// (`commit_entry` を経ていない)、表示は `buffer.text()` を見せるので
/// 隠れる。生の `EngineState` の等値比較だとここを「読んだ」と誤判定する。
///
/// `DisplayState` が違うだけでは「読んだ」と言えない——`touched_value_
/// fields` を先に見る理由は `reads_in_trial` の docstring。
///
/// # これが見逃すもの
///
/// - **2 つの入力が、たまたま同じ答えを出す関数。** `0! = 1! = 1` が
///   その実例——探りの値(16 と 25 / 0.2 と 0.125)はこの偶然が起きない
///   よう選んだが、**将来追加される関数がこの値でたまたま一致しない**
///   保証はどこにも無い。値を変えれば変えるほど確からしくなるだけで、
///   有限個の探りである以上、証明にはならない。
/// - **どちらの探りの定義域からも外れるキー。** `n_fact` は非負整数、
///   `asin` / `acos` は `[-1, 1]` を要求する——2 つの探りを用意したのは
///   このためだが、**両方の探りの外側でしか受け付けない**将来のキーが
///   来れば、両方とも同じ `DomainError` に潰れて偶然一致し、見逃す。
/// - **`buffer` が空でない状態でだけ `current` を読むキー。** 2 つの
///   探りはどちらも `buffer: None` で終わる状態(`=` の直後と同じ形、
///   `CARRIED_VALUE_TOKENS` が扱う「列の先頭キー」の場面そのもの)で
///   キーを試す。`neg` は指数入力中だけ経路が変わる(`apply()` の
///   `Key::Neg` 参照)が、列の先頭では常に buffer が無いのでこの経路には
///   入らない——**この形以外でだけ `current` を読むキー**がもしあれば、
///   この探りには映らない。
#[test]
fn carried_value_tokens_match_the_engine_that_derives_them() {
    let derived = derive_carried_value_tokens();
    // **比較件数の下限。** 判定ロジックが壊れて何も「読む」と言わなく
    // なっても(あるいは逆に何もかも「読む」と言うようになっても)、
    // 下限が無ければ次の集合比較がたまたま両方空/両方全部で緑になり
    // かねない。
    assert!(
        !derived.is_empty(),
        "engine から 1 つも「current を読むキー」が導けなかった。判定ロジックが壊れていないか確認する"
    );
    assert!(
        derived.len() < Key::ALL.len(),
        "Key::ALL の全キーが「current を読む」と判定された。判定ロジックが壊れていないか確認する"
    );

    let src = include_str!("../../../web/src/ui/ScientificPanel.tsx");
    let ts = carried_value_tokens_in_ts(src);
    assert!(
        !ts.is_empty(),
        "ScientificPanel.tsx から CARRIED_VALUE_TOKENS を 1 つも抜けなかった。抽出が壊れていないか確認する"
    );

    let missing_from_ts: Vec<&String> = derived.difference(&ts).collect();
    let missing_from_engine: Vec<&String> = ts.difference(&derived).collect();

    assert!(
        missing_from_ts.is_empty() && missing_from_engine.is_empty(),
        "CARRIED_VALUE_TOKENS と engine から導いた集合が食い違っている。\n\
         engine には在るが TypeScript(CARRIED_VALUE_TOKENS)には無い: {missing_from_ts:?}\n\
         TypeScript には在るが engine から導いた集合には無い: {missing_from_engine:?}"
    );
}

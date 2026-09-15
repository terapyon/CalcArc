//! **入力中は、綴りの最後の語が engine の表示と一致する**(設計書
//! `2026-09-10-independent-verification-gaps-design.md` §2.4、不変条件 A)。
//!
//! `spell` は `Buffer` を本物で歩かせるが、**キーをどこへ振り分けるか**
//! (バッファを開く／確定する／捨てる)は `apply()` を読んで手で写した
//! `match` である。**写しの残りはここで、次にこの族が入るならここ**である。
//! 振り分けがずれると、次の数字で `spell` は新しい語を始め、engine は
//! 書き足す——**最後の語と表示が食い違う。**
//!
//! **逆写像を書かない**(案 B を採らなかった理由、§2.5)。比べる相手は
//! engine 自身の表示だけである。
//!
//! **捕まえないもの**: 字形の側のずれのうち、最後の語に響かないもの
//! (`3 + DEL ( 4` のように `DEL` の直後が数字でない形。`+` が消えても次の
//! 記号が新しい語を始めるので A は黙る)と、途中に取り残された語
//! (`3 j DEL DEL 3` を `3 j 3` と綴る形。最後の語は表示と一致するので A は
//! 黙る——A が見るのは最後の語だけである)と、web の 2 件(履歴の欠陥 6・7)。
//!
//! **`3 + DEL 4` は A が捕まえる**(見立ての誤り。設計書
//! `2026-09-10-independent-verification-gaps-design.md` §2.4 で訂正)——
//! 落ちた `+` のせいで `4` が直前の `3` にくっつき、綴りは `34`、表示は
//! `4` になる。この列は `spell_table.rs:211` が、`j` の取り残しは
//! `spell_table.rs:227-228` が持つ。

use calcarc_core::engine::spell::spell;
use calcarc_core::{EngineState, Key, reduce, render};
use proptest::prelude::*;

/// A を 1 回確かめる。入力中でなければ比べずに `Ok(false)` を返す。
///
/// **比べたときだけ `Ok(true)`**——呼び出し側はそれを数え、下限を assert
/// する。入力中でない打鍵は黙って通るので、数えなければ「1 度も比べずに緑」
/// と「比べて緑」の区別がつかない(engine が打鍵の途中で `buffer` を開かなく
/// なる日が来ても、下の 2 本は緑のまま何も見なくなる)。
fn check(keys: &[Key], state: &EngineState) -> Result<bool, String> {
    if state.buffer.is_none() || state.error.is_some() {
        return Ok(false);
    }
    let shown = render(state).main;
    let spelled = spell(keys);
    let last = spelled.rsplit(' ').next().unwrap_or("");
    if last == shown {
        Ok(true)
    } else {
        let tokens: Vec<&str> = keys.iter().map(|k| k.token()).collect();
        Err(format!(
            "入力中なのに綴りの最後の語が表示と違う: 表示 {shown:?} / 綴り {spelled:?}\n  keys: {tokens:?}"
        ))
    }
}

/// **網羅の同値類。** `engine_robustness.rs` の `ALL_CLASSES`(17)に
/// **`Zeros3` と `Neg` を足したもの**——どちらも過去の欠陥の鍵である
/// (`000` の `del`、指数の符号)。`ALL_CLASSES` には無い。
const CLASSES: [Key; 19] = [
    Key::Digit(3),
    Key::Digit(0),
    Key::Dot,
    Key::J,
    Key::Sub,
    Key::Div,
    Key::Eq,
    Key::LParen,
    Key::RParen,
    Key::Del,
    Key::Ac,
    Key::PolarToggle,
    Key::Sqrt,
    Key::Pi,
    Key::Exp,
    Key::Pow,
    Key::Dms,
    Key::Zeros3,
    Key::Neg,
];

/// 比べた回数を `compared` に足しながら歩く。
fn walk(state: &EngineState, keys: &mut Vec<Key>, depth: usize, max: usize, compared: &mut usize) {
    if depth == max {
        return;
    }
    for &key in &CLASSES {
        // 拒まれたキーは web の打鍵の列に積まれない(ScientificPanel、0.9.2 設計書 §3.3 の
        // 条件 1)。列に足さず、その枝も降りない。判断は engine の `refuses`(写しではない)。
        if calcarc_core::engine::refuses(state, key) {
            continue;
        }
        let (next, _) = reduce(state, key);
        keys.push(key);
        match check(keys, &next) {
            Ok(true) => *compared += 1,
            Ok(false) => {}
            Err(why) => panic!("{why}"),
        }
        // エラーからは AC 以外で新しい状態に届かない(`engine_robustness.rs` の I5)。
        if state.error.is_none() || key == Key::Ac {
            walk(&next, keys, depth + 1, max, compared);
        }
        keys.pop();
    }
}

/// **長さ 5 までのすべての列**(19 類)。字数上限(12)には `3 000 000 000 000`
/// (5 打鍵・13 桁)で届き、指数の符号には `3 Exp 3 +/−`(4 打鍵)で届く。
///
/// **比べた回数の下限**: 2026-09-13 に実測 768,209 回(2026-09-11 の
/// 768,281 から減った)。押し直しがいまは戻り先から畳み直す(0.9.2 設計書 §2)
/// ので、`÷ 0 xʸ ÷|−`(`0`・`.`・`+/−`・`√`・`000` のどれで 0 に確定させても
/// 同じ)と `xʸ j xʸ ÷|−` の 2 つの形、それぞれに続く 6 通りの入力開始キーを
/// 合わせた 72 列が、直接押した列と同じく `0 ÷ 0` または `0 xʸ 1j` で終わって
/// エラーになり、比べられなくなったため(F1)。
///
/// **再実測(2026-09-13、F5 のあと)**: 426,191 回に減った。**拒まれたキーの枝を
/// 降りなくなったためである**(0.9.2 設計書 §3.3 の条件 1)——`walk` は `refuses`
/// が真のキーを列に足さず、その先を辿らない。手元の値(`on_hand`)があるあいだ
/// 数字・`(`・`π`・`e` を拒むようになったので、S4・S5 に当たる形(`)`・`√` などの
/// あとに数字や `(` を続ける列)がまるごと網から落ちる。
///
/// 網羅は決定的なので下限は実測値そのものである。**これが 0 に近づいたら A は
/// 何も見ていない**——`check` は入力中でない打鍵を黙って通すので、engine が
/// `buffer` を開かなくなっても、数えなければ緑のままである。CLASSES か深さを
/// 変えて回数が動いたら、実測を取り直してここを書き直す。
#[test]
fn every_sequence_up_to_five_keys_spells_the_entry_as_the_engine_shows_it() {
    let mut compared = 0;
    walk(
        &EngineState::initial(),
        &mut Vec::new(),
        0,
        5,
        &mut compared,
    );
    assert!(
        compared >= 426_191,
        "網羅で比べたのは {compared} 回(2026-09-13・F5 のあとの実測 426,191 回)。\
         打鍵の途中で buffer が開かなくなっていないかを確認すること"
    );
}

/// 入力に寄せた乱択。**長い数**(字数上限の上での `.`・`000` の上限跨ぎ)に
/// 届かせるため、数字と入力のキーを厚くする。`engine_robustness.rs` の
/// `weighted_key` は `Zeros3`・`Exp`・`Dms` を 1 つも引かないので使わない。
fn entry_key() -> impl Strategy<Value = Key> {
    prop_oneof![
        6 => prop::sample::select(vec![Key::Digit(0), Key::Digit(3), Key::Digit(7)]),
        2 => Just(Key::Zeros3),
        2 => Just(Key::Dot),
        2 => Just(Key::Exp),
        2 => Just(Key::Neg),
        2 => Just(Key::Del),
        1 => Just(Key::J),
        1 => Just(Key::Dms),
        2 => prop::sample::select(vec![Key::Add, Key::Sub, Key::Mul, Key::Div]),
        1 => prop::sample::select(vec![Key::LParen, Key::RParen, Key::Eq]),
        1 => prop::sample::select(vec![Key::Sqrt, Key::Sin, Key::Pi, Key::E]),
        1 => Just(Key::Ac),
    ]
}

const RANDOM_CASES: u32 = 2000;

/// **1 度以上比べたケースの数の下限。** 2026-09-11 に 5 回走らせて
/// 1,908〜1,919 件(2,000 件中)。比べないのは、たとえば打鍵が空の列や
/// 数を 1 つも打たない列である。種は走行ごとに変わるので実測値
/// そのものは書けない——下限は実測の最小から 100 件あまり下に置いた
/// (二項分布の標準偏差はおよそ 9 件)。**これが 0 に近づいたら A は
/// 何も見ていない。**
const RANDOM_CASES_THAT_COMPARED: u32 = 1800;

/// `proptest!` の形をやめて `TestRunner` を直に回すのは、**全ケースを
/// 回し終えたあとに 1 度だけ**比べたケースの数を assert するためである。
/// 1 ケースごとに「1 回以上比べた」を要求すると、比べるものが無い正当な
/// ケース(空の列など)で赤くなる。種の取り方(`TestRunner::new`)・
/// ケース数・縮小・失敗の記録(`source_file`)はマクロと同じである。
#[test]
fn random_entry_heavy_sequences_spell_the_entry_as_the_engine_shows_it() {
    use proptest::test_runner::{Config, TestCaseError, TestRunner};
    use std::cell::Cell;

    let mut config = Config::with_cases(RANDOM_CASES);
    config.source_file = Some(file!());
    let mut runner = TestRunner::new(config);
    let looked = Cell::new(0u32);
    let result = runner.run(&prop::collection::vec(entry_key(), 0..40), |raw| {
        let mut state = EngineState::initial();
        let mut keys = Vec::new();
        let mut compared = 0usize;
        for key in raw {
            // エラーに落ちたら AC を挟んで生き延びさせる(綴りにも同じ AC を入れる)。
            if state.error.is_some() {
                state = reduce(&state, Key::Ac).0;
                keys.push(Key::Ac);
            }
            // 拒まれたキーは web の打鍵の列に積まれない(0.9.2 設計書 §3.3 の条件 1)。
            // 列にも `reduce` にも渡さない。
            if calcarc_core::engine::refuses(&state, key) {
                continue;
            }
            state = reduce(&state, key).0;
            keys.push(key);
            match check(&keys, &state) {
                Ok(true) => compared += 1,
                Ok(false) => {}
                Err(why) => return Err(TestCaseError::fail(why)),
            }
        }
        if compared > 0 {
            looked.set(looked.get() + 1);
        }
        Ok(())
    });
    if let Err(e) = result {
        panic!("{e}");
    }
    assert!(
        looked.get() >= RANDOM_CASES_THAT_COMPARED,
        "1 度以上比べたケースが {} 件({RANDOM_CASES} 件中。2026-09-11 の実測は \
         1,908〜1,919 件)。打鍵の途中で buffer が開かなくなっていないかを確認すること",
        looked.get()
    );
}

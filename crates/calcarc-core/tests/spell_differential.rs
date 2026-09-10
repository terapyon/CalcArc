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

/// A を 1 回確かめる。入力中でなければ何も言わない。
fn check(keys: &[Key], state: &EngineState) -> Result<(), String> {
    if state.buffer.is_none() || state.error.is_some() {
        return Ok(());
    }
    let shown = render(state).main;
    let spelled = spell(keys);
    let last = spelled.rsplit(' ').next().unwrap_or("");
    if last == shown {
        Ok(())
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

fn walk(state: &EngineState, keys: &mut Vec<Key>, depth: usize, max: usize) {
    if depth == max {
        return;
    }
    for &key in &CLASSES {
        let (next, _) = reduce(state, key);
        keys.push(key);
        if let Err(why) = check(keys, &next) {
            panic!("{why}");
        }
        // エラーからは AC 以外で新しい状態に届かない(`engine_robustness.rs` の I5)。
        if state.error.is_none() || key == Key::Ac {
            walk(&next, keys, depth + 1, max);
        }
        keys.pop();
    }
}

/// **長さ 5 までのすべての列**(19 類)。字数上限(12)には `3 000 000 000 000`
/// (5 打鍵・13 桁)で届き、指数の符号には `3 Exp 3 +/−`(4 打鍵)で届く。
#[test]
fn every_sequence_up_to_five_keys_spells_the_entry_as_the_engine_shows_it() {
    walk(&EngineState::initial(), &mut Vec::new(), 0, 5);
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

proptest! {
    #![proptest_config(ProptestConfig::with_cases(2000))]

    #[test]
    fn random_entry_heavy_sequences_spell_the_entry_as_the_engine_shows_it(
        raw in prop::collection::vec(entry_key(), 0..40)
    ) {
        let mut state = EngineState::initial();
        let mut keys = Vec::new();
        for key in raw {
            // エラーに落ちたら AC を挟んで生き延びさせる(綴りにも同じ AC を入れる)。
            if state.error.is_some() {
                state = reduce(&state, Key::Ac).0;
                keys.push(Key::Ac);
            }
            state = reduce(&state, key).0;
            keys.push(key);
            if let Err(why) = check(&keys, &state) {
                prop_assert!(false, "{}", why);
            }
        }
    }
}

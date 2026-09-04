//! **綴りと盤面のラベルが一致するか。**
//!
//! `token_parity.rs` と同じ形——**Rust から TypeScript のソースをテキストで
//! 読む**。ここが無いと、盤面のラベルだけ変えたときに **core が古い綴りを
//! 出したまま緑になる**(計画 §A-3 / Task 3)。

use calcarc_core::{Key, engine::spell::spell};

/// 綴らない 7 キー。**盤面には在るが式には出ない。**
///
/// `spell` の中でそれぞれ別の理由で無音になる: `eq` は列を閉じるだけ、
/// `ac` は列を空にする、`del` は打ったものを戻す、`angle_toggle` /
/// `eng` / `polar_toggle` は表示だけを変える、`dms` は入力中でなければ
/// 表示の一時トグルである(入力中は 60 進の区切りとして
/// `Buffer::text()` の中に入るので、やはり固定の字面を持たない)。
const SEVEN_SILENT: [&str; 7] = [
    "eq",
    "ac",
    "del",
    "angle_toggle",
    "eng",
    "polar_toggle",
    "dms",
];

/// **数そのものを作るキー。ここでは比較しない。**
///
/// `spell` は `engine/state.rs` の `Buffer` を実際に歩かせ、値の部分を
/// `Buffer::text()` で綴る(`engine/spell.rs` の冒頭を見ること)。だから
/// これらのキーの綴りは**そのときのバッファの中身で決まり、固定の字面を
/// 持たない**——盤面のラベルと突き合わせる対象が存在しない。
///
/// 単独で押した場合ですら一致しない実例が 2 つある:
/// - `dot`: `Buffer::push_dot` が空のバッファに先頭の `0` を補うので
///   `text()` は `"0."`。盤面のラベルは `"."` である。
/// - `zeros3`: `Buffer::push_zeros` は `push_digit(0)` を 3 回呼び、
///   先頭ゼロの規則が畳むので `text()` は `"0"`。ラベルは `"000"`。
///
/// `exp` も同じ形である(仮数なしの `Exp` は仮数 1 として `"1e"` と
/// 見える。ラベルは `"Exp"`)。**どれも綴りの欠陥ではなく、engine が
/// 実際に見せている姿である**——ここで一致を求めると `spell` を
/// engine から引き離すことになる(以前それをやって、この番人を
/// 壊した側が差し戻された)。
///
/// **`j` はここに入らない。** `j` は数字ではなく印で、`Buffer::text()` は
/// それを末尾の固定の 1 文字(`tail`)として付ける——バッファの中身が
/// 何であれ `j` は `"j"` なので、ラベルと突き合わせる意味がある。
const VALUE_KEYS: [&str; 13] = [
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "dot", "zeros3", "exp",
];

/// `scientific.ts` から `token` と `label` の対を抜く。
///
/// TS のパースではなく「`token: "..."` の直後に来る `label: "..."`」という
/// 構造依存の抽出——`token_parity.rs` の `tokens_in_ts_array` と同じ流儀
/// (正規表現ではなく素直な走査)。`shift:` の裏のオブジェクトも同じ形を
/// しているので、素直に上から舐めれば一緒に拾える。
///
/// `token: null`(`Shift`)は文字列リテラルではないので `token: "` に
/// 一致せず、自動的に飛ばされる。
fn labels_in_scientific(src: &str) -> Vec<(String, String)> {
    let mut pairs = Vec::new();
    let mut rest = src;
    while let Some(token_at) = rest.find("token: \"") {
        let after_token = &rest[token_at + "token: \"".len()..];
        let Some(token_end) = after_token.find('"') else {
            break;
        };
        let token = &after_token[..token_end];

        let after_token = &after_token[token_end..];
        let Some(label_at) = after_token.find("label: \"") else {
            panic!("token \"{token}\" の直後に label が見つからない");
        };
        let after_label = &after_token[label_at + "label: \"".len()..];
        let Some(label_end) = after_label.find('"') else {
            panic!("token \"{token}\" の label が閉じていない");
        };
        let label = &after_label[..label_end];

        pairs.push((token.to_owned(), label.to_owned()));
        rest = &after_label[label_end..];
    }
    pairs
}

#[test]
fn every_board_label_matches_what_core_spells() {
    let src = include_str!("../../../web/src/ui/Keypad/scientific.ts");
    let pairs = labels_in_scientific(src);

    // **番人が番人であることの下限。** `Key::ALL` の 46 種すべてが
    // scientific.ts の盤面上に(トップレベルか shift の裏として)現れる
    // ので、パーサがまともに拾えていれば少なくとも `Key::ALL.len()` 組は
    // 取れているはず。素直な走査が壊れて何も拾わなくなっても、この下限が
    // なければテストは「比較 0 件」のまま緑になってしまう。
    let expected_min = calcarc_core::Key::ALL.len();
    assert!(
        pairs.len() >= expected_min,
        "scientific.ts から抜けた token/label の対が少なすぎる: {} 組(Key::ALL は {expected_min} 種)。抽出が壊れていないか確認する",
        pairs.len()
    );

    let mut compared = 0usize;
    let mut wrong = Vec::new();
    for (token, label) in pairs {
        // **綴らない 7 つは飛ばす。** 盤面には在るが式には出ない。
        if SEVEN_SILENT.contains(&token.as_str()) {
            continue;
        }
        // **数を作るキーも飛ばす。** 綴りは `Buffer::text()` が持っていて
        // 固定の字面が無い(上の `VALUE_KEYS` の註)。
        if VALUE_KEYS.contains(&token.as_str()) {
            continue;
        }
        let Some(key) = Key::from_token(&token) else {
            continue;
        };
        compared += 1;
        // **空でも飛ばさない。** 残ったキーはどれも `commit_glyph` か
        // `spell` 本体の固定の字面を持つはずなので、空になったのなら
        // それは食い違いとして報告する対象である。
        let spelled = spell(&[key]);
        if spelled != label {
            wrong.push(format!("{token}: 盤面は {label:?}、core は {spelled:?}"));
        }
    }

    // **比較件数そのものの下限。** 除外の一覧を数え間違えても(あるいは
    // ループの条件が壊れて何も比較しなくなっても)、この下限が無ければ
    // `wrong` が空のまま緑になり続ける。**コード上の数から導く**——
    // `Key::ALL`(46)から無音の 7 つと数を作る 13 を引いた 26 であって、
    // 書き下ろした定数ではない。**除外を 1 つ増やせばここも下がる**ので、
    // 「通らないから除外する」をやると下限が一緒に下がることが差分に出る。
    let expected_compared_min =
        calcarc_core::Key::ALL.len() - SEVEN_SILENT.len() - VALUE_KEYS.len();
    assert!(
        compared >= expected_compared_min,
        "比較した token/label の対が少なすぎる: {compared} 組(期待は少なくとも {expected_compared_min} 組)"
    );

    assert!(
        wrong.is_empty(),
        "綴りと盤面のラベルが食い違っている:\n{}",
        wrong.join("\n")
    );
}

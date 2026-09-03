//! **綴りと盤面のラベルが一致するか。**
//!
//! `token_parity.rs` と同じ形——**Rust から TypeScript のソースをテキストで
//! 読む**。ここが無いと、盤面のラベルだけ変えたときに **core が古い綴りを
//! 出したまま緑になる**(計画 §A-3 / Task 3)。

use calcarc_core::{Key, engine::spell::spell};

/// 綴らない 7 キー。**盤面には在るが式には出ない**
/// (`calcarc_core::engine::spell::glyph` が `None` を返す集合と同じ)。
const SEVEN_SILENT: [&str; 7] = [
    "eq",
    "ac",
    "del",
    "angle_toggle",
    "eng",
    "polar_toggle",
    "dms",
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
        if SEVEN_SILENT.contains(&token.as_str()) {
            continue;
        }
        let Some(key) = Key::from_token(&token) else {
            continue;
        };
        let spelled = spell(&[key]);
        // **綴らない 7 つは飛ばす。** 盤面には在るが式には出ない。
        if spelled.is_empty() {
            continue;
        }
        compared += 1;
        if spelled != label {
            wrong.push(format!("{token}: 盤面は {label:?}、core は {spelled:?}"));
        }
    }

    // **比較件数そのものの下限。** SEVEN_SILENT を数え間違えても
    // (あるいはループの条件が壊れて何も比較しなくなっても)、この下限が
    // 無ければ `wrong` が空のまま緑になり続ける。`Key::ALL.len() -
    // SEVEN_SILENT.len()` は実際のコード量から出た数(46 - 7 = 39)で
    // あって、決め打ちの定数ではない。
    let expected_compared_min = calcarc_core::Key::ALL.len() - SEVEN_SILENT.len();
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

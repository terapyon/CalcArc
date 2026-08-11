//! reduce がどんな入力に対しても panic せず、遷移の不変条件を守ることを
//! 確認する。
//!
//! UI に panic を露出させないという要求（base-spec §27）は、
//! 個別のテストケースでは保証しきれないため無作為な打鍵列で検査する。

use calcarc_core::engine::state::STATE_SCHEMA;
use calcarc_core::{EngineState, Key, reduce};
use proptest::prelude::*;
use proptest::test_runner::TestCaseError;

/// 不変条件。網羅列挙とランダム探索の両方がここだけを呼ぶ。
///
/// 同じ性質を 2 か所に書くと、片方だけ直されて食い違う。検査はすべて
/// 「1 回の遷移」に対する局所的な条件として書く。局所的に成り立てば列
/// 全体でも成り立ち、反例が出たときにどの 1 手が壊したかがすぐ分かる。
mod invariants {
    use calcarc_core::engine::display::ERROR_TEXT;
    use calcarc_core::engine::state::{BinOp, Buffer, OpToken};
    use calcarc_core::{DisplayState, EngineState, Key, Value, render};

    /// 検査対象の 1 手。
    pub struct Step<'a> {
        /// 打鍵位置を最後に動かしたキー。列の先頭では None。
        ///
        /// **engine の `operator_pending` を検査の前提に使わないため**に
        /// 持つ。旗が誤ってクリアされるバグでは「直前が演算子だった」と
        /// いう前提のほうが偽になり、I4 が自分で自分を無効化して素通り
        /// する。実際にそれが起きた。検査対象を検査の前提に使わない。
        ///
        /// 求め方は `keeps_the_position` を見ること。走査側（`walk` と
        /// `Run`）が、渡したキー列と観測した状態差だけから積む。
        pub anchor: Option<Key>,
        pub before: &'a EngineState,
        pub key: Key,
        pub after: &'a EngineState,
        /// `reduce` が返した表示。WASM 境界に実際に渡る値そのもの。
        pub shown: &'a DisplayState,
    }

    /// この 1 手が打鍵位置を保ったか。保ったなら `anchor` は据え置く。
    ///
    /// 位置を決めるのは `buffer` `current` `operands` `operators` `error`
    /// で、`angle` と `form` は表示にしか効かないので数えない。
    /// **engine の `operator_pending` は見ない。** 見れば検査対象を前提に
    /// 使うことになり、I4 がまた自己無効化する。
    ///
    /// キーを絞るのは、状態差だけでは足りないからである。`π` は
    /// `3 − π −` のように現在値がすでに π なら何も動かさないが、
    /// 位置としては被演算数を置き直しており、演算子の直後ではなくなる。
    /// 表示トグルと「何も消さなかった DEL」だけが、位置を保ったと
    /// 断言できるキーである。歴史上のバグ `3 + DEL + 4 =` と
    /// `3 + DRG + 4 =` はどちらもこの形で、これで I4 の射程に入る。
    pub fn keeps_the_position(key: Key, before: &EngineState, after: &EngineState) -> bool {
        if !matches!(key, Key::AngleToggle | Key::PolarToggle | Key::Del) {
            return false;
        }
        before.buffer == after.buffer
            && before.current == after.current
            && before.operands == after.operands
            && before.operators == after.operators
            && before.error == after.error
    }

    /// 遷移 1 回が満たすべき条件をすべて検査する。
    ///
    /// **表示の検査は `reduce` が返したものに掛ける。** `render(after)` を
    /// 組み直して検査すると、WASM 境界に実際に渡る第 2 要素だけがどこ
    /// からも見られない。組み直しは無料ではなく、網羅列挙では毎遷移で
    /// もう 1 回 `render` を呼ぶことになる（実測で全等価類の網が
    /// 4.3s → 6.7s）。返り値を使えば I1 がそのまま境界の値の検査になる。
    pub fn check(step: &Step<'_>) -> Result<(), String> {
        check_state_with(step.after, step.shown)?;
        error_is_latched(step)?;
        real_axis_is_closed(step)?;
        operator_press_replaces(step)?;
        del_removes_at_most_one_thing(step)?;
        Ok(())
    }

    /// `check` に加えて、返された表示が `render(次の状態)` と一致する
    /// ことまで見る。
    ///
    /// 呼ぶのは乱択 2 本だけである。これは `reduce` の最終行 1 行の性質で
    /// あって列の形には依らないので、乱択が踏む数万遷移で十分に張れる。
    /// 網羅列挙の 1,350 万遷移で毎回組み直すと壁時計が 2.4 秒伸び、その
    /// ぶんで買えるものが無い。
    pub fn check_with_the_returned_display(step: &Step<'_>) -> Result<(), String> {
        let recomputed = render(step.after);
        if *step.shown != recomputed {
            return Err(format!(
                "I1b: reduce returned {:?} but render(state) gives {:?}",
                step.shown, recomputed
            ));
        }
        check(step)
    }

    /// 状態だけで判定できる条件。打鍵が 1 度も起きない列（長さ 0）でも
    /// 初期状態を検査できるように、遷移とは別に呼べる形にしておく。
    pub fn check_state(state: &EngineState) -> Result<(), String> {
        check_state_with(state, &render(state))
    }

    fn check_state_with(state: &EngineState, shown: &DisplayState) -> Result<(), String> {
        renderable(shown)?;
        operand_count_matches(state)?;
        Ok(())
    }

    /// I1: 表示は常に作れて、それ自身と矛盾しない。
    ///
    /// 空でないことに加えて「`Math ERROR` と出ているなら error が載って
    /// いる」を見る。極形式は半径が溢れると値そのものは有限のまま表示
    /// だけが失敗するので（`try_format_polar`）、この 2 つが割れうる
    /// 唯一の経路がそこにある。網羅列挙で極形式を踏むために、全等価類の
    /// 網は表示トグルの代表を `▸∠` にしてある（設計書 §5.2）。
    fn renderable(shown: &DisplayState) -> Result<(), String> {
        if shown.main.is_empty() {
            return Err("I1: display is empty".to_string());
        }
        if (shown.main == ERROR_TEXT) != shown.error.is_some() {
            return Err(format!(
                "I1: display shows {:?} but reports error={:?}",
                shown.main, shown.error
            ));
        }
        Ok(())
    }

    fn count_ops(state: &EngineState) -> usize {
        state
            .operators
            .iter()
            .filter(|t| matches!(t, OpToken::Op(_)))
            .count()
    }

    pub(crate) fn count_parens(state: &EngineState) -> usize {
        state
            .operators
            .iter()
            .filter(|t| matches!(t, OpToken::OpenParen))
            .count()
    }

    /// I2: 被演算数の数 = 保留中の二項演算子の数。
    fn operand_count_matches(after: &EngineState) -> Result<(), String> {
        if after.error.is_some() {
            return Ok(());
        }
        let ops = count_ops(after);
        if after.operands.len() != ops {
            return Err(format!(
                "I2: {} operands against {} pending operators",
                after.operands.len(),
                ops
            ));
        }
        Ok(())
    }

    /// I5: エラー中は AC 以外のどのキーでも状態が変わらない。
    fn error_is_latched(step: &Step<'_>) -> Result<(), String> {
        if step.before.error.is_none() || step.key == Key::Ac {
            return Ok(());
        }
        if step.after != step.before {
            return Err(format!(
                "I5: {} changed the state while an error was showing",
                step.key.token()
            ));
        }
        Ok(())
    }

    /// 状態が実数だけで構成されているか。
    fn all_real(state: &EngineState) -> bool {
        state.current.im == 0.0
            && state.operands.iter().all(|v| v.im == 0.0)
            && state.buffer.as_ref().is_none_or(|b| !b.imaginary)
    }

    /// この打鍵が作用する値。入力中なら確定前のバッファの値。
    fn acting_on(state: &EngineState) -> Value {
        state.buffer.as_ref().map_or(state.current, |b| b.value())
    }

    /// I3 / I3b: 実軸は演算で閉じており、虚軸への出口は 2 つだけ。
    ///
    /// 出口 1 は `j` キーで、これは入力なので「実数のみの入力」という
    /// 前提から外れる。出口 2 は負の実数の sqrt で、`sqrt(-4) = j2` を
    /// 返すのは設計上の機能である（Vertical Slice 設計書 §4.1）。
    /// この 2 つを例外として認めないと、網羅列挙が `−` `√` を踏んだ
    /// 瞬間にバグでないものが落ちるテストになる。
    fn real_axis_is_closed(step: &Step<'_>) -> Result<(), String> {
        let (before, after) = (step.before, step.after);
        if !all_real(before) || after.error.is_some() {
            return Ok(());
        }
        if step.key == Key::J {
            // j は入力を始めるだけで、確定済みの値には触れない。免除を
            // 「何をしても素通し」にしないため、そこだけ確かめる。
            if after.current != before.current || after.operands != before.operands {
                return Err(format!(
                    "I3: j changed the committed values ({:?} {:?} -> {:?} {:?})",
                    before.current, before.operands, after.current, after.operands
                ));
            }
            return Ok(());
        }
        if step.key == Key::Sqrt && acting_on(before).re < 0.0 {
            // I3b: 純虚数でなければならない。極形式を経由する実装だと
            // 実部に 1.2e-16 が残り、j2 が 1.224646799e-16+j2 になる。
            //
            // 網羅列挙がここへ届くのは `− 3 = √` や `0 − 3 = √` で、
            // 二項演算の低優先クラスの代表を `+` ではなく `−` にして
            // ある理由がこれである（設計書 §5.2）。
            return if after.current.re == 0.0 {
                Ok(())
            } else {
                Err(format!(
                    "I3b: sqrt of a negative real left re={}",
                    after.current.re
                ))
            };
        }
        if !all_real(after) {
            return Err(format!(
                "I3: a real-only state produced im={} after {}",
                after.current.im,
                step.key.token()
            ));
        }
        Ok(())
    }

    fn binop_of(key: Key) -> Option<BinOp> {
        Some(match key {
            Key::Add => BinOp::Add,
            Key::Sub => BinOp::Sub,
            Key::Mul => BinOp::Mul,
            Key::Div => BinOp::Div,
            _ => return None,
        })
    }

    /// I4: 二項演算子を続けて押したら、最後の 1 つだけが残る。
    ///
    /// 局所的に言い換える。直前の打鍵が二項演算子だったなら、次の二項
    /// 演算子は積むのではなく差し替えでなければならず、被演算数も演算子も
    /// 増えてはならない。累算すると 3 + + 4 = が 10 になる。
    ///
    /// 同種・異種を問わない。実際に起きたバグは `3 + × 4 =` と
    /// `3 + DEL + 4 =` であって、同種の連打ではなかった。表示トグルや
    /// 何も消さない DEL を挟んだ形も `anchor` が拾うので射程に入る。
    ///
    /// **前提は `anchor` から取る。** engine の `operator_pending` を読むと、
    /// 旗が誤ってクリアされるバグでは前提そのものが偽になり、この検査が
    /// 黙って無効化される。実測: 二項演算子の腕を `true` から `false` に
    /// 退行させると、旗を読む版は 7 本すべて緑のまま通り、`anchor` を
    /// 読む版は `3 + +` で落ちる。
    ///
    /// 何かを消した DEL を挟んだ形（`3 × 4 DEL × 5 =`）は前提から外れる。
    /// 位置が動いたかどうかを走査側から言えないためで、そちらは
    /// engine_table.rs の `del_returns_to_the_pending_operator` が受け持つ。
    fn operator_press_replaces(step: &Step<'_>) -> Result<(), String> {
        let (before, after) = (step.before, step.after);
        let Some(op) = binop_of(step.key) else {
            return Ok(());
        };
        if !step.anchor.is_some_and(|k| binop_of(k).is_some()) {
            return Ok(());
        }
        if before.error.is_some() {
            // 直前の演算子は畳み込みに失敗している。I5 の領域。
            return Ok(());
        }
        // 差し替えは計算を起こさないので、失敗しようがない。
        if after.error.is_some() {
            return Err(format!(
                "I4: {} after a pending operator errored ({:?})",
                step.key.token(),
                after.error
            ));
        }
        // **長さで比べてはならない。** 優先順位が同じか降順のときは、
        // 誤って積んだ被演算数が直後の畳み込みで戻されるため長さが変わらない。
        // 3 + + 4 = が 10 になるバグはまさにこの経路で、長さ比較では
        // 素通りする（operands も operators も 1 -> 1 のまま）。
        // 積まれたかどうかは内容にしか現れない。
        if after.operands != before.operands {
            return Err(format!(
                "I4: {} after a pending operator changed the operands ({:?} -> {:?})",
                step.key.token(),
                before.operands,
                after.operands
            ));
        }
        if after.current != before.current {
            return Err(format!(
                "I4: {} after a pending operator changed the value ({:?} -> {:?})",
                step.key.token(),
                before.current,
                after.current
            ));
        }
        if after.operators.len() != before.operators.len() {
            return Err(format!(
                "I4: {} after a pending operator grew the operator stack ({} -> {})",
                step.key.token(),
                before.operators.len(),
                after.operators.len()
            ));
        }
        // 長さだけでなく、押した演算子がスタックの先頭に載っていること。
        // 見ないと、差し替えを「何もせず return」に退行させても通る。
        if after.operators.last() != Some(&OpToken::Op(op)) {
            return Err(format!(
                "I4: {} left {:?} on top of the operator stack",
                step.key.token(),
                after.operators.last()
            ));
        }
        Ok(())
    }

    /// DEL 1 回でバッファがどうなるべきか。
    ///
    /// 打鍵した文字を末尾から 1 つだけ消す。数字が尽きても `j` マーカーは
    /// 残り、消すにはもう一度押す。ここを「まとめて捨てる」に戻すと
    /// `3 + j4 DEL 5 =` が 3+j5 ではなく 8 になる。実装の `Buffer::backspace` を
    /// 写したものではなく、「入力欄から 1 文字消える」という外から見た
    /// 期待をそのまま書いてある。
    fn entry_after_del(entry: &Buffer) -> Option<Buffer> {
        let mut digits = entry.digits.clone();
        // 数字が無いなら、残っているのは j マーカーだけ。それが消える。
        digits.pop()?;
        if digits.is_empty() && !entry.imaginary {
            // 実数の入力が空になったらバッファごと消える。表示は確定値に戻る。
            return None;
        }
        Some(Buffer {
            digits,
            imaginary: entry.imaginary,
        })
    }

    /// I7: DEL は 3 段のうち 1 つだけを消す。
    ///
    /// 段は 数字 → `j` マーカー → 閉じられていない開き括弧 の順で、
    /// 確定した値（`current` / `operands`）と演算子には触れない。
    /// **段の順序と、消える文字数まで見る。** ここを `operands` と
    /// スタックの本数だけで書くと、設計書 §1 の動機になった実バグ
    /// （DEL が虚数入力の `j` を捨てる）を再導入しても無言で通る。
    fn del_removes_at_most_one_thing(step: &Step<'_>) -> Result<(), String> {
        let (before, after) = (step.before, step.after);
        if step.key != Key::Del || before.error.is_some() {
            return Ok(());
        }
        if after.current != before.current {
            return Err(format!(
                "I7: DEL changed the committed value ({:?} -> {:?})",
                before.current, after.current
            ));
        }
        if after.operands != before.operands {
            return Err("I7: DEL moved the operand stack".to_string());
        }
        if count_ops(after) != count_ops(before) {
            return Err("I7: DEL removed an operator".to_string());
        }
        let (open_before, open_after) = (count_parens(before), count_parens(after));
        match &before.buffer {
            // 1 段目と 2 段目。入力中は括弧に手を出さない。
            Some(entry) => {
                if open_after != open_before {
                    return Err(format!(
                        "I7: DEL went for a parenthesis ({open_before} -> {open_after}) \
                         while the entry {entry:?} was still open"
                    ));
                }
                let expected = entry_after_del(entry);
                if after.buffer != expected {
                    return Err(format!(
                        "I7: DEL turned the entry {:?} into {:?}, expected {:?}",
                        entry, after.buffer, expected
                    ));
                }
            }
            // 3 段目。開き括弧が先頭にあるときだけ、それを 1 つ消す。
            None => {
                if after.buffer.is_some() {
                    return Err(format!("I7: DEL created an entry ({:?})", after.buffer));
                }
                let takes_paren = matches!(before.operators.last(), Some(OpToken::OpenParen));
                let expected = open_before - usize::from(takes_paren);
                if open_after != expected {
                    return Err(format!(
                        "I7: DEL left {open_after} parentheses, expected {expected}"
                    ));
                }
            }
        }
        Ok(())
    }
}

/// 等価類に畳んだ代表キー。畳んでよい根拠は設計書 §5.2 の表にある。
/// 判断基準は「状態機械に対する作用が同じか」であって、表示上の違いではない。
///
/// 構造の網。表示トグルと定数を外すぶん、長さ 7 まで届く。
///
/// 二項演算子の代表が `−` と `÷` なのは、同じ等価類のうち**射程が広いほう**
/// を選んでいるからである。`−` は負の実数を作れるので `√` の I3b 経路に
/// 届き、`÷` は畳み込みの途中で失敗できる唯一の二項演算子で、被演算数を
/// 消費した後にエラーになった状態の形を網に入れる。`+` `×` を代表にすると
/// どちらの形も一度も通らない。
const STRUCTURE: [Key; 10] = [
    Key::Digit(3),
    Key::Dot,
    Key::J,
    Key::Sub,
    Key::Div,
    Key::Eq,
    Key::LParen,
    Key::RParen,
    Key::Del,
    Key::Ac,
];

/// 全等価類の網。表示トグル・後置関数・定数・ゼロを足すぶん長さ 6 まで。
///
/// `√` を後置関数の代表にするのは、sqrt だけが負の実数用の専用経路を持ち
/// （I3b）、他の単項関数と違う分岐を通るためである。`0 − 3 = √` で届く。
///
/// 表示トグルの代表は `▸∠` にする。`DRG` と `▸∠` は状態への作用こそ同じ
/// だが、`angle` は三角関数と極形式の角度にしか効かず、この網は単項関数を
/// `√` に畳んでいるので `DRG` を選ぶと**何も変わらないキー**になる。
/// `▸∠` なら極形式の描画が網の全域で走り、I1 がそれを見る。
const ALL_CLASSES: [Key; 14] = [
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
];

/// 深さ優先で全列を辿り、遷移ごとに不変条件を検査する。
///
/// エラー状態に落ちた列は AC 以外が無効なので（I5）、そこから先を辿っても
/// 新しい状態には届かない。枝刈りする。
fn walk(
    state: &EngineState,
    keys: &[Key],
    depth: usize,
    max: usize,
    trail: &mut Vec<&'static str>,
    anchor: Option<Key>,
) {
    if depth == max {
        return;
    }
    for &key in keys {
        let (next, shown) = reduce(state, key);
        trail.push(key.token());
        let step = invariants::Step {
            anchor,
            before: state,
            key,
            after: &next,
            shown: &shown,
        };
        if let Err(why) = invariants::check(&step) {
            panic!("{why}\n  key sequence: {trail:?}");
        }
        let next_anchor = if invariants::keeps_the_position(key, state, &next) {
            anchor
        } else {
            Some(key)
        };
        // エラー状態からは AC 以外で新しい状態に届かないので、ここから
        // **先を辿らない**。遷移そのものは上で必ず検査する。枝刈りの根拠が
        // I5（エラーは AC でしか解けない）である以上、I5 を検査せずに
        // 枝刈りしては循環で、I5 だけが網羅から漏れる。
        if state.error.is_none() || key == Key::Ac {
            walk(&next, keys, depth + 1, max, trail, next_anchor);
        }
        trail.pop();
    }
}

/// 網羅列挙の入口。長さ 0 の列——初期状態そのもの——も検査してから降りる。
fn walk_from_the_start(keys: &[Key], max: usize) {
    let start = EngineState::initial();
    if let Err(why) = invariants::check_state(&start) {
        panic!("{why}\n  key sequence: []");
    }
    walk(&start, keys, 0, max, &mut Vec::new(), None);
}

/// 構造に関わるキーだけで、長さ 7 までのすべての打鍵列を検査する。
///
/// Vertical Slice で見つかったキー列バグは最長で 7 打鍵だった
/// （`3 + j 4 DEL 5 =`）。ランダム探索はこの領域をたまたましか踏まない。
#[test]
fn every_structural_sequence_up_to_seven_keys_holds_the_invariants() {
    walk_from_the_start(&STRUCTURE, 7);
}

/// 全等価類で長さ 6 まで。表示トグルを挟んだ形（`3 − ▸∠ − 4 =`）や
/// 負の実数の `√`（`0 − 3 = √`）はこちらの網にかかる。
#[test]
fn every_sequence_over_all_classes_up_to_six_keys_holds_the_invariants() {
    walk_from_the_start(&ALL_CLASSES, 6);
}

/// 重みつきのキー生成。演算子と括弧を厚くして、深い入れ子と長い畳み込みに
/// 届かせる。
///
/// **効いているのは重みの絶対値ではなく `(` と `)` の比である。** 合計 20 の
/// うち `(` が 3（15%）、`)` が 2（10%）で、一様な 1/30（3.3%）よりどちらも
/// 厚い。`)` を引く率はむしろ 3 倍に上げてある。深さが伸びるのは `(` が
/// `)` より 1.5 倍出やすいからであって、`)` を薄くしているからではない。
///
/// 列が最後まで生き延びるのは重みのおかげではなく、下のループが挟む **AC
/// 復帰**のおかげである。実測では列の 9 割近くが途中で一度はエラーに落ちる。
/// 「`)` を薄くすれば列が死ななくなる」と読んで重みを触ると、深さだけが
/// 静かに消える。触るなら the_weighted_search_still_reaches_deep_states の
/// 実測値ごと見直すこと。
fn weighted_key() -> impl Strategy<Value = Key> {
    prop_oneof![
        5 => prop::sample::select(vec![
            Key::Digit(0), Key::Digit(3), Key::Digit(7),
        ]),
        4 => prop::sample::select(vec![
            Key::Add, Key::Sub, Key::Mul, Key::Div,
        ]),
        3 => Just(Key::LParen),
        2 => Just(Key::RParen),
        2 => Just(Key::Eq),
        1 => Just(Key::J),
        1 => Just(Key::Dot),
        1 => prop::sample::select(vec![
            Key::Sqrt, Key::Sqr, Key::Neg, Key::Sin, Key::Cos, Key::Tan, Key::Pi,
        ]),
        1 => prop::sample::select(vec![
            Key::Del, Key::AngleToggle, Key::PolarToggle, Key::Ac,
        ]),
    ]
}

/// 乱択探索が辿る 1 本の列。
///
/// 走査を 1 か所に集約する。不変条件を検査する proptest と、到達距離を
/// 測るテストが別々の歩き方をすると、測っている列と検査している列が
/// 黙って食い違う。
struct Run {
    state: EngineState,
    /// 打鍵位置を最後に動かしたキー。I4 の前提になる（`Step::anchor`）。
    anchor: Option<Key>,
    /// 実際に `reduce` に渡したキー列。挟んだ AC も含む。
    ///
    /// proptest が出す縮小結果は `Vec<Key>` の Debug 表示で、しかも AC を
    /// 含まない（実行時に差し込まれるため）。つまりそれだけでは再現でき
    /// ない。`engine_table.rs` の `main_of(&[...])` にそのまま貼れる形で
    /// 持っておく。
    trail: Vec<&'static str>,
}

impl Run {
    fn new() -> Run {
        Run {
            state: EngineState::initial(),
            anchor: None,
            trail: Vec::new(),
        }
    }

    /// エラー中なら AC を挟んでから `key` を打つ。
    ///
    /// 挟まないと、一度落ちた列は残り全部が無効打鍵になり探索に寄与しない。
    fn press(
        &mut self,
        key: Key,
        observe: &mut impl FnMut(&invariants::Step<'_>) -> Result<(), String>,
    ) -> Result<(), String> {
        if self.state.error.is_some() {
            self.press_without_recovery(Key::Ac, observe)?;
        }
        self.press_without_recovery(key, observe)
    }

    /// AC を挟まずに 1 手進める。エラー状態に留まったまま打鍵し続ける形
    /// （I5 の連続適用）を踏むのはこちらだけ。
    fn press_without_recovery(
        &mut self,
        key: Key,
        observe: &mut impl FnMut(&invariants::Step<'_>) -> Result<(), String>,
    ) -> Result<(), String> {
        let (next, shown) = reduce(&self.state, key);
        self.trail.push(key.token());
        let step = invariants::Step {
            anchor: self.anchor,
            before: &self.state,
            key,
            after: &next,
            shown: &shown,
        };
        if let Err(why) = observe(&step) {
            return Err(format!("{why}\n  key sequence: {:?}", self.trail));
        }
        if !invariants::keeps_the_position(key, &self.state, &next) {
            self.anchor = Some(key);
        }
        self.state = next;
        Ok(())
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(500))]

    /// 任意の打鍵列を与えても panic せず、常に表示可能な状態が返る。
    ///
    /// 重みつきの探索があってもこれを残すのは、固有の寄与が 2 つあるため。
    /// (a) 30 キーを一様に引く唯一の乱択で、`schema` の検査もここにしか
    /// ない。(b) **AC 復帰を挟まない**唯一の乱択で、エラー状態に留まった
    /// まま打鍵し続ける形（I5 の連続適用）を踏むのはここだけである。
    #[test]
    fn never_panics(indices in prop::collection::vec(0usize..Key::ALL.len(), 0..40)) {
        let mut run = Run::new();
        // 長さ 0 の列ではループが 1 度も回らない。初期状態だけは見ておく。
        if let Err(why) = invariants::check_state(&run.state) {
            return Err(TestCaseError::fail(why));
        }
        for i in indices {
            let outcome = run.press_without_recovery(Key::ALL[i], &mut |step| {
                if step.after.schema != STATE_SCHEMA {
                    return Err(format!("schema {} is not {STATE_SCHEMA}", step.after.schema));
                }
                invariants::check_with_the_returned_display(step)
            });
            if let Err(why) = outcome {
                return Err(TestCaseError::fail(why));
            }
        }
    }

    /// AC はどんな状態からでも初期表示に戻す。
    #[test]
    fn ac_always_recovers(indices in prop::collection::vec(0usize..Key::ALL.len(), 0..40)) {
        let mut state = EngineState::initial();
        for i in indices {
            state = reduce(&state, Key::ALL[i]).0;
        }
        let (cleared, shown) = reduce(&state, Key::Ac);
        prop_assert!(cleared.error.is_none());
        prop_assert!(cleared.operands.is_empty());
        prop_assert!(cleared.operators.is_empty());
        // 表示形式が Polar のままなら "0 ∠ 0"、Rect なら "0"。
        prop_assert!(shown.main == "0" || shown.main == "0 ∠ 0");
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(300))]

    /// 長い打鍵列を辿る。エラーに落ちたら AC を挟んで続ける。
    ///
    /// 網羅列挙が短い列を保証するので、こちらは深い入れ子・長い畳み込み・
    /// エラーからの復帰を繰り返す領域を担当する。
    #[test]
    fn long_sequences_hold_the_invariants(
        keys in prop::collection::vec(weighted_key(), 0..120)
    ) {
        let mut run = Run::new();
        for key in keys {
            if let Err(why) = run.press(key, &mut invariants::check_with_the_returned_display) {
                return Err(TestCaseError::fail(why));
            }
        }
    }
}

/// 到達距離を測るときの「深い」の境目。
const DEEP: usize = 5;

/// 重みが崩れたことに気づけるようにする。
///
/// 深い入れ子・長い畳み込み・復帰の繰り返しに届くテストはこれ 1 つで、
/// 網羅列挙は費用の都合で届かない（長さ 8 で 51 秒）。重みを触った誰かが
/// 到達距離を潰しても、不変条件は静かに通り続ける。到達距離そのものを
/// 表明しておかないと、この領域の網は音もなく消える。
///
/// **測るのは最大値ではなく滞在量である。** 深さの最大値は極値統計なので
/// 鈍い。実測（この種で 300 列）:
///
/// | 生成器 | 最大深さ | 深さ 5 以上の打鍵数 | 復帰回数 |
/// |---|---|---|---|
/// | 現状 | 9 | 315 | 1159 |
/// | `(` を 3 → 2 | 9 | 29 | 1586 |
/// | `)` を 2 → 6 | 8 | 29 | 3382 |
/// | 重みを全部 1 | 9 | 87 | 1751 |
///
/// 崩した 3 通りのどれでも最大深さは 8〜9 のままで、`deepest >= 5` は
/// 素通りする。滞在量なら 3 通りとも捕まる。
///
/// **復帰回数は両側で挟む。** 生成器が悪化するほど復帰は単調に増えるので、
/// 下限だけでは「重みが崩れた」ことに原理的に気づけない。
///
/// 種は固定してあるので結果は揺れない。ただし proptest の RNG が変われば
/// 実測値も動く。`Cargo.toml` の `proptest = "1"` は minor を固定して
/// いないので、`cargo update` の後にこのテストが落ちたら、まず実測を
/// 取り直して数字を更新することを疑う。
#[test]
fn the_weighted_search_still_reaches_deep_states() {
    use proptest::strategy::ValueTree;
    use proptest::test_runner::{Config, RngAlgorithm, TestRng, TestRunner};

    let mut runner = TestRunner::new_with_rng(
        Config::default(),
        TestRng::deterministic_rng(RngAlgorithm::ChaCha),
    );
    let strategy = prop::collection::vec(weighted_key(), 0..120);

    let (mut deepest, mut dwell, mut recoveries) = (0usize, 0usize, 0usize);
    for _ in 0..300 {
        let keys = strategy.new_tree(&mut runner).unwrap().current();
        let mut run = Run::new();
        for key in keys {
            run.press(key, &mut |step| {
                if step.key == Key::Ac && step.before.error.is_some() {
                    recoveries += 1;
                }
                let depth = invariants::count_parens(step.after);
                deepest = deepest.max(depth);
                if depth >= DEEP {
                    dwell += 1;
                }
                Ok(())
            })
            .expect("観測しかしないので失敗しない");
        }
    }

    assert!(
        dwell >= 150,
        "深さ {DEEP} 以上で打たれた打鍵が {dwell} 回しかない（実測 315）。\
         最大到達深さ {deepest} は崩れても動かないので当てにならない。\
         weighted_key の重みを確認すること"
    );
    assert!(
        (900..=1400).contains(&recoveries),
        "エラーからの復帰が {recoveries} 回（実測 1159）。生成器が崩れると\
         増える側にも動くので両側で挟んである。weighted_key の重みを確認すること"
    );
}

#[test]
fn a_state_with_the_wrong_schema_is_discarded() {
    let mut stale = EngineState::initial();
    stale.schema = STATE_SCHEMA + 1;
    stale.current = calcarc_core::Value::real(999.0);

    // 例外にせず、初期状態から再開する（設計書 §5）。
    let (next, shown) = reduce(&stale, Key::from_token("3").unwrap());
    assert_eq!(next.schema, STATE_SCHEMA);
    assert_eq!(shown.main, "3");
}

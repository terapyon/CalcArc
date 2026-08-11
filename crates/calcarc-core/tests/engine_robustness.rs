//! reduce がどんな入力に対しても panic しないことを確認する。
//!
//! UI に panic を露出させないという要求（base-spec §27）は、
//! 個別のテストケースでは保証しきれないため無作為な打鍵列で検査する。

use calcarc_core::engine::key::Key;
use calcarc_core::engine::reduce;
use calcarc_core::engine::state::{EngineState, STATE_SCHEMA};
use proptest::prelude::*;
use proptest::test_runner::TestCaseError;

/// 不変条件。網羅列挙とランダム探索の両方がここだけを呼ぶ。
///
/// 同じ性質を 2 か所に書くと、片方だけ直されて食い違う。検査はすべて
/// 「1 回の遷移」に対する局所的な条件として書く。局所的に成り立てば列
/// 全体でも成り立ち、反例が出たときにどの 1 手が壊したかがすぐ分かる。
mod invariants {
    use calcarc_core::Value;
    use calcarc_core::engine::display::display;
    use calcarc_core::engine::key::Key;
    use calcarc_core::engine::state::{EngineState, OpToken};

    /// 遷移 1 回が満たすべき条件をすべて検査する。
    pub fn check(before: &EngineState, key: Key, after: &EngineState) -> Result<(), String> {
        check_state(after)?;
        error_is_latched(before, key, after)?;
        real_axis_is_closed(before, key, after)?;
        operator_press_replaces(before, key, after)?;
        del_removes_at_most_one_thing(before, key, after)?;
        Ok(())
    }

    /// 状態だけで判定できる条件。打鍵が 1 度も起きない列（長さ 0）でも
    /// 初期状態を検査できるように、遷移とは別に呼べる形にしておく。
    pub fn check_state(state: &EngineState) -> Result<(), String> {
        renderable(state)?;
        operand_count_matches(state)?;
        Ok(())
    }

    /// I1: 表示は常に作れる。
    fn renderable(after: &EngineState) -> Result<(), String> {
        if display(after).main.is_empty() {
            return Err("I1: display is empty".to_string());
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

    fn count_parens(state: &EngineState) -> usize {
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
    fn error_is_latched(before: &EngineState, key: Key, after: &EngineState) -> Result<(), String> {
        if before.error.is_none() || key == Key::Ac {
            return Ok(());
        }
        if after != before {
            return Err(format!(
                "I5: {} changed the state while an error was showing",
                key.token()
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
    /// この 2 つを例外として認めないと、網羅列挙が `+/−` `√` を踏んだ
    /// 瞬間にバグでないものが落ちるテストになる。
    fn real_axis_is_closed(
        before: &EngineState,
        key: Key,
        after: &EngineState,
    ) -> Result<(), String> {
        if !all_real(before) || after.error.is_some() {
            return Ok(());
        }
        if key == Key::J {
            // j は入力を始めるだけで、確定済みの値には触れない。免除を
            // 「何をしても素通し」にしないため、そこだけ確かめる。
            return if after.current == before.current {
                Ok(())
            } else {
                Err(format!(
                    "I3: j changed the committed value ({:?} -> {:?})",
                    before.current, after.current
                ))
            };
        }
        if key == Key::Sqrt && acting_on(before).re < 0.0 {
            // I3b: 純虚数でなければならない。極形式を経由する実装だと
            // 実部に 1.2e-16 が残り、j2 が 1.224646799e-16+j2 になる。
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
                key.token()
            ));
        }
        Ok(())
    }

    fn is_binop(key: Key) -> bool {
        matches!(key, Key::Add | Key::Sub | Key::Mul | Key::Div)
    }

    /// I4: 二項演算子を続けて押したら、最後の 1 つだけが残る。
    ///
    /// 局所的に言い換える。直前が二項演算子だったなら、次の二項演算子は
    /// 積むのではなく差し替えでなければならず、被演算数も演算子も増えては
    /// ならない。累算すると 3 + + 4 = が 10 になる。
    ///
    /// 同種・異種を問わない。また表示だけを変えるキーや、何も消さない DEL を
    /// 挟んでも operator_pending は落ちないので、この検査はその形も覆う。
    /// 実際に起きたバグは `3 + × 4 =` と `3 + DEL + 4 =` であって、
    /// 同種の連打ではなかった。
    fn operator_press_replaces(
        before: &EngineState,
        key: Key,
        after: &EngineState,
    ) -> Result<(), String> {
        if !before.operator_pending || !is_binop(key) || after.error.is_some() {
            return Ok(());
        }
        // **長さで比べてはならない。** 優先順位が同じか降順のときは、
        // 誤って積んだ被演算数が直後の畳み込みで戻されるため長さが変わらない。
        // 3 + + 4 = が 10 になるバグはまさにこの経路で、長さ比較では
        // 素通りする（operands も operators も 1 -> 1 のまま）。
        // 積まれたかどうかは内容にしか現れない。
        if after.operands != before.operands {
            return Err(format!(
                "I4: {} after a pending operator changed the operands ({:?} -> {:?})",
                key.token(),
                before.operands,
                after.operands
            ));
        }
        if after.current != before.current {
            return Err(format!(
                "I4: {} after a pending operator changed the value ({:?} -> {:?})",
                key.token(),
                before.current,
                after.current
            ));
        }
        if after.operators.len() != before.operators.len() {
            return Err(format!(
                "I4: {} after a pending operator grew the operator stack ({} -> {})",
                key.token(),
                before.operators.len(),
                after.operators.len()
            ));
        }
        Ok(())
    }

    /// I7: DEL は 3 段のうち 1 つだけを消す。演算子と被演算数は動かさない。
    fn del_removes_at_most_one_thing(
        before: &EngineState,
        key: Key,
        after: &EngineState,
    ) -> Result<(), String> {
        if key != Key::Del || before.error.is_some() {
            return Ok(());
        }
        if after.operands != before.operands {
            return Err("I7: DEL moved the operand stack".to_string());
        }
        if count_ops(after) != count_ops(before) {
            return Err("I7: DEL removed an operator".to_string());
        }
        let (open_before, open_after) = (count_parens(before), count_parens(after));
        if open_after > open_before {
            return Err("I7: DEL added a parenthesis".to_string());
        }
        if open_before - open_after > 1 {
            return Err(format!(
                "I7: DEL removed {} parentheses at once",
                open_before - open_after
            ));
        }
        Ok(())
    }
}

/// 等価類に畳んだ代表キー。畳んでよい根拠は設計書 §5.2 の表にある。
/// 判断基準は「状態機械に対する作用が同じか」であって、表示上の違いではない。
///
/// 構造の網。表示トグルと定数を外すぶん、長さ 7 まで届く。
const STRUCTURE: [Key; 10] = [
    Key::Digit(3),
    Key::Dot,
    Key::J,
    Key::Add,
    Key::Mul,
    Key::Eq,
    Key::LParen,
    Key::RParen,
    Key::Del,
    Key::Ac,
];

/// 全等価類の網。表示トグル・後置関数・定数・ゼロを足すぶん長さ 6 まで。
///
/// `√` を後置関数の代表にするのは、sqrt だけが負の実数用の専用経路を持ち
/// （I3b）、他の単項関数と違う分岐を通るためである。
/// `DRG` と `▸∠` は互いに等価なので代表 1 つでよい。どちらも angle / form
/// しか変えず、buffer / current / operands / operators に触れない。
const ALL_CLASSES: [Key; 14] = [
    Key::Digit(3),
    Key::Digit(0),
    Key::Dot,
    Key::J,
    Key::Add,
    Key::Mul,
    Key::Eq,
    Key::LParen,
    Key::RParen,
    Key::Del,
    Key::Ac,
    Key::AngleToggle,
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
) {
    if depth == max {
        return;
    }
    for &key in keys {
        let (next, _) = reduce(state, key);
        trail.push(key.token());
        if let Err(why) = invariants::check(state, key, &next) {
            panic!("{why}\n  key sequence: {trail:?}");
        }
        // エラー状態からは AC 以外で新しい状態に届かないので、ここから
        // **先を辿らない**。遷移そのものは上で必ず検査する。枝刈りの根拠が
        // I5（エラーは AC でしか解けない）である以上、I5 を検査せずに
        // 枝刈りしては循環で、I5 だけが網羅から漏れる。
        if state.error.is_none() || key == Key::Ac {
            walk(&next, keys, depth + 1, max, trail);
        }
        trail.pop();
    }
}

/// 構造に関わるキーだけで、長さ 7 までのすべての打鍵列を検査する。
///
/// Vertical Slice で見つかったキー列バグは最長で 7 打鍵だった
/// （`3 + j 4 DEL 5 =`）。ランダム探索はこの領域をたまたましか踏まない。
#[test]
fn every_structural_sequence_up_to_seven_keys_holds_the_invariants() {
    walk(&EngineState::initial(), &STRUCTURE, 0, 7, &mut Vec::new());
}

/// 全等価類で長さ 6 まで。表示トグルを挟んだ形（`3 + DRG + 4 =`）は
/// こちらの網にかかる。
#[test]
fn every_sequence_over_all_classes_up_to_six_keys_holds_the_invariants() {
    walk(&EngineState::initial(), &ALL_CLASSES, 0, 6, &mut Vec::new());
}

/// 重みつきのキー生成。演算子と括弧を厚くして、深い入れ子と長い畳み込みに
/// 届かせる。一様に引くと `)` を早々に踏んで大半の列が死ぬ。
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

proptest! {
    #![proptest_config(ProptestConfig::with_cases(500))]

    /// 任意の打鍵列を与えても panic せず、常に表示可能な状態が返る。
    #[test]
    fn never_panics(indices in prop::collection::vec(0usize..Key::ALL.len(), 0..40)) {
        let mut state = EngineState::initial();
        // 長さ 0 の列ではループが 1 度も回らない。初期状態だけは見ておく。
        if let Err(why) = invariants::check_state(&state) {
            return Err(TestCaseError::fail(why));
        }
        for i in indices {
            let key = Key::ALL[i];
            let (next, _) = reduce(&state, key);
            prop_assert_eq!(next.schema, STATE_SCHEMA);
            if let Err(why) = invariants::check(&state, key, &next) {
                return Err(TestCaseError::fail(why));
            }
            state = next;
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
    /// 挟まないと、一度落ちた列は残り全部が無効打鍵になり探索に寄与しない。
    /// 網羅列挙が短い列を保証するので、こちらは深い入れ子・長い畳み込み・
    /// エラーからの復帰を繰り返す領域を担当する。
    #[test]
    fn long_sequences_hold_the_invariants(
        keys in prop::collection::vec(weighted_key(), 0..120)
    ) {
        let mut state = EngineState::initial();
        for key in keys {
            if state.error.is_some() {
                let (cleared, _) = reduce(&state, Key::Ac);
                if let Err(why) = invariants::check(&state, Key::Ac, &cleared) {
                    return Err(TestCaseError::fail(why));
                }
                state = cleared;
            }
            let (next, _) = reduce(&state, key);
            if let Err(why) = invariants::check(&state, key, &next) {
                return Err(TestCaseError::fail(format!("{why} (key {})", key.token())));
            }
            state = next;
        }
    }
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

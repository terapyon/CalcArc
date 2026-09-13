//! 全列挙の最終値の照合(0.9.2 設計書 §2.6)。
//!
//! 独立: 別手順。エンジンは演算子スタックで打鍵のたびに畳むが、ここはキー列を
//! **式のトークン列**に正規化し、`=` で**再帰下降の構文解析により有理数のまま**評価する。
//! 入力の決まり(押し直し・DEL・押せないキー・閉じ忘れ・`x op =`)は `Typed::press` の
//! 各腕が engine_table.rs の行を名指しして持つ——**写しの出どころを 1 か所にする**。
//!
//! **押せないキーも列に残す**(calcarc-1e の確認、設計書 §2.6)。エンジンには全キーを渡し、
//! ここは自前の規則で押せないキーを無視する。`refuses` は呼ばない——呼べば、エンジンが
//! 拒みすぎても拒み足りなくても、ここが同じ誤りに従って黙る。

use calcarc_core::numeric::format::format_real;
use calcarc_core::{CalcError, EngineState, Key, reduce};

/// 既約の有理数。分母は正。
#[derive(Clone, Copy, Debug, PartialEq)]
struct Q {
    n: i128,
    d: i128,
}

fn gcd(a: i128, b: i128) -> i128 {
    if b == 0 { a.abs() } else { gcd(b, a % b) }
}

impl Q {
    fn int(n: i128) -> Q {
        Q { n, d: 1 }
    }
    fn new(n: i128, d: i128) -> Q {
        let g = gcd(n, d).max(1);
        let s = if d < 0 { -1 } else { 1 };
        Q {
            n: s * n / g,
            d: s * d / g,
        }
    }
    fn add(self, o: Q) -> Q {
        Q::new(self.n * o.d + o.n * self.d, self.d * o.d)
    }
    fn sub(self, o: Q) -> Q {
        Q::new(self.n * o.d - o.n * self.d, self.d * o.d)
    }
    fn mul(self, o: Q) -> Q {
        Q::new(self.n * o.n, self.d * o.d)
    }
    fn div(self, o: Q) -> Result<Q, CalcError> {
        if o.n == 0 {
            Err(CalcError::DivisionByZero)
        } else {
            Ok(Q::new(self.n * o.d, self.d * o.n))
        }
    }
    fn to_f64(self) -> f64 {
        self.n as f64 / self.d as f64
    }
}

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Num(String),
    Val(Q),
    Op(char),
    Open,
    Close,
}

fn prec(op: char) -> u8 {
    if op == '+' || op == '−' { 1 } else { 2 }
}

fn glyph(key: Key) -> char {
    match key {
        Key::Add => '+',
        Key::Sub => '−',
        Key::Mul => '×',
        _ => '÷',
    }
}

/// 閉じていない `(` の数。
fn depth(toks: &[Tok]) -> usize {
    toks.iter().fold(0usize, |d, t| match t {
        Tok::Open => d + 1,
        Tok::Close => d.saturating_sub(1),
        _ => d,
    })
}

/// `x op =`・`x op )` の右辺(engine_table: `equals_after_an_operator_repeats_the_operand` の
/// `3 + =` が 6、`the_echo_shows_the_pending_expression` の `2 × 3 +` が「6 +」)。
/// **演算子を押した瞬間に画面に出る値**＝押した演算子より優先順位が低くない演算だけで
/// 結ばれた、直前の項の値。いちばん内側の開いた括弧より前へは戻らない。
fn implied(prefix: &[Tok], p: u8) -> Result<Q, CalcError> {
    let mut depth = 0usize;
    let mut start = 0;
    for (i, t) in prefix.iter().enumerate().rev() {
        match t {
            Tok::Close => depth += 1,
            Tok::Open if depth > 0 => depth -= 1,
            Tok::Open => {
                start = i + 1;
                break;
            }
            Tok::Op(op) if depth == 0 && prec(*op) < p => {
                start = i + 1;
                break;
            }
            _ => {}
        }
    }
    eval(&prefix[start..])
}

fn eval(toks: &[Tok]) -> Result<Q, CalcError> {
    let mut at = 0;
    let v = expr(toks, &mut at)?;
    if at == toks.len() {
        Ok(v)
    } else {
        Err(CalcError::SyntaxError)
    }
}

fn expr(t: &[Tok], at: &mut usize) -> Result<Q, CalcError> {
    let mut v = term(t, at)?;
    while let Some(Tok::Op(op @ ('+' | '−'))) = t.get(*at) {
        *at += 1;
        let r = term(t, at)?;
        v = if *op == '+' { v.add(r) } else { v.sub(r) };
    }
    Ok(v)
}

fn term(t: &[Tok], at: &mut usize) -> Result<Q, CalcError> {
    let mut v = factor(t, at)?;
    while let Some(Tok::Op(op @ ('×' | '÷'))) = t.get(*at) {
        *at += 1;
        let r = factor(t, at)?;
        v = if *op == '×' { v.mul(r) } else { v.div(r)? };
    }
    Ok(v)
}

fn factor(t: &[Tok], at: &mut usize) -> Result<Q, CalcError> {
    match t.get(*at) {
        Some(Tok::Num(s)) => {
            *at += 1;
            s.parse::<i128>()
                .map(Q::int)
                .map_err(|_| CalcError::SyntaxError)
        }
        Some(Tok::Val(q)) => {
            *at += 1;
            Ok(*q)
        }
        Some(Tok::Open) => {
            *at += 1;
            let v = expr(t, at)?;
            match t.get(*at) {
                Some(Tok::Close) => {
                    *at += 1;
                    Ok(v)
                }
                _ => Err(CalcError::SyntaxError),
            }
        }
        _ => Err(CalcError::SyntaxError),
    }
}

/// 打った列を式として持つ。`toks` が空のとき画面に出ている値が `base`
/// (始めは 0、`=` のあとは答え)。
#[derive(Clone, Debug)]
struct Typed {
    toks: Vec<Tok>,
    base: Q,
    error: Option<CalcError>,
}

impl Typed {
    fn new() -> Typed {
        Typed {
            toks: Vec::new(),
            base: Q::int(0),
            error: None,
        }
    }

    fn press(&mut self, key: Key) {
        // エラー中は AC 以外を受け付けない(engine_table: `keys_other_than_ac_are_ignored_while_in_error`)。
        // AC は網に無い。
        if self.error.is_some() {
            return;
        }
        match key {
            Key::Digit(d) => {
                // `)` の直後は押せない(F5 の S4。engine_table: `a_key_that_would_drop_a_number_cannot_be_pressed`)。
                if matches!(self.toks.last(), Some(Tok::Close)) {
                    return;
                }
                let c = char::from(b'0' + d);
                match self.toks.last_mut() {
                    // 字数の上限は 12(engine_table: `the_entry_buffer_stops_accepting_digits_at_its_limit`)。
                    // 網の長さでは届かないが写しておく。
                    Some(Tok::Num(s)) if s.len() < 12 => s.push(c),
                    Some(Tok::Num(_)) => {}
                    _ => self.toks.push(Tok::Num(c.to_string())),
                }
            }
            Key::Add | Key::Sub | Key::Mul | Key::Div => {
                match self.toks.last() {
                    // 押し直しは訂正(engine_table: `a_second_operator_replaces_the_first`・
                    // `a_corrected_operator_means_what_the_right_one_would_have`)。
                    Some(Tok::Op(_)) => {
                        self.toks.pop();
                    }
                    // 何も打っていなければ画面の値が左辺(`=` のあとは答え。engine_table:
                    // `multiplies_a_complex_number_by_a_real` の `… = × 2 =`)。
                    None => self.toks.push(Tok::Val(self.base)),
                    // `(` の直後は 0 が左辺(設計書 §2.2 の実測「`3 × ( +` は `3 × ( 0 +`」。
                    // engine_table に行は無い)。
                    Some(Tok::Open) => self.toks.push(Tok::Val(Q::int(0))),
                    _ => {}
                }
                self.toks.push(Tok::Op(glyph(key)));
            }
            Key::LParen => {
                // 打ちかけの数・`)` の直後は押せない(F5 の S1・S4。engine_table:
                // `a_key_that_would_drop_a_number_cannot_be_pressed`)。
                if matches!(self.toks.last(), Some(Tok::Num(_) | Tok::Close)) {
                    return;
                }
                // 何も打っていないときの `(` は新しい計算の始まり。DEL で消しても
                // 前の答えは戻らない(engine_table: `del_on_a_fresh_paren_returns_to_the_operator_before_it`
                // の `2 + 3 = ( DEL =` → 0、§9 の 10)。
                if self.toks.is_empty() {
                    self.base = Q::int(0);
                }
                self.toks.push(Tok::Open);
            }
            Key::RParen => {
                // 開いていない `)` はエラー。**種類は式で決める**: `=` と同じく右辺を補ってから、
                // 保留の式全体を評価する。評価が失敗すればその種類が先に出る(`÷ )` は 0 ÷ 0 で
                // DivisionByZero)。成り立てば SyntaxError(engine_table:
                // `an_unmatched_closing_paren_folds_the_pending_operations_first`・
                // `an_unmatched_closing_paren_is_a_syntax_error`・`every_error_kind_reaches_the_display`
                // の `)` 単独)。何も保留が無ければ評価するものが無く、SyntaxError。
                if depth(&self.toks) == 0 {
                    let failed = if self.toks.is_empty() {
                        None
                    } else {
                        self.fill_the_right_operand()
                            .and_then(|()| eval(&self.toks))
                            .err()
                    };
                    self.error = Some(failed.unwrap_or(CalcError::SyntaxError));
                    return;
                }
                if let Err(e) = self.fill_the_right_operand() {
                    self.error = Some(e);
                    return;
                }
                self.toks.push(Tok::Close);
            }
            Key::Eq => {
                // 何も打っていなければ画面の値のまま(engine_table: `equals_without_an_operator_keeps_the_entry`。
                // `2 + 3 = =` → 5 の形そのものの行は無い)。
                if self.toks.is_empty() {
                    return;
                }
                if let Err(e) = self.fill_the_right_operand() {
                    self.error = Some(e);
                    return;
                }
                // `=` は閉じ忘れを補う(engine_table: `equals_closes_unclosed_parentheses`)。
                for _ in 0..depth(&self.toks) {
                    self.toks.push(Tok::Close);
                }
                match eval(&self.toks) {
                    Ok(v) => {
                        self.base = v;
                        self.toks.clear();
                    }
                    Err(e) => self.error = Some(e),
                }
            }
            Key::Del => {
                if let Some(Tok::Num(s)) = self.toks.last_mut() {
                    // 数字を 1 つ消す(engine_table: `del_removes_the_last_character`)。
                    s.pop();
                    if s.is_empty() {
                        self.toks.pop();
                    }
                } else if let Some(i) = self.top_open() {
                    // 保留のいちばん上が開き括弧なら、それを消す(engine_table:
                    // `del_removes_an_unclosed_paren`)。**括弧の後ろに閉じた組が
                    // あっても消える**——`( ( 3 ) DEL )` は外の括弧が消え、最後の `)` が
                    // SyntaxError になる。括弧が末尾なら「演算子の直後に戻る」
                    // (engine_table: `del_on_a_fresh_paren_returns_to_the_operator_before_it`。
                    // `3 × ( DEL =` は `3 × =`)。
                    self.toks.remove(i);
                }
                // 演算子・答えは消さない(DEL は undo ではない。engine_table:
                // `del_does_not_remove_an_operator`)。
            }
            _ => unreachable!("網に無いキー: {key:?}"),
        }
    }

    /// 保留のいちばん上——末尾から、閉じた組と数を飛ばして最初に当たる演算子か開き括弧——が
    /// 開き括弧なら、その位置。engine の演算子スタックの先頭に当たる。
    fn top_open(&self) -> Option<usize> {
        let mut depth = 0usize;
        for (i, t) in self.toks.iter().enumerate().rev() {
            match t {
                Tok::Close => depth += 1,
                Tok::Open if depth > 0 => depth -= 1,
                Tok::Open => return Some(i),
                Tok::Op(_) if depth == 0 => return None,
                _ => {}
            }
        }
        None
    }

    /// 右辺が無いまま `)`・`=` に来たときの補い。`x op` は `x op x`、`(` は `( 0`。
    fn fill_the_right_operand(&mut self) -> Result<(), CalcError> {
        match self.toks.last() {
            Some(Tok::Op(op)) => {
                let p = prec(*op);
                let v = implied(&self.toks[..self.toks.len() - 1], p)?;
                self.toks.push(Tok::Val(v));
            }
            Some(Tok::Open) => self.toks.push(Tok::Val(Q::int(0))),
            _ => {}
        }
        Ok(())
    }
}

const NET: [Key; 10] = [
    Key::Digit(3),
    Key::Digit(4),
    Key::Add,
    Key::Sub,
    Key::Mul,
    Key::Div,
    Key::LParen,
    Key::RParen,
    Key::Eq,
    Key::Del,
];

/// 列の長さの上限(最後の `=` を含む)。
///
/// **7 にした。** 設計書 §2.6 の上限は時間の予算であって長さではない。2026-09-13 に debug で
/// 実測して、6 は 74,871 回・0.29 秒、7 は 682,651 回・2.80 秒(9 倍の網が 3 秒に収まる)。
const LENGTH: usize = 7;

/// `trail` を打った状態から `=` で閉じた値を比べ、1 キー足して降りる。
fn walk(state: &EngineState, typed: &Typed, trail: &mut Vec<Key>, compared: &mut usize) {
    let (_, shown) = reduce(state, Key::Eq);
    let mut closed = typed.clone();
    closed.press(Key::Eq);
    let tokens: Vec<&str> = trail.iter().map(|k| k.token()).collect();
    match (shown.error, closed.error) {
        (Some(engine), Some(oracle)) => {
            assert_eq!(engine, oracle, "エラーの種類が違う: {tokens:?} + eq");
        }
        (None, None) => {
            assert_eq!(
                shown.main,
                format_real(closed.base.to_f64()),
                "最終値が違う: {tokens:?} + eq(評価器の式 {:?})",
                typed.toks
            );
        }
        (engine, oracle) => panic!(
            "片方だけエラー: engine {engine:?} / 評価器 {oracle:?}: {tokens:?} + eq(式 {:?})",
            typed.toks
        ),
    }
    *compared += 1;
    if trail.len() + 1 >= LENGTH || typed.error.is_some() {
        return;
    }
    for &key in &NET {
        let (next, _) = reduce(state, key);
        let mut t = typed.clone();
        t.press(key);
        trail.push(key);
        walk(&next, &t, trail, compared);
        trail.pop();
    }
}

#[test]
fn every_sequence_closed_by_equals_matches_an_independent_evaluator() {
    let mut compared = 0;
    walk(
        &EngineState::initial(),
        &Typed::new(),
        &mut Vec::new(),
        &mut compared,
    );
    println!("比べた回数: {compared}");
    // **比べた回数の下限**(0 本で緑にしない)。網羅は決定的なので下限は実測値そのもの
    // (2026-09-13、LENGTH = 7 で実測 682,651 回、2.83 秒(debug))。
    assert!(
        compared >= 682_651,
        "比べたのは {compared} 回(2026-09-13 の実測 682,651 回)"
    );
}

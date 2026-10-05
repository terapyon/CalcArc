//! 全列挙の最終値の照合(0.9.2 設計書 §2.6)。
//!
//! 独立: 別手順。エンジンは演算子スタックで打鍵のたびに畳むが、ここはキー列を
//! **式のトークン列**に正規化し、`=` で**再帰下降の構文解析により有理数のまま**評価する。
//! 入力の決まり(押し直し・DEL・押せないキー・閉じ忘れ・`x op =`)は `Typed::press` の
//! 各腕が engine_table.rs の行を名指しして持つ——**写しの出どころを 1 か所にする**。
//!
//! **押せないキーも列に残す**(calcarc-1e の確認、設計書 §2.6)。エンジンには全キーを渡し、
//! ここは自前の規則で押せないキーを無視する。**値の照合は `refuses` を呼ばない**——呼べば、
//! エンジンが拒みすぎても拒み足りなくても、ここが同じ誤りに従って黙る。
//!
//! **綴りを読み直す不変条件**(0.9.2 の Task 9、利用者の裁定 2026-09-16、設計書 §10・§9 の 12。
//! calcarc-e3 の提案): 1 つの計算を `=` で閉じたとき、**web が記録する列**を `spell` で綴り、
//! その式を同じ評価器で読んだ値が engine の答えと一致する。`refuses` を呼ぶのはここだけで、
//! **web の記録を真似るため**である(`ScientificPanel` の `press` は `Step.refused` に載った
//! キーを列に積まない)。値の照合のほうは今までどおり全キーをエンジンと評価器の両方に渡す。
//! **評価器は engine に寄せていない**——`Typed` は Task 4 のまま、綴りを語に分けて打ち直した
//! キーを読むだけで、この不変条件のために規則を 1 つも足していない。
//!
//! **3 本目の網 `SIGN_NET`**(1.2.1、関数の書き方の設計書 §5.3): `+/−` と `x²` の綴りを、
//! **キーに打ち直さず文字列のまま慣例で読む**(`read_by_convention`)。`Typed` を使わない
//! 理由はその註にある。

use calcarc_core::engine::{
    refuses,
    spell::{spell, spell_line},
};
use calcarc_core::numeric::format::format_real;
use calcarc_core::{CalcError, DisplayState, EngineState, Key, reduce, render};

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
    /// **表示の文字列を、そのまま有理数として読む**(2026-10-03、`=` をまたぐ列のため)。
    ///
    /// **読むのは `format_real` が出す形だけ**——桁区切りの `,`、ASCII の `-`、小数点の `.`。
    /// **ASCII の `-` である**(U+2212 の `−` は綴りの減算のほうで、表示には出ない。実測)。
    /// **指数表記(`1e-7`)や `∠` の付いた極形式は読まない**——`None` を返し、呼ぶ側が数えない。
    fn from_decimal(text: &str) -> Option<Q> {
        let plain = text.replace(',', "");
        let (sign, digits) = match plain.strip_prefix('-') {
            Some(rest) => (-1i128, rest),
            None => (1i128, plain.as_str()),
        };
        if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit() || b == b'.') {
            return None;
        }
        let mut parts = digits.splitn(2, '.');
        let whole = parts.next().unwrap_or("");
        let frac = parts.next().unwrap_or("");
        if frac.contains('.') {
            return None;
        }
        let n: i128 = format!("{whole}{frac}").parse().ok()?;
        let d = 10i128.checked_pow(u32::try_from(frac.len()).ok()?)?;
        Some(Q::new(sign * n, d))
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
    /// **ここまでに効いたキー列**(0.9.3 設計書 §4.2)。閉じた組を開き直す DEL が
    /// 「**`)` の押下を列から抜いて打ち直す**」ために持つ。
    keys: Vec<Key>,
}

impl Typed {
    fn new() -> Typed {
        Typed::starting_from(Q::int(0))
    }

    /// **画面に出ている値から始める。** `=` をまたいだ行を読み直すときに使う
    /// ——**行の頭に在るのは「前の答えの表示」**なので、**その値を `base` に置いて
    /// 続きの綴りを打ち直す**(2026-10-03)。
    fn starting_from(base: Q) -> Typed {
        Typed {
            toks: Vec::new(),
            base,
            error: None,
            keys: Vec::new(),
        }
    }

    /// キー列を最初から打ち直す。**開き直しの DEL だけがこれを使う。**
    fn replay(keys: &[Key]) -> Typed {
        let mut typed = Typed::new();
        for &key in keys {
            typed.press(key);
        }
        typed
    }

    fn press(&mut self, key: Key) {
        // エラー中は AC 以外を受け付けない(engine_table: `keys_other_than_ac_are_ignored_while_in_error`)。
        // AC は網に無い。
        if self.error.is_some() {
            return;
        }
        // **閉じた組のあとの DEL は、その `)` の押下を無かったことにする**
        // (0.9.3 設計書 §4.2、利用者の裁定 2026-09-17)。
        //
        // **engine は「`)` を押す直前の状態」を積んで戻すが、こちらは
        // 「キー列から `)` を 1 つ抜いて打ち直す」**——**2 つの手順が別物であることに
        // 意味がある**(CLAUDE.md: 参照実装を移植にしない)。打ち直しなら、
        // `)` が補った右辺も、畳んだ値も、押し直しの訂正も、**そもそも発生しない**。
        if key == Key::Del && matches!(self.toks.last(), Some(Tok::Close)) {
            let mut keys = self.keys.clone();
            if let Some(at) = keys.iter().rposition(|k| *k == Key::RParen) {
                keys.remove(at);
            }
            *self = Typed::replay(&keys);
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
                    // `the_answer_carries_on_until_a_new_entry_is_committed` の `2 + 3 = × 4 =` → 20)。
                    None => self.toks.push(Tok::Val(self.base)),
                    // `(` の直後は 0 が左辺(engine_table:
                    // `an_operator_right_after_an_open_paren_takes_zero_as_its_left_operand` の
                    // `( + 3 ) =` → 3)。
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
                // の `2 + 3 = ( DEL =` → 0、§9 の 10)。数字はここが違う——確定するまで
                // 新しい計算を始めない(DEL の腕と `the_answer_carries_on_until_a_new_entry_is_committed`)。
                if self.toks.is_empty() {
                    self.base = Q::int(0);
                }
                self.toks.push(Tok::Open);
            }
            Key::RParen => {
                // **開いていない `)` は押せない**(0.9.3 の D-2、利用者の裁定
                // 2026-09-17。engine_table: `an_unmatched_closing_paren_cannot_be_pressed`)。
                // **押せないキーは押されなかったのと同じ**なので、`(` の腕と同じく
                // 何も変えずに戻る——**この列は記録もされない**(呼び出し側は
                // 一致を見てからキーを積む)。
                //
                // **0.9.2 まではここがエラーだった**: 右辺を補ってから保留の式を
                // 評価し、失敗すればその種類、成り立てば SyntaxError。
                // **その形は `src/engine/mod.rs` の単体テストへ移した**
                // ——`close_paren` を直接呼ぶ側だけが、いまもあの経路を通る。
                if depth(&self.toks) == 0 {
                    return;
                }
                if let Err(e) = self.fill_the_right_operand() {
                    self.error = Some(e);
                    return;
                }
                // **`)` はその場で組を畳む**(engine の `close_paren`)。**畳んで失敗するなら、
                // `)` を押した時点でエラーである**——`+ ( ÷ ) DEL 3` は engine が `)` で
                // DivisionByZero になり、以後のキーを受け付けない。
                // **`=` まで遅らせると、あいだの DEL がそのエラーを無かったことにする**
                // (0.9.3 で DEL が `)` を取り消すようになって初めて見えた。2026-09-17)。
                let mut depth_from_end = 0usize;
                let mut matching_open = None;
                for (i, tok) in self.toks.iter().enumerate().rev() {
                    match tok {
                        Tok::Close => depth_from_end += 1,
                        Tok::Open if depth_from_end > 0 => depth_from_end -= 1,
                        Tok::Open => {
                            matching_open = Some(i);
                            break;
                        }
                        _ => {}
                    }
                }
                if let Some(i) = matching_open
                    && let Err(e) = eval(&self.toks[i + 1..])
                {
                    self.error = Some(e);
                    return;
                }
                self.toks.push(Tok::Close);
            }
            Key::Eq => {
                // 何も打っていなければ画面の値のまま(engine_table:
                // `the_answer_carries_on_until_a_new_entry_is_committed` の `2 + 3 = =` → 5、
                // `equals_without_an_operator_keeps_the_entry`)。
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
                    // 数字を 1 つ消す(engine_table: `del_removes_the_last_character`)。消し切って
                    // 何も残らなければ、画面は `base`(`=` のあとは答え)に戻る(engine_table:
                    // `the_answer_carries_on_until_a_new_entry_is_committed` の `2 + 3 = 4 DEL + 1 =` → 6)。
                    s.pop();
                    if s.is_empty() {
                        self.toks.pop();
                    }
                } else if let Some(i) = self.top_open() {
                    // 打ちかけの数が無いときの DEL は、**いちばん最後の閉じていない `(`** を消す——
                    // ただし、その `(` のあとに**同じ深さの演算子**が続いていないときだけ(うしろの
                    // 閉じた組と数は数えない。組の中身は残る)。engine_table:
                    // `del_removes_an_unclosed_paren`・
                    // `del_after_a_closed_group_removes_the_unclosed_paren_before_it`
                    // (`( ( 3 ) DEL` は外の `(` が消え、最後の `)` は開いていない `)` になる)。
                    // `(` が末尾なら、消したあとは演算子の直後に戻る
                    // (`del_on_a_fresh_paren_returns_to_the_operator_before_it`。`3 × ( DEL =` は `3 × =`)。
                    self.toks.remove(i);
                }
                // 演算子・答えは消さない(DEL は undo ではない)。`( 3 + DEL` は `(` のあとに同じ
                // 深さの `+` があるので何も消さない(engine_table: `del_does_not_remove_an_operator`)。
                // `3 + ( 4 ) DEL` は閉じていない `(` が無いので何も消さない
                // (`del_after_a_closed_group_removes_the_unclosed_paren_before_it` の後半)。
            }
            _ => unreachable!("網に無いキー: {key:?}"),
        }
        // **押せなかったキーは列に残さない**(0.9.3 設計書 §4.2)。上の腕は F5 で拒む
        // キー(`)` の直後の数字と `(`)を `return` で捨てるので、ここへ来るのは
        // **実際に効いたキーだけ**である。
        //
        // **これが無いと、打ち直しが「押せなかったはずのキー」を打つ。**
        // `333 × ( ) 3 DEL` の `3` は `)` の直後なので押せない——ところが `)` を
        // 抜いて打ち直すと押せる位置に変わるので、記録してあると 999 になる
        // (engine は 0)。**2026-09-17 に実際に落ちた。**
        self.keys.push(key);
    }

    /// 打ちかけの数が無いときに DEL が消す `(` の位置: **いちばん最後の閉じていない `(`** で、
    /// そのあとに**同じ深さの演算子**が続いていないもの(うしろの閉じた組と数は数えない)。
    /// 末尾から読み、閉じた組は深さを数えて飛ばす。深さ 0 で先に演算子に当たれば無し、
    /// 開き括弧に当たればそれ(engine_table: `del_removes_an_unclosed_paren`・
    /// `del_after_a_closed_group_removes_the_unclosed_paren_before_it`・`del_does_not_remove_an_operator`)。
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
/// これは値の照合だけの時間。2026-09-16 に綴りの読み直し(Task 9)を同じ歩みに足してからは、
/// 7 で 3.84 秒(debug)。
///
/// **2026-10-05 の実測は 8.58 秒**(debug、この作業機、load average 0.91。
/// `cargo test -p calcarc-core --test engine_values -- every_sequence_closed_by_equals_matches_an_independent_evaluator --exact`
/// を 1 本だけ)。**伸びたのは比べる列が増えたから**で、印字は「値 1061361 / 綴りの読み直し
/// 919493」。**増えた時点は 2 つある**(2026-10-05 に旧い版を 1 本ずつ走らせて確かめた):
/// - **値**: `56b5171` で 679,821 回、`be8e736`(2026-09-17、0.9.3 の D-2「開いていない `)` は
///   押せない」)で 1,061,361 回。**それまでは開いていない `)` が engine と評価器の両方を
///   SyntaxError にし、そこで降りるのをやめていた**(`walk` の「両方がエラー」)。押せなく
///   なってその枝が刈られなくなった。綴りの読み直しも同じ時点で 339,560 → 591,298 回。
/// - **綴りの読み直し**: `98809f6`(2026-10-03、`=` をまたぐ列を読み直す)で 591,298 →
///   919,493 回。
///
/// **網は狭めない**(監視役の裁定 2026-10-05)。
const LENGTH: usize = 7;

/// 括弧に寄せた網(Task 9)。**値の下の `(` を DEL が消し、その前の演算子が組み方を変える形**
/// ——`× ( ( 3 ) DEL + 3 =` は 9 打鍵要り、`NET` の長さ 7 には届かない。キーを 6 つに絞って
/// 長さを 9 まで伸ばす。`=` は列を閉じるときだけ押す(途中の `=` は綴りの照合の外なので、
/// 網に入れても綴りの比較は増えない)。
const PAREN_NET: [Key; 6] = [
    Key::Digit(3),
    Key::Mul,
    Key::Add,
    Key::LParen,
    Key::RParen,
    Key::Del,
];

/// `PAREN_NET` の列の長さの上限(最後の `=` を含む)。
///
/// **9 にした。** `× ( ( 3 ) DEL + 3 =` の形に届く長さである。2026-09-16 に debug で実測して
/// 7.91 秒(値の照合 856,681 回・綴りの読み直し 782,703 回)。
///
/// **2026-10-05 の実測は 19.16 秒**(debug、この作業機、load average 0.91。
/// `cargo test -p calcarc-core --test engine_values -- spellings_in_a_paren_heavy_net_read_back_to_the_engines_answer --exact`
/// を 1 本だけ)。**09-16 に置いた「予算の 15 秒」は超えた**が、**負荷ではなく比べる列が
/// 増えたから**である——印字は「値 2015539 / 綴りの読み直し 2002863」。
/// **増えたのは `be8e736`(2026-09-17、0.9.3 の D-2「開いていない `)` は押せない」)**
/// (2026-10-05 に旧い版を 1 本ずつ走らせて確かめた): `56b5171` は「値 870343 / 綴りの
/// 読み直し 802358」、`be8e736` は「値 2015539 / 綴りの読み直し 2015539」。**それまでは
/// 開いていない `)` が両方を SyntaxError にし、そこで降りるのをやめていた。** この網には
/// `÷` も `=` も無いので、**いまはエラーになる枝が 1 本も無く、刈らない木の全部**
/// (6⁰ + … + 6⁸ = 2,015,539 節)を歩く。**10-03 の `=` をまたぐ読み直しはこの網に `=` が
/// 無いので効かない**(綴りの読み直しは 2,015,539 → 2,002,863 と、むしろ減った)。
/// **予算のほうを言い直す: 網は狭めない**(監視役の裁定 2026-10-05)。9 を下げると
/// 上の形に届かなくなる。
const PAREN_LENGTH: usize = 9;

/// **符号と 2 乗の網**(1.2.1、関数の書き方の設計書 §5.3)。**後置関数の綴りを読み直す
/// ただ 1 つの網**——`NET` と `PAREN_NET` は数字・`+ − × ÷`・括弧だけで、関数の綴りを
/// 1 度も読まない。**`+/−` と `x²` を既存の網に足すと大きくなりすぎる**
/// (`PAREN_NET` は 7.5 倍。設計書 §5.3.1 の表)ので、3 本目として足した。
///
/// **`÷` を入れない**ので値はいつも整数で、**画面の値に丸めが入らない**
/// (`1e10` 以上の指数表記だけは読めない。`sign_spelling_reads_back` が数えて飛ばす)。
/// **`=` を入れる**ので、`=` をまたぐ前置(設計書 §2.5)も網に入る。
/// **綴りは `Typed` ではなく `read_by_convention` が読む**(下の註)。
const SIGN_NET: [Key; 10] = [
    Key::Digit(3),
    Key::Add,
    Key::Sub,
    Key::Mul,
    Key::LParen,
    Key::RParen,
    Key::Eq,
    Key::Del,
    Key::Neg,
    Key::Sqr,
];

/// `SIGN_NET` の列の長さの上限(最後の `=` を含む)。
///
/// **7 にした**(設計書 §5.3.1)。**この網は枝を刈らない**(`÷` が無くエラーにならない)ので、
/// 長さを 1 つ伸ばすと節はキーの数だけ、**10 倍**になる。
/// **2026-10-05 の実測は 9.33 秒**(debug、この作業機、load average 0.91〜0.96。
/// `cargo test -p calcarc-core --test engine_values -- sign_and_square_spellings_read_back_by_convention --exact`
/// を 1 本だけ)。印字は「節 1111111 / 慣例での読み直し 967199」。設計書の見込み
/// 「6 秒前後」(実測前)より長い。**網は狭めない**(監視役の裁定 2026-10-05)。
const SIGN_LENGTH: usize = 7;

/// **行の頭に置く値と、その判定**(2026-10-03)。**web の `carryAtDecisionRef` と
/// `decidedRef` の写し**である——**決めた時点で画面に出ていた値**を持つ。
#[derive(Clone, Copy)]
struct Prefix<'a> {
    /// 表示の文字列と、評価器が持っている厳密な値。**`None` は前置しない。**
    value: Option<(&'a str, Q)>,
    /// **まだ決めていなければ `None`。**
    decided: Option<bool>,
}

/// 網の歩き方を 1 つにまとめる。
struct Net {
    keys: &'static [Key],
    /// 列の長さの上限(最後の `=` を含む)。
    length: usize,
}

/// 比べた回数。どちらも下限を置く(0 本で緑にしない)。
#[derive(Default)]
struct Counts {
    /// 打った全キーを評価器に渡した列の、`=` で閉じた値の照合。
    values: usize,
    /// 綴りを読み直した値の照合。
    spellings: usize,
    /// **頭に値を前置した行**(2026-10-03)。**`=` をまたいだ行はここに入る**
    /// ——ほかに「`+` から打ち始めた列」（画面の 0 を左辺に取る）も入る。
    /// **`spellings` の内数である。**
    prefixed: usize,
    /// **前の答えの表示が丸められていて、読み直せなかった回数**(同)。
    /// **`4 ÷ 3 =` の答えは `1.333333333` で、内部の値とは別物**——
    /// **その行を読み直すと 3.999999999 になり、engine の `4` と一致しない。**
    /// **不具合ではない**(engine は内部の f64 で続き、表示は丸める)ので、**数えて飛ばす。**
    /// **2026-10-03 の実測では 176 件**。**うち、飛ばさなければ不一致になるのは 71 件**
    /// ——**残り 105 件は丸めていても続きの表示が一致する**(レビュー役の測り)。
    /// **除外は必要な分より少し広い。知ったうえで広いままにしている**
    /// ——**狭めるには「丸めたが結果は一致する」を先に判定することになり、
    /// それは engine の計算をもう 1 度なぞる形**である。
    rounded_away: usize,
    /// **一致しなかった行**(2026-10-03 の調べ。**数えてから裁定する**ので、
    /// その場で panic せずに溜める)。**先頭の数件だけ綴りを残す。**
    mismatches: usize,
    samples: Vec<String>,
    /// **形ごとの件数**(2026-10-03 の数え上げ)。**鳴った形は穴の標本にすぎない**ので、
    /// **全件を形に畳んで数える**([[count-before-you-fix]])。
    shapes: std::collections::BTreeMap<String, usize>,
    /// **既知の欠陥として除いた行**(`SIGN_NET` だけが数える。`frozen_carry_shape` の註)。
    frozen_carry: usize,
}

/// engine の答え `shown` と、`=` で閉じた評価器 `closed` を比べる。値ならその表示、エラーなら
/// 種類。`what` は落ちたときに列を説明する(成功のたびには組み立てない)。
fn agree(shown: &DisplayState, closed: &Typed, what: &dyn Fn() -> String) {
    match (&shown.error, &closed.error) {
        (Some(engine), Some(oracle)) => {
            assert_eq!(engine, oracle, "エラーの種類が違う: {}", what());
        }
        (None, None) => {
            assert_eq!(
                shown.main,
                format_real(closed.base.to_f64()),
                "最終値が違う(左が engine、右が評価器): {}",
                what()
            );
        }
        (engine, oracle) => panic!(
            "片方だけエラー: engine {engine:?} / 評価器 {oracle:?}: {}",
            what()
        ),
    }
}

/// 綴りを空白で語に分け、評価器のキーに打ち直す。数字だけの語は `Key::Digit` の列、演算子と
/// 括弧はそのキー。**減算は U+2212 の `−`**(`spell.rs` の `commit_glyph`)で、ASCII の `-` は
/// 網のキーからは出ないので、出たら panic する。
///
/// **評価器が黙って捨てる並びも panic する**: 数の語が 2 つ続く(評価器は 1 つの数に繋げる)・
/// `)` の直後の数・数か `)` の直後の `(`(評価器は押せないキーとして無視する)・二項演算子が
/// 2 つ続く(評価器は押し直しとして前を捨てる)。これを許すと、綴りに余計な語が残っても
/// 読み直した値は変わらず、不変条件がその取りこぼしに黙る。**評価器の規則は変えていない**
/// ——ここは綴りの語の並びを見るだけである。
///
/// **括弧は語から切り出す**(1.2.1、関数の書き方の設計書 §2.6・§5.3.2)。綴りは括弧の
/// 内側に空白を入れなくなった(`(3 + 4)`)ので、空白で割った語の頭の `(` と尻の `)` を
/// 1 つずつ別の語にする(`(3` → `(` と `3`、`4)` → `4` と `)`、`()` → `(` と `)`)。
/// **読み方の規則は変えていない**——切り出したあとの並びは、空白があった頃の語の並びと同じである。
fn keys_of_spelling(spelled: &str) -> Vec<Key> {
    fn is_number(word: &str) -> bool {
        !word.is_empty() && word.bytes().all(|b| b.is_ascii_digit())
    }
    fn is_binary(word: &str) -> bool {
        matches!(word, "+" | "−" | "×" | "÷")
    }
    /// 空白で割った 1 語から、頭の `(` と尻の `)` を切り出す。
    fn split_brackets(word: &str) -> Vec<&str> {
        let body = word.trim_start_matches('(');
        let opens = word.len() - body.len();
        let middle = body.trim_end_matches(')');
        let closes = body.len() - middle.len();
        let mut pieces = vec!["("; opens];
        if !middle.is_empty() {
            pieces.push(middle);
        }
        pieces.extend(std::iter::repeat_n(")", closes));
        pieces
    }
    let mut keys = Vec::new();
    let mut previous: Option<&str> = None;
    for word in spelled
        .split(' ')
        .filter(|w| !w.is_empty())
        .flat_map(split_brackets)
    {
        let dropped = match previous {
            Some(p) if is_number(word) => is_number(p) || p == ")",
            Some(p) if word == "(" => is_number(p) || p == ")",
            Some(p) if is_binary(word) => is_binary(p),
            _ => false,
        };
        assert!(
            !dropped,
            "評価器が黙って捨てる並び {previous:?} {word:?}: 綴り {spelled:?}"
        );
        match word {
            "+" => keys.push(Key::Add),
            "−" => keys.push(Key::Sub),
            "×" => keys.push(Key::Mul),
            "÷" => keys.push(Key::Div),
            "(" => keys.push(Key::LParen),
            ")" => keys.push(Key::RParen),
            digits if is_number(digits) => {
                keys.extend(digits.bytes().map(|b| Key::Digit(b - b'0')));
            }
            other => panic!("網のキーからは出ない語 {other:?}: 綴り {spelled:?}"),
        }
        previous = Some(word);
    }
    keys
}

/// **綴りを読み直す不変条件。** `trail + =` について、web が記録する列 `recorded` を綴り、
/// その式を新しい評価器で `=` まで読んだ値が engine の答え `shown` と一致する。
fn spelling_reads_back(
    state: &EngineState,
    shown: &DisplayState,
    trail: &[Key],
    segment: &[Key],
    carried: Option<(&str, Q)>,
    continues: bool,
    counts: &mut Counts,
) {
    // `=` の前に engine がもうエラーなら数えない。エラー中の web は `AC` 以外を列に積まず
    // (`ScientificPanel` の `press`、H-3)、その `=` も積まれないので、履歴の行ができない。
    // エラーは `AC` でしか解けない(網に無い)ので、ここを通る列は途中でも一度もエラーに
    // なっておらず、`segment` はエラーの門で 1 つも落ちていない。
    if state.error.is_some() {
        return;
    }
    let spelled = spell(segment);
    // **綴りが空の区間は、web が行を作らない**(`history/index.ts`——空の式は積まない)。
    // **`( DEL` のような区間がこれ**で、engine は新しい計算を始めている。
    if spelled.is_empty() {
        return;
    }
    // **前の答えを頭に足すかは、区間の中で最初に「画面の値を使うキー」を押した時点の
    // `answer_on_screen` で決まる**(2026-10-03 に替えた。入力経歴の設計書 §4)。
    // **web がそうしている**——`ScientificPanel` の `carryAtDecisionRef` は
    // **engine が前の Step に載せた `answerOnScreen` を見て、そのときの `main` を
    // 写すだけ**である。
    // **キー列から推測しない**(推測していた版は `DEL` で消えた数字を
    // 「新しい計算の始まり」と読み、364 件の行が答えを生まなかった)。
    // **判定そのものは `walk` が降りながら決める**ので、ここは受け取るだけ。
    // **行の頭に置くのは「決めた時点で画面に出ていた値」の表示**(2026-10-03)。
    // web がそうしている(`ScientificPanel` の `carryAtDecisionRef`)
    // ——**置くのは表示の文字列**である。
    //
    // **読み直せるのは、その表示が丸められていないときだけ。**
    // **`format_real` は 10 桁で丸める**ので、`4 ÷ 3 =` の `1.333333333` は内部の値と別物で、
    // **その行を読み直すと 3.999999999 になる**(engine は `4`)。**不具合ではない**
    // ——**engine は内部の f64 で続き、表示は丸める**。**数えて飛ばす。**
    //
    // **判定は推測ではなく計算である**: **表示を有理数として読み戻した値が、評価器が
    // 持っている厳密な値と等しいか。** `agree` が毎回 `format_real(base) == shown.main` を
    // 主張しているので、**この 2 つが食い違うときは「表示が丸めた」ときに限る。**
    let (base, across) = match carried.filter(|_| continues) {
        None => (Q::int(0), false),
        Some((display, exact)) => {
            // **表示を有理数として読み戻し、評価器が持っている厳密な値と比べる。**
            // **等しくなければ、その表示は丸めた値である**——数えて飛ばす。
            // **指数表記・極形式は読めない**(`None`)ので、同じく飛ばす。
            match Q::from_decimal(display) {
                Some(written) if written == exact => (written, true),
                _ => {
                    counts.rounded_away += 1;
                    return;
                }
            }
        }
    };
    let mut read = Typed::starting_from(base);
    for key in keys_of_spelling(&spelled) {
        read.press(key);
    }
    read.press(Key::Eq);
    // **数えてから裁定する**ので、その場で panic しない(2026-10-03 の調べ)。
    let agreed = match (&shown.error, &read.error) {
        (Some(engine), Some(oracle)) => engine == oracle,
        (None, None) => shown.main == format_real(read.base.to_f64()),
        _ => false,
    };
    if agreed {
        counts.spellings += 1;
        if across {
            counts.prefixed += 1;
        }
    } else {
        counts.mismatches += 1;
        // **形**: 最後の `=` から後ろの打鍵（＝この行を作った区間）。
        let shape: Vec<&str> = segment.iter().map(|k| k.token()).collect();
        *counts.shapes.entry(shape.join(" ")).or_insert(0) += 1;
        if counts.samples.len() < 12 {
            let tokens: Vec<&str> = trail.iter().map(|k| k.token()).collect();
            let head = if across {
                carried.map(|(display, _)| display).unwrap_or("")
            } else {
                ""
            };
            counts.samples.push(format!(
                "{tokens:?} 行={head:?}+{spelled:?} engine={:?} 読み直し={:?}",
                shown.main,
                format_real(read.base.to_f64())
            ));
        }
    }
}

/// `trail` を打った状態から `=` で閉じた値を比べ、1 キー足して降りる。`recorded` は web が
/// 記録する列(engine が拒まなかったキーだけ)。
fn walk(
    net: &Net,
    state: &EngineState,
    typed: &Typed,
    trail: &mut Vec<Key>,
    // `segment` は **`=` からこちらに web が記録した列**(2026-10-03。前は列の全体だった)
    // ——**web は `=` で列を切る**(`ScientificPanel` の `pendingSpellRef`)。
    // `carried` は **直前の `=` の答え**で、**表示の文字列と、評価器が持つ厳密な値の対**。
    segment: &mut Vec<Key>,
    prefix: Prefix,
    counts: &mut Counts,
) {
    let (_, shown) = reduce(state, Key::Eq);
    let mut closed = typed.clone();
    closed.press(Key::Eq);
    agree(&shown, &closed, &|| {
        let tokens: Vec<&str> = trail.iter().map(|k| k.token()).collect();
        format!("{tokens:?} + eq(評価器の式 {:?})", typed.toks)
    });
    counts.values += 1;
    spelling_reads_back(
        state,
        &shown,
        trail,
        segment,
        prefix.value,
        prefix.decided == Some(true),
        counts,
    );
    // 降りるのをやめるのは、**評価器とエンジンの両方が**もうエラーのときだけ。片方だけなら
    // 先の列でもう片方が値を出すかもしれないので、比べ続ける。
    if trail.len() + 1 >= net.length || (typed.error.is_some() && state.error.is_some()) {
        return;
    }
    for &key in net.keys {
        // エンジンと評価器には全キーを渡す(値の照合)。web の記録だけが拒まれたキーを落とす。
        let web_records = !refuses(state, key);
        let (next, _after) = reduce(state, key);
        let mut t = typed.clone();
        t.press(key);
        trail.push(key);
        // **`=` で区間を切る**(web と同じ)。**切ったあとの区間は空**で、
        // **次の行の頭には「いまの答えの表示」と「評価器の厳密な値」が付く。**
        // **web と同じ時点で決める**——**この押下の直前の表示**を見る。
        // **web の `CARRIED_VALUE_TOKENS` の、網に在る部分**である
        // (あちらは後置関数 14 個も含む。網に無いので、ここには出てこない)。
        // **網を広げる日は、あちらと突き合わせて増やす**——**片方だけ直すと、
        // 広げた先で判定がずれる。**
        let uses_the_screen_value = matches!(
            key,
            Key::Add | Key::Sub | Key::Mul | Key::Div | Key::Eq | Key::RParen
        );
        // **前置する値は「決めた時点で画面に出ていた値」である**(2026-10-03)。
        // **その押下が使う値そのもの**なので、`( DEL` のように画面が 0 に戻った列でも
        // ずれない(前の `=` の答えを覚えておく形だと、`33 = ( DEL +` に `33` を
        // 前置してしまい、engine の 0 と食い違った。170 件)。
        let decide = web_records && prefix.decided.is_none() && uses_the_screen_value;
        let next_decided = if decide {
            Some(render(state).answer_on_screen)
        } else {
            prefix.decided
        };
        let closing = key == Key::Eq && web_records;
        let saved: Option<Vec<Key>> = if closing {
            Some(std::mem::take(segment))
        } else {
            if web_records {
                segment.push(key);
            }
            None
        };
        let next_value = if closing {
            None
        } else if decide && next_decided == Some(true) {
            // **この押下の直前の表示と、評価器が持っている厳密な値。**
            Some((render(state).main, typed.base))
        } else {
            prefix
                .value
                .map(|(display, exact)| (display.to_string(), exact))
        };
        walk(
            net,
            &next,
            &t,
            trail,
            segment,
            Prefix {
                value: next_value
                    .as_ref()
                    .map(|(display, exact)| (display.as_str(), *exact)),
                decided: if closing { None } else { next_decided },
            },
            counts,
        );
        if let Some(old) = saved {
            *segment = old;
        } else if web_records {
            segment.pop();
        }
        trail.pop();
    }
}

fn walk_from_the_start(net: &Net) -> Counts {
    let mut counts = Counts::default();
    walk(
        net,
        &EngineState::initial(),
        &Typed::new(),
        &mut Vec::new(),
        &mut Vec::new(),
        Prefix {
            value: None,
            decided: None,
        },
        &mut counts,
    );
    counts
}

/// 読み手の語(設計書 §5.3.2 の字句)。
#[derive(Clone, Copy, Debug, PartialEq)]
enum Word {
    Num(Q),
    /// 二項の `+`。
    Plus,
    /// **二項の `−`**——空白で区切った 1 語のとき。
    Minus,
    Times,
    /// **単項の `−`**——次の数や `(` に空白なしで付くとき。
    Negate,
    Open,
    Close,
    Square,
}

/// 読めなかった理由。
#[derive(Debug)]
enum Unread {
    /// **指数表記の値**(`1e10` 以上の画面の値・前置の答え)。**丸めた値なので読み直せない**
    /// ——`format_real` は 10 桁で丸める。**数えて飛ばす**(`Counts::rounded_away`)。
    Exponent,
    /// **慣例では読めない綴り**(`…`・対応の無い `)`・二項演算子が 2 つ続く、など)。
    /// **食い違いとして数える。**
    Malformed(String),
}

/// 画面の値の綴り `[0-9]+ ("," [0-9]{3})* ("." [0-9]+)?` に `-` が付きうるもの(設計書
/// §5.3.2 の字句)。`,` は桁区切り(条件 2)で、剥いでから `Q::from_decimal` に渡す。
fn number_of(text: &str) -> Option<Q> {
    let unsigned = text.strip_prefix('-').unwrap_or(text);
    let whole = unsigned.split('.').next().unwrap_or("");
    let mut groups = whole.split(',');
    let first = groups.next().unwrap_or("");
    let grouped = whole.contains(',');
    let first_ok = !first.is_empty()
        && first.bytes().all(|b| b.is_ascii_digit())
        && (!grouped || first.len() <= 3);
    if !first_ok || !groups.all(|g| g.len() == 3 && g.bytes().all(|b| b.is_ascii_digit())) {
        return None;
    }
    Q::from_decimal(text)
}

/// 綴りを語に割る(設計書 §5.3.2 の字句)。**単項か二項かは文字列の段でしか見分けられない**
/// ので、ここで決める——**二項の `−` は空白で区切った 1 語**(`)` の直前を含む)、
/// **単項の `−` は次の数や `(` に空白なしで付く**(§2.3・§2.6)。**ASCII の `-` は画面の値と前置の答えの負号だけ**(§2.1)
/// なので、数の一部として読む。
///
/// **この読み方の死角**: ASCII の `-3²` は `-3` という 1 つの数の 2 乗として **9** と読む。
/// **負の画面の値(前置の答え)を包み忘れても(`(-3)²` が `-3²` になっても)、`SIGN_NET` は
/// 黙る**——engine の答えも 9 だからである。**代わりに守るのは spell_table の 2 本**:
/// `a_function_with_no_value_on_the_line_writes_the_screen` の `"−3 + (-3)²"` の行と、
/// `the_edges_the_order_named` の `"(-3)²"` の行(どちらも綴りの文字列そのものを突き合わせる)。
/// U+2212 の `−3²` は単項の `−` と `²` の優先順位で −9 と読むので、こちらは赤くなる。
fn words_of(line: &str) -> Result<Vec<Word>, Unread> {
    let chars: Vec<char> = line.chars().collect();
    let mut words = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let word = match chars[i] {
            ' ' => None,
            '(' => Some(Word::Open),
            ')' => Some(Word::Close),
            '²' => Some(Word::Square),
            '+' => Some(Word::Plus),
            '×' => Some(Word::Times),
            // **`)` の前も二項である**——括弧の内側に空白を入れない(§2.6)ので、
            // `(3 −)` の `−` は `)` に空白なしで付く。単項は数か `(` に付くときだけ。
            '−' => Some(
                if chars
                    .get(i + 1)
                    .is_some_and(|next| next.is_ascii_digit() || *next == '(')
                {
                    Word::Negate
                } else {
                    Word::Minus
                },
            ),
            '-' | '0'..='9' => {
                let start = i;
                i += 1;
                while i < chars.len()
                    && (chars[i].is_ascii_digit()
                        || matches!(chars[i], ',' | '.' | 'e')
                        || (chars[i] == '-' && chars[i - 1] == 'e'))
                {
                    i += 1;
                }
                let text: String = chars[start..i].iter().collect();
                if text.contains('e') {
                    return Err(Unread::Exponent);
                }
                let value =
                    number_of(&text).ok_or_else(|| Unread::Malformed(format!("数 {text:?}")))?;
                words.push(Word::Num(value));
                continue;
            }
            other => return Err(Unread::Malformed(format!("字 {other:?}"))),
        };
        words.extend(word);
        i += 1;
    }
    Ok(words)
}

/// **綴りを数学の慣例で読む小さな再帰下降**(設計書 §5.3.2)。有理数(`Q`)で評価する。
///
/// 独立: 別手順。**engine は演算子スタックで打鍵のたびに畳む**が、ここは**綴りの文字列**を
/// 字句から読み、**文法の段**(`+ −` の式・`×` の項・単項の `−`・後置の `²`)で評価する。
/// **キーには打ち直さない**——**`Typed` を使わない理由**: 綴りの `−` は単項(`−3`)と
/// 二項(`2 − 3`)の両方に使われ、`keys_of_spelling` は「二項演算子が 2 つ続く」で
/// panic する(押し直しとして前を捨てる並びを拒むため)ので `2 − −3` を打ち直せない。
/// 単項か二項かは文字列の段でしか見分けられない。
///
/// ```text
/// 式   = 項 (二項 項?)*                  ← 項の省略は規則 1
/// 項   = 単項 ("×" 単項?)*               ← 同上
/// 単項 = "−" 単項 | 後置                 ← `²` は前置の `−` より強い(`−3²` は −9)
/// 後置 = 一次 "²"*
/// 一次 = 数 | "(" 中身 ")"? | "(" 中身 行末
/// 中身 = 空 | 二項 式 | 式               ← 空は規則 2、先頭の二項は規則 3
/// ```
///
/// **省略の規則 3 つは engine の振る舞い**で、`Typed` の対応する腕と同じ engine_table の行を
/// 名指しする(各規則の註)。
struct Reader {
    words: Vec<Word>,
    at: usize,
}

impl Reader {
    fn peek(&self) -> Option<Word> {
        self.words.get(self.at).copied()
    }

    /// 二項演算子のあとに項が無い(行末か `)` の直前)。
    fn operand_missing(&self) -> bool {
        matches!(self.peek(), None | Some(Word::Close))
    }

    /// `式`。`first` は、もう読んだ最初の単項の値(規則 3 の 0)。
    fn expr(&mut self, first: Option<Q>) -> Result<Q, String> {
        let mut sum = self.term(first)?;
        while let Some(op @ (Word::Plus | Word::Minus)) = self.peek() {
            self.at += 1;
            // **規則 1**: 項が無ければ、右辺は**この段でそれまでに積んだ値**(式の累計)。
            // engine_table: `equals_after_an_operator_repeats_the_operand`(`3 + =` → 6)・
            // `the_echo_shows_the_pending_expression`(`2 × 3 +` が「6 +」)——`Typed` の
            // `implied` と同じ行。**`implied` のように前へ遡って区間を探さない**——遡る範囲
            // (押した演算子より優先順位が低くない演算だけで結ばれた直前の項)は、
            // 再帰下降では**その段の累計そのもの**である。累計は `(` の中から始まるので、
            // `(` より前へは戻らない。
            let right = if self.operand_missing() {
                sum
            } else {
                self.term(None)?
            };
            sum = if op == Word::Plus {
                sum.add(right)
            } else {
                sum.sub(right)
            };
        }
        Ok(sum)
    }

    /// `項`。
    fn term(&mut self, first: Option<Q>) -> Result<Q, String> {
        let mut product = match first {
            Some(value) => value,
            None => self.unary()?,
        };
        while self.peek() == Some(Word::Times) {
            self.at += 1;
            // **規則 1**(項の段): 右辺は項の累計(`2 + 3 × =` の右辺は 3。上と同じ行)。
            let right = if self.operand_missing() {
                product
            } else {
                self.unary()?
            };
            product = product.mul(right);
        }
        Ok(product)
    }

    /// `単項`。
    fn unary(&mut self) -> Result<Q, String> {
        if self.peek() == Some(Word::Negate) {
            self.at += 1;
            return Ok(Q::int(0).sub(self.unary()?));
        }
        let mut value = self.primary()?;
        while self.peek() == Some(Word::Square) {
            self.at += 1;
            value = value.mul(value);
        }
        Ok(value)
    }

    /// `一次`。
    fn primary(&mut self) -> Result<Q, String> {
        match self.peek() {
            Some(Word::Num(value)) => {
                self.at += 1;
                Ok(value)
            }
            Some(Word::Open) => {
                self.at += 1;
                let inside = match self.peek() {
                    // **規則 2**: 中身が空の `(` は 0(`( )` も、閉じ忘れの `(` が行末に
                    // 来るときも)。engine_table: `an_empty_group_is_zero`(`( ) =` → 0、
                    // `3 + ( =` → 3)。`Typed` では `fill_the_right_operand` の `(` の腕。
                    None | Some(Word::Close) => Q::int(0),
                    // **規則 3**: `(` の直後の二項演算子は 0 を左辺にする。engine_table:
                    // `an_operator_right_after_an_open_paren_takes_zero_as_its_left_operand`
                    // (`( + 3 ) =` → 3)。`Typed` では `press` の `Some(Tok::Open)` の腕。
                    // **`( −` は二項として読む**(空白で区切られる)。単項と読んでも値は同じ。
                    Some(Word::Plus | Word::Minus | Word::Times) => self.expr(Some(Q::int(0)))?,
                    _ => self.expr(None)?,
                };
                match self.peek() {
                    Some(Word::Close) => self.at += 1,
                    // **行末の閉じ忘れの `(` は閉じる**(engine_table:
                    // `equals_closes_unclosed_parentheses`。`Typed` の `=` の腕)。
                    None => {}
                    other => return Err(format!("`(` の中身のあとに {other:?}")),
                }
                Ok(inside)
            }
            other => Err(format!("値の位置に {other:?}")),
        }
    }
}

/// 綴り 1 行を慣例で読んだ値。
fn read_by_convention(line: &str) -> Result<Q, Unread> {
    let mut reader = Reader {
        words: words_of(line)?,
        at: 0,
    };
    let value = reader.expr(None).map_err(Unread::Malformed)?;
    match reader.peek() {
        None => Ok(value),
        Some(rest) => Err(Unread::Malformed(format!("読み残し {rest:?}"))),
    }
}

/// **`SIGN_NET` の読み直し**(設計書 §5.3)。`trail + =` について、web が記録する行
/// ——前置の値 `carry`・区間 `segment`・各キーの前の画面 `screens`——を `spell_line` で綴り、
/// **`read_by_convention` が読んだ値**が engine の答え `shown` と一致する。
#[allow(clippy::too_many_arguments)]
fn sign_spelling_reads_back(
    state: &EngineState,
    shown: &DisplayState,
    trail: &[Key],
    segment: &[Key],
    screens: &[String],
    carry: Option<&str>,
    decided: Option<bool>,
    counts: &mut Counts,
) {
    // エラー中の web は `AC` 以外を積まない(`spelling_reads_back` の註と同じ)。
    // **`=` そのものを拒むなら、web はその `=` を積まず、行ができない。**
    if state.error.is_some() || refuses(state, Key::Eq) {
        return;
    }
    // **前置はまだ決めていなければ、この `=` で決める**——web の `CARRIED_VALUE_TOKENS` に
    // `eq` が居る(`ScientificPanel` の `press`)。
    let before = render(state);
    let head = match decided {
        Some(true) => carry,
        Some(false) => None,
        None if before.answer_on_screen => Some(before.main.as_str()),
        None => None,
    };
    let screens: Vec<&str> = screens.iter().map(String::as_str).collect();
    let spelled = spell_line(head, segment, &screens);
    if spelled.is_empty() {
        return;
    }
    let read = match read_by_convention(&spelled) {
        Err(Unread::Exponent) => {
            counts.rounded_away += 1;
            return;
        }
        other => other,
    };
    let agreed = match (&shown.error, &read) {
        (None, Ok(value)) => shown.main == format_real(value.to_f64()),
        _ => false,
    };
    if agreed {
        counts.spellings += 1;
        if head.is_some() {
            counts.prefixed += 1;
        }
    } else if frozen_carry_shape(segment) {
        // **食い違った行だけを除く**——直れば一致して数が 0 に落ち、下の `assert_eq!` が赤くなる。
        counts.frozen_carry += 1;
    } else {
        counts.mismatches += 1;
        let shape: Vec<&str> = segment.iter().map(|k| k.token()).collect();
        *counts.shapes.entry(shape.join(" ")).or_insert(0) += 1;
        if counts.samples.len() < 12 {
            let tokens: Vec<&str> = trail.iter().map(|k| k.token()).collect();
            let what = match &read {
                Ok(value) => format_real(value.to_f64()),
                Err(Unread::Malformed(why)) => format!("読めない({why})"),
                Err(Unread::Exponent) => "指数表記".to_string(),
            };
            counts.samples.push(format!(
                "{tokens:?} 行={spelled:?} engine={:?} 読み={what}",
                shown.main
            ));
        }
    }
}

/// **既知の欠陥の形**: 区間が `( ) DEL DEL` で始まり(頭の何も消さない `DEL` は飛ばす)、
/// (何も消さない `DEL` を挟んで)二項演算子が続く。**記録した区間のキー列で判定する**——綴りの文字列は見ない。
///
/// - **原因**: web の `decidedRef`(`ScientificPanel` の `press`)は `)` で前置の判定を
///   固める(`)` は `CARRIED_VALUE_TOKENS` に居り、その時点の `answerOnScreen` は偽)。
///   **その `)` を `DEL` が消しても、判定は未決に戻らない。** engine のほうは `( ) DEL DEL` で
///   `answer_on_screen` が真に戻り、続く演算子は画面の値を左辺に取る。
/// - **再現**: `( ) DEL DEL × 3 =` は行が `× 3`、engine の答えは 0(echo は `0 × 3`)。
///   `5 =` のあとでも同じ(区間は `=` で切れるので、同じ形になる)。
///   **行が答えを生まない**——慣例では行頭の `×` を読めない。
/// - **既存の 2 本の網が黙っていた理由**: `Typed` は行頭の演算子の左辺に `base`(ここでは 0)を
///   入れる(`press` の `None` の腕)。それが画面の 0 とたまたま同じなので、一致してしまう。
///
/// **直しは別の枝で、小さな設計を付けて行う**(監視役の裁定 2026-10-05)。
/// **読み手は緩めない**(行頭の演算子を読む規則は設計書 §5.3.2 に無い)。
/// **web だけを直してもこのテストは赤くならない**——ここが読むのは web の前置の判定の
/// **写し**(`walk_signs` の `decided`)であって web そのものではなく、`walk` にも
/// もう 1 つ写しがある。**直す枝は `ScientificPanel.tsx`・`walk_signs`・`walk` の 3 つを
/// 同じコミットで変える。** そうすればこの形は一致して `frozen_carry` が 0 に落ち、下の
/// `assert_eq!` が赤くなる——**そのときこの除外を消す。** web の側の欠陥そのものは
/// E2E(`entry.spec.ts` の既知の欠陥の固定)が実 wasm で留めている。
fn frozen_carry_shape(segment: &[Key]) -> bool {
    // **前後の `DEL` は何も消さない**(区間の頭の `DEL`、組を消し終えたあとの `DEL`)
    // ——web はそれも積むので、区間の頭と演算子の前で読み飛ばす(2026-10-05 の実測で
    // 54 件のうち 3 件ずつがこの形)。
    let start = segment.iter().take_while(|k| **k == Key::Del).count();
    match &segment[start..] {
        [Key::LParen, Key::RParen, Key::Del, Key::Del, rest @ ..] => {
            let mut after = rest.iter().skip_while(|k| **k == Key::Del);
            matches!(after.next(), Some(Key::Add | Key::Sub | Key::Mul))
        }
        _ => false,
    }
}

/// `SIGN_NET` を歩く。**前置の判定は `walk` と同じ**(`=` で区間を切る・区間で最初に
/// 画面の値を使うキーで決める・拒まれたキーは web が積まない)。違いは 2 つ:
/// **`+/−` と `x²` も画面の値を使うキー**(web の `CARRIED_VALUE_TOKENS` の後置関数。
/// `walk` の網には無いので、あちらには出てこない)と、**各キーの前の画面 `main` を
/// `screens` に積む**(web が `spell_line` に添える列。設計書 §2.7.1)。
/// **値の照合(`Typed`)はしない**——`Typed` は `+/−` と `x²` を持たない。
#[allow(clippy::too_many_arguments)]
fn walk_signs(
    state: &EngineState,
    trail: &mut Vec<Key>,
    segment: &mut Vec<Key>,
    screens: &mut Vec<String>,
    carry: Option<&str>,
    decided: Option<bool>,
    counts: &mut Counts,
) {
    let (_, shown) = reduce(state, Key::Eq);
    counts.values += 1;
    sign_spelling_reads_back(
        state, &shown, trail, segment, screens, carry, decided, counts,
    );
    // **エラーは `AC` でしか解けない**(網に無い)ので、その先の行は 1 本もできない。
    if trail.len() + 1 >= SIGN_LENGTH || state.error.is_some() {
        return;
    }
    for &key in &SIGN_NET {
        let web_records = !refuses(state, key);
        let (next, _) = reduce(state, key);
        trail.push(key);
        let uses_the_screen_value = matches!(
            key,
            Key::Add | Key::Sub | Key::Mul | Key::Eq | Key::RParen | Key::Neg | Key::Sqr
        );
        let before = render(state);
        let decide = web_records && decided.is_none() && uses_the_screen_value;
        let next_decided = if decide {
            Some(before.answer_on_screen)
        } else {
            decided
        };
        let next_carry: Option<String> = if decide && before.answer_on_screen {
            Some(before.main.clone())
        } else {
            carry.map(str::to_string)
        };
        if key == Key::Eq && web_records {
            // **`=` で区間を切る**(web と同じ)。次の区間は空、前置は未決に戻る。
            let saved_keys = std::mem::take(segment);
            let saved_screens = std::mem::take(screens);
            walk_signs(&next, trail, segment, screens, None, None, counts);
            *segment = saved_keys;
            *screens = saved_screens;
        } else {
            if web_records {
                segment.push(key);
                screens.push(before.main.clone());
            }
            walk_signs(
                &next,
                trail,
                segment,
                screens,
                next_carry.as_deref(),
                next_decided,
                counts,
            );
            if web_records {
                segment.pop();
                screens.pop();
            }
        }
        trail.pop();
    }
}

#[test]
fn sign_and_square_spellings_read_back_by_convention() {
    let mut counts = Counts::default();
    walk_signs(
        &EngineState::initial(),
        &mut Vec::new(),
        &mut Vec::new(),
        &mut Vec::new(),
        None,
        None,
        &mut counts,
    );
    println!(
        "比べた回数: 節 {} / 慣例での読み直し {} (うち頭に値を前置した行 {}) / 指数表記で飛ばした {} / 既知の欠陥で除いた {} / 一致しなかった {}",
        counts.values,
        counts.spellings,
        counts.prefixed,
        counts.rounded_away,
        counts.frozen_carry,
        counts.mismatches
    );
    for sample in &counts.samples {
        println!("不一致: {sample}");
    }
    for (shape, n) in &counts.shapes {
        println!("形: {n:>4} 件  {shape}");
    }
    // **比べた回数の下限**(0 本で緑にしない)。網羅は決定的なので下限は実測値そのもの
    // (2026-10-05、SIGN_LENGTH = 7、debug)。節の数は設計書 §5.3.1 の engine だけの
    // 見積り(1,111,111)と同じ——この網は枝を刈らない(エラーは `AC` でしか解けず、
    // 網に `÷` が無いのでエラーにならない)。
    assert!(
        counts.values >= 1_111_111,
        "歩いた節は {} 個(2026-10-05 の実測 1,111,111 個)",
        counts.values
    );
    assert!(
        counts.spellings >= 967_199,
        "慣例で読み直したのは {} 回(2026-10-05 の実測 967,199 回)",
        counts.spellings
    );
    // **前置した行の下限**——前置が `=` をまたぐ行を 1 本も読まないまま緑にしない。
    assert!(
        counts.prefixed >= 714_205,
        "頭に値を前置して読み直したのは {} 回(2026-10-05 の実測 714,205 回)",
        counts.prefixed
    );
    // **既知の欠陥はちょうどの数で固定する**(`>=` にしない。監視役の裁定 2026-10-05)。
    // **読むのは `walk_signs` が持つ web の前置の判定の写し**(`walk` にもう 1 つ)なので、
    // web だけ直しても数は動かない。**直す枝は `ScientificPanel.tsx`・`walk_signs`・`walk` を
    // 同じコミットで変える**——そこで 0 に落ちて赤くなり、`frozen_carry_shape` を消す。
    assert_eq!(
        counts.frozen_carry, 54,
        "既知の欠陥(`( ) DEL DEL` のあとの演算子)で除いた行が {} 件(2026-10-05 の実測 54 件)",
        counts.frozen_carry
    );
    assert_eq!(
        counts.mismatches, 0,
        "慣例で読んだ値が engine の答えと違う行が {} 件(形は上の印字)",
        counts.mismatches
    );
}

#[test]
fn every_sequence_closed_by_equals_matches_an_independent_evaluator() {
    let counts = walk_from_the_start(&Net {
        keys: &NET,
        length: LENGTH,
    });
    println!(
        "比べた回数: 値 {} / 綴りの読み直し {} (うち頭に値を前置した行 {}) / 丸めで飛ばした {} / 一致しなかった {}",
        counts.values, counts.spellings, counts.prefixed, counts.rounded_away, counts.mismatches
    );
    for sample in &counts.samples {
        println!("不一致: {sample}");
    }
    for (shape, n) in &counts.shapes {
        println!("形: {n:>4} 件  {shape}");
    }
    // **比べた回数の下限**(0 本で緑にしない)。網羅は決定的なので下限は実測値そのもの
    // (2026-09-13、LENGTH = 7 で実測 682,651 回、2.83 秒(debug))。降りるのをやめる条件を
    // 「両方がエラー」にしたあとも同じ 682,651 回(2.89 秒)——評価器がエラーにする所では
    // エンジンもエラーなので、切る枝は変わらなかった。ここまでの秒数は値の照合だけのもの。
    // 2026-09-16 に綴りの読み直し(Task 9)を足してからは、回数は同じ 682,651 回で 3.84 秒(debug)。
    //
    // **★ 2026-09-17(0.9.3 の D-1)で 682,651 → 679,821 に下がった。2,830 回の減である。**
    // **下限を下げるのは「緩めれば緑になる数字」を 1 つ増やす動きなので、理由を書く**:
    // **評価器が `)` の時点で組を畳むようになった**(engine の `close_paren` と同じ時機。
    // DEL が `)` を取り消すようになったので、`=` まで遅らせるとエラーが消えてしまう)。
    // **早くエラーになる枝は、そこで降りるのをやめる**——`両方がエラー` が打ち切りの条件
    // だからである。**打ち切った枝の先は、engine も評価器もエラーのまま**なので、
    // **比べる価値のある組み合わせは減っていない。**
    // **減った分を確かめる手順**: この数を 682_651 に戻すと落ちる。落ちた回数の差が
    // そのまま「`)` で早く畳むようになった枝」である。
    //
    // **★ 2026-10-05 に 679,821 → 1,061,361 に上げた**(床が古く、3 割以上の比較が消えても
    // 緑だった)。**増えたのは `be8e736`(2026-09-17、開いていない `)` を押せなくした)**
    // ——`LENGTH` の註。
    assert!(
        counts.values >= 1_061_361,
        "比べたのは {} 回(2026-10-05 の実測 1,061,361 回)",
        counts.values
    );
    // **綴りを読み直した回数の下限**(Task 9)。実測値そのもの(2026-10-03 の 919,493 回。
    // 2026-10-05 の印字も同じ)。値の照合より少ないのは、`spelling_reads_back` が数えずに
    // 戻る行があるため——`=` の前に engine がエラーの列・綴りが空の区間・丸めで飛ばした行。
    assert!(
        counts.spellings >= 919_493,
        "綴りを読み直したのは {} 回(2026-10-03 の実測 919,493 回。2026-09-16 は 338,898 回で、         `=` をまたぐ列を数えるようになって増えた)",
        counts.spellings
    );
    // **頭に値を前置した行の下限**(2026-10-03)。**除外条件が強すぎると、前置する行を
    // 1 本も比べないまま緑になる**([[tests-can-assert-nothing]])ので、**その回数そのものを撃つ。**
    assert!(
        counts.prefixed >= 555_020,
        "頭に値を前置して読み直したのは {} 回(2026-10-03 の実測 555,020 回)",
        counts.prefixed
    );
    // **行が engine の答えを生むこと。** **飛ばすのは「表示が丸めた行」だけ**(上の註)。
    assert_eq!(
        counts.mismatches, 0,
        "綴りが答えを生まない行が {} 件(形は上の印字)",
        counts.mismatches
    );
}

#[test]
fn spellings_in_a_paren_heavy_net_read_back_to_the_engines_answer() {
    let counts = walk_from_the_start(&Net {
        keys: &PAREN_NET,
        length: PAREN_LENGTH,
    });
    println!(
        "比べた回数: 値 {} / 綴りの読み直し {} (うち頭に値を前置した行 {}) / 丸めで飛ばした {} / 一致しなかった {}",
        counts.values, counts.spellings, counts.prefixed, counts.rounded_away, counts.mismatches
    );
    for sample in counts.samples.iter().take(4) {
        println!("不一致: {sample}");
    }
    // **比べた回数の下限**(0 本で緑にしない)。網羅は決定的なので下限は実測値そのもの
    // (2026-09-16、PAREN_LENGTH = 9 で値の照合 856,681 回・綴りの読み直し 782,703 回、
    // 合わせて 7.91 秒(debug))。綴りと前置の床は 2026-10-03 の実測で、2026-10-05 の印字も同じ。
    // **★ 2026-10-05 に 856,681 → 2,015,539 に上げた**(刈らない木の全部。`PAREN_LENGTH` の註)。
    assert!(
        counts.values >= 2_015_539,
        "比べたのは {} 回(2026-10-05 の実測 2,015,539 回)",
        counts.values
    );
    assert!(
        counts.spellings >= 2_002_863,
        "綴りを読み直したのは {} 回(2026-10-03 の実測 2,002,863 回。2026-09-16 は 782,703 回)",
        counts.spellings
    );
    // **ここで前置を守っているのは、この床のほうである**(2026-10-03、レビュー役の実測)。
    // **括弧網には `=` が無い**(上の `PAREN_NET`)ので、**前置される値はいつも画面の 0**で、
    // **評価器の既定の左辺と同じ**になる——**前置をやめても不一致は 0 のままである。**
    // **つまり下の「不一致 0」は、この網では前置について何も言っていない。**
    assert!(
        counts.prefixed >= 1_124_996,
        "頭に値を前置して読み直したのは {} 回(2026-10-03 の実測 1,124,996 回)",
        counts.prefixed
    );
    assert_eq!(
        counts.mismatches, 0,
        "綴りが答えを生まない行が {} 件(形は上の印字)",
        counts.mismatches
    );
}

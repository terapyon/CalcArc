use serde::{Deserialize, Serialize};

use crate::{AngleMode, CalcError, CalcResult, Value};

/// 状態のスキーマ版。永続化を始めた後に不整合を検出するために持つ。
/// 本スライスでは保存しないが、後から足すと既存データが扱えなくなるため
/// 最初から持たせておく（設計書 §4.4）。
/// 4: `Buffer` に指数部が入った(設計書 §2)。直列化の形が変わったので上げた。
/// 5: `EngineState` に `notation`(ENG トグル)が入った(設計書 §4)。
/// 6: `Buffer` に 60 進の段が、`EngineState` に 60 進表示の一時状態が
///    入った(S-4 設計書 §3.2)。**3 つ目の入力モード**である。
/// 形を変えたら上げる——上げないと、旧い形の状態が届いたときの初期化が
/// serde の解析失敗という事故として起き、意図した挙動と区別できなくなる。
pub const STATE_SCHEMA: u32 = 6;

/// 入力欄に打ち込める最大文字数。
///
/// `pub` なのは `calcarc-wasm` の `max_entry_len()` がこれをそのまま
/// 境界の向こうへ渡すため——履歴の呼び戻し(`web/src/ui/
/// ScientificPanel.tsx` の `mapAnswerToKeys`)がこの上限を跨ぐ答を
/// 打ち直そうとすると、engine 側で黙って切り詰められて別の数になる
/// (Fix round 3 finding)。TypeScript にこの数をハードコードすると、
/// ここを上げたときに web だけ古い値のまま取り残される。
pub const MAX_ENTRY_LEN: usize = 12;

/// 指数部に打てる桁数。f64 の定義域(約 1e±308)を打鍵で覆える 3 桁にする
/// (設計書 §2)。2 桁だと golden の境界ケースを手で再現できない。
const MAX_EXPONENT_LEN: usize = 3;

/// 表示形式。`▸∠` で切り替わる。値そのものには影響しない。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DisplayForm {
    Rect,
    Polar,
}

impl DisplayForm {
    /// 全列挙。TypeScript の DISPLAY_FORMS と token_parity.rs が対応を守る。
    pub const ALL: [DisplayForm; 2] = [DisplayForm::Rect, DisplayForm::Polar];

    pub fn toggled(self) -> DisplayForm {
        match self {
            DisplayForm::Rect => DisplayForm::Polar,
            DisplayForm::Polar => DisplayForm::Rect,
        }
    }
}

/// 表示の記法。`AngleMode` や `DisplayForm` と同じ**表示の状態**である(設計書 §4)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Notation {
    Normal,
    Eng,
}

impl Notation {
    /// 全列挙。TypeScript の NOTATIONS と token_parity.rs が対応を守る。
    pub const ALL: [Notation; 2] = [Notation::Normal, Notation::Eng];

    pub fn toggled(self) -> Notation {
        match self {
            Notation::Normal => Notation::Eng,
            Notation::Eng => Notation::Normal,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    /// xʸ。**唯一の右結合演算子**(S-1 設計書 §3.1)。
    Pow,
    /// 順列 nPr。**左結合**、優先順位 3(S-3 設計書 §2)。
    Npr,
    /// 組合せ nCr。**左結合**、優先順位 3。
    Ncr,
}

impl BinOp {
    /// 大きいほど先に評価される（設計書 D9）。
    ///
    /// 段は 4 つある: `+ −`(1) < `× ÷`(2) < `nPr nCr`(3) < `xʸ`(4)。
    /// **上下の両方が engine_table に固定されている**——`nPr`/`nCr` を 2 に
    /// 下げると `combinations_bind_tighter_than_multiplication` が、
    /// 5 に上げると `combinations_sit_below_the_power_operator` が落ちる。
    pub fn precedence(self) -> u8 {
        match self {
            BinOp::Add | BinOp::Sub => 1,
            BinOp::Mul | BinOp::Div => 2,
            // 「1 つの数」を作る演算として読まれるので × ÷ より先
            // (S-3 設計書 §2 の裁定 1)。`5 × 4 nCr 2` は `5 × 6 = 30`。
            BinOp::Npr | BinOp::Ncr => 3,
            BinOp::Pow => 4,
        }
    }

    /// 同じ優先順位が連続したとき、右から畳むか。
    ///
    /// 数学の慣行では冪だけが右結合で、`2^3^2` は `2^(3^2) = 512` である
    /// （`(2^3)^2 = 64` ではない）。**左結合はタダではない**——独立検証層の
    /// mpmath は慣行に従うので、左結合を選ぶと恒久的に食い違う。それを消す
    /// 唯一の方法は Python に engine の意味論を教えることで、それは
    /// CONTRIBUTING の「参照実装を Rust の移植にしない」に真正面から当たる
    /// （S-1 設計書 §3.2）。
    pub fn is_right_associative(self) -> bool {
        matches!(self, BinOp::Pow)
    }
}

/// 演算子スタックに積まれるもの。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OpToken {
    Op(BinOp),
    OpenParen,
}

/// 入力中の指数部。`Exp` を押した時点で、桁が無いまま存在する。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Exponent {
    pub digits: String,
    pub negative: bool,
}

/// 入力中の数値。確定するまで Value にならない。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Buffer {
    /// 打鍵された文字列。`"3"`, `"3.1"`, `""`（j の直後）。
    pub digits: String,
    /// `j` が押されて虚部として入力中か。
    pub imaginary: bool,
    /// `Exp` を押してから確定するまでの指数部(設計書 §2)。
    pub exponent: Option<Exponent>,
    /// 60 進で**確定した段**(S-4 設計書 §3)。`digits` が今打っている段である。
    /// `1 °'" 30 °'"` なら `["1", "30"]` で `digits` は空。
    ///
    /// **最大 2 つ**——度・分・秒の 3 段なので、確定するのは 2 つまで。
    /// **指数とは排他**である(下の `try_push_sexagesimal_separator` を見ること)。
    #[serde(default)]
    pub sexagesimal: Vec<String>,
}

/// `backspace` が何を消したか。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backspace {
    /// 1 文字消した。バッファはまだ生きている。
    Removed,
    /// 消すものが尽きた。呼び出し側はバッファごと破棄してよい。
    Exhausted,
}

impl Buffer {
    pub fn imaginary() -> Buffer {
        Buffer {
            imaginary: true,
            ..Buffer::default()
        }
    }

    /// 確定値。`j` だけで数字がなければ 1j と解釈する（設計書 §4.3）。
    /// `Exp` だけの場合も仮数 1 とする(実機と同じ)。
    ///
    /// 指数を付けた結果が f64 の範囲を超えたら Overflow(設計書 §2)。
    /// **打鍵の途中ではなく、値になる瞬間に返す**——`1e30` を打つ途中に
    /// `1e3` を経由するのと同じで、途中経過をエラーにはしない。
    pub fn value(&self) -> CalcResult<Value> {
        // 60 進は段を畳む。`1 °'" 30 °'"` は秒を省いた形で 1.5(設計書 §3)。
        if !self.sexagesimal.is_empty() {
            let mut total = 0.0_f64;
            let mut scale = 1.0_f64;
            for stage in self.sexagesimal.iter().chain(std::iter::once(&self.digits)) {
                let n: f64 = if stage.is_empty() {
                    0.0
                } else {
                    stage.parse().map_err(|_| CalcError::SyntaxError)?
                };
                total += n / scale;
                scale *= 60.0;
            }
            if !total.is_finite() {
                return Err(CalcError::Overflow);
            }
            return Ok(if self.imaginary {
                Value::imag(total)
            } else {
                Value::real(total)
            });
        }
        let mantissa = if self.digits.is_empty() {
            "1".to_string()
        } else {
            self.digits.clone()
        };
        let text = match &self.exponent {
            // 桁の無い指数は指数なしと同じ。
            Some(e) if !e.digits.is_empty() => format!(
                "{mantissa}e{}{}",
                if e.negative { "-" } else { "" },
                e.digits
            ),
            _ => mantissa,
        };
        let n: f64 = text.parse().map_err(|_| CalcError::SyntaxError)?;
        if !n.is_finite() {
            return Err(CalcError::Overflow);
        }
        Ok(if self.imaginary {
            Value::imag(n)
        } else {
            Value::real(n)
        })
    }

    /// 入力中に表示する文字列。打鍵した通りに見せる。
    pub fn text(&self) -> String {
        // 60 進は `°` で繋いで打った通りに見せる(S-4)。**十進でも 60 進の
        // 完成形でもない、打鍵の途中の姿**である。
        if !self.sexagesimal.is_empty() {
            let tail = if self.imaginary { "j" } else { "" };
            let body = self
                .sexagesimal
                .iter()
                .map(String::as_str)
                .chain(std::iter::once(self.digits.as_str()))
                .collect::<Vec<_>>()
                .join("°");
            return format!("{body}{tail}");
        }
        let mantissa = if !self.digits.is_empty() {
            self.digits.clone()
        } else if self.exponent.is_some() {
            // 仮数なしの Exp は仮数 1(実機と同じ)。値と表示を揃える。
            "1".to_string()
        } else if self.imaginary {
            String::new()
        } else {
            "0".to_string()
        };
        let exponent = match &self.exponent {
            Some(e) => format!("e{}{}", if e.negative { "-" } else { "" }, e.digits),
            None => String::new(),
        };
        let tail = if self.imaginary { "j" } else { "" };
        format!("{mantissa}{exponent}{tail}")
    }

    /// 打鍵された数字があるか。j の切り替え条件(設計書 §1)。
    pub fn has_digits(&self) -> bool {
        !self.digits.is_empty()
    }

    /// 実部と虚部を切り替える。数字はそのまま残す。
    pub fn toggle_imaginary(&mut self) {
        self.imaginary = !self.imaginary;
    }

    pub fn push_digit(&mut self, d: u8) {
        if d > 9 {
            // Key::Digit は pub なので範囲外の値を構築できる。from_token は
            // 0..=9 しか作らないが、直接渡されると (b'0' + d) が桁上がりして
            // panic する。このクレートは panic しないと約束している。
            return;
        }
        let digit = (b'0' + d) as char;
        // 指数入力中は指数へ入る(設計書 §2)。先頭ゼロの規則は仮数と共通。
        if let Some(exponent) = self.exponent.as_mut() {
            if exponent.digits.len() >= MAX_EXPONENT_LEN {
                return;
            }
            if exponent.digits == "0" {
                exponent.digits.clear();
            }
            exponent.digits.push(digit);
            return;
        }
        if self.digits.len() >= MAX_ENTRY_LEN {
            return;
        }
        // 先頭の 0 は次の数字で置き換える。"0" -> "5" であって "05" ではない。
        if self.digits == "0" {
            self.digits.clear();
        }
        self.digits.push(digit);
    }

    /// `000`。0 を 3 つ入れる。字数制限に収まるぶんだけ入り、先頭ゼロの
    /// 規則も 1 つずつ押したときと同じになる(設計書 §3)。
    pub fn push_zeros(&mut self) {
        for _ in 0..3 {
            self.push_digit(0);
        }
    }

    /// `Exp`。すでに指数入力中なら何もしない(連打は無視)。
    ///
    /// **60 進入力中も何もしない**(S-4)。指数と 60 進は別の入力モードで、
    /// 混ぜると意味が決まらない——`push_dot` が「指数は整数。小数点は
    /// 無視する(打ち間違いで計算を止めない)」と決めているのと同じ理由で、
    /// **エラーにもモード切替にもしない**。
    pub fn push_exponent(&mut self) {
        if !self.sexagesimal.is_empty() {
            return;
        }
        self.exponent.get_or_insert_with(Exponent::default);
    }

    /// `°'"` を入力中に押したときの区切り(S-4 設計書 §3)。
    ///
    /// 打てたら true。**指数入力中と、段が 3 つ埋まっているときは false**
    /// ——前者は排他(上の `push_exponent` と対)、後者は度・分・秒で
    /// 打ち止めだからである(裁定 3)。
    ///
    /// **`try_` が付いているのは、`push` が std では可謬でないからである**
    /// (`api-style.md` の「名前の嘘」)。`Vec::push` は `()` を返して失敗しない
    /// ので、`push_…() -> bool` は**押せなかったことがある**という事実を名前が
    /// 隠す。`Result` ではなく `bool` なのは、**断る理由が呼び出し側にとって
    /// 1 つしかない**からである——`Key::Dms` は「区切れたか、そうでなければ
    /// 表示のトグルか」しか見ない。
    #[must_use = "打てなかったことは戻り値にしか出ない"]
    pub fn try_push_sexagesimal_separator(&mut self) -> bool {
        if self.exponent.is_some() || self.sexagesimal.len() >= 2 {
            return false;
        }
        self.sexagesimal.push(std::mem::take(&mut self.digits));
        true
    }

    /// `+/−`。指数入力中なら指数の符号を反転して true を返す。そうでなければ
    /// 何もせず false——呼び出し側が確定値の符号を反転する(設計書 §2)。
    ///
    /// **`try_` は付けない。** `toggle` は std の名前ではないので、可謬で
    /// あることを名前が偽っていない(`api-style.md`「std の慣習は名前の嘘を
    /// 直すために採り、ドメイン語彙を消すためには採らない」)。**戻り値は
    /// 失敗の合図ではなく、どちらが符号を反転するかの割り振り**である。
    #[must_use = "どちらが符号を反転するかは戻り値にしか出ない"]
    pub fn toggle_exponent_sign(&mut self) -> bool {
        match self.exponent.as_mut() {
            Some(exponent) => {
                exponent.negative = !exponent.negative;
                true
            }
            None => false,
        }
    }

    pub fn push_dot(&mut self) -> CalcResult<()> {
        if self.exponent.is_some() {
            // 指数は整数。小数点は無視する(打ち間違いで計算を止めない)。
            return Ok(());
        }
        if self.digits.contains('.') {
            return Err(CalcError::SyntaxError);
        }
        if self.digits.len() >= MAX_ENTRY_LEN {
            return Ok(());
        }
        if self.digits.is_empty() {
            self.digits.push('0');
        }
        self.digits.push('.');
        Ok(())
    }

    /// 末尾 1 文字を削る。
    ///
    /// 虚数入力では数字が尽きても j マーカーを残す。ここで一緒に捨てると
    /// `3 + 4j DEL 5 =` が 3+5j ではなく 3+5 になり、何を計算しているかが
    /// 黙って変わる。j を消すにはもう一度 DEL を押す。
    pub fn backspace(&mut self) -> Backspace {
        // 段は 指数の桁 → e マーカー → 仮数の文字 → j マーカー の順
        // (設計書 §2)。一度に 1 段だけ戻す。
        if let Some(exponent) = self.exponent.as_mut() {
            if exponent.digits.pop().is_some() {
                return Backspace::Removed;
            }
            self.exponent = None;
            return Backspace::Removed;
        }
        if self.digits.pop().is_some() {
            if self.digits.is_empty() && !self.imaginary && self.sexagesimal.is_empty() {
                return Backspace::Exhausted;
            }
            return Backspace::Removed;
        }
        // 60 進の区切りを 1 つ戻す。段の文字が尽きてから区切りが消えるので、
        // `1 °'" 30` は 3 回で `1` に戻る(I7: 一度に 1 段だけ)。
        if let Some(previous) = self.sexagesimal.pop() {
            self.digits = previous;
            return Backspace::Removed;
        }
        // 数字はもう無い。残っているのは j だけなので、これで破棄してよい。
        Backspace::Exhausted
    }
}

/// 電卓の全状態。Rust はこれを保持せず、呼び出しごとに受け渡す（設計書 D7）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EngineState {
    pub schema: u32,
    /// 入力中の数値。None なら `current` が表示される。
    pub buffer: Option<Buffer>,
    /// 確定している現在値。
    pub current: Value,
    /// 保留中の被演算数。
    pub operands: Vec<Value>,
    /// 保留中の演算子と開き括弧。
    pub operators: Vec<OpToken>,
    pub angle: AngleMode,
    pub form: DisplayForm,
    pub notation: Notation,
    /// **60 進で見せているか**(S-4 設計書 §3.1)。`°'"` を押した直後だけ真で、
    /// **`°'"` 以外のあらゆるキーで解除される**——モードではなく一時状態
    /// である。`angle` / `form` / `notation` と違って `AC` でも落ちる。
    #[serde(default)]
    pub sexagesimal_view: bool,
    /// Some のあいだは AC 以外のキーを受け付けない。
    pub error: Option<CalcError>,
    /// 二項演算子の直後に居るか。演算子を続けて押したときに差し替える
    /// ための判定に使う。
    ///
    /// 「直前のキーが演算子だったか」ではない。入力中の文字や `(` は
    /// 居場所を動かさないので、この旗を落とさない。DEL で入力を消せば
    /// 演算子の直後に戻るのだから、落としてはいけない。差し替えてよい
    /// 状態かどうかは、この旗と `buffer` / `operators` の形を併せて
    /// `push_binop` が決める。
    pub operator_pending: bool,
}

impl EngineState {
    pub fn initial() -> EngineState {
        EngineState {
            schema: STATE_SCHEMA,
            buffer: None,
            current: Value::ZERO,
            operands: Vec::new(),
            operators: Vec::new(),
            angle: AngleMode::Deg,
            form: DisplayForm::Rect,
            notation: Notation::Normal,
            sexagesimal_view: false,
            error: None,
            operator_pending: false,
        }
    }

    /// 角度モード・表示形式・記法は利用者の設定なので AC で戻さない。
    ///
    /// **`sexagesimal_view` は戻す**(S-4 設計書 §3.1)。あれは設定ではなく
    /// 「いま覗いている」という一時状態なので、`AC` でも解除される。
    /// AC。**角度と表示形式は残す**——利用者が選んだ「見え方」であって、
    /// 打った数ではない。
    ///
    /// **`notation` はここで持ち越さない**(【変更 2026-08-25、0.4.0】)。
    /// ENG は覗くためのキーになり、`reduce` が ENG 以外のすべてのキーで
    /// 通常表記に戻す——AC もその「すべて」に入る。**ここに
    /// `notation: self.notation` を書いても、直後に上書きされて
    /// 一度も観測されない。**
    pub fn cleared(&self) -> EngineState {
        EngineState {
            angle: self.angle,
            form: self.form,
            ..EngineState::initial()
        }
    }

    pub fn is_valid(&self) -> bool {
        self.schema == STATE_SCHEMA
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sexagesimal_buffer_folds_its_stages() {
        // 1 °'" 30 °'" 0 → 1.5(S-4 設計書 §3)
        let mut b = Buffer::default();
        b.push_digit(1);
        assert!(b.try_push_sexagesimal_separator());
        b.push_digit(3);
        b.push_digit(0);
        assert!(b.try_push_sexagesimal_separator());
        b.push_digit(0);
        assert_eq!(b.value().unwrap(), Value::real(1.5));
    }

    #[test]
    fn the_last_sexagesimal_stage_may_be_omitted() {
        // 1 °'" 30 °'" で秒を省ける(設計書 §3)。
        let mut b = Buffer::default();
        b.push_digit(1);
        assert!(b.try_push_sexagesimal_separator());
        b.push_digit(3);
        b.push_digit(0);
        assert!(b.try_push_sexagesimal_separator());
        assert_eq!(b.value().unwrap(), Value::real(1.5));
    }

    #[test]
    fn a_fourth_sexagesimal_stage_is_refused() {
        // 段は 3 つまで(裁定 3)。4 つ目の区切りは打てない。
        let mut b = Buffer::default();
        b.push_digit(1);
        assert!(b.try_push_sexagesimal_separator());
        assert!(b.try_push_sexagesimal_separator());
        assert!(!b.try_push_sexagesimal_separator());
    }

    #[test]
    fn sexagesimal_and_the_exponent_do_not_mix() {
        // **両方向とも無視する**(S-4 の実装計画で明文化)。エラーにも
        // モード切替にもしない——push_dot の「打ち間違いで計算を止めない」
        // と同じ理由であり、切り替えるなら既に打った桁の読み直しを決めねば
        // ならないが、その答えが無い(1.5e3 の 3 は指数か秒か)。
        let mut b = Buffer::default();
        b.push_digit(1);
        assert!(b.try_push_sexagesimal_separator());
        b.push_exponent();
        assert!(b.exponent.is_none());

        let mut c = Buffer::default();
        c.push_digit(1);
        c.push_exponent();
        assert!(!c.try_push_sexagesimal_separator());
        assert!(c.sexagesimal.is_empty());
    }

    #[test]
    fn a_sexagesimal_buffer_shows_what_was_typed() {
        // 入力中は打った通りに見せる(既存の規則)。
        let mut b = Buffer::default();
        b.push_digit(1);
        // **段に入れたことを主張する。** ここが false なら以下の `text()` は
        // 60 進ではなく十進を見ていることになり、検査が別のものを測る。
        assert!(b.try_push_sexagesimal_separator());
        b.push_digit(3);
        b.push_digit(0);
        assert_eq!(b.text(), "1°30");
    }

    #[test]
    fn backspace_walks_out_of_the_sexagesimal_stages() {
        // 段は 1 つずつ戻る(I7)。1 °'" 30 から 3 回で 1 に戻る。
        let mut b = Buffer::default();
        b.push_digit(1);
        // **段に入れたことを主張する。** ここが false なら以下の `text()` は
        // 60 進ではなく十進を見ていることになり、検査が別のものを測る。
        assert!(b.try_push_sexagesimal_separator());
        b.push_digit(3);
        b.push_digit(0);
        assert_eq!(b.backspace(), Backspace::Removed);
        assert_eq!(b.text(), "1°3");
        assert_eq!(b.backspace(), Backspace::Removed);
        assert_eq!(b.text(), "1°");
        assert_eq!(b.backspace(), Backspace::Removed);
        assert_eq!(b.text(), "1");
    }

    #[test]
    fn push_digit_ignores_an_out_of_range_digit() {
        // Key::Digit は pub なので範囲外の値を構築できる。(b'0' + d) が
        // 桁上がりして panic しないことを確認する。
        let mut buffer = Buffer::default();
        buffer.push_digit(250);
        assert_eq!(buffer, Buffer::default());
    }
}

//! キー列を、履歴に残す式の文字列に綴る。
//!
//! **キーは後置で押すが、式は数学の慣例で書く**(1.2.1、設計書
//! `2026-10-04-function-notation-design.md`。利用者の裁定 2026-10-04)。
//! `3 0 sin` は `sin(30)`、`( 2 + 3 ) x²` は `(2 + 3)²`、`3 +/−` は `−3`、`xʸ` は `^`。
//! 括弧の内側には空白を入れない(`(2 + 3)`、裁定 2)。
//!
//! **構文木は組まない**——組めばそれは計算であり、参照実装に同じ手順を書くことに
//! なって照合の意味が消える(設計書 `2026-09-03-history-design.md` §4a)。語の列
//! (`parts`)を打った順に積み、**後置関数を押したら、末尾から 1 つの値**(閉じた組
//! なら対応する `(` まで)**を抜いて 1 語に畳む**だけである(`top_open` と同じ、末尾から
//! 読み飛ばす形)。**語には種類を持たせる**(原子・組・そのほか。§2.1)——綴りの
//! 文字列から種類を推し量らない(推測は過去に同じ欠陥を 4 回入れた形である)。
//! **かかる値が綴りに無い**(演算子・`(` の直後、空の区間)ときは、**押す直前に
//! 画面に出ていた値**を 1 語として補う(裁定 1)——engine が実際にかけた値であり、
//! 綴りの側で優先順位を真似ない。
//! **演算子の直後の演算子は訂正なので、最後の 1 つだけを残す**
//! (0.9.2 設計書 §9 の 9。engine の押し直しと同じ意味)。
//!
//! 独立: 不可能。**綴りは「式をどう書くか」という取り決め**であって数学的な
//! 事実ではないので、別手順で同じ文字列に到達する道が無い。
//! **番人は `tests/spell_table.rs` の表**であり、そこでは入力中の数の綴りを
//! **engine を実際に走らせた `render(...).main` と 1 文字ずつ突き合わせる。**
//! (取り決めのうち「慣例どおりに読めば engine の答えになる」という数学の側の主張は、
//! `tests/engine_values.rs` の読み直しが独立に確かめる。)
//!
//! **番人はもう 1 つある**——`tests/spell_differential.rs` が、長さ 5 までの
//! 全列と入力に寄せた乱択で「入力中は綴りが engine の表示で終わり、その直前は
//! 空白か `(` か行頭である」(不変条件 A′。設計書 §5.2)を確かめる。**写しの残り
//! (キーの振り分け)を見るのはこちら**である。A′ が見るのは末尾だけなので、
//! 途中の語に取り残されたずれには構造的に黙る(設計書
//! `2026-09-10-independent-verification-gaps-design.md` §2.4)。
//! 過去の欠陥版 4 つで赤くなることを実測した(同 §2.6、A′ では 2026-10-05)。
//!
//! # 数の部分は真似ない。`Buffer` そのものを歩かせる
//!
//! かつてここには `Buffer` と「同じ形の」写しが置いてあり、`del` の段・
//! 先頭ゼロ・小数点・指数を手で真似ていた。**同じ欠陥が 5 回入った**
//! ——真似そこねた振る舞いが 1 つ直るたびに、次の真似そこねが表に出た。
//! 数え直したところ `Buffer` の 16 の振る舞いのうち **13 を真似られて
//! いなかった**(字数上限、上限での `.`、指数の桁数上限、指数の符号、
//! 指数中の `.`、`Exp` の連打、60 進中の `Exp`、仮数と指数の先頭ゼロ、
//! 裸の `.` の暗黙の 0、仮数なしの `Exp` の 1、`000` の上限跨ぎ、ほか)。
//!
//! **いまは写しを持たない。** `spell` は本物の `Buffer`
//! (`engine/state.rs`)を持って歩き、`engine/mod.rs` の `apply()` が
//! バッファへ渡すのと同じキーを同じ順で渡し、**値の部分を
//! `Buffer::text()` で綴る。** `text()` の docstring が
//! 「入力中に表示する文字列。打鍵した通りに見せる。」と言っているとおり、
//! これは §4a の「打った通り」を **engine 自身の実装で**述べたものである。
//! **原子かどうかも `Buffer` から取る**(指数・60 進・虚部を持つか)。
//! 演算子・関数・括弧など、バッファを通らないものは従来どおりここで
//! 組み立てる(`commit_glyph`・`function_form`)。
//!
//! **その帰結**: 指数の符号は綴りの数の中に出る(`1.5e-3`)。**仮数の符号は
//! `Buffer` に無い**——`+/−` は指数入力中でなければ `Buffer` ではなく呼び出し側
//! (`apply_unary`)が確定値に掛けるので、綴りでも確定した語に `−` を付けて畳む
//! (`−3`)。この非対称は engine の分担そのままである。
//!
//! **どのキーがバッファに届き、どのキーがバッファを確定・破棄するか**は
//! `engine/mod.rs` の `apply()` と `commit_entry` の呼び出し元をそのまま
//! 辿った(下の各 `match` アームのコメントを見ること)。

use super::key::Key;
use super::state::{Backspace, Buffer};

/// 語の種類(設計書 §2.1)。**綴りの文字列から推し量らない**——数の語は `Buffer`
/// から、関数を畳んだ語は畳んだ側が決める。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    /// **原子**: 符号の無い普通の数(`Buffer` が指数・60 進・虚部を持たない)と定数 `π`・`e`。
    /// 記号を付けても括弧が要らない。
    Atom,
    /// **組**: `(` から対応する `)` までの語の並び。**1 語としては積まない**
    /// ——`(` と `)` は 1 語ずつのまま(`top_open` と DEL の規則が語を数えるため。§2.6)。
    /// 後置関数が末尾から範囲を探したときに、その範囲の種類としてだけ現れる(`operand`)。
    Group,
    /// **そのほか**: 上のどれでもない値。負の数・指数表記・60 進・複素・関数を畳んだ結果。
    /// 記号を付けるときと `^` の左に来たときは括弧で包む。
    Other,
    /// `(`・`)`・二項演算子。**値ではない**ので上の 3 つのどれでもない
    /// (設計書 §4.1 は「種類は持たせても使わない」と書く。値と取り違えないための印)。
    Mark,
}

/// 綴りの 1 語。
#[derive(Debug, Clone)]
struct Part {
    text: String,
    kind: Kind,
    /// **`1/x` で畳んだ語か**(設計書 §2.4、監視役の裁定 2026-10-05)。`render` が `^` と
    /// `÷` の右でこの語を包むために読む。**字面の `1/` を探さない**——畳んだ側が印を付ける。
    reciprocal: bool,
}

impl Part {
    /// 印の無い語(`1/x` で畳んだのではない語)。
    fn new(text: impl Into<String>, kind: Kind) -> Part {
        Part {
            text: text.into(),
            kind,
            reciprocal: false,
        }
    }

    fn mark(text: &str) -> Part {
        Part::new(text, Kind::Mark)
    }

    /// その語が値でない語 `text`(`(`・`)`・二項演算子)か。
    fn is(&self, text: &str) -> bool {
        self.kind == Kind::Mark && self.text == text
    }

    fn is_binary(&self) -> bool {
        self.kind == Kind::Mark && BINARY_GLYPHS.contains(&self.text.as_str())
    }

    /// 打ちかけの数を語にする。**原子かどうかは `Buffer` の中身で決める**(§2.1)
    /// ——指数・60 進の段・虚部のどれかを持てば原子ではない。`3.` も `0.5` も原子。
    fn entry(buffer: &Buffer) -> Part {
        let atom = buffer.exponent.is_none() && buffer.sexagesimal.is_empty() && !buffer.imaginary;
        Part::new(buffer.text(), if atom { Kind::Atom } else { Kind::Other })
    }

    /// **文字列でしか来ない値**(前の答えと画面の値)を語にする。原子かどうかは
    /// 表示の文字列で決めるしかない(§2.1)。
    fn shown(text: &str) -> Part {
        let kind = if is_plain_number(text) {
            Kind::Atom
        } else {
            Kind::Other
        };
        Part::new(text, kind)
    }
}

/// 表示の文字列が「符号の無い普通の数」か(設計書 §2.1)。
/// `^[0-9]+(\.[0-9]+)?$` か `^[0-9]{1,3}(,[0-9]{3})*(\.[0-9]+)?$` に合うもの。
///
/// **桁区切りの `,` を含めるのは監視役の裁定**(設計書 §0.4 の条件 2)——画面は整数部を
/// 3 桁ごとに区切る(`numeric/format.rs` の `group_integer_part`)ので、含めないと
/// `1234 × 1000 =` のあとの `x²` が `(1,234,000)²` になる。
/// **負の数(ASCII の `-`)・指数表記・極形式・60 進は合わない**ので原子ではない。
fn is_plain_number(text: &str) -> bool {
    fn digits(s: &str) -> bool {
        !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
    }
    let (whole, fraction) = match text.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (text, None),
    };
    if fraction.is_some_and(|f| !digits(f)) {
        return false;
    }
    if digits(whole) {
        return true;
    }
    let mut groups = whole.split(',');
    let first_ok = groups.next().is_some_and(|g| digits(g) && g.len() <= 3);
    first_ok && groups.all(|g| digits(g) && g.len() == 3)
}

/// 開いている `Buffer` を `parts` へ流し込み、閉じる。`commit_entry`
/// (`engine/mod.rs`)と同じ——バッファが無ければ何もしない。
///
/// **`value()` は呼ばない。** 綴りは打鍵の記録であって計算ではないので、
/// 溢れも構文エラーもここでは起きない(engine 側だけが状態をエラーに
/// する)。流し込むのは `text()` ——engine が入力中に見せていた姿である。
fn commit_into(current: &mut Option<Buffer>, parts: &mut Vec<Part>) {
    if let Some(buffer) = current.take() {
        parts.push(Part::entry(&buffer));
    }
}

/// `Buffer` を確定させたあと、値でない語を 1 つだけ足すキー(二項演算子と `)`)の字面。
///
/// ここに来るのは、`apply()`(`engine/mod.rs`)で `commit_entry` を呼ぶ
/// キーのうち、専用の分岐を持たず、後置関数でもないものだけである。`Eq` は綴りに
/// 何も足さない(列を閉じるだけ)。
///
/// **`Buffer` に届くキー(数字・`.`・`000`・`Exp`・`j`・`°'"`)はここに
/// 載らない。** それらの綴りは `Buffer::text()` が持っており、固定の
/// 字面を持たない。後置関数は `function_form` が持つ。
fn commit_glyph(key: Key) -> Option<&'static str> {
    Some(match key {
        Key::Add => "+",
        Key::Sub => "−",
        Key::Mul => "×",
        Key::Div => "÷",
        // **`xʸ` は `^` と書く**(設計書 §2.4)。engine の `echo` も `2 ^` と書く。
        Key::Pow => "^",
        Key::Npr => "nPr",
        Key::Ncr => "nCr",
        Key::RParen => ")",
        _ => return None,
    })
}

/// 二項演算子の字面。押し直しの判定・`top_open`・`^` の左の包みが読む。
const BINARY_GLYPHS: [&str; 7] = ["+", "−", "×", "÷", "^", "nPr", "nCr"];

fn is_binary(key: Key) -> bool {
    matches!(
        key,
        Key::Add | Key::Sub | Key::Mul | Key::Div | Key::Pow | Key::Npr | Key::Ncr
    )
}

/// 後置関数の書き方(設計書 §2.3)。
#[derive(Debug, Clone, Copy)]
enum Form {
    /// `f(…)`。組ならその括弧を自分の括弧に使う(二重にしない)。
    Call(&'static str),
    /// 値の後ろに記号(`²`・`!`)。原子と組はそのまま、そのほかは包む。
    After(&'static str),
    /// 値の前に記号(`e^`・`1/`・`−`)。包み方は `After` と同じ。
    Before(&'static str),
}

/// 後置関数のキーの書き方。**`+/−` は仮数の符号のときだけここを通る**(指数の符号は
/// `Buffer` の中で効く。`spell` の `Key::Neg` の腕)。
fn function_form(key: Key) -> Option<Form> {
    Some(match key {
        Key::Sqrt => Form::Call("√"),
        Key::Sin => Form::Call("sin"),
        Key::Cos => Form::Call("cos"),
        Key::Tan => Form::Call("tan"),
        Key::Asin => Form::Call("asin"),
        Key::Acos => Form::Call("acos"),
        Key::Atan => Form::Call("atan"),
        Key::Ln => Form::Call("ln"),
        Key::Log10 => Form::Call("log"),
        Key::Sqr => Form::After("²"),
        Key::NFact => Form::After("!"),
        Key::ExpE => Form::Before("e^"),
        Key::Recip => Form::Before("1/"),
        Key::Neg => Form::Before("−"),
        _ => return None,
    })
}

/// **語の列を 1 行の字面にする。字面を作る関数はこれ 1 つ**(設計書 §4.1、条件 3)
/// ——行全体を繋ぐときも、組を 1 語に畳むときもここを呼ぶ。別々に書くと、畳むほうが
/// `^` の左の包みを忘れて `( 3 +/− xʸ 2 ) sin` を `sin(−3 ^ 2)` と書きうる。
///
/// - **空白**: 語のあいだに 1 つ。ただし `(` の後ろと `)` の前には入れない(§2.6)。
/// - **`^` の左の包み**(§2.4): 次の語が `^` で、この語が「そのほか」なら `(…)` で包む。
///   **語に焼き込まない**——押し直しで `^` が消えれば包みも消える(`3 +/− xʸ +` は
///   `−3 +`)。組は `)` の語で終わるので包まれない(`(2 + 3) ^ 2`)。
/// - **`^` と `÷` の右の包み**(§2.4、監視役の裁定 2026-10-05): 前の語が `^` か `÷` で、
///   この語が `1/x` で畳んだ語なら `(…)` で包む——`2 ^ (1/2)`・`3 ÷ (1/2)`。包まないと
///   慣例で `(2 ^ 1)/2`・`(3 ÷ 1)/2` と読める。`×`・`−`・`+`・`nPr`・`nCr` の右と、左には
///   付けない。**同じ理由で語に焼き込まない**(`3 ÷ × 2 1/x` は `3 × 1/2`)。
fn render(parts: &[Part]) -> String {
    let mut line = String::new();
    for (i, part) in parts.iter().enumerate() {
        let previous = i.checked_sub(1).and_then(|j| parts.get(j));
        let after_open = previous.is_some_and(|p| p.is("("));
        if i > 0 && !after_open && !part.is(")") {
            line.push(' ');
        }
        let before_power = parts.get(i + 1).is_some_and(|next| next.is("^"));
        let after_tight = previous.is_some_and(|p| p.is("^") || p.is("÷"));
        if (part.kind == Kind::Other && before_power) || (part.reciprocal && after_tight) {
            line.push('(');
            line.push_str(&part.text);
            line.push(')');
        } else {
            line.push_str(&part.text);
        }
    }
    line
}

/// **後置関数がかかる範囲**(設計書 §2.2): 末尾から 1 つ。範囲の始まりと種類を返す。
///
/// - 末尾が `)` → **対応する `(` まで**(深さを数える)。種類は組
/// - 末尾が値の語 → その 1 語
/// - 末尾が二項演算子・`(`・空 → **無し**(呼び出し側が画面の値を補う)
/// - 中身の無い組 `( )` は組として返す——**呼び出し側(`apply_function`)が捨てて、
///   無しと同じに扱う**(監視役の裁定 2026-10-05)
///
/// **対応する `(` が無い `)`**(DEL で `(` を消したあとの開いていない `)`。engine は
/// SyntaxError にし、web はそのあとの関数を押させない)は、その `)` 1 語を「そのほか」
/// として扱う——何も捨てず、panic しない。
fn operand(parts: &[Part]) -> Option<(usize, Kind)> {
    let last_index = parts.len().checked_sub(1)?;
    let last = &parts[last_index];
    if last.is(")") {
        let mut depth = 0usize;
        for (i, part) in parts.iter().enumerate().rev() {
            if part.is(")") {
                depth += 1;
            } else if part.is("(") {
                depth -= 1;
                if depth == 0 {
                    return Some((i, Kind::Group));
                }
            }
        }
        return Some((last_index, Kind::Other));
    }
    match last.kind {
        Kind::Mark => None,
        kind => Some((last_index, kind)),
    }
}

/// 後置関数を押した。§2.2 の範囲を `parts` から抜き、§2.3 の 1 語(そのほか)に畳んで
/// 積み直す。**範囲が無ければ、押す直前の画面の値**(`screen`。列が無ければ `…`)を
/// 1 語として積んでから畳む(§2.7)。
///
/// **畳むのは確定した語だけ**——呼び出し側は先に `commit_into` を済ませている
/// (`apply_unary` が入力中の数を確定してから関数をかけるのと同じ)。
fn apply_function(parts: &mut Vec<Part>, form: Form, screen: Option<&str>) {
    // **中身の無い組 `( )` は「綴りに値が無い」と同じ**(監視役の裁定 2026-10-05、
    // 設計書 §2.2)。engine はそのとき画面の値(0)にかけるので、`( )` を捨てて画面を書く
    // ——`( ) sin` は `sin(0)`。
    let found = match operand(parts) {
        Some((start, Kind::Group)) if parts.len() - start == 2 => {
            parts.truncate(start);
            None
        }
        found => found,
    };
    let (start, kind) = match found {
        Some(found) => found,
        None => {
            let value = screen.map_or_else(|| Part::new("…", Kind::Atom), Part::shown);
            let kind = value.kind;
            parts.push(value);
            (parts.len() - 1, kind)
        }
    };
    let range = parts.split_off(start);
    let whole = render(&range);
    // 関数の括弧の中身。**組ならその括弧を使う**(二重にしない)。
    let inside = match kind {
        Kind::Group => render(&range[1..range.len() - 1]),
        _ => whole.clone(),
    };
    // 記号を付けるときの姿。原子と組はそのまま、そのほかは包む(§2.3)。
    let wrapped = match kind {
        Kind::Atom | Kind::Group => whole,
        Kind::Other | Kind::Mark => format!("({whole})"),
    };
    let text = match form {
        Form::Call(name) => format!("{name}({inside})"),
        Form::After(mark) => format!("{wrapped}{mark}"),
        Form::Before(mark) => format!("{mark}{wrapped}"),
    };
    parts.push(Part {
        text,
        kind: Kind::Other,
        reciprocal: matches!(form, Form::Before("1/")),
    });
}

/// 綴りの語の列で、保留のいちばん上が閉じていない `(` なら、その位置。**1 つの計算の中では**
/// engine の演算子スタックの先頭が `(` であることと同じ——末尾から、閉じた組・数・後置関数・定数を
/// 飛ばし、最初に当たるのが二項演算子なら無し、閉じていない `(` ならそれ。
/// **畳んだ語(`sin(2 + 3)`)は値の語**なので、`(` とも `)` とも数えない(§4.1)。
///
/// **`=` をまたぐと同じではない。** `spell` は `=` の印を `parts` に残さない(`Key::Eq` の腕は
/// バッファを流し込むだけ)ので、`( 3 = DEL` では前の計算の `(` を消すが、engine のスタックは
/// `=` で空になっていて何も消さない(旧規則の「末尾の `(` だけ」も `( = DEL` で同じ隙間を
/// 持っていた)。web は `=` で打鍵の列を切る(`ScientificPanel.tsx` の `press`)ので、この形は
/// 履歴の綴りに届かない。
fn top_open(parts: &[Part]) -> Option<usize> {
    let mut depth = 0usize;
    for (i, part) in parts.iter().enumerate().rev() {
        if part.is(")") {
            depth += 1;
        } else if part.is("(") {
            if depth == 0 {
                return Some(i);
            }
            depth -= 1;
        } else if depth == 0 && part.is_binary() {
            return None;
        }
    }
    None
}

/// キー列を式の文字列に綴る。**画面の列を添えない形**——`spell_line(None, keys, &[])`。
///
/// 画面の値が要る場所(演算子や `(` の直後の関数)には `…` を書く(設計書 §2.7.1)。
/// 本番の経路(web)は `spell_line` に画面の列を添える。
pub fn spell(keys: &[Key]) -> String {
    spell_line(None, keys, &[])
}

/// 履歴・経歴の 1 行を綴る。
///
/// - `carry`: **行の頭に置く前の答え**(`=` のあとに続けた区間。設計書 §2.5)。
///   最初の語として積んでから歩くので、`3 =` のあとの `sin` は `sin(3)` になる。
///   原子かどうかは表示の文字列で決める(§2.1)。**綴りが空なら頭も付けない**
///   ——空の式の行は履歴に積まれない(web の `lineOf` が持っていた約束を core に移した)。
/// - `screens`: `screens[i]` は `keys[i]` を押す**直前の**画面(`display.main`)。
///   関数がかかる値が綴りに無いときだけ読む(§2.7.4)。**足りなければ `…` を書く。
///   panic しない。**
pub fn spell_line(carry: Option<&str>, keys: &[Key], screens: &[&str]) -> String {
    let head = carry.filter(|text| !text.is_empty());
    let Some(head) = head else {
        return render(&walk(Vec::new(), keys, screens));
    };
    // **「綴りが空」は前の答えを除いた区間の綴りで決める**(`lineOf` と同じ)。
    if walk(Vec::new(), keys, screens).is_empty() {
        return String::new();
    }
    render(&walk(vec![Part::shown(head)], keys, screens))
}

/// キー列を語の列にする。`parts` は最初の語(前の答え)を持って来ることがある。
///
/// **`ac` は列を空にする**(`engine/mod.rs` の `next.cleared()` と同じ
/// ——入力中のバッファも、前の答えも一緒に捨てる)。
///
/// **開く・確定する・捨てるの 3 通り**(`apply()` を読んで分けた):
/// - **開く/伸ばす**(バッファを作る・書き足す): 数字・`.`・`000`・
///   `Exp`・`j`・`°'"`(バッファが既にあるときだけ)・指数入力中の `+/−`
/// - **確定する**(バッファを `parts` へ流し込み、`None` にする):
///   二項演算子・`=`・`)`・後置関数・仮数の符号としての `+/−`
/// - **捨てる**(流し込まずに `None` にする): `(`・`π`・`e`
///   ——`open_paren`/`Key::Pi`/`Key::E` が `state.buffer = None` を
///   直接代入し、`commit_entry` を経由しない(入力途中の値を捨てる)のを
///   そのまま写した分岐である。**0.9.2 以降、web はこの捨てる経路に
///   入力途中の値を持ち込まない**——engine が数字の入力中はこれらの
///   キーを拒否するようになり(0.9.2 設計書 §3.2 S1)、`press`(web 側)は
///   拒否されたキーを engine にも列にも渡さない。この分岐が残っているのは
///   `spell` が公開関数で、任意のキー列を渡す呼び出し元(テストなど)には
///   拒否が掛からないため。
///
/// **`del` は `Buffer::backspace` を呼ぶ**(`delete_one` と同じ)。
/// バッファが無ければ、**保留のいちばん上の、閉じていない `(`** を消す
/// (`delete_one` が演算子スタックの先頭の `(` を抜くのと同じ `(`)——
/// **その `(` のあとに値があっても消す**(`2 × ( π DEL + 1` は
/// 「2 × π + 1」。閉じた組の直後の DEL は先に下の 0 段目が `)` を取り消す)。演算子は消えず、
/// 演算子が保留されていれば何も消さない(`3 + ( 4 ) DEL` は「3 + (4)」のまま)。
/// 以前は末尾の `(` しか消さず、値の下の `(` が綴りに残って履歴の式が答えを
/// 生まなかった(0.9.2 設計書 §10 の既知の穴。利用者の裁定 2026-09-16、同 §9 の 12
/// ——綴りを engine に合わせ、engine は変えない)。**畳んだ関数は取り消せない**
/// (engine の DEL も手元の値に何もしない)。
///
/// どの分岐も空の列に来ては何も起きない(**panic しない**)。
fn walk(mut parts: Vec<Part>, keys: &[Key], screens: &[&str]) -> Vec<Part> {
    let mut current: Option<Buffer> = None;
    // 押し直しの判定に使う: 直前に積んだ語が二項演算子で、そのあと `=` で計算が閉じて
    // いないか。`=` は綴りに何も足さないので、語の並びだけでは「閉じた」ことが見えない
    // ——`3 + = × 5` の `+` は訂正の対象ではない(engine の `finish` が演算子を使い切っている)。
    let mut open_operator = false;
    // **`)` を押す直前の綴り**(0.9.3 設計書 §4.2)。`)` がするのは「打ちかけの数を
    // 流し込んで `)` を足す」ことだけなので、**控えるのは語の本数と打ちかけの数**で足りる
    // ——DEL はそこまで切り詰めて数を戻せば、`)` を押す前に戻る。
    // **engine の `closed_groups` と同じ形**である(綴りは engine の写しであり、
    // 独立な実装ではない——独立に書き下すのは `engine_values.rs` の評価器のほう)。
    // **`open_operator` も控える。** engine が `operator_pending` を戻すのと同じ理由で、
    // ここを戻さないと**押し直しの訂正が効かなくなる**——`33 × ( × ) DEL ×` の綴りが
    // 「33 × ( × ×」と演算子 2 つになった(2026-09-17 に実際に落ちた)。
    // **関数で畳むと `parts` は縮む**が、後置関数は下の後判定でこの控えを空にするので、
    // 畳んだあとに古い長さへ切り詰めることは起きない(設計書 §4.1。spell_table の
    // `( 2 + 3 ) sin DEL` が固定する)。
    let mut closed: Vec<(usize, Option<Buffer>, bool)> = Vec::new();

    for (i, &key) in keys.iter().enumerate() {
        let screen = screens.get(i).copied();
        match key {
            Key::Ac => {
                parts.clear();
                current = None;
                open_operator = false;
            }
            Key::Del => {
                // `delete_one`(engine/mod.rs)をそのまま辿る。バッファが無ければ、
                // engine が演算子スタックの先頭から抜く `(` を綴りからも抜く——末尾の語で
                // なくてもよい(値や閉じた組の下の `(`。利用者の裁定 2026-09-16、0.9.2 設計書
                // §10・§9 の 12)。`open_operator` には触らない: 押し直しは末尾の語が演算子の
                // ときにしか効かない。`(` の後ろに値や閉じた組があれば、消したあとも末尾はその
                // 値か `)` のままなので押し直しにならない(engine でも値のあとの演算子は訂正では
                // ない)。末尾の `(` を消せば、その前の演算子と真偽がそのまま戻る(`(` を消した
                // 直後の演算子は訂正。spell_table の `3 × ( DEL + 4` →「3 + 4」)。
                if let Some((len, buffer, was_open)) = closed.pop() {
                    // **0 段目: 閉じた組を開き直す**(0.9.3 設計書 §4.2)。控えた長さまで
                    // 切り詰め、打ちかけの数を戻す。**連鎖はここから出る**——`)` ごとに
                    // 1 つ控えてあるので、`DEL` を続ければ 1 つずつ戻る。
                    parts.truncate(len);
                    current = buffer;
                    open_operator = was_open;
                } else if let Some(buffer) = current.as_mut() {
                    if buffer.backspace() == Backspace::Exhausted {
                        current = None;
                    }
                } else if let Some(i) = top_open(&parts) {
                    parts.remove(i);
                }
            }
            Key::Digit(d) => {
                // 範囲外の桁は `push_digit` 自身が捨てる(panic しない)。
                current.get_or_insert_with(Buffer::default).push_digit(d);
            }
            Key::Dot => {
                // 2 つ目の `.` は `SyntaxError` になるが、綴りはエラー状態を
                // 持たない——engine 側だけが状態を止める。
                let _ = current.get_or_insert_with(Buffer::default).push_dot();
            }
            Key::Zeros3 => {
                current.get_or_insert_with(Buffer::default).push_zeros();
            }
            Key::Exp => {
                current.get_or_insert_with(Buffer::default).push_exponent();
            }
            Key::J => {
                // 数字があれば実部⇄虚部の切り替え、無ければ新しい虚部入力
                // (設計書 §1)。`apply()` の `Key::J` と同じ 2 段の借用。
                let toggles = current.as_ref().is_some_and(Buffer::has_digits);
                if toggles {
                    if let Some(buffer) = current.as_mut() {
                        buffer.toggle_imaginary();
                    }
                } else {
                    current = Some(Buffer::imaginary());
                }
            }
            Key::Dms => {
                // バッファが無ければ表示トグル(値に触れない、無音)。
                let _ = current
                    .as_mut()
                    .is_some_and(Buffer::try_push_sexagesimal_separator);
            }
            Key::Neg => {
                // `+/−` は 2 つの階層で働く(設計書 §2)。指数入力中は
                // 指数の符号——`text()` が `e-` を出すので綴りの数の中に現れる。
                // そうでなければ確定値の符号で、`Buffer` は関与しない
                // (`apply_unary` が掛ける)ので、確定した語に `−` を付けて畳む。
                let signed_exponent = current.as_mut().is_some_and(Buffer::toggle_exponent_sign);
                if !signed_exponent {
                    commit_into(&mut current, &mut parts);
                    if let Some(form) = function_form(key) {
                        apply_function(&mut parts, form, screen);
                    }
                }
            }
            Key::LParen => {
                // 入力途中の値を捨てる(`open_paren` と同じ)。0.9.2 以降、
                // web はここに入力途中の値を持ち込まない——engine が
                // 数字の入力中はこのキーを拒否し、`press` は拒否された
                // キーを渡さない。`spell` 自身は公開関数で拒否を知らない
                // ので、分岐は残す(上の註参照)。
                current = None;
                parts.push(Part::mark("("));
            }
            Key::Pi => {
                current = None;
                parts.push(Part::new("π", Kind::Atom));
            }
            Key::E => {
                current = None;
                parts.push(Part::new("e", Kind::Atom));
            }
            Key::AngleToggle | Key::EngToggle | Key::PolarToggle => {
                // 表示だけを変える。バッファにも `parts` にも触れない。
            }
            Key::Eq => {
                commit_into(&mut current, &mut parts);
                open_operator = false;
            }
            _ => {
                // 二項演算子・`)`・後置関数。
                // **`)` は戻り先を控えてから流し込む**(0.9.3 設計書 §4.2)。
                if key == Key::RParen {
                    closed.push((parts.len(), current.clone(), open_operator));
                }
                commit_into(&mut current, &mut parts);
                if let Some(form) = function_form(key) {
                    apply_function(&mut parts, form, screen);
                } else {
                    // 演算子の直後の演算子は訂正(engine の `push_binop`)。綴りも最後の 1 つ
                    // だけを残す(0.9.2 設計書 §9 の 9)。バッファがあれば上の行が数を流し込む
                    // ので、ここで末尾が演算子なのは「演算子の直後から動いていない」ときだけ。
                    // `=` は綴りに何も足さないので、`open_operator` フラグで「演算子がまだ開いて
                    // いる」かどうかを判定する(engine の `finish` が演算子を消費したかどうか)。
                    if is_binary(key) && open_operator && parts.last().is_some_and(Part::is_binary)
                    {
                        parts.pop();
                    }
                    if let Some(text) = commit_glyph(key) {
                        parts.push(Part::mark(text));
                    }
                }
                // 後置関数と `)` は二項ではないので、フラグを false にする。
                open_operator = is_binary(key);
            }
        }
        // **積みは `)` で伸び、DEL で縮む。保つのは DEL と表示トグルだけ**
        // (0.9.3 設計書 §4.2.1)——だから遡れるのは「連続して閉じた `)`」の範囲だけ。
        // **engine の `reduce` の後判定と同じ条件を、同じ順で書く。**
        if !matches!(
            key,
            Key::RParen
                | Key::Del
                | Key::AngleToggle
                | Key::PolarToggle
                | Key::EngToggle
                | Key::Dms
        ) {
            closed.clear();
        }
    }
    commit_into(&mut current, &mut parts);
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plain_number_is_digits_optionally_grouped_by_three() {
        // 設計書 §2.1 の 2 つの形: `^[0-9]+(\.[0-9]+)?$` と `^[0-9]{1,3}(,[0-9]{3})*(\.[0-9]+)?$`。
        for text in ["3", "0.5", "3,333", "1,234,000.5"] {
            assert!(is_plain_number(text), "{text} は原子");
        }
        for text in [
            "1e20", "12,34", "1.", ".5", "-3", "1,2345", "", ",333", "3,333,",
        ] {
            assert!(!is_plain_number(text), "{text} は原子ではない");
        }
    }

    #[test]
    fn the_binary_glyphs_are_the_ones_commit_glyph_writes() {
        // `BINARY_GLYPHS` は `commit_glyph` の二項演算子の字面と同じでなければならない
        // ——片方だけ変えると押し直しの判定が黙って外れる。
        let binary: Vec<Key> = Key::ALL.iter().copied().filter(|&k| is_binary(k)).collect();
        assert_eq!(binary.len(), BINARY_GLYPHS.len());
        for key in binary {
            let glyph = commit_glyph(key).unwrap();
            assert!(BINARY_GLYPHS.contains(&glyph), "{key:?} → {glyph}");
        }
    }
}

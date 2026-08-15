//! 式の字句解析と再帰下降(設計書 §8)。
//!
//! ```text
//! 式   := 項 (("+" | "-") 項)*
//! 項   := 因子 (("*" | "/") 因子)*
//! 因子 := 数 | "(" 式 ")"
//! 数   := (数字列 単位)* 数字列?        -- 少なくとも 1 つは要る
//! ```
//!
//! **優先順位あり・括弧あり**(Scientific と同じ規則。同じアプリの中で 2 つの
//! 規則が共存しない)。**単位は数リテラルの後置修飾**で、下る向きにしか
//! 置けない——`1億6000万` は 1 つの数、`1万億` は文法違反である。

use super::UnitSet;
use super::rational::Rational;
use crate::{CalcError, CalcResult};

#[derive(Debug, Clone, PartialEq, Eq)]
enum Token {
    /// 数字列。年利では小数点を含む。
    Number(String),
    Unit(char),
    Plus,
    Minus,
    Star,
    Slash,
    Open,
    Close,
}

fn tokenize(text: &str, units: &[(char, u128)]) -> CalcResult<Vec<Token>> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut at = 0;
    while at < chars.len() {
        let c = chars[at];
        if c.is_ascii_digit() {
            let start = at;
            while at < chars.len() && chars[at].is_ascii_digit() {
                at += 1;
            }
            // 小数点は数字列の一部として拾う(年利だけが使う)。
            if at < chars.len() && chars[at] == '.' {
                at += 1;
                while at < chars.len() && chars[at].is_ascii_digit() {
                    at += 1;
                }
            }
            tokens.push(Token::Number(chars[start..at].iter().collect()));
            continue;
        }
        let token = match c {
            '+' => Token::Plus,
            '-' => Token::Minus,
            '*' => Token::Star,
            '/' => Token::Slash,
            '(' => Token::Open,
            ')' => Token::Close,
            // **綴りはワイヤ契約。** 表に無い文字は SyntaxError であって、
            // 黙って無視しない。
            _ if units.iter().any(|(label, _)| *label == c) => Token::Unit(c),
            _ => return Err(CalcError::SyntaxError),
        };
        tokens.push(token);
        at += 1;
    }
    Ok(tokens)
}

struct Parser<'a> {
    tokens: Vec<Token>,
    at: usize,
    units: &'a [(char, u128)],
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.at)
    }

    fn take(&mut self) -> CalcResult<Token> {
        let token = self
            .tokens
            .get(self.at)
            .cloned()
            .ok_or(CalcError::SyntaxError)?;
        self.at += 1;
        Ok(token)
    }

    fn expression(&mut self) -> CalcResult<Rational> {
        let mut value = self.term()?;
        while matches!(self.peek(), Some(Token::Plus) | Some(Token::Minus)) {
            let operator = self.take()?;
            let right = self.term()?;
            value = if operator == Token::Plus {
                value.checked_add(right)?
            } else {
                value.checked_sub(right)?
            };
        }
        Ok(value)
    }

    fn term(&mut self) -> CalcResult<Rational> {
        let mut value = self.factor()?;
        while matches!(self.peek(), Some(Token::Star) | Some(Token::Slash)) {
            let operator = self.take()?;
            let right = self.factor()?;
            value = if operator == Token::Star {
                value.checked_mul(right)?
            } else {
                value.checked_div(right)?
            };
        }
        Ok(value)
    }

    fn factor(&mut self) -> CalcResult<Rational> {
        match self.take()? {
            Token::Open => {
                let value = self.expression()?;
                if self.take()? != Token::Close {
                    return Err(CalcError::SyntaxError);
                }
                Ok(value)
            }
            Token::Number(digits) => self.number(digits),
            _ => Err(CalcError::SyntaxError),
        }
    }

    /// 数リテラル。単位は後置修飾で、**下る向きにしか置けない**。
    fn number(&mut self, first: String) -> CalcResult<Rational> {
        let mut total = Rational::from_i128(0)?;
        let mut digits = first;
        let mut last_rank: isize = -1;
        while let Some(Token::Unit(label)) = self.peek().cloned() {
            let rank = self
                .units
                .iter()
                .position(|(l, _)| *l == label)
                .ok_or(CalcError::SyntaxError)? as isize;
            if rank <= last_rank {
                return Err(CalcError::SyntaxError); // 同じか昇る向き
            }
            last_rank = rank;
            self.at += 1;
            let scale = self.units[rank as usize].1;
            let scale = i128::try_from(scale).map_err(|_| CalcError::Overflow)?;
            let piece = literal(&digits)?.checked_mul(Rational::from_i128(scale)?)?;
            total = total.checked_add(piece)?;
            match self.peek() {
                Some(Token::Number(next)) => {
                    digits = next.clone();
                    self.at += 1;
                }
                _ => return Ok(total),
            }
        }
        total.checked_add(literal(&digits)?)
    }
}

/// 数字列(小数を含みうる)を分数にする。
fn literal(text: &str) -> CalcResult<Rational> {
    if text.is_empty() {
        return Err(CalcError::SyntaxError);
    }
    let (integer, fraction) = match text.split_once('.') {
        Some((left, right)) => (left, right),
        None => (text, ""),
    };
    if integer.is_empty() && fraction.is_empty() {
        return Err(CalcError::SyntaxError);
    }
    let scale = 10i128
        .checked_pow(fraction.len() as u32)
        .ok_or(CalcError::Overflow)?;
    let digits: String = format!("{integer}{fraction}");
    let numerator: i128 = digits.parse().map_err(|_| CalcError::Overflow)?;
    Rational::from_ratio(numerator, scale)
}

pub fn evaluate(text: &str, units: UnitSet) -> CalcResult<Rational> {
    if text.is_empty() {
        return Err(CalcError::SyntaxError);
    }
    let table = units.units();
    let mut parser = Parser {
        tokens: tokenize(text, &table)?,
        at: 0,
        units: &table,
    };
    let value = parser.expression()?;
    if parser.peek().is_some() {
        return Err(CalcError::SyntaxError); // 食べ残し
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn yen(text: &str) -> CalcResult<u128> {
        evaluate(text, UnitSet::Yen)?.floor_to_u128()
    }

    #[test]
    fn precedence_and_parentheses() {
        assert_eq!(yen("3000+500*2").unwrap(), 4000);
        assert_eq!(yen("(3000+500)*2").unwrap(), 7000);
        assert_eq!(yen("100-30-20").unwrap(), 50); // 左結合
    }

    #[test]
    fn units_are_a_postfix_on_the_literal() {
        assert_eq!(yen("3000万*2").unwrap(), 60_000_000);
        assert_eq!(yen("100万+50万").unwrap(), 1_500_000);
        assert_eq!(yen("1億6000万-500万").unwrap(), 155_000_000);
        assert_eq!(yen("1億6000万").unwrap(), 160_000_000);
    }

    #[test]
    fn units_only_step_down() {
        assert_eq!(yen("1万億"), Err(CalcError::SyntaxError));
        assert_eq!(yen("1万2万"), Err(CalcError::SyntaxError));
    }

    #[test]
    fn an_unknown_spelling_is_a_syntax_error() {
        // 綴りはワイヤ契約。ずれても黙って誤答にはならない。
        assert_eq!(yen("3000萬"), Err(CalcError::SyntaxError));
        assert_eq!(
            evaluate("3000万", UnitSet::Count),
            Err(CalcError::SyntaxError)
        );
    }

    #[test]
    fn the_period_length_reaches_the_parser() {
        let months = |t: &str| {
            evaluate(t, UnitSet::Months)
                .unwrap()
                .floor_to_u128()
                .unwrap()
        };
        assert_eq!(months("35年"), 420);
        assert_eq!(months("3年6"), 42);
        assert_eq!(months("3年6月"), 42);
        let periods = |t: &str, n: u32| {
            evaluate(t, UnitSet::Periods(n))
                .unwrap()
                .floor_to_u128()
                .unwrap()
        };
        assert_eq!(
            (periods("10年", 12), periods("10年", 2), periods("10年", 1)),
            (120, 20, 10)
        );
    }

    #[test]
    fn the_syntax_table() {
        for text in ["3000+", "(3000+500", "", "3000)", "+3000", "3000**2"] {
            assert_eq!(yen(text), Err(CalcError::SyntaxError), "{text}");
        }
    }

    #[test]
    fn zero_division_and_overflow_travel_up() {
        assert_eq!(yen("100/0"), Err(CalcError::DivisionByZero));
        let huge = i128::MAX.to_string();
        assert_eq!(
            evaluate(&format!("{huge}*2/2"), UnitSet::Count),
            Err(CalcError::Overflow)
        );
    }
}

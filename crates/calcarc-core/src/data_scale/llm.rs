//! LLM のメモリ見積り(S-0 設計書 §3.2〜§3.4)。
//!
//! **内部はすべてビットで持ち、表示の直前にバイトへ切り上げる**(§3.1)。
//! バイト数は Exact Integer で、u128 の checked 演算で持つ。あふれは
//! 黙って折り返さず Overflow(§3.6)。**実行時メモリの推定はしない**——
//! 一時バッファもアロケータの挙動も、モデルの諸元からは決まらない(§8)。

use crate::{CalcError, CalcResult};

/// 重みと KV の精度。
///
/// **ビット幅は定義値である**(IEEE 754 の binary32 / binary16、bfloat16 の
/// 16 bit、整数型のビット幅)。INT4 は 4 bit = 0.5 byte の理論値で、GGUF 等の
/// 実ファイルとは一致しない——scale・zero point・メタデータ・アラインメントが
/// 載るためである(§3.2)。
///
/// **重みと KV で同じ型を使う。** 盤面が KV に出す候補は 4 つだが(§4.3)、
/// コアで 4 つに絞ると根拠のない定義域が計算層に生まれる。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Precision {
    Fp32,
    Fp16,
    Bf16,
    Int8,
    Int4,
}

impl Precision {
    /// 境界(WASM / JS)とテストが参照する全体。
    pub const ALL: [Precision; 5] = [
        Precision::Fp32,
        Precision::Fp16,
        Precision::Bf16,
        Precision::Int8,
        Precision::Int4,
    ];

    /// 境界で使う文字列トークンから復元する。未知のトークンは None。
    pub fn from_token(token: &str) -> Option<Precision> {
        Some(match token {
            "fp32" => Precision::Fp32,
            "fp16" => Precision::Fp16,
            "bf16" => Precision::Bf16,
            "int8" => Precision::Int8,
            "int4" => Precision::Int4,
            _ => return None,
        })
    }

    /// 境界へ渡す文字列トークン。`from_token` の逆写像。
    pub fn token(self) -> &'static str {
        match self {
            Precision::Fp32 => "fp32",
            Precision::Fp16 => "fp16",
            Precision::Bf16 => "bf16",
            Precision::Int8 => "int8",
            Precision::Int4 => "int4",
        }
    }

    /// 要素 1 つのビット数。
    pub fn bits(self) -> u128 {
        match self {
            Precision::Fp32 => 32,
            Precision::Fp16 | Precision::Bf16 => 16,
            Precision::Int8 => 8,
            Precision::Int4 => 4,
        }
    }
}

/// 1 回の見積り。**重みと KV は別々に切り上げてから足す**(§3.4)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LlmMemory {
    pub weight_bytes: u128,
    pub kv_bytes: u128,
    pub total_bytes: u128,
}

fn mul(a: u128, b: u128) -> CalcResult<u128> {
    a.checked_mul(b).ok_or(CalcError::Overflow)
}

/// 重み ＋ KV cache。バッチサイズは 1 で固定する(§3.3、§8)。
///
/// `kv_heads` は **KV ヘッド数**であって、アテンションヘッド数ではない
/// ——GQA のモデルでは 32 → 8 のように減っており、取り違えると 4 倍ずれる。
pub fn memory(
    parameters: u128,
    weight: Precision,
    layers: u128,
    kv_heads: u128,
    head_dim: u128,
    context_length: u128,
    kv: Precision,
) -> CalcResult<LlmMemory> {
    let weight_bits = mul(parameters, weight.bits())?;
    // 並びは §3.3 のとおり。**左から順に checked_mul する**——あふれた後に
    // 0 が来ても救わないのが契約である(§3.6)。
    let mut kv_bits = 2u128;
    for factor in [layers, context_length, kv_heads, head_dim, kv.bits()] {
        kv_bits = mul(kv_bits, factor)?;
    }
    // **切り上げる**——4 bit の重みが 1 個だけあるとき「0 バイト」と
    // 言わないためである(§3.1)。KV 側は常に 8 の倍数なので、この
    // 切り上げは**重み側でしか発火しない**(§3.1 が実測で書いている)。
    let weight_bytes = weight_bits.div_ceil(8);
    let kv_bytes = kv_bits.div_ceil(8);
    // **この枝は到達しない。** どちらも ceil(u128::MAX / 8) = 2^125 以下
    // なので、和は 2^126 で頭打ちになる。それでも checked_add で書く
    // ——「到達不能だから素の +」は、証明が崩れた日に panic になる。
    let total_bytes = weight_bytes
        .checked_add(kv_bytes)
        .ok_or(CalcError::Overflow)?;
    Ok(LlmMemory {
        weight_bytes,
        kv_bytes,
        total_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_headline_case() {
        // 27B INT4 / 62 層 / KV 16 ヘッド / ヘッド次元 128 / 文脈長 8192 / KV FP16(§5)
        let m = memory(
            27_000_000_000,
            Precision::Int4,
            62,
            16,
            128,
            8192,
            Precision::Fp16,
        )
        .expect("headline case");
        assert_eq!(m.weight_bytes, 13_500_000_000);
        assert_eq!(m.kv_bytes, 4_160_749_568);
        assert_eq!(m.total_bytes, 17_660_749_568);
        assert_eq!(m.weight_bytes + m.kv_bytes, m.total_bytes);
    }

    #[test]
    fn kv_heads_is_not_the_attention_head_count() {
        // GQA: 32 → 8。取り違えるとちょうど 4 倍になる(§3.3)。
        let grouped = memory(
            8_000_000_000,
            Precision::Int8,
            32,
            8,
            128,
            4096,
            Precision::Fp16,
        )
        .expect("gqa");
        let mistaken = memory(
            8_000_000_000,
            Precision::Int8,
            32,
            32,
            128,
            4096,
            Precision::Fp16,
        )
        .expect("mha");
        assert_eq!(grouped.kv_bytes, 536_870_912);
        assert_eq!(mistaken.kv_bytes, grouped.kv_bytes * 4);
    }

    #[test]
    fn a_single_int4_parameter_is_one_byte_not_zero() {
        // 切り上げ(§3.1)。**重み側にしか無い端である。**
        let m = memory(1, Precision::Int4, 1, 8, 128, 0, Precision::Fp16).expect("edge");
        assert_eq!((m.weight_bytes, m.kv_bytes, m.total_bytes), (1, 0, 1));
    }

    #[test]
    fn the_kv_side_never_needs_the_ceiling() {
        // §3.1 の主張そのもの: kv_bits は常に 8 の倍数。5 つの精度で確かめる。
        for kv in Precision::ALL {
            let m = memory(1, Precision::Int8, 3, 5, 7, 11, kv).expect("kv");
            assert_eq!(
                m.kv_bytes * 8,
                2 * 3 * 11 * 5 * 7 * kv.bits(),
                "{kv:?} left a remainder"
            );
        }
    }

    #[test]
    fn every_precision_has_its_width() {
        let expect: [(Precision, u128); 5] = [
            (Precision::Fp32, 32),
            (Precision::Fp16, 16),
            (Precision::Bf16, 16),
            (Precision::Int8, 8),
            (Precision::Int4, 4),
        ];
        for (p, bits) in expect {
            assert_eq!(p.bits(), bits, "{p:?}");
        }
    }

    #[test]
    fn tokens_round_trip() {
        for p in Precision::ALL {
            assert_eq!(Precision::from_token(p.token()), Some(p), "{p:?}");
        }
        assert_eq!(Precision::from_token("fp8"), None);
        assert_eq!(Precision::from_token(""), None);
    }

    #[test]
    fn overflow_is_an_error_not_a_wrap() {
        let big = 1u128 << 127;
        assert_eq!(
            memory(big, Precision::Fp32, 1, 1, 1, 0, Precision::Fp16),
            Err(CalcError::Overflow)
        );
        // **順序が効く。** 2 × layers であふれた時点で終わり、後ろの 0 は救わない。
        assert_eq!(
            memory(1, Precision::Int8, big, 1, 1, 0, Precision::Fp16),
            Err(CalcError::Overflow)
        );
    }

    #[test]
    fn zero_context_is_a_valid_input() {
        let m = memory(1_000_000, Precision::Fp16, 10, 8, 64, 0, Precision::Fp16).expect("zero");
        assert_eq!(m.kv_bytes, 0);
        assert_eq!(m.total_bytes, m.weight_bytes);
    }
}

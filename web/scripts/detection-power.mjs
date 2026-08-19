#!/usr/bin/env node
/**
 * **このコーパスは壊れたものを赤くできるのか、を測る。**
 *
 * 「不一致 0 件」は、それだけでは「見つからなかった」しか言っていない。
 * 外の読み手が知りたいのは「**見つけられるのか**」である。そこで engine に
 * 既知の壊れ方を一時的に入れ、何件が赤くなるかを数える。
 *
 * **期待も一緒に書く。** 捕まるはずの変異が捕まらなければ失敗だが、
 * **捕まらないはずの変異が捕まっても失敗である**——レポートが
 * 「この領域は踏んでいない」と書いているなら、その主張が嘘だったことになる。
 *
 * 変異はコミットしない。各回のあとに原文へ戻し、バイト単位で一致を確かめる。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WEB = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = dirname(WEB);
const OUT = join(WEB, "detection-power.json");
const RUN_JSON = join(WEB, "heavy-run.json");

/**
 * **この走行に居るべきシャードの集計名。定数で持つ。**
 *
 * `heavy-run.json` の `expected` は、走行が `corpus/generated/` を読んで
 * その場で導いたものである。それと突き合わせても**シャードのファイルが
 * 1 枚消えた走行は捕まらない**——`expected` も一緒に縮むからで、
 * 「14 枚しか読んでいない走行が完全一致を語る」という、この検査が塞ぐはずの
 * 穴がそのまま開く(設計書 §4.4)。
 *
 * 枚数だけを assert しても足りない。1 枚消えて 1 枚増えた走行が緑で通り、
 * 壊れたときに何が消えたのかを言えない。**名前で持つ。**
 *
 * 正当に 16 枚目を足す日には、ここの更新が意識的な 1 行になる。それが
 * この定数の狙いである。
 */
export const ALL_SHARDS = [
  "angle-mode-000.json (values)",
  "cancellation-000.json (values)",
  "combinatorics-000.json (values)",
  "complex-000.json (values)",
  "elementary-000.json (values)",
  "inverse-trig-000.json (values)",
  "precedence-000.json (values)",
  "scientific-000.json (values)",
  "typed-000.json (values)",
  "corrections-000.json (equivalences)",
  "equivalence-000.json (equivalences)",
  "data-scale-000.json (calls)",
  "finance-000.json (calls)",
  "complex-display-000.json (displays)",
  "display-000.json (displays)",
];

/**
 * 壊し方の一覧。
 *
 * `expectShards` は「どのシャードが赤くなるはずか」を名前で列挙したもの。
 * `[]` は**どこも赤くならないはず**という主張で、それはレポートの
 * 「この領域は踏んでいない」と同じことを言っている。
 *
 * `minRate` は `expectShards` に挙げたシャードごとの下限率(不一致件数 /
 * そのシャードの総件数)。率で持つのは、コーパスが増えても表を書き換えず
 * 済むようにするため——2000 件で 200、4000 件で 400 なら同じ 10% である。
 * 挙げていないシャードは下限 0(=反応しないはず)を意味する。
 *
 * 値は 2026-08-19（Task 7）に `pnpm heavy:power` を実走して確定した。
 * 反応件数は 2026-08-17 の走行（設計書 §4.6）と 1 件も違わなかった——
 * コーパスも変異の効き方もその後動いていないということ。記録は
 * `docs/corpus-measurements.md` の「実測から `minRate` を確定する」節。
 */
export const MUTATIONS = [
  {
    id: "display-digits",
    what: "表示の有効桁数を 10 から 9 に減らす",
    file: "crates/calcarc-core/src/numeric/format.rs",
    from: "pub const DISPLAY_DIGITS: usize = 10;",
    to: "pub const DISPLAY_DIGITS: usize = 9;",
    // **値シャードすべて、ではない。** 値シャードは 9 枚あり、反応するのは
    // 8 枚。`cancellation-000.json` だけが反応しない。名前ではなく実測で書く。
    //
    // 理由は測って分かった。このシャードだけ `tolerance.rel` が 1e-6 で、
    // 他の 8 枚は 5e-10 である。比較は表示文字列を読み直して相対誤差で行う
    // (`classifyComplex`。期待値が厳密に 0 のときだけ abs を見るが、この
    // シャードに期待値 0 のケースは 1 件も無い)。有効桁を 10 から 9 に落として
    // 生じる相対誤差は半 ulp——5e-9 以下——なので、1e-6 の閾値を**跨ぎようが
    // ない**。余裕も測ってある: このシャードの実測最大相対誤差は 7.67e-7 で、
    // 閾値までの余裕 2.33e-7 は摂動の上限 5.5e-9 の約 42 倍。たまたま反応
    // しなかったのではない。詳細は設計書 §4.6 追記と
    // `docs/corpus-measurements.md`。
    expectShards: [
      "angle-mode-000.json (values)",
      "combinatorics-000.json (values)",
      "complex-000.json (values)",
      "elementary-000.json (values)",
      "inverse-trig-000.json (values)",
      "precedence-000.json (values)",
      "scientific-000.json (values)",
      "typed-000.json (values)",
      "complex-display-000.json (displays)",
      "display-000.json (displays)",
    ],
    minRate: {
      "angle-mode-000.json (values)": 0.254,
      "combinatorics-000.json (values)": 0.296,
      "complex-000.json (values)": 0.095,
      "elementary-000.json (values)": 0.302,
      "inverse-trig-000.json (values)": 0.183,
      "precedence-000.json (values)": 0.244,
      "scientific-000.json (values)": 0.199,
      "typed-000.json (values)": 0.222,
      "complex-display-000.json (displays)": 0.083,
      "display-000.json (displays)": 0.103,
    },
  },
  {
    id: "precedence-collapse",
    what: "× ÷ の優先順位を + − と同じに落とす",
    file: "crates/calcarc-core/src/engine/state.rs",
    from: "BinOp::Mul | BinOp::Div => 2,",
    to: "BinOp::Mul | BinOp::Div => 1,",
    // **括弧を省いたシャードだけが反応するはず。** 全括弧のシャードは
    // 括弧が構造を決めるので、優先順位が変わっても答えが変わらない。
    expectShards: ["precedence-000.json (values)"],
    minRate: { "precedence-000.json (values)": 0.274 },
  },
  {
    id: "associativity-flip",
    what: "同順位の畳み込みの向きを反転する",
    file: "crates/calcarc-core/src/engine/mod.rs",
    from: "|| (top.precedence() == op.precedence() && !op.is_right_associative())",
    to: "|| (top.precedence() == op.precedence() && op.is_right_associative())",
    // **どこも赤くならないはず。** レポートが「結合方向は踏んでいない」と
    // 書いており、これはその主張そのものである。赤くなったらレポートが嘘。
    expectShards: [],
    minRate: {},
  },
  {
    id: "ncr-multiply-first",
    what: "nCr を「掛けてから割る」順に変える(答は収まるのに途中で溢れる)",
    file: "crates/calcarc-core/src/scientific/mod.rs",
    from: "acc = acc / (i + 1.0) * (n - i);",
    to: "acc = acc * (n - i) / (i + 1.0);",
    // 中心二項係数の帯だけ。答は f64 に収まるのに途中で溢れる。
    expectShards: ["combinatorics-000.json (values)"],
    minRate: { "combinatorics-000.json (values)": 0.0025 },
  },
  {
    id: "eng-exponent-toward-zero",
    what: "工学表記の指数を 0 方向に丸める(`div_euclid` を `/` に戻す)",
    file: "crates/calcarc-core/src/numeric/format.rs",
    from: "let eng_exponent = exponent.div_euclid(3) * 3;",
    to: "let eng_exponent = (exponent / 3) * 3;",
    // **1 未満の値だけが壊れる。** `-1 / 3` は Rust で `0` なので
    // `0.5` が `500e-3` ではなく `0.5` と出る。正の指数は影響を受けない。
    // 値は 1 ビットも変わらないので、**表示のシャード以外は何も気づかない**
    // ——それがこの段階を足した理由そのものである。
    expectShards: ["display-000.json (displays)"],
    minRate: { "display-000.json (displays)": 0.024 },
  },
  {
    id: "sexagesimal-no-carry",
    what: "60 進の秒の繰り上がりを止める",
    file: "crates/calcarc-core/src/numeric/format.rs",
    from: "if text.parse::<f64>().unwrap_or(0.0) >= 60.0 {",
    to: "if text.parse::<f64>().unwrap_or(0.0) >= 600.0 {",
    // 桁を 1 つ間違えた形。秒は丸めても 60 を超えないので、繰り上がりが
    // **一度も起きなくなる**——`59'60\"` と出る。
    // これも値は変わらないので、表示のシャードにしか見えない。
    expectShards: ["display-000.json (displays)"],
    minRate: { "display-000.json (displays)": 0.0025 },
  },
  {
    id: "complex-multiply-sign",
    what: "複素数の乗算の実部の符号を反転する(i² = +1 にしてしまう)",
    file: "crates/calcarc-core/src/value.rs",
    from: "self.re * rhs.re - self.im * rhs.im,",
    to: "self.re * rhs.re + self.im * rhs.im,",
    // **実数には一切影響しない。** 虚部が両方 0 なら `- 0` も `+ 0` も同じで、
    // 既存 11 シャード 26000 件は 1 件も気づかない。複素数の乗算・除算・
    // 2 乗だけが変わる(`(j2)^2` が `-4` ではなく `4` になる)。
    expectShards: ["complex-000.json (values)"],
    minRate: { "complex-000.json (values)": 0.036 },
  },
  {
    id: "polar-angle-flipped",
    what: "極形式の偏角の引数を入れ替える(atan2(re, im) にする)",
    file: "crates/calcarc-core/src/polar.rs",
    from: "theta_rad: self.im.atan2(self.re),",
    to: "theta_rad: self.re.atan2(self.im),",
    // **半径は変わらない。** 角度だけが余角になる(53.13 が 36.87 に)。
    // `▸∠` を押した表示しか見ない欠陥で、直交形式の表示も値も動かない。
    expectShards: ["complex-display-000.json (displays)"],
    minRate: { "complex-display-000.json (displays)": 0.165 },
  },

  // **ここから Finance 用の 10 種(設計書 §5)。**
  //
  // すべて `expectShards` は `finance-000.json (calls)` の 1 枚だけである
  // ——Finance は整数の厳密一致なので、値が 1 ビットでもずれれば必ず
  // 不一致として出る。他の 14 枚は Finance のコードを一切通らないので、
  // 反応したらそれ自体が「Finance の変更が漏れている」という報告になる。
  //
  // **変異は Rust の finance を意図的に壊す。** この走行中に
  // `cargo test --workspace` を回すと当然赤くなる——`detection-power` は
  // wasm ビルドと heavy しか回さないので、それとは無関係である。
  {
    id: "loan-interest-round-not-floor",
    what: "毎期利息を切り捨てから四捨五入へ変える",
    file: "crates/calcarc-core/src/finance/loan/rate.rs",
    from: "let interest = product / self.denominator as u128;",
    to: "let interest = (product + self.denominator as u128 / 2) / self.denominator as u128;",
    // ローンの各行・複利の各期の両方がここを通る(`interest_floor` は
    // `monthly_interest_floor` の別名)。四捨五入で 1 円上がる期が
    // 1 つでもあれば、その口座の以後の残高がすべてずれる。
    expectShards: ["finance-000.json (calls)"],
    minRate: { "finance-000.json (calls)": 0.386 },
  },
  {
    id: "loan-interest-as-f64",
    what: "整数比の利息計算を f64 近似へ変える",
    file: "crates/calcarc-core/src/finance/loan/rate.rs",
    from: `    pub fn monthly_interest_floor(&self, balance: u64) -> CalcResult<u64> {
        let product = balance as u128 * self.numerator as u128;
        let interest = product / self.denominator as u128;
        u64::try_from(interest).map_err(|_| CalcError::Overflow)
    }`,
    to: `    pub fn monthly_interest_floor(&self, balance: u64) -> CalcResult<u64> {
        let rate = self.numerator as f64 / self.denominator as f64;
        let interest = (balance as f64 * rate).floor();
        if interest < 0.0 || interest > u64::MAX as f64 {
            return Err(CalcError::Overflow);
        }
        Ok(interest as u64)
    }`,
    // f64 は仮数部 53 ビットしか持たない。残高が大きい・分母が細かい
    // (bp 刻みの金利)口座では、厳密な床と f64 の床が 1 円単位でずれる。
    expectShards: ["finance-000.json (calls)"],
    minRate: { "finance-000.json (calls)": 0.015 },
  },
  {
    id: "compound-deposit-at-start",
    what: "積立を期末から期首へ動かす(その期の利息を積立額にも付ける)",
    file: "crates/calcarc-core/src/finance/compound.rs",
    from: `    let mut balance = principal;
    for _ in 0..periods {
        let interest = rate.interest_floor(balance)?;
        balance = balance.checked_add(interest).ok_or(CalcError::Overflow)?;
        balance = balance.checked_add(deposit).ok_or(CalcError::Overflow)?;
    }`,
    to: `    let mut balance = principal;
    for _ in 0..periods {
        balance = balance.checked_add(deposit).ok_or(CalcError::Overflow)?;
        let interest = rate.interest_floor(balance)?;
        balance = balance.checked_add(interest).ok_or(CalcError::Overflow)?;
    }`,
    // 3 行の並べ替えだけ(設計書 §5)。積立額が 0 の一括預入は影響を
    // 受けない——`grow(P, 0, ...)` の毎期は変わらない。
    expectShards: ["finance-000.json (calls)"],
    minRate: { "finance-000.json (calls)": 0.087 },
  },
  {
    id: "compound-round-once-at-maturity",
    what: "毎期切り捨てをやめ、満期時に一度だけ丸める",
    file: "crates/calcarc-core/src/finance/compound.rs",
    from: `    let mut balance = principal;
    for _ in 0..periods {
        let interest = rate.interest_floor(balance)?;
        balance = balance.checked_add(interest).ok_or(CalcError::Overflow)?;
        balance = balance.checked_add(deposit).ok_or(CalcError::Overflow)?;
    }`,
    to: `    let scale: u128 = 1_000_000_000;
    let mut scaled = principal as u128 * scale;
    for _ in 0..periods {
        let interest = scaled * rate.numerator as u128 / rate.denominator as u128;
        scaled = scaled
            .checked_add(interest)
            .and_then(|v| v.checked_add(deposit as u128 * scale))
            .ok_or(CalcError::Overflow)?;
    }
    let balance = u64::try_from(scaled / scale).map_err(|_| CalcError::Overflow)?;`,
    // 設計書 §5.1: 残高を 10^9 スケールの分数のまま持ち回し、最後の
    // 1 回だけ円に落とす。毎期の 1 円未満切り捨てが積み上がらないので、
    // 期数が多い口座ほど正しい厳密値との差が大きくなる。
    expectShards: ["finance-000.json (calls)"],
    minRate: { "finance-000.json (calls)": 0.086 },
  },
  {
    id: "rate-nominal-to-effective",
    what: "名目換算を実効換算に変える((1+r)^(1/期) − 1 を f64 で近似する)",
    file: "crates/calcarc-core/src/finance/loan/rate.rs",
    from: `        let denominator = scale
            .checked_mul(100)
            .and_then(|v| v.checked_mul(periods_per_year as u64))
            .ok_or(CalcError::SyntaxError)?;
        Ok(Rate {
            numerator,
            denominator,
        })
    }`,
    to: `        let annual = numerator as f64 / (scale as f64 * 100.0);
        let periodic = (1.0 + annual).powf(1.0 / periods_per_year as f64) - 1.0;
        let effective_denominator: u64 = 1_000_000_000_000;
        let effective_numerator = (periodic * effective_denominator as f64).round() as u64;
        Ok(Rate {
            numerator: effective_numerator,
            denominator: effective_denominator,
        })
    }`,
    // 設計書 §5.1: 実効換算は無理数で分数に載らないので、f64 で近似して
    // 分母 10^12 の分数に丸め直す。名目(年利÷期/年)と実効の差は
    // `periods_per_year == 1` では 0 だが、月次・半年では複利ぶんだけ開く。
    expectShards: ["finance-000.json (calls)"],
    minRate: { "finance-000.json (calls)": 0.324 },
  },
  {
    id: "tax-combined-rate",
    what: "国税・地方税を合計 20.315% の一括計算にする",
    file: "crates/calcarc-core/src/finance/tax.rs",
    from: `    let national = interest as u128 * NATIONAL_NUM / NATIONAL_DEN;
    let local = interest as u128 * LOCAL_NUM / LOCAL_DEN;`,
    to: `    let national = interest as u128 * 20_315 / 100_000;
    let local = 0u128;`,
    // 別々に切り捨てると 1 円ずれるケースがある(`tax.rs` のテスト
    // `the_two_taxes_are_floored_separately` の 2,648,906 円が実例)。
    // 一括計算はそのケースだけ違う総額を返す。
    expectShards: ["finance-000.json (calls)"],
    minRate: { "finance-000.json (calls)": 0.058 },
  },
  {
    id: "loan-final-row-no-adjustment",
    what: "ローン最終回の調整を削除する(残高+利息ではなく定例額を払わせる)",
    file: "crates/calcarc-core/src/finance/loan/schedule.rs",
    from: `        run.pay(due, interest)?;
        return Ok(run.finish(due));`,
    to: `        run.pay(payment, interest)?;
        return Ok(run.finish(payment));`,
    // `residual == 0` の最終回だけを狙う(schedule.rs:90-91)。定例額が
    // 端数をちょうど吸収する稀な入力以外はすべて `final_payment` と
    // `final_balance` が真値からずれる。
    expectShards: ["finance-000.json (calls)"],
    minRate: { "finance-000.json (calls)": 0.232 },
  },
  {
    id: "bonus-half-year-becomes-monthly",
    what: "ボーナス列の半年利を月利にする(denominator / 6 を外す)",
    file: "crates/calcarc-core/src/finance/loan/rate.rs",
    from: "denominator: self.denominator / 6,",
    to: "denominator: self.denominator,",
    // ボーナス併用のローン・複利だけが半年利を要る。半年利が月利の
    // 6 倍(=正しい利率の 1/6)のままになるので、半年ぶんの利息が
    // ごく僅かにしか付かなくなる。
    expectShards: ["finance-000.json (calls)"],
    minRate: { "finance-000.json (calls)": 0.052 },
  },
  {
    id: "periods-for-binary-search",
    what: "必要期間を全走査から二分探索へ変える(手取りの非単調な谷を飛び越える)",
    file: "crates/calcarc-core/src/finance/compound_inverse.rs",
    from: `    let mut balance = principal;
    let mut principal_total = principal;
    for n in 1..=MAX_PERIODS {
        balance = balance
            .checked_add(rate.interest_floor(balance)?)
            .and_then(|b| b.checked_add(deposit))
            .ok_or(CalcError::Overflow)?;
        principal_total = principal_total
            .checked_add(deposit)
            .ok_or(CalcError::Overflow)?;
        // 利率は非負なので投入合計を下回らないが、契約として checked のまま引く。
        let interest = balance
            .checked_sub(principal_total)
            .ok_or(CalcError::Overflow)?;
        if reached(balance, interest, taxed)? >= target {
            return solution(
                deposit,
                n,
                Growth {
                    final_balance: balance,
                    principal_total,
                    interest,
                },
                taxed,
            );
        }
    }
    // 1,200 期でも届かない = 事実上の発散(ローンの term_for と同じ扱い)。
    Err(CalcError::SyntaxError)`,
    to: `    // Overflow は「届く側」として扱う(engine 自身の流儀。
    // \`deposit_for\` の \`probe\` と同じ: \`Err(CalcError::Overflow) => true\`)。
    let probe = |n: u32| -> bool {
        match grow(principal, deposit, rate, n) {
            Ok(g) => matches!(reached(g.final_balance, g.interest, taxed), Ok(v) if v >= target),
            Err(CalcError::Overflow) => true,
            Err(_) => false,
        }
    };
    if !probe(MAX_PERIODS) {
        return Err(CalcError::SyntaxError);
    }
    let mut low = 0u32;
    let mut high = MAX_PERIODS;
    while high - low > 1 {
        let mid = low + (high - low) / 2;
        if probe(mid) {
            high = mid;
        } else {
            low = mid;
        }
    }
    let g = grow(principal, deposit, rate, high)?;
    solution(deposit, high, g, taxed)`,
    // **最初の版はここで Overflow を `?` で伝播させていて、152 件を検出
    // していた。** 実際は谷とは無関係の別の欠陥だった: `probe(MAX_PERIODS)`
    // を先に呼ぶので、答が小さい期(例: 10 期)のケースでも 1,200 期まで
    // 育てて u64 を溢れさせ、前進走査なら出せたはずの答の代わりに Overflow
    // を返していた(taxed 79 件・税なし 72 件。税なしは期数について厳密に
    // 単調なので、税の床は原因になりようがない——溢れに前のめりなだけ)。
    // Overflow を「届く側」として扱う `deposit_for` と同じ流儀に直したら、
    // 差は設計書どおり **1 件**(`fin-000265`、前進 19 / 二分 21)になった。
    // **検出数が多いことは検出力が高いことを意味しない**——152 件のうち
    // 151 件は #9 が確かめたいはずの非単調性と無関係の人工物だった。詳細は
    // `docs/corpus-measurements.md`。
    //
    // **`minRate` はここでは置かない。** 実測は 1 件だけで、率にすると
    // 3500 件中 1 件は 3 桁の下限表現に載らない(floor が 0 になる)。
    // `verdictFor` の `floor = Math.max(1, Math.ceil(total * rate - 1e-9))`
    // が `rate` 未指定(=0)のときに 1 を保証するので、それに委ねる。
    expectShards: ["finance-000.json (calls)"],
    minRate: {},
  },
  {
    id: "compound-inverse-ignores-tax-flag",
    what: "税あり目標を手取りでなく税引前残高と比較する",
    file: "crates/calcarc-core/src/finance/compound_inverse.rs",
    from: "    if !taxed {",
    to: "    if true {",
    // `reached` が常に残高をそのまま返すようになる。税 OFF の逆算は
    // 元々 `reached` が同じ経路(`if !taxed`)を通るので影響を受けず、
    // **税 ON のケースだけ**が違う値と比較されて壊れる。
    expectShards: ["finance-000.json (calls)"],
    minRate: { "finance-000.json (calls)": 0.038 },
  },
];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: WEB,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: "1" },
    ...options,
  });
}

/**
 * `run` が期待した形をしているか。
 *
 * **壊れた要約は、無い要約と同じだけ何も言っていない。** `schema` が
 * 違う・`shards` や `expected` が配列でない(将来のスキーマ変更、書き込み
 * 途中でのプロセス終了、あるいは単に `heavy-run.json` の中身が `5` だった、
 * 等)場合に `run.shards` をそのまま走査すると `TypeError` が
 * `measure()` を突き抜けて `main()` ごと落ちる。この関数の目的は
 * 「測定が失敗した」を例外にせず構造化された事実(`runJsonFound: false`)
 * にすること――それがこの spec の存在理由なので、ここで例外を許すわけには
 * いかない。
 */
function isWellFormedRun(run) {
  return (
    run !== null &&
    typeof run === "object" &&
    run.schema === 1 &&
    Array.isArray(run.shards) &&
    Array.isArray(run.expected)
  );
}

/**
 * 読み取り段だけを切り出した純関数。
 *
 * `measure()` から分けたのは、ここだけを単体テストするため。**プロセスを
 * 起動しないのでテストできる。** 「見つからなかった」扱いになるのは 2 通り
 * ある――`run === null`(`heavy-run.json` が無い。`globalTeardown` まで
 * 走らなかった)と、`run` はあるが形が壊れている場合(`isWellFormedRun`
 * 参照)。どちらも読み手には同じ「測定に失敗した」でしかないので、
 * 同じ結果を返す。
 */
export function readMeasurement({ buildOk, playwrightExitCode, run }) {
  if (!isWellFormedRun(run)) {
    return {
      buildOk,
      playwrightExitCode,
      runJsonFound: false,
      ranTests: false,
      expected: [],
      shardsSeen: [],
      mismatchesByShard: {},
      totalsByShard: {},
    };
  }
  const mismatchesByShard = {};
  const totalsByShard = {};
  for (const shard of run.shards) {
    mismatchesByShard[shard.name] = shard.mismatches;
    totalsByShard[shard.name] = shard.total;
  }
  return {
    buildOk,
    playwrightExitCode,
    runJsonFound: true,
    ranTests: run.ranTests,
    expected: run.expected,
    shardsSeen: run.shards.map((shard) => shard.name),
    mismatchesByShard,
    totalsByShard,
  };
}

/**
 * `execFileSync` が投げた `error` から、playwright の終了コードを取り出す。
 *
 * `error.status` が数値なら「走って、その終了コードで落ちた」――テストが
 * 赤くなるのが目的なので想定内。数値でないのは「そもそも起動できなかった」
 * (`ENOENT` など、spawn 自体の失敗)ということで、これは「走って落ちた」
 * とは別の事実である。ここで安易に `1` を返すと「playwright が終了コード 1
 * で落ちた」と読めてしまい、実際には一度も走っていないのに走ったことになる
 * ――このリポジトリが繰り返し踏んでいる「検査は緑のまま理由だけが嘘になる」
 * 形そのもの。`null` を返して「走らなかった」を保つ。
 *
 * **注意: `null` は 2 つの意味を持つ。** ビルドで止まって一度も呼ばれ
 * なかった場合(`measure()` の `buildOk === false` のときの初期値)と、
 * ここで spawn 自体に失敗した場合の両方が `null` になる。どちらも
 * `heavy-run.json` は書かれないので `runJsonFound: false` に落ち、
 * 判定側(Task 5)はそれで「測定失敗」と読める――が、両者を区別したく
 * なったら `playwrightExitCode` だけでは足りない。
 */
export function exitCodeFrom(error) {
  return typeof error.status === "number" ? error.status : null;
}

/**
 * **走行を 3 段に分ける。**
 *
 * `pnpm heavy` は `pnpm wasm && playwright test` の合成なので、合成のまま
 * 呼ぶと**ビルド失敗とテスト失敗が同じ非ゼロ終了**になる。分けて呼べば、
 * どちらで倒れたかが別々の事実として残る。
 */
export function measure() {
  // **前の走行のファイルを残さない。** playwright の起動そのものが失敗
  // すると(ビルド失敗、あるいは spawn 自体の失敗)、globalSetup
  // (`resetRun()`)まで到達しない――`heavy-run.json` を消すのはそこだけ
  // なので、消さずに始めると**前の変異が書いたファイルがディスクに
  // 残ったまま**になる。`measure()` はそれをそのまま読み、`buildOk: true`
  // / `runJsonFound: true` / `ranTests: true` / シャード完備という健全性
  // チェックを 4 つとも素通りし、**一度も測っていない変異が前の変異の
  // 不一致件数で判定される**。この spec が消そうとしている偽陽性そのもの
  // なので、ビルドを試す前に必ず消す。
  rmSync(RUN_JSON, { force: true });
  let buildOk = true;
  try {
    run("pnpm", ["wasm"]);
  } catch {
    buildOk = false;
  }
  let playwrightExitCode = null;
  if (buildOk) {
    try {
      run("pnpm", ["exec", "playwright", "test", "--config", "playwright.heavy.config.ts"]);
      playwrightExitCode = 0;
    } catch (error) {
      // 赤くなるのが目的なので、失敗そのものは想定内。取り出し方は
      // `exitCodeFrom` を参照。
      playwrightExitCode = exitCodeFrom(error);
    }
  }
  let parsed = null;
  try {
    parsed = JSON.parse(readFileSync(RUN_JSON, "utf-8"));
  } catch {
    parsed = null;
  }
  return readMeasurement({ buildOk, playwrightExitCode, run: parsed });
}

function sameSet(left, right) {
  if (left.length !== right.length) return false;
  const sorted = [...right].sort();
  return [...left].sort().every((name, i) => name === sorted[i]);
}

/**
 * **測定の健全性を先に見て、そのあとで検出を見る。**
 *
 * 1〜4 の赤は「測れていない」、5 以降の赤は「測った結果が期待と違う」である。
 * この 2 つを同じ言葉で報告すると、レポートが**測定の失敗を検証の成果として
 * 数える**——それがこの段階を足した理由そのものである。
 */
export function verdictFor(mutation, m, allShards = ALL_SHARDS) {
  const fail = (kind, why) => ({ ok: false, kind, why });
  if (!m.buildOk) {
    return fail("measurement-failed", "wasm のビルドが失敗した——検出の有無は測れていない");
  }
  if (!m.runJsonFound) {
    return fail("measurement-failed", "heavy-run.json が無い——走行がレポート生成に到達していない");
  }
  if (!m.ranTests) {
    return fail("measurement-failed", "テストが 1 本も走っていない");
  }
  if (!sameSet(m.shardsSeen, allShards)) {
    const missing = allShards.filter((name) => !m.shardsSeen.includes(name));
    const extra = m.shardsSeen.filter((name) => !allShards.includes(name));
    const parts = [];
    if (missing.length > 0) parts.push(`読み込まれていない(${missing.join(", ")})`);
    if (extra.length > 0) parts.push(`知らないシャードが居る(${extra.join(", ")})`);
    return fail(
      "measurement-failed",
      `${parts.join("、")}——` +
        "黙っているべきシャードが走っていない走行は、完全一致を語る資格がない",
    );
  }
  const reacted = Object.entries(m.mismatchesByShard)
    .filter(([, count]) => count > 0)
    .map(([name]) => name);
  if (mutation.expectShards.length === 0) {
    if (reacted.length > 0) {
      // **シャードが実際に反応した。** レポートの「この領域は踏んでいない」
      // という主張そのものが破られている――検出の結果である。
      return fail(
        "claim-was-false",
        `赤くなった(${reacted.join(", ")})。レポートの「踏んでいない」が嘘である`,
      );
    }
    if (m.playwrightExitCode !== 0) {
      // **どのシャードも反応していないのに、走行は非ゼロで終わった。**
      // これはシャード比較以外の失敗(タイムアウト等)で走行そのものが
      // 壊れただけであり、レポートの「踏んでいない」という主張は
      // 破られていない――spec A §4.5 が言う 1〜4 の「測れていない」に
      // 属するので `claim-was-false` ではなく `measurement-failed` として
      // 報告する。
      return fail(
        "measurement-failed",
        `テストが非ゼロ(${m.playwrightExitCode})で終了したが、どのシャードも反応していない——走行そのものが壊れている`,
      );
    }
    return { ok: true, kind: "ok", why: "赤くならなかった——レポートの「踏んでいない」が正しい" };
  }
  if (reacted.length === 0) {
    if (m.playwrightExitCode !== 0) {
      // **ここも Minor 4 と同じ誤ラベルだった。** 健全性チェック 1〜4 を
      // 通っている以上シャードの比較自体は完了しており、非ゼロ終了は
      // シャード比較とは別のテストが落ちたということ――走行そのものが
      // 壊れているのであって、コーパスが検出できなかったのではない。
      // `caught-nothing` のまま報告すると、隣り合う 2 つの枝(この枝と
      // `expectShards === []` の枝)で同じ状況に違う意味論を割り当てる
      // ことになる。
      return fail(
        "measurement-failed",
        `テストが非ゼロ(${m.playwrightExitCode})で終了したが、どのシャードも反応していない——走行そのものが壊れている`,
      );
    }
    return fail("caught-nothing", "1 件も捕まえられなかった");
  }
  if (!sameSet(reacted, mutation.expectShards)) {
    return fail(
      "shard-set-mismatch",
      `反応したのは ${reacted.sort().join(", ")}、期待は ${[...mutation.expectShards].sort().join(", ")}`,
    );
  }
  for (const name of mutation.expectShards) {
    const total = m.totalsByShard[name] ?? 0;
    const rate = mutation.minRate?.[name] ?? 0;
    // **`max(1, ...)` は保険であって、ここでは load-bearing ではない。**
    // ここに来る時点で直前の `sameSet` が「反応したシャードの集合が
    // `expectShards` と一致する」ことを確立しており、`reacted` は定義上
    // 「件数が 0 より多いシャード」だけを含む。つまり `expectShards` の
    // 各要素は、このループに来る時点で既に 1 件以上検出している――
    // `max(1, ...)` が実際に効くのは考えにくい入力(負の `rate` など)に
    // 対する保険でしかない。
    //
    // `- 1e-9` は浮動小数の丸め対策。`total * rate` は数学的には整数でも
    // f64 では丸め誤差が乗る――たとえば 3500 * 0.274 は 959 のはずが
    // `959.0000000000001` になり、素の `Math.ceil` は 960 を返す。率で
    // 下限を持たせた目的(コーパスが増えても表を書き換えずに済む)が、
    // 実測ちょうどの走行を「1 件足りない」と誤判定する形でまさにここで
    // 崩れるので、微小なイプシロンを引いてから切り上げる。
    const floor = Math.max(1, Math.ceil(total * rate - 1e-9));
    const caught = m.mismatchesByShard[name] ?? 0;
    if (caught < floor) {
      return fail("below-min-rate", `${name} は ${caught} 件で、下限 ${floor} 件(${total} 件の ${rate})に届かない`);
    }
  }
  return { ok: true, kind: "ok", why: `期待したシャードだけが反応した(${reacted.sort().join(", ")})` };
}

/**
 * `mutation.expectShards` から `report.ts` 契約の `expect: string` を作る。
 *
 * `resultRecord` と、変異元が見つからなかったときの記録
 * (`runOneMutation`)の両方がこの規則を要る。**2 か所に手で書くと、
 * どちらか片方だけが変わって食い違う** ので、ここに畳む。
 */
function describeExpect(mutation) {
  return mutation.expectShards.length === 0 ? "nothing" : mutation.expectShards.join(", ");
}

/**
 * `results.push` に積む 1 件を組み立てる。
 *
 * **ここは `web/tests/heavy/report.ts` が読む JSON の契約を守るためだけの
 * 関数で、判定には一切関与しない。** `verdictFor` には常に完全な
 * `measurement`(0 件のシャードを含む)を渡す――それをここで先に間引いて
 * しまうと、Task 4 で消したはずの shim が判定側に戻ってくる(§4.2 が
 * 名指しで禁じた「ビルド失敗が反応なしに化ける」形そのもの)。この関数が
 * 間引くのは判定が終わったあとの**表示専用**の値である。
 *
 * `report.ts` の `DetectionPower` 型は `expect: string` /
 * `caught: Record<string, number>` / `total: number` を要求する。
 * `MUTATIONS` を `expectShards`/`minRate` に変えた(Task 5)際に
 * `mutation.expect` を消したので、ここで文字列に戻して書く。`caught` は
 * `mismatchesByShard` のうち非ゼロのシャードだけ(レポートの「赤くなった
 * シャード」欄が表示するのはこれ)、`total` はその合計。`kind` は契約に
 * 無い追加項目――D+E がレポートで 5 種の失敗を区別するために使う。
 */
export function resultRecord(mutation, measurement, verdict) {
  const caught = Object.fromEntries(
    Object.entries(measurement.mismatchesByShard).filter(([, count]) => count > 0),
  );
  const total = Object.values(caught).reduce((a, b) => a + b, 0);
  return {
    id: mutation.id,
    what: mutation.what,
    expect: describeExpect(mutation),
    caught,
    total,
    ok: verdict.ok,
    kind: verdict.kind,
    why: verdict.why,
  };
}

/**
 * 1 変異ぶんを、変異・測定・判定・**復元**まで 1 まとまりで行う。
 *
 * **これは既知の欠陥の修正ではなく、構造の固定である。** 旧 `main()` も
 * `try { measurement = measure() } finally { 復元 }` のあとで
 * `verdictFor(mutation, measurement)` を呼んでいた――`finally` を抜けて
 * から判定していたので、復元は判定より前に必ず終わっていた。つまり
 * 「判定で例外が出ると変異が残る」という経路は旧構造にも無かった。
 *
 * それでも判定・記録の組み立てまでを `finally` の内側に閉じるのは、
 * この 4 段(変異・測定・判定・復元)を 1 関数に閉じ込め、**将来だれかが
 * 順序を並べ替えても復元が外れない形にする**ため。加えて `measure` を
 * 差し替え可能にしたことで、「測定やそのあとの判定が例外を投げても
 * ファイルは戻る」ことをテストで直接主張できるようになった――
 * `measure`/`root` を差し替えられる形自体が、この関数を切り出した動機
 * である。
 */
export function runOneMutation(mutation, { root = ROOT, measure: measureFn = measure } = {}) {
  const path = join(root, mutation.file);
  const original = readFileSync(path, "utf-8");
  if (!original.includes(mutation.from)) {
    // **黙って飛ばさない。** 変異が当たらなくなったのに緑で終わると、
    // 「検出力を測った」という記録だけが残って中身が空になる。変異を
    // 書いていない(まだ何も戻すものがない)ので、ここは try/finally の
    // 外で早期リターンしてよい。`resultRecord` は使えない――
    // `measurement` が無いので、同じ契約を手で組み立てる。
    return {
      id: mutation.id,
      what: mutation.what,
      expect: describeExpect(mutation),
      caught: {},
      total: 0,
      ok: false,
      kind: "mutation-site-missing",
      why: `変異元が ${mutation.file} に無い。engine が変わったので変異を書き直すこと`,
    };
  }
  writeFileSync(path, original.replace(mutation.from, mutation.to));
  try {
    const measurement = measureFn();
    const verdict = verdictFor(mutation, measurement);
    return resultRecord(mutation, measurement, verdict);
  } finally {
    // **必ず戻す。** `measureFn()` だけでなく `verdictFor`/`resultRecord`
    // が投げた例外もここを通る――構造上そうなっているだけで、旧 `main()`
    // でこの経路が壊れていたわけではない(上の JSDoc 参照)。
    // 戻したことをバイトで確かめる。
    writeFileSync(path, original);
    if (readFileSync(path, "utf-8") !== original) {
      throw new Error(`detection-power: ${mutation.file} を戻せなかった`);
    }
  }
}

function main() {
  const results = [];
  let failed = 0;

  for (const mutation of MUTATIONS) {
    process.stderr.write(`[${mutation.id}] ${mutation.what} ... `);
    const result = runOneMutation(mutation);
    if (!result.ok) {
      failed += 1;
    }
    process.stderr.write(`${result.ok ? "ok" : "NG"} — ${result.why}\n`);
    results.push(result);
  }

  // **最後に wasm を作り直す。**
  //
  // 原文は毎回戻しているが、**戻したあとに一度もビルドしていない**ので
  // `web/src/wasm/` には最後の変異が入ったままになる。`pnpm heavy` と
  // `pnpm heavy:ui` は先頭で `pnpm wasm` を回すので気づかないが、
  // ビルドを挟まずに playwright を直に叩くと**変異した engine を本物として
  // 測ることになる**——実際にそれを踏んだ(2026-08-17)。極形式の角度が
  // すべて `90 − 期待値` になり、engine の欠陥かと思って調べた。
  //
  // 走行の後始末として作り直しておけば、次に何を回しても原文の engine になる。
  if (MUTATIONS.length > 0) {
    process.stderr.write("原文の wasm を作り直しています ... ");
    run("pnpm", ["wasm"]);
    process.stderr.write("done\n");
  }

  writeFileSync(OUT, `${JSON.stringify({ results }, null, 2)}\n`);
  console.error(`detection-power: wrote ${OUT}`);
  if (failed > 0) {
    console.error(`detection-power: ${failed} の変異が期待どおりでなかった`);
    process.exit(1);
  }
}

// **import されたときは走らない。** テストがこのファイルを読むだけで
// 変異が始まっては困る。
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}

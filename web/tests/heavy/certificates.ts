import type { Page } from "@playwright/test";
import type { CallCase } from "./corpus";

/**
 * Heavy の逆算証明書(設計書 2026-08-19 §4.10)。
 *
 * `calls.spec.ts` の照合は「答が参照実装と同じ値である」ことしか見ない。
 * ここではその一歩先——**「その答が境界そのものである」**ことを、既存の
 * `loan_forward` / `compound_grow`(正算)だけを使って確かめる。新しい wasm
 * API も、ハーネスへの計算の追加も要らない。
 *
 * 4 op すべてに共通する形: 答の側で条件を満たし、境界の外側(±1 円・±1 期)
 * では満たさないことを、正算を 2 回(必要期間だけは n 回)呼んで示す。
 *
 * **正常ケースだけに掛ける。** `"error" in expect` のケースには答が無い。
 */

/** ハーネスに送る 1 回の呼び出し。`src/heavy-harness.ts` の `CallCase` と同じ形。 */
interface ProbeInput {
  op: "loan_forward" | "compound_grow";
  input: Record<string, string | number | boolean>;
}

/** 1 回の呼び出しと、その結果が満たすべき条件。 */
export interface Probe {
  input: ProbeInput;
  /** 条件が破れていれば、何が破れたかを言う文字列。満たしていれば `null`。 */
  check: (result: unknown) => string | null;
}

function asRecord(result: unknown): Record<string, unknown> | null {
  if (result === null || typeof result !== "object") {
    return null;
  }
  return result as Record<string, unknown>;
}

function errorOf(result: unknown): string | null {
  const rec = asRecord(result);
  if (rec === null) {
    return "wasm did not return an object";
  }
  const error = rec.error;
  return error === null || error === undefined ? null : JSON.stringify(error);
}

/** `loan_forward` の `monthlyPayment`(camelCase)を BigInt で取り出す。 */
function monthlyPaymentOf(result: unknown): bigint {
  const rec = asRecord(result) ?? {};
  return BigInt(rec.monthlyPayment as string);
}

/**
 * 複利の到達値。**税 ON なら手取り(`net`)、OFF なら残高(`finalBalance`)**
 * (設計書の公開契約 6、`crates/calcarc-core/src/finance/compound_inverse.rs`
 * の `reached` と同じ選び方)。
 */
function reachedValueOf(result: unknown, taxed: boolean): bigint {
  const rec = asRecord(result) ?? {};
  const key = taxed ? "net" : "finalBalance";
  return BigInt(rec[key] as string);
}

/** `loan_forward` の `finalPayment`(camelCase)を BigInt で取り出す。 */
function finalPaymentOf(result: unknown): bigint {
  const rec = asRecord(result) ?? {};
  return BigInt(rec.finalPayment as string);
}

/**
 * `loan_forward(principal, rate, n, residual=0)` の結果から、**予算
 * `payment` で n 回払い切れるか**(`schedule::clears_within` と同じ問い)
 * を導く。
 *
 * `loan_forward` は自分で導いた `monthlyPayment` を払う前提で表を走らせる
 * ——`clears_within` は `payment` を払う前提で走らせる。**両者が食い違う
 * のは `monthlyPayment` と `payment` が一致しない(タイでない)ときだけ**
 * である。金利が非負なので、固定額が大きいほど早く/確実に払い切れる
 * (実測で裏を取った不変条件、下記):
 *
 * - `monthlyPayment < payment`: 予算のほうが大きいので必ず払い切れる。
 * - `monthlyPayment > payment`: 自分の最適解ですら payment を超えるので
 *   払い切れない。
 * - `monthlyPayment === payment`(タイ): 走らせている表が
 *   `clears_within` の表と同一になるので、`finalPayment` がそのまま
 *   答え(`finalPayment <= payment` が `clears_within` の定義そのもの)。
 *
 * **タイは実測でよく起きる**(元利均等の月額は理論値の連続関数を
 * 円未満で切り捨てるので、隣り合う元本が同じ切り捨て値に落ちることが
 * 珍しくない)。例: `rate=12.0% n=121 payment=3360445` では、答の元本
 * (fin-003026)も答 + 1 円も `monthlyPayment` は同じ `3360445` だが、
 * `finalPayment` は答で `3360445`(払い切れる)、答 + 1 円で `3360451`
 * (超える)——タイのときだけ見るべき場所が違う、という実例。
 */
function clearsBudget(
  result: unknown,
  payment: bigint,
): { clears: boolean; error: string | null } {
  const error = errorOf(result);
  if (error !== null) {
    return { clears: false, error };
  }
  const monthly = monthlyPaymentOf(result);
  if (monthly < payment) {
    return { clears: true, error: null };
  }
  if (monthly > payment) {
    return { clears: false, error: null };
  }
  return { clears: finalPaymentOf(result) <= payment, error: null };
}

function loanClearsBudget(
  payment: bigint,
  caseId: string,
  label: string,
): (result: unknown) => string | null {
  return (result) => {
    const { clears, error } = clearsBudget(result, payment);
    if (error !== null) {
      return `${caseId}: ${label} errored unexpectedly (${error})`;
    }
    if (!clears) {
      return `${caseId}: ${label} expected to clear within the payment budget ${payment}, but loan_forward's schedule does not settle within it`;
    }
    return null;
  };
}

function loanDoesNotClearBudget(
  payment: bigint,
  caseId: string,
  label: string,
): (result: unknown) => string | null {
  return (result) => {
    const { clears, error } = clearsBudget(result, payment);
    if (error !== null) {
      return `${caseId}: ${label} errored unexpectedly (${error})`;
    }
    if (clears) {
      return `${caseId}: ${label} expected NOT to clear within the payment budget ${payment}, but loan_forward's schedule does settle within it`;
    }
    return null;
  };
}

function reachesTarget(
  target: bigint,
  taxed: boolean,
  caseId: string,
  label: string,
): (result: unknown) => string | null {
  return (result) => {
    const err = errorOf(result);
    if (err !== null) {
      return `${caseId}: ${label} errored unexpectedly (${err})`;
    }
    const got = reachedValueOf(result, taxed);
    if (got < target) {
      return `${caseId}: ${label} expected to reach target ${target} but compound_grow gave ${got}`;
    }
    return null;
  };
}

/**
 * `compound_grow` がエラーで返ったとき、その結果は「未到達」の一種として
 * 扱ってよいか。
 *
 * `compound_inverse::deposit_for` 自身の `probe` がそう扱っている
 * (`Err(CalcError::Overflow) => true`(届いた扱い)、`Err(_) => false`
 * (届かない扱い))。**答 − 1 円が `principal = 0, deposit = 0` になる
 * ケースが実測 123 件ある**——このとき `grow` は「入れた金がゼロ」の
 * `SyntaxError` を返す。それは計算できなかったのではなく、`deposit_for` が
 * その入力を「届かない」の側として読んでいる、という事実そのものである。
 */
function errorMeansShortOfTarget(err: string): boolean {
  return !err.includes("Overflow");
}

function fallsShortOfTarget(
  target: bigint,
  taxed: boolean,
  caseId: string,
  label: string,
): (result: unknown) => string | null {
  return (result) => {
    const err = errorOf(result);
    if (err !== null) {
      if (errorMeansShortOfTarget(err)) {
        return null;
      }
      return (
        `${caseId}: ${label} overflowed (${err}), which the solver's own ` +
        `probe treats as reaching the target — expected NOT to reach ` +
        `target ${target}`
      );
    }
    const got = reachedValueOf(result, taxed);
    if (got >= target) {
      return `${caseId}: ${label} expected NOT to reach target ${target} yet, but compound_grow gave ${got}`;
    }
    return null;
  };
}

function normalCases(cases: CallCase[], op: string): CallCase[] {
  return cases.filter((c) => c.op === op && !("error" in c.expect));
}

/**
 * `loan_principal` の答が**縮退**している(`rows_paid < n`)か。
 *
 * `loan_principal` 自身は「`payment` を n 回まで払う」表を走らせて答を
 * 確定する。予算に余裕がある入力では、その表が n 回を使い切る前に
 * 払い終わることがある(`schedule.rs` の「縮退」)——`rows_paid` が
 * `n` より小さいのがその印である。
 *
 * `loan_forward` はこの表を再現できない。`loan_forward` は「n 期を
 * ちょうど使い切る」前提で**自分で**月額を導くので、縮退したのと同じ
 * (元本, 金利, n)を渡すと、その月額は理論上とても小さくなり、しばしば
 * 初回利息の切り捨てと一致するか下回る——`schedule::run_schedule` の
 * 発散ガード(「月額が初回利息以下」)に落ちて `SyntaxError` になる。
 *
 * 実測: 432 件中 17 件がこの形(`rate=100% n=1199 principal=3,599,999`
 * が実例——`loan_forward` はこの元本でも答 + 1 円でも `SyntaxError` を
 * 返す)。`loan_forward` だけでは境界を確かめられないので、この証明書は
 * 縮退ケースを除外する。除外数は `countDegenerateLoanPrincipalCases` で
 * 読める。
 */
function isDegenerateLoanPrincipal(c: CallCase): boolean {
  const rowsPaid = c.expect.rows_paid as number;
  const n = c.input.n as number;
  return rowsPaid < n;
}

/** `loanPrincipalProbes` が縮退として除外した件数。測定・報告用。 */
export function countDegenerateLoanPrincipalCases(cases: CallCase[]): number {
  return normalCases(cases, "loan_principal").filter(isDegenerateLoanPrincipal)
    .length;
}

/**
 * `loan_principal`(借入可能額): 答の元本では `payment` 以内に払い切れ、
 * 答 + 1 円では払い切れない(`clearsBudget` の意味で。単なる
 * `monthlyPayment` の大小比較だとタイで false negative になる——上の
 * `clearsBudget` のコメントの実例を見よ)。**縮退ケース(上記)は除く。**
 */
export function loanPrincipalProbes(cases: CallCase[]): Probe[] {
  const probes: Probe[] = [];
  for (const c of normalCases(cases, "loan_principal")) {
    if (isDegenerateLoanPrincipal(c)) {
      continue;
    }
    const principal = BigInt(c.expect.principal as string);
    const rate = c.input.rate as string;
    const n = c.input.n as number;
    const payment = BigInt(c.input.payment as string);
    probes.push({
      input: {
        op: "loan_forward",
        input: { principal: principal.toString(), rate, n, residual: "0" },
      },
      check: loanClearsBudget(
        payment,
        c.id,
        `at the answer (principal=${principal})`,
      ),
    });
    const over = principal + 1n;
    probes.push({
      input: {
        op: "loan_forward",
        input: { principal: over.toString(), rate, n, residual: "0" },
      },
      check: loanDoesNotClearBudget(
        payment,
        c.id,
        `at answer + 1 yen (principal=${over})`,
      ),
    });
  }
  return probes;
}

/**
 * `loan_term`(返済期間): 答の期数では `payment` 以内に払い切れ、
 * 答 − 1 期では払い切れない。**答が 1 期の場合、0 期は構成できないので
 * 下限側は測らない**(`loan_forward` は n=0 を受け付けない)。実測では
 * この形が 12 件ある。
 */
export function loanTermProbes(cases: CallCase[]): Probe[] {
  const probes: Probe[] = [];
  for (const c of normalCases(cases, "loan_term")) {
    const n = c.expect.n as number;
    const principal = c.input.principal as string;
    const rate = c.input.rate as string;
    const payment = BigInt(c.input.payment as string);
    probes.push({
      input: {
        op: "loan_forward",
        input: { principal, rate, n, residual: "0" },
      },
      check: loanClearsBudget(payment, c.id, `at the answer (n=${n})`),
    });
    if (n > 1) {
      probes.push({
        input: {
          op: "loan_forward",
          input: { principal, rate, n: n - 1, residual: "0" },
        },
        check: loanDoesNotClearBudget(
          payment,
          c.id,
          `at answer - 1 period (n=${n - 1})`,
        ),
      });
    }
  }
  return probes;
}

/**
 * `compound_deposit_for`(必要積立額): 答の積立額で目標到達、答 − 1 円で
 * 未到達。実測では答が 0 円の正常ケースは無い(下限側が構成できない入力は
 * 出ていない)が、出た場合に備えて 0 円は下限側を飛ばす。
 */
export function compoundDepositForProbes(cases: CallCase[]): Probe[] {
  const probes: Probe[] = [];
  for (const c of normalCases(cases, "compound_deposit_for")) {
    const deposit = BigInt(c.expect.deposit as string);
    const target = BigInt(c.input.target as string);
    const taxed = c.input.tax as boolean;
    const base = {
      principal: c.input.principal as string,
      rate: c.input.rate as string,
      periods_per_year: c.input.periods_per_year as number,
      periods: c.input.periods as number,
      tax: taxed,
    };
    probes.push({
      input: {
        op: "compound_grow",
        input: { ...base, deposit: deposit.toString() },
      },
      check: reachesTarget(
        target,
        taxed,
        c.id,
        `at the answer (deposit=${deposit})`,
      ),
    });
    if (deposit === 0n) {
      continue;
    }
    const under = deposit - 1n;
    probes.push({
      input: {
        op: "compound_grow",
        input: { ...base, deposit: under.toString() },
      },
      check: fallsShortOfTarget(
        target,
        taxed,
        c.id,
        `at answer - 1 yen (deposit=${under})`,
      ),
    });
  }
  return probes;
}

/**
 * `compound_periods_for`(必要期間): **答より前の全期間 k = 1..n−1 で未達、
 * 答 n で到達。** 必要期間だけが O(n) の全走査になるのは意図——手取りは
 * 期数について単調でないので(`compound_inverse.rs` の module docstring)、
 * n−1 だけを見ても「n が最小である」ことの証明にならない。
 */
export function compoundPeriodsForProbes(cases: CallCase[]): Probe[] {
  const probes: Probe[] = [];
  for (const c of normalCases(cases, "compound_periods_for")) {
    const n = Number(c.expect.periods as string);
    const target = BigInt(c.input.target as string);
    const taxed = c.input.tax as boolean;
    const base = {
      principal: c.input.principal as string,
      deposit: c.input.deposit as string,
      rate: c.input.rate as string,
      periods_per_year: c.input.periods_per_year as number,
      tax: taxed,
    };
    for (let k = 1; k < n; k += 1) {
      probes.push({
        input: { op: "compound_grow", input: { ...base, periods: k } },
        check: fallsShortOfTarget(
          target,
          taxed,
          c.id,
          `at k=${k} of n=${n} (not yet)`,
        ),
      });
    }
    probes.push({
      input: { op: "compound_grow", input: { ...base, periods: n } },
      check: reachesTarget(target, taxed, c.id, `at the answer (periods=${n})`),
    });
  }
  return probes;
}

/**
 * 証明書のプローブを 1 束ずつハーネスへ流し、破れた条件だけを集める。
 *
 * 束ねるのは既存の `calls.spec.ts` と同じ理由: 往復のコストが計算の
 * コストを覆わない大きさにする。必要期間の証明書だけで数万回の呼び出しに
 * なるので、束は既存の `BATCH`(500)より大きくする。
 */
export async function runProbes(
  page: Page,
  probes: Probe[],
  batchSize: number,
): Promise<string[]> {
  const mismatches: string[] = [];
  for (let start = 0; start < probes.length; start += batchSize) {
    const batch = probes.slice(start, start + batchSize);
    const results = await page.evaluate(
      (input: ProbeInput[]) => {
        const harness = window.__calcarc;
        if (harness === undefined) {
          throw new Error("harness is not on the page");
        }
        return harness.runCalls(input as never);
      },
      batch.map((p) => p.input),
    );
    batch.forEach((probe, index) => {
      const message = probe.check(results[index]);
      if (message !== null) {
        mismatches.push(message);
      }
    });
  }
  return mismatches;
}

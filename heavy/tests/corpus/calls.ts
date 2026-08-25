/**
 * 関数呼び出しの結果を突き合わせる規則(設計書 2026-08-17 §3.2)。
 *
 * **ここが「何を食い違いと呼ぶか」を決める場所である。** 規則を緩めれば
 * 判定は緑になるので、**規則ごとに「これを緩めると何を見逃すか」を書き、
 * それを `calls.spec.ts` の敵対テストが固定する。**
 *
 * 比較は厳密一致である。円もバイト数も整数なので、許容誤差の概念が無い。
 */

/**
 * wasm 側の名前 → 参照側の名前。**camelCase を超える違いだけを挙げる。**
 * 増やすときは、なぜ違うのかを 1 行添えること。
 */
export const RENAMES: Record<string, string> = {
  // `loan_term` が返す期間。wasm は `months`、参照は `n`(入力と同じ名前)。
  months: "n",
};

/**
 * wasm の camelCase を参照の snake_case に直す。
 *
 * **綴りを寄せるのはこちら側である。** 参照実装を Rust に合わせて書き換えると、
 * 独立していることが検証の土台なのにその土台を崩す。
 *
 * **衝突したら落ちる。** `monthlyPayment` と `monthly_payment` が両方あると、
 * 片方が黙って消えて「一致した」ように見える。
 */
export function normalise(
  got: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(got)) {
    const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    const target = RENAMES[snake] ?? snake;
    if (target in out) {
      throw new Error(
        `calls: two wasm keys map to ${JSON.stringify(target)} (${key}). ` +
          "One would silently overwrite the other and the comparison would " +
          "read as a match.",
      );
    }
    out[target] = value;
  }
  return out;
}

export interface Difference {
  key: string;
  actual: unknown;
  expected: unknown;
  why: string;
}

/**
 * **参照実装が答えの権威である。** 比較は参照が出したキーの上で行う。
 *
 * wasm にしか無いキーは、次の 2 つに限り黙認する。**どちらも「情報が増えて
 * いない」ことが確かめられる場合だけ**である。
 *
 * 1. **値が `null`** — wasm はエラー時に値の欄を `null` で埋め、参照はキーごと
 *    出さない。同じ事実の別の書き方。
 *    *緩めると見逃すもの:* 無い。参照が値を持つキーは下の主比較に入るので、
 *    「計算できたはずのものを wasm が `null` にした」はここを通らない
 * 2. **値が入力そのもの** — wasm は `compound_deposit_for` の `periods` の
 *    ように入力を結果に含めて返す。
 *    *緩めると見逃すもの:* **入力を歪めて返す壊れ方。** そこで
 *    「入力と一致すること」を条件にしてある。違えば下の `echo` として報告する
 */
export function differences(
  actual: unknown,
  expected: Record<string, unknown>,
  input: Record<string, string | number | boolean>,
): Difference[] {
  if (actual === null || typeof actual !== "object") {
    return [
      {
        key: "(whole result)",
        actual,
        expected,
        why: "wasm did not return an object",
      },
    ];
  }
  const got = normalise(actual as Record<string, unknown>);
  const out: Difference[] = [];

  // **主比較。参照が出したキーは 1 つ残らず突き合わせる。**
  for (const key of Object.keys(expected).sort()) {
    if (JSON.stringify(got[key]) !== JSON.stringify(expected[key])) {
      out.push({
        key,
        actual: got[key],
        expected: expected[key],
        why: "value differs from the reference",
      });
    }
  }

  // **wasm にしか無いキー。** 上の 2 条件に当てはまらないものだけ報告する。
  for (const key of Object.keys(got).sort()) {
    if (key in expected) {
      continue;
    }
    const value = got[key];
    if (value === null) {
      continue;
    }
    if (key === "error") {
      // 成功時の `error: null` は上で落ちている。ここに来る `error` は
      // **wasm がエラーを名乗り、参照は成功した**という食い違いである。
      out.push({
        key,
        actual: value,
        expected: undefined,
        why: "wasm reported an error where the reference computed a value",
      });
      continue;
    }
    if (key in input && String(value) === String(input[key])) {
      continue;
    }
    out.push({
      key,
      actual: value,
      expected: undefined,
      why:
        key in input
          ? "wasm echoed this input back with a different value"
          : "wasm returned a field the reference does not have",
    });
  }
  return out;
}

export function describe(diff: Difference[]): string {
  return diff
    .map(
      (d) =>
        `${d.key}: ${JSON.stringify(d.actual)} ≠ ${JSON.stringify(d.expected)} (${d.why})`,
    )
    .join("; ");
}

/**
 * 入力の積立の位置。**書いていなければ期末**——期末のコーパス
 * (`finance-000.json`)は `timing` を持たない(設計書 2026-09-10 §4.4)。
 *
 * **知らない綴りは落とす。** 黙って期末へ倒すと、綴りを間違えた期首の
 * ケースが期末として照合され、**もっともらしい不一致**になる。
 */
export function timingOf(input: Record<string, unknown>): "end" | "start" {
  const value = input.timing;
  if (value === undefined) return "end";
  if (value === "end" || value === "start") return value;
  throw new Error(
    `timingOf: the case's timing is ${JSON.stringify(value)}; expected "end" or "start"`,
  );
}

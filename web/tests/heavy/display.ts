/**
 * 表示文字列を数に戻す。
 *
 * **許容誤差はここに書かない。** corpus の JSON が持つ(CLAUDE.md の規約)。
 * ここがするのは書式の逆変換だけである。
 *
 * 複素数の表示(例: "j2")はここでは扱わない。実測(docs/corpus-measurements.md)
 * では sqrt(-4) が "j2" を返したが、これは Number() で読める実数ではないので
 * 下の Number.isFinite チェックで例外になる。実数以外を生成しうるキー列を
 * コーパスが含める場合は、呼び出し側が parseDisplay に渡す前に実数か複素数か
 * を別途判定する必要がある。
 */
export function parseDisplay(main: string): number {
  const cleaned = main
    .replace(/,/g, "") // 桁区切り
    .replace(/−/g, "-"); // 数学用マイナス
  const value = Number(cleaned);
  if (!Number.isFinite(value)) {
    // 黙って NaN を返すと、比較が「誤差の範囲外」ではなく「常に不一致」に
    // 化けて、原因が書式なのか計算なのか分からなくなる。
    throw new Error(`display: cannot read ${JSON.stringify(main)} as a number`);
  }
  return value;
}

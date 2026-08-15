/**
 * 表示文字列を数に戻す。
 *
 * **許容誤差はここに書かない。** corpus の JSON が持つ(CLAUDE.md の規約)。
 * ここがするのは書式の逆変換だけである。
 *
 * **実際に観測した書式だけを解する。** 桁区切りのカンマと U+2212(数学用
 * マイナス)を吸収する変換をブリーフの当初案は持っていたが、9 探り
 * (docs/corpus-measurements.md)のどれも出さなかったため、レビュー修正
 * ラウンド 1 で落とした。負号は ASCII の "-" のみを観測している。
 * 実測されない変換をここに残すと、テストされないコードが増える一方、
 * `Number()` がそのまま解せない書式(このどちらでもない未知の書式)が
 * 出てきたときに黙って通してしまう恐れがある。カンマや U+2212 が実際に
 * 観測されたら、そのときに実測付きで足す。
 *
 * 複素数の表示(例: "j2")もここでは扱わない。実測(docs/corpus-measurements.md)
 * では sqrt(-4) が "j2" を返したが、これは Number() で読める実数ではないので
 * 下の Number.isFinite チェックで例外になる。実数以外を生成しうるキー列を
 * コーパスが含める場合は、呼び出し側が parseDisplay に渡す前に実数か複素数か
 * を別途判定する必要がある。
 */
export function parseDisplay(main: string): number {
  const value = Number(main);
  if (!Number.isFinite(value)) {
    // 黙って NaN を返すと、比較が「誤差の範囲外」ではなく「常に不一致」に
    // 化けて、原因が書式なのか計算なのか分からなくなる。
    throw new Error(`display: cannot read ${JSON.stringify(main)} as a number`);
  }
  return value;
}

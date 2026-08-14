/**
 * 金額の打鍵を解釈する純関数。**React も WASM も知らない**——`types.ts` と
 * 同じ層である（`index.ts` は型変換と初期化だけを持つ）。
 *
 * 構造は「確定済みセグメントの列 + 入力中の数字」（設計書 §5）。累計を持たず、
 * **値・表示・DEL のすべてをこの 1 つの構造から導く**。
 *
 * 金額のためのものである。年利は小数を含み、期間は整数の月数なので、
 * どちらもここを通らない（それぞれ素の文字列で持つ）。
 */

/** 位取りの単位。scale は 10 の冪。 */
export interface Unit {
  label: string;
  scale: bigint;
}

export const MAN: Unit = { label: "万", scale: 10n ** 4n };
export const OKU: Unit = { label: "億", scale: 10n ** 8n };

interface Segment {
  digits: string;
  unit: Unit;
}

export interface Entry {
  segments: Segment[];
  /** まだ単位が付いていない、入力中の数字。 */
  digits: string;
}

export const EMPTY: Entry = { segments: [], digits: "" };

/** 1 セグメントに打てる最大桁数。u64 の 10 進 20 桁に合わせる。 */
const MAX_DIGITS = 20;

export function pushDigit(entry: Entry, digit: string): Entry {
  if (!/^\d$/.test(digit)) return entry;
  if (entry.digits.length >= MAX_DIGITS) return entry;
  // 先頭の 0 は次の数字で置き換える（"0" -> "5" であって "05" ではない）。
  const head = entry.digits === "0" ? "" : entry.digits;
  return { ...entry, digits: head + digit };
}

/**
 * 単位キー。**下る単位しか受けない**（万 のあとに 億 は無い）。
 *
 * 文法違反は null。盤面は `canPushUnit` でそのキーを押せなくするので、
 * ここに null が返るのは盤面を通らない経路（別の UI、テスト）だけである
 * ——契約は残し、盤面は到達させない（設計書 §5）。
 */
export function pushUnit(entry: Entry, unit: Unit): Entry | null {
  if (entry.digits === "") return null;
  const last = entry.segments.at(-1);
  if (last && last.unit.scale <= unit.scale) return null;
  return {
    segments: [...entry.segments, { digits: entry.digits, unit }],
    digits: "",
  };
}

export function canPushUnit(entry: Entry, unit: Unit): boolean {
  // 規則を 2 か所に書かない。押せるかどうかは「押せた結果があるか」である。
  return pushUnit(entry, unit) !== null;
}

/** DEL 1 回。入力中の数字があれば 1 文字、無ければ直前のセグメントを解く。 */
export function backspace(entry: Entry): Entry {
  if (entry.digits !== "") {
    return { ...entry, digits: entry.digits.slice(0, -1) };
  }
  const last = entry.segments.at(-1);
  if (!last) return entry;
  return { segments: entry.segments.slice(0, -1), digits: last.digits };
}

/** 何も打たれていないか。可否の判定で何度も要る。 */
export function isEmpty(entry: Entry): boolean {
  return entry.segments.length === 0 && entry.digits === "";
}

/** 打った通りの文字列。桁区切りは入れない（打鍵と画面を 1 対 1 に保つ）。 */
export function text(entry: Entry): string {
  const head = entry.segments.map((s) => `${s.digits}${s.unit.label}`).join("");
  return head + entry.digits;
}

/** コアへ渡す素の数字列。空の入力は空文字。 */
export function digits(entry: Entry): string {
  if (entry.segments.length === 0) return entry.digits;
  const total = entry.segments.reduce(
    (sum, s) => sum + BigInt(s.digits) * s.unit.scale,
    entry.digits === "" ? 0n : BigInt(entry.digits),
  );
  return total.toString();
}

/** 表示のための桁区切り。金額は number に収まらないので文字列のまま加工する。 */
export function grouped(amount: string): string {
  return amount.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

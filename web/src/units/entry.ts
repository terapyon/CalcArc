/**
 * 打鍵をトークンの列として保つ純関数。**React も WASM も知らない**。
 *
 * **値の計算はここに無い。** 打った通りの文字列をコアへ渡し、コアが単位を
 * 解釈して評価する（設計書 2026-08-15 訂正 2）——単位表を TypeScript と Rust の
 * 両方に置くと二重管理になり、ずれが静かに沈むためである。
 *
 * ここが持つのは**編集と表示**だけ:
 *
 * - 打った通りの文字列（`3000万+50万`）
 * - DEL の 1 段（数字は 1 文字、単位・演算子・括弧は 1 つ）
 * - 次にどのキーを押せるか（単位は下る向きだけ、など）
 *
 * 単位の **scale は持たない**。持つのはラベルと**並び順**だけで、
 * 「億 の次に 万 は置けるが逆は不可」の判定には順番があれば足りる。
 */

/** 単位。**scale は持たない**——計算はコアの仕事である。 */
export interface Unit {
  label: string;
  /** 表の中での位置。小さいほど大きい単位（億 = 0、万 = 1）。 */
  rank: number;
}

export type Operator = "+" | "-" | "*" | "/";

export type Token =
  | { kind: "digits"; text: string }
  | { kind: "unit"; unit: Unit }
  | { kind: "op"; op: Operator }
  | { kind: "lparen" }
  | { kind: "rparen" };

export interface Entry {
  tokens: Token[];
}

export const EMPTY: Entry = { tokens: [] };

const last = (entry: Entry): Token | undefined => entry.tokens.at(-1);

/** 打った通りの文字列。**これがそのままコアへ渡る式である。** */
export function text(entry: Entry): string {
  return entry.tokens
    .map((token) => {
      if (token.kind === "digits") return token.text;
      if (token.kind === "unit") return token.unit.label;
      if (token.kind === "op") return token.op;
      return token.kind === "lparen" ? "(" : ")";
    })
    .join("");
}

export function isEmpty(entry: Entry): boolean {
  return entry.tokens.length === 0;
}

/** 式を打っている途中か（演算子・括弧が含まれるか）。 */
export function hasOperator(entry: Entry): boolean {
  return entry.tokens.some(
    (t) => t.kind === "op" || t.kind === "lparen" || t.kind === "rparen",
  );
}

export function pushDigit(
  entry: Entry,
  digit: string,
  maxDigits: number,
): Entry {
  if (!/^\d$/.test(digit)) return entry;
  const tail = last(entry);
  if (tail?.kind === "digits") {
    if (tail.text.length >= maxDigits) return entry;
    // 先頭の 0 は次の数字で置き換える（"0" -> "5" であって "05" ではない）。
    const head = tail.text === "0" ? "" : tail.text;
    return replaceLast(entry, { kind: "digits", text: head + digit });
  }
  return { tokens: [...entry.tokens, { kind: "digits", text: digit }] };
}

export function pushDot(entry: Entry, maxDigits: number): Entry {
  const tail = last(entry);
  if (tail?.kind !== "digits") return entry;
  if (tail.text.includes(".")) return entry;
  if (tail.text.length >= maxDigits) return entry;
  return replaceLast(entry, { kind: "digits", text: `${tail.text}.` });
}

/**
 * 単位キー。**下る単位しか受けない**（万 のあとに 億 は無い）。
 *
 * 文法違反は null。盤面は `canPushUnit` でそのキーを押せなくするので、
 * ここに null が返るのは盤面を通らない経路だけである。
 */
export function pushUnit(entry: Entry, unit: Unit): Entry | null {
  const tail = last(entry);
  if (tail?.kind !== "digits") return null;
  const previous = lastUnitOfTerm(entry);
  if (previous !== undefined && previous.rank >= unit.rank) return null;
  return { tokens: [...entry.tokens, { kind: "unit", unit }] };
}

export function canPushUnit(entry: Entry, unit: Unit): boolean {
  // 規則を 2 か所に書かない。押せるかどうかは「押せた結果があるか」である。
  return pushUnit(entry, unit) !== null;
}

/** いま組み立てている項に既に置かれた単位（演算子で区切られる）。 */
function lastUnitOfTerm(entry: Entry): Unit | undefined {
  for (let i = entry.tokens.length - 1; i >= 0; i -= 1) {
    const token = entry.tokens[i];
    if (token === undefined) break;
    if (token.kind === "unit") return token.unit;
    if (token.kind !== "digits") break; // 演算子や括弧を跨いだら別の項
  }
  return undefined;
}

export function pushOperator(entry: Entry, op: Operator): Entry {
  const tail = last(entry);
  // 演算子の連続は受けない。空の式にも置けない（単項マイナスは持たない）。
  if (tail === undefined) return entry;
  if (tail.kind === "op" || tail.kind === "lparen") return entry;
  if (tail.kind === "digits" && tail.text.endsWith(".")) return entry;
  return { tokens: [...entry.tokens, { kind: "op", op }] };
}

export function canPushOperator(entry: Entry): boolean {
  return pushOperator(entry, "+") !== entry;
}

export function pushOpenParen(entry: Entry): Entry {
  const tail = last(entry);
  // 数や閉じ括弧の直後には置けない（暗黙の掛け算を持たない）。
  if (
    tail?.kind === "digits" ||
    tail?.kind === "unit" ||
    tail?.kind === "rparen"
  ) {
    return entry;
  }
  return { tokens: [...entry.tokens, { kind: "lparen" }] };
}

export function pushCloseParen(entry: Entry): Entry {
  if (openDepth(entry) === 0) return entry;
  const tail = last(entry);
  if (
    tail?.kind !== "digits" &&
    tail?.kind !== "unit" &&
    tail?.kind !== "rparen"
  ) {
    return entry;
  }
  return { tokens: [...entry.tokens, { kind: "rparen" }] };
}

export function canPushOpenParen(entry: Entry): boolean {
  return pushOpenParen(entry) !== entry;
}

export function canPushCloseParen(entry: Entry): boolean {
  return pushCloseParen(entry) !== entry;
}

/** 閉じていない `(` の数。 */
export function openDepth(entry: Entry): number {
  return entry.tokens.reduce((depth, token) => {
    if (token.kind === "lparen") return depth + 1;
    if (token.kind === "rparen") return depth - 1;
    return depth;
  }, 0);
}

/** DEL 1 回。**数字は 1 文字、それ以外は 1 トークン**戻す。 */
export function backspace(entry: Entry): Entry {
  const tail = last(entry);
  if (tail === undefined) return entry;
  if (tail.kind === "digits" && tail.text.length > 1) {
    return replaceLast(entry, { kind: "digits", text: tail.text.slice(0, -1) });
  }
  return { tokens: entry.tokens.slice(0, -1) };
}

/** 値をそのまま置き換える（`=` の結果を項目に入れるときに使う）。 */
export function fromDigits(value: string): Entry {
  return value === "" ? EMPTY : { tokens: [{ kind: "digits", text: value }] };
}

function replaceLast(entry: Entry, token: Token): Entry {
  return { tokens: [...entry.tokens.slice(0, -1), token] };
}

/** 表示のための桁区切り。金額は number に収まらないので文字列のまま加工する。 */
export function grouped(amount: string): string {
  return amount.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

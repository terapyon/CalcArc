/**
 * 履歴の貯め方・読み書き。
 *
 * **Storage を引数で受ける**——ブラウザの Storage を直接掴まない(settings と
 * 同じ考え方)。壊れた JSON・知らない値・例外を投げる Storage の分岐が、
 * すべて React の外で試せる。
 */

import {
  ALLOWED,
  HISTORY_KEY,
  HISTORY_LIMIT,
  type HistoryEntry,
  type HistoryStorage,
} from "./types";

export type { HistoryEntry, HistoryStorage } from "./types";
export { HISTORY_KEY, HISTORY_LIMIT } from "./types";

/** 白リストに載っているかどうかだけを見る(型を絞り込む)。 */
function isAllowed<T>(allowed: readonly T[], value: unknown): value is T {
  return (allowed as readonly unknown[]).includes(value as T);
}

/**
 * 1 件を検証する。**4 つの欄すべてが揃って初めて有効**——
 * 欠けている欄が 1 つでもあれば `null`(呼び出し側が読み飛ばす)。
 */
function parseEntry(value: unknown): HistoryEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.expression !== "string") return null;
  if (typeof v.answer !== "string") return null;
  if (!isAllowed(ALLOWED.angle, v.angle)) return null;
  if (typeof v.error !== "boolean") return null;
  return {
    expression: v.expression,
    answer: v.answer,
    angle: v.angle,
    error: v.error,
  };
}

function parse(raw: string): HistoryEntry[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(json)) return [];

  const out: HistoryEntry[] = [];
  for (const item of json) {
    const entry = parseEntry(item);
    if (entry !== null) out.push(entry);
  }
  return out.slice(0, HISTORY_LIMIT);
}

export function readHistory(storage: HistoryStorage): HistoryEntry[] {
  let raw: string | null;
  try {
    raw = storage.getItem(HISTORY_KEY);
  } catch {
    // Storage が使えなくても計算は続く(設定と同じ考え方)。
    return [];
  }
  return raw === null ? [] : parse(raw);
}

export function writeHistory(
  storage: HistoryStorage,
  entries: HistoryEntry[],
): void {
  try {
    storage.setItem(
      HISTORY_KEY,
      JSON.stringify(entries.slice(0, HISTORY_LIMIT)),
    );
  } catch {
    // 保存できないことは利用者に伝えない(設定と同じ考え方)。
  }
}

/**
 * 新しいものが先頭。**溢れたら末尾(古いもの)から捨てる。**
 *
 * **式が空なら積まない**(`=` の 2 度押しがここに来る)。
 * **先頭と式・答・角度モードが 3 つとも一致しても積まない**。
 * どちらの場合も**受け取った列をそのまま返す**。
 */
export function pushEntry(
  entries: HistoryEntry[],
  entry: HistoryEntry,
): HistoryEntry[] {
  if (entry.expression === "") return entries;

  const top = entries[0];
  if (
    top !== undefined &&
    top.expression === entry.expression &&
    top.answer === entry.answer &&
    top.angle === entry.angle
  ) {
    return entries;
  }

  return [entry, ...entries].slice(0, HISTORY_LIMIT);
}

export function removeAt(
  entries: HistoryEntry[],
  index: number,
): HistoryEntry[] {
  return entries.filter((_, i) => i !== index);
}

export function clearAll(): HistoryEntry[] {
  return [];
}

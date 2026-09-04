/** `storage.ts` と `web/src/history/` をつなぐ。**掴み手は持たない。** */
import { type HistoryEntry, readHistory, writeHistory } from "../history";
import { browserStorage } from "./storage";

export function loadHistory(): HistoryEntry[] {
  const storage = browserStorage();
  return storage === null ? [] : readHistory(storage);
}

export function saveHistory(entries: HistoryEntry[]): void {
  const storage = browserStorage();
  if (storage !== null) writeHistory(storage, entries);
}

/**
 * 設定の読み書きをブラウザの Storage につなぐ。
 *
 * **ブラウザの Storage を掴む場所は `./storage.ts` に 1 つだけ**である
 * (P-1 設計書 §6)。web/src/settings/ は Storage を引数で受け取る純粋な
 * モジュールで、ここがその引数を埋める。
 *
 * hook ではないが ui 層に置く——ブラウザの Storage はブラウザの持ち物で、
 * web/src/settings/ が掴むと jsdom 無しに試せなくなる。
 */

import {
  defaultSettings,
  readSettings,
  type Settings,
  writeSettings,
} from "../settings";
import { browserStorage } from "./storage";

export function loadSettings(): Settings {
  const storage = browserStorage();
  return storage === null ? defaultSettings() : readSettings(storage);
}

export function saveSettings(next: Settings): void {
  const storage = browserStorage();
  if (storage !== null) writeSettings(storage, next);
}

/** 読んで、変えて、書く。パネルが 1 項目だけ変えるときに使う。 */
export function updateSettings(patch: (current: Settings) => Settings): void {
  saveSettings(patch(loadSettings()));
}

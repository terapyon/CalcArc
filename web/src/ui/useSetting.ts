/**
 * 設定の読み書きを localStorage につなぐ。
 *
 * **localStorage を掴むのはこのファイルだけ**である(P-1 設計書 §6)。
 * web/src/settings/ は Storage を引数で受け取る純粋なモジュールで、
 * ここがその引数を埋める。
 *
 * hook ではないが ui 層に置く——localStorage はブラウザの持ち物で、
 * web/src/settings/ が掴むと jsdom 無しに試せなくなる。
 */

import {
  defaultSettings,
  readSettings,
  type Settings,
  type SettingsStorage,
  writeSettings,
} from "../settings";

/**
 * localStorage を返す。**参照そのものが投げることがある**
 * ——Safari のプライベートモードや、ストレージを無効にした設定である。
 */
function browserStorage(): SettingsStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

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

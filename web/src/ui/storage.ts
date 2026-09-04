/**
 * ブラウザの `localStorage` を掴む**唯一の場所**。
 *
 * **参照そのものが投げることがある**——Safari のプライベートモードや、
 * ストレージを無効にした設定である。掴み手をここ 1 つに寄せてあるので、
 * **その分岐を書く場所も 1 つで済む。**
 *
 * 掴まない側（`web/src/settings/` と `web/src/history/`）は Storage を
 * 引数で受ける純粋なモジュールで、**jsdom 無しに試せる。**
 */
export interface BrowserStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function browserStorage(): BrowserStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * ビルド時に作るマニュアルの本文（`vite.config.ts` の `manualsPlugin`）。
 *
 * **動的 import でしか読まない**——`import("virtual:manuals")` が**別の塊**になる
 * （0.9.6 設計書 §4.5、監視役の裁定 2026-09-23）。
 */
declare module "virtual:manuals" {
  import type { ManualBook } from "../scripts/manual/books.ts";

  const books: readonly ManualBook[];
  export default books;
}

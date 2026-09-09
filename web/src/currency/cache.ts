/**
 * レートの保存(U-4 設計書 §4.1・§4.4)。
 *
 * **IndexedDB を掴むのはこのファイルだけ**——`localStorage` を掴むのが
 * `web/src/ui/storage.ts` だけなのと同じ約束である(spec §4.1)。**ここは
 * `localStorage` を触らない。**
 *
 * **版が違う・壊れている・読めないときは、捨てて「キャッシュ無し」に倒す**
 * (§4.4)。**移行は書かない**——レートは捨てても取り直せる。利用者が作った
 * 値ではないので、設定(`web/src/settings/`)とは立場が違う。
 *
 * **React を import しない。**
 */

import type { CurrencyRateSet } from "./types";

/** IndexedDB のデータベース名。 */
export const DB_NAME = "calcarc-currency";

/**
 * IndexedDB 自身の版。**オブジェクトストアの構造の版**であって、
 * {@link RATES_SCHEMA_VERSION} とは別物である。
 */
export const DB_VERSION = 1;

/** オブジェクトストア名。 */
export const STORE_NAME = "rates";

/** 保存するレコードの鍵。**レート表は常に 1 枚**(spec §9 は履歴を外している)。 */
export const RECORD_KEY = "latest";

/**
 * 保存した中身の版(spec §4.4)。
 *
 * **移行の仕組みではない。** `CurrencyRateSet` の意味が変わったらここを上げる
 * ——上げれば古いレコードは読まれずに捨てられ、次の取得で入れ直る。
 * `web/src/settings/` の `SETTINGS_VERSION` と同じ立場だが、あちらは
 * 「捨てると利用者の設定が消える」ので慎重、こちらは**捨ててよい。**
 */
export const RATES_SCHEMA_VERSION = 1;

/** 実際に IndexedDB へ入る形。 */
interface StoredRates {
  schemaVersion: number;
  set: CurrencyRateSet;
}

export interface RateCache {
  readRates(): Promise<CurrencyRateSet | null>;
  writeRates(set: CurrencyRateSet): Promise<void>;
  clearRates(): Promise<void>;
}

/** `IDBRequest` を Promise にする。 */
function requested<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request"));
  });
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // 鍵は外から渡す(keyPath を持たない)。レコードは 1 枚だけである。
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open"));
    // 他のタブが古い版を掴んでいると開けない。**待たずに諦める**
    // ——待つと画面がネットワークならぬ DB 待ちになる(§4.2 の「通信を待たない」
    // と同じ理由)。
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

/**
 * 1 トランザクションを回す。**`complete` を待つ**——書き込みは request の
 * success だけでは確定しない。
 */
async function withStore<T>(
  factory: IDBFactory,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openDb(factory);
  try {
    const tx = db.transaction(STORE_NAME, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB abort"));
    });
    const value = await run(tx.objectStore(STORE_NAME));
    await done;
    return value;
  } finally {
    db.close();
  }
}

/**
 * 保存されていた値が、書いたときの形のままかを見る。
 *
 * **ここで見るのは形だけである。** 「知らない通貨が入っている」「レートが
 * 10 進として読めない」は §4.3 の検証(`rates.ts`)の仕事で、そちらは
 * **項目ごとに落とす**。ここは §4.4 の「壊れていたら捨てる」だけを持つ。
 *
 * **`rates` の値が `string` でなければ捨てる。** 数値が入っているのは、
 * どこかで `f64` を通した書き込みが混ざった証拠である(spec §2.1)。
 */
function shaped(value: unknown): CurrencyRateSet | null {
  if (typeof value !== "object" || value === null) return null;
  const set = value as Record<string, unknown>;
  if (
    typeof set.baseCurrency !== "string" ||
    typeof set.date !== "string" ||
    typeof set.fetchedAt !== "string" ||
    typeof set.provider !== "string" ||
    typeof set.rates !== "object" ||
    set.rates === null ||
    Array.isArray(set.rates)
  ) {
    return null;
  }
  const rates: Record<string, string> = {};
  for (const [code, rate] of Object.entries(set.rates)) {
    if (typeof rate !== "string") return null;
    rates[code] = rate;
  }
  return {
    baseCurrency: set.baseCurrency,
    date: set.date,
    fetchedAt: set.fetchedAt,
    provider: set.provider,
    rates,
  };
}

/**
 * IndexedDB を掴むキャッシュを作る。
 *
 * **`factory` を渡せる**のは、テストが `fake-indexeddb` の `IDBFactory` を
 * 差し込むためである——本番は `globalThis.indexedDB` をそのまま使う。
 */
export function createRateCache(factory: IDBFactory): RateCache {
  async function drop(): Promise<void> {
    await withStore(factory, "readwrite", async (store) => {
      await requested(store.delete(RECORD_KEY));
    });
  }

  return {
    async readRates(): Promise<CurrencyRateSet | null> {
      let record: unknown;
      try {
        record = await withStore(factory, "readonly", (store) =>
          requested(store.get(RECORD_KEY) as IDBRequest<unknown>),
        );
      } catch {
        // 読めないなら「キャッシュ無し」に倒す(§4.4)。換算ができないだけで、
        // 他の 7 カテゴリは 1 つも壊れない(§0.0-4)。
        return null;
      }
      if (record === undefined) return null;

      const stored = record as Partial<StoredRates>;
      if (stored.schemaVersion !== RATES_SCHEMA_VERSION) {
        // **版が違えば捨てる。移行は書かない**(§4.4)。
        await drop().catch(() => {});
        return null;
      }
      const set = shaped(stored.set);
      if (set === null) {
        await drop().catch(() => {});
        return null;
      }
      return set;
    },

    async writeRates(set: CurrencyRateSet): Promise<void> {
      const record: StoredRates = {
        schemaVersion: RATES_SCHEMA_VERSION,
        set,
      };
      try {
        await withStore(factory, "readwrite", async (store) => {
          await requested(store.put(record, RECORD_KEY));
        });
      } catch {
        // 保存できないことは利用者に伝えない(`settings/index.ts` と同じ判断)。
        // 次に開いたときに取り直せばよい。
      }
    },

    async clearRates(): Promise<void> {
      try {
        await drop();
      } catch {
        // 同上。消せなかったとしても、読む側が版と形を見て捨てる。
      }
    },
  };
}

/** 既定のキャッシュ。`globalThis.indexedDB` が無い環境では何も持たない。 */
let fallback: RateCache | null = null;

function defaultCache(): RateCache | null {
  if (fallback !== null) return fallback;
  const factory = globalThis.indexedDB as IDBFactory | undefined;
  if (factory === undefined || factory === null) return null;
  fallback = createRateCache(factory);
  return fallback;
}

/** キャッシュから読む。無い・版違い・壊れている・読めない → `null`(§4.4)。 */
export function readRates(): Promise<CurrencyRateSet | null> {
  return defaultCache()?.readRates() ?? Promise.resolve(null);
}

/** キャッシュに書く。**いつ書くかは `rates.ts` の `shouldWrite` が決める**(§4.2)。 */
export function writeRates(set: CurrencyRateSet): Promise<void> {
  return defaultCache()?.writeRates(set) ?? Promise.resolve();
}

/** キャッシュを捨てる。 */
export function clearRates(): Promise<void> {
  return defaultCache()?.clearRates() ?? Promise.resolve();
}

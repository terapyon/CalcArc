import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createRateCache,
  DB_NAME,
  DB_VERSION,
  RATES_SCHEMA_VERSION,
  RECORD_KEY,
  STORE_NAME,
} from "./cache";
import type { CurrencyRateSet } from "./types";

/**
 * **`fake-indexeddb` を差し込む**(jsdom は IndexedDB を持たない)。
 *
 * グローバルを差し替える `fake-indexeddb/auto` は使わない——**テスト間で
 * 同じ DB を共有してしまう**。`new IDBFactory()` は毎回まっさらである。
 */
function fresh(): IDBFactory {
  return new IDBFactory();
}

const SET: CurrencyRateSet = {
  baseCurrency: "USD",
  date: "2026-08-20",
  fetchedAt: "2026-08-20T00:10:00.000Z",
  provider: "https://www.exchangerate-api.com",
  rates: { USD: "1", JPY: "158.548543", EUR: "0.857421" },
};

/** cache.ts を通さずに 1 レコード書く。壊れた保存・古い版を作るために使う。 */
function rawPut(factory: IDBFactory, record: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = factory.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record, RECORD_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
    open.onerror = () => reject(open.error);
  });
}

/** cache.ts を通さずに 1 レコード読む。**捨てたことを確かめる**ために使う。 */
function rawGet(factory: IDBFactory): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const open = factory.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(RECORD_KEY);
      req.onsuccess = () => {
        db.close();
        resolve(req.result);
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    };
    open.onerror = () => reject(open.error);
  });
}

let factory: IDBFactory;

beforeEach(() => {
  factory = fresh();
});

describe("書いて読める", () => {
  it("往復する", async () => {
    const cache = createRateCache(factory);
    await cache.writeRates(SET);

    expect(await cache.readRates()).toEqual(SET);
  });

  it("キャッシュが無ければ null", async () => {
    expect(await createRateCache(factory).readRates()).toBeNull();
  });

  it("上書きできる(常に 1 枚)", async () => {
    const cache = createRateCache(factory);
    await cache.writeRates(SET);
    await cache.writeRates({ ...SET, date: "2026-08-21" });

    const back = await cache.readRates();
    expect(back?.date).toBe("2026-08-21");
  });
});

describe("rates は string のまま往復する", () => {
  it("number に化けていない", async () => {
    const cache = createRateCache(factory);
    await cache.writeRates(SET);

    const back = await cache.readRates();
    expect(back).not.toBeNull();
    const rates = (back as CurrencyRateSet).rates;
    // **綴りが保たれる。** 型でも見る(spec §2.1)。
    expect(rates.JPY).toBe("158.548543");
    for (const rate of Object.values(rates)) {
      expect(typeof rate).toBe("string");
    }
  });

  /**
   * **保存を往復しても f64 を通していないことの固定。**
   *
   * 綴りは provider.test.ts と同じ 3 つ——`JSON.parse` / `Number` を 1 度でも
   * 通せば `0.12345678901234568` / `2.5` / `9007199254740992` に変わる(実測)。
   */
  it("f64 を通せば変わる綴りが、保存を越えて残る", async () => {
    const cache = createRateCache(factory);
    await cache.writeRates({
      ...SET,
      rates: {
        AAA: "0.1234567890123456789",
        BBB: "2.50",
        CCC: "9007199254740993",
      },
    });

    const back = await cache.readRates();
    expect(back?.rates).toEqual({
      AAA: "0.1234567890123456789",
      BBB: "2.50",
      CCC: "9007199254740993",
    });
  });

  it("number が入っていたセットは丸ごと捨てる", async () => {
    // どこかで f64 を通した書き込みが混ざった状態。**読まずに捨てる。**
    await rawPut(factory, {
      schemaVersion: RATES_SCHEMA_VERSION,
      set: { ...SET, rates: { USD: 1, JPY: 158.548543 } },
    });

    expect(await createRateCache(factory).readRates()).toBeNull();
  });
});

describe("捨てて「キャッシュ無し」に倒す(§4.4)", () => {
  it("版が違えば捨てる", async () => {
    await rawPut(factory, {
      schemaVersion: RATES_SCHEMA_VERSION + 1,
      set: SET,
    });

    expect(await createRateCache(factory).readRates()).toBeNull();
    // **移行しないだけでなく、残さない。**
    expect(await rawGet(factory)).toBeUndefined();
  });

  it("版が無ければ捨てる", async () => {
    await rawPut(factory, { set: SET });

    expect(await createRateCache(factory).readRates()).toBeNull();
    expect(await rawGet(factory)).toBeUndefined();
  });

  it("壊れた値を読んだら null", async () => {
    await rawPut(factory, {
      schemaVersion: RATES_SCHEMA_VERSION,
      set: { baseCurrency: "USD" },
    });

    expect(await createRateCache(factory).readRates()).toBeNull();
    expect(await rawGet(factory)).toBeUndefined();
  });

  it("set がオブジェクトでなければ null", async () => {
    await rawPut(factory, { schemaVersion: RATES_SCHEMA_VERSION, set: "USD" });

    expect(await createRateCache(factory).readRates()).toBeNull();
  });

  it("レコードそのものが別物でも null", async () => {
    await rawPut(factory, 42);

    expect(await createRateCache(factory).readRates()).toBeNull();
  });

  it("IndexedDB が使えなくても null を返す(例外を投げない)", async () => {
    const broken = {
      open() {
        throw new Error("no IndexedDB here");
      },
    } as unknown as IDBFactory;

    expect(await createRateCache(broken).readRates()).toBeNull();
    // 書き込みと消去も黙って諦める(settings/index.ts と同じ判断)。
    await expect(
      createRateCache(broken).writeRates(SET),
    ).resolves.toBeUndefined();
    await expect(createRateCache(broken).clearRates()).resolves.toBeUndefined();
  });
});

describe("clearRates", () => {
  it("消える", async () => {
    const cache = createRateCache(factory);
    await cache.writeRates(SET);
    expect(await cache.readRates()).not.toBeNull();

    await cache.clearRates();

    expect(await cache.readRates()).toBeNull();
    expect(await rawGet(factory)).toBeUndefined();
  });

  it("何も無くても落ちない", async () => {
    await expect(
      createRateCache(factory).clearRates(),
    ).resolves.toBeUndefined();
  });
});

describe("localStorage を触らない", () => {
  it("書いても読んでも localStorage は空のまま(§4.1)", async () => {
    localStorage.clear();
    const cache = createRateCache(factory);
    await cache.writeRates(SET);
    await cache.readRates();
    await cache.clearRates();

    expect(localStorage.length).toBe(0);
  });
});

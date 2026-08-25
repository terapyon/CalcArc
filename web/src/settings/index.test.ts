import { describe, expect, it } from "vitest";
import {
  defaultSettings,
  readSettings,
  SETTINGS_KEY,
  type SettingsStorage,
  writeSettings,
} from "./index";

/** localStorage の代わり。**jsdom を要らなくするために引数で渡す。** */
function fakeStorage(
  initial?: string,
): SettingsStorage & { saved: string | null } {
  return {
    saved: initial ?? null,
    getItem() {
      return this.saved;
    },
    setItem(_key: string, value: string) {
      this.saved = value;
    },
  };
}

/** 読み書きのどちらも投げる Storage(プライベートモード・容量超過)。 */
const throwingStorage: SettingsStorage = {
  getItem() {
    throw new Error("storage is not available");
  },
  setItem() {
    throw new Error("quota exceeded");
  },
};

describe("readSettings", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(readSettings(fakeStorage())).toEqual(defaultSettings());
  });

  it("keeps the fields it can read and drops only the ones it cannot", () => {
    // **これが「項目ごとに検査する」の本体**(P-1 設計書 §1-2)。
    // notation が壊れていても angle は生き残る。
    const storage = fakeStorage(
      JSON.stringify({ v: 1, scientific: { angle: "Rad", form: "Zzz" } }),
    );
    const read = readSettings(storage);
    expect(read.scientific.angle).toBe("Rad");
    expect(read.scientific.form).toBe("Rect");
  });

  it("survives a version it does not know", () => {
    // v は移行の仕組みではない(設計書 §5)。綴りが有効なら通す。
    const storage = fakeStorage(
      JSON.stringify({ v: 999, scientific: { angle: "Rad" } }),
    );
    expect(readSettings(storage).scientific.angle).toBe("Rad");
  });

  it("falls back to the defaults when the JSON is broken", () => {
    expect(readSettings(fakeStorage("{not json"))).toEqual(defaultSettings());
  });

  it("falls back to the defaults when the stored value is not an object", () => {
    expect(readSettings(fakeStorage("42"))).toEqual(defaultSettings());
  });

  it("does not throw when the storage itself throws", () => {
    // **保存できなくても計算は続く**(設計書 §6)。
    expect(readSettings(throwingStorage)).toEqual(defaultSettings());
  });

  it("ignores a section it does not know", () => {
    const storage = fakeStorage(
      JSON.stringify({
        v: 1,
        convert: { length: "m" },
        finance: { mode: "compound" },
      }),
    );
    const read = readSettings(storage);
    expect(read.finance.mode).toBe("compound");
    expect(read).toEqual({
      ...defaultSettings(),
      finance: { ...defaultSettings().finance, mode: "compound" },
    });
  });

  it("rejects a number that is not one of the allowed periods", () => {
    const storage = fakeStorage(
      JSON.stringify({ v: 1, finance: { periodsPerYear: 7 } }),
    );
    expect(readSettings(storage).finance.periodsPerYear).toBe(12);
  });

  it("rejects a non-boolean withholding", () => {
    const storage = fakeStorage(
      JSON.stringify({ v: 1, finance: { withholding: "yes" } }),
    );
    expect(readSettings(storage).finance.withholding).toBe(false);
  });
});

describe("writeSettings", () => {
  it("omits the fields that equal the defaults", () => {
    // 初期値と同じ項目は書かない(設計書 §3)。
    const storage = fakeStorage();
    const next = defaultSettings();
    next.scientific.angle = "Rad";
    writeSettings(storage, next);
    expect(JSON.parse(storage.saved as string)).toEqual({
      v: 1,
      scientific: { angle: "Rad" },
    });
  });

  it("writes only the version when nothing differs from the defaults", () => {
    const storage = fakeStorage();
    writeSettings(storage, defaultSettings());
    expect(JSON.parse(storage.saved as string)).toEqual({ v: 1 });
  });

  it("does not throw when the storage refuses to write", () => {
    expect(() =>
      writeSettings(throwingStorage, defaultSettings()),
    ).not.toThrow();
  });

  it("round-trips every field", () => {
    // **全項目を 1 度は往復させる。** 1 項目でも配線を忘れると落ちる。
    const storage = fakeStorage();
    const next: ReturnType<typeof defaultSettings> = {
      scientific: { angle: "Rad", form: "Polar" },
      dataScale: { dtype: "int8", primary: "binary" },
      finance: { mode: "compound", periodsPerYear: 1, withholding: true },
    };
    writeSettings(storage, next);
    expect(readSettings(storage)).toEqual(next);
  });

  it("stores under the documented key", () => {
    const storage = fakeStorage();
    let usedKey = "";
    writeSettings(
      {
        getItem: () => null,
        setItem: (key) => {
          usedKey = key;
        },
      },
      defaultSettings(),
    );
    expect(usedKey).toBe(SETTINGS_KEY);
    expect(storage.saved).toBeNull();
  });
});

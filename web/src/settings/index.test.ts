import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("rejects a deposit timing that is not one of the two tokens", () => {
    // **知らない綴りは既定(期末)に倒す。** ここで倒さないと、壊れた保存が
    // 画面の初期値を `undefined` にして「期末でも期首でもない」状態を作る。
    const storage = fakeStorage(
      JSON.stringify({ v: 1, finance: { depositTiming: "BGN" } }),
    );
    expect(readSettings(storage).finance.depositTiming).toBe("end");
  });

  it("rejects a non-boolean withholding", () => {
    const storage = fakeStorage(
      JSON.stringify({ v: 1, finance: { withholding: "yes" } }),
    );
    expect(readSettings(storage).finance.withholding).toBe(false);
  });

  it("defaults history to on", () => {
    expect(defaultSettings().history.enabled).toBe(true);
  });

  it("keeps history on when the stored section is missing", () => {
    // **古い保存には history が無い。** 既定は入(設計書 §7)。
    const storage = fakeStorage(JSON.stringify({ v: 1, scientific: {} }));
    expect(readSettings(storage).history.enabled).toBe(true);
  });

  it("takes a stored false", () => {
    const storage = fakeStorage(
      JSON.stringify({ v: 1, history: { enabled: false } }),
    );
    expect(readSettings(storage).history.enabled).toBe(false);
  });

  it("falls back to on when the stored value is not a boolean", () => {
    const storage = fakeStorage(
      JSON.stringify({ v: 1, history: { enabled: "no" } }),
    );
    expect(readSettings(storage).history.enabled).toBe(true);
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
      finance: {
        mode: "compound",
        periodsPerYear: 1,
        withholding: true,
        depositTiming: "start",
      },
      history: { enabled: false },
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

  it("saves exactly these nine fields, and the spec says nine", () => {
    // **保存する欄の集合を字面で持つ**（0.9.6）。**`toEqual({ ...defaultSettings() })`
    // の形は、10 個目を足しても緑**である——**この形の検査は 0 件だった**
    // （検証役 calcarc-be が `Object.keys`・`depositTiming`・`withholding` で探した、
    // 2026-09-24）。**実際に `base-spec.md` の「保存しているのは 7 項目」は
    // 2 つぶん古くなっていた**（`depositTiming` と `history.enabled` が足されたのに
    // 動かなかった）。**同じ腐り方をもう一度させない。**
    //
    // **欄を足す・消すのは正しい変更である。** ここが赤くなったら、
    // **この表と `docs/base-spec.md` の数を一緒に直す**——**直すことを
    // 忘れないための番人**であって、増やすなと言っているのではない。
    const saved = new Set<string>();
    for (const [section, fields] of Object.entries(defaultSettings())) {
      for (const field of Object.keys(fields as Record<string, unknown>)) {
        saved.add(`${section}.${field}`);
      }
    }
    expect([...saved].sort()).toEqual([
      "dataScale.dtype",
      "dataScale.primary",
      "finance.depositTiming",
      "finance.mode",
      "finance.periodsPerYear",
      "finance.withholding",
      "history.enabled",
      "scientific.angle",
      "scientific.form",
    ]);

    // **文書の数と、コードの形を結ぶ**（`tools/check-manual-limits.mjs` と同じ型）。
    // **数が 2 か所にあるなら、機械が突き合わせる。**
    // `readFileSync(new URL(相対, import.meta.url))` は vitest で
    // 「The URL must be of scheme file」で落ちる（`manual-widths.test.ts:42` の
    // 註と同じ罠。**踏んだので同じ形にした**）。
    const spec = readFileSync(
      join(import.meta.dirname, "../../../docs/base-spec.md"),
      "utf8",
    );
    const written = [...spec.matchAll(/いま保存しているのは (\d+) 項目/g)];
    expect(written, "base-spec の「いま保存しているのは … 項目」").toHaveLength(
      1,
    );
    expect(Number(written[0]?.[1])).toBe(saved.size);
  });
});

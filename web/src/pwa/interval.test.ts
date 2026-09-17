import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UPDATE_CHECK_INTERVAL_MS } from "./interval";

/**
 * `index.ts` の**本文**。**読み込んで動かすことはできない**
 * (`virtual:pwa-register` は vite が作る仮想モジュールで、jsdom には無い)
 * ので、**本文を当てる**——`web/scripts/check-sw.mjs` や
 * `tools/tests/webkit-gate.test.ts` と同じ作法である。
 */
const wiring = readFileSync(join(import.meta.dirname, "index.ts"), "utf8");

describe("新しい版を探す間隔（0.9.3 設計書 §3.2）", () => {
  it("6 時間である", () => {
    // **「間隔が在る」ではなく「6 時間である」を見る。**
    //
    // **緩めれば緑になる数字にしないため**である——「在ること」だけを見る検査は、
    // 値を 24 時間に変えても緑のままになる。**利用者は「最大 6 時間遅れて届く」を
    // 承知で選んだ**(裁定 2026-09-17)ので、**その 6 時間がここに在る**。
    //
    // **2 つの綴りで書く。** 読める形と、掛け算を間違えたときに落ちる形の両方。
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(21_600_000);
  });

  it("その間隔が実際に使われている", () => {
    // **「6 時間である」と「6 時間が使われている」は別である。**
    //
    // **1e の変異 m2（2026-09-17）**: `index.ts` の
    // `setInterval(…, UPDATE_CHECK_INTERVAL_MS)` を `setInterval(…, 1000)` に
    // 書き換えても、**`web` の 556 本すべてが緑のままだった**——上の検査は
    // **定数の値しか見ていない**ので、**配線を戻しても誰も気づかない**。
    //
    // **定数を別ファイルに出したこと自体は正しい**（`index.ts` は
    // `virtual:pwa-register` を引き込むので検査から読めない）。**その結果として
    // 配線の側に「緩めれば緑」が残った**ので、ここで本文を当てて塞ぐ。
    // **「在ること」と「効いていること」は別**——この 2 本が並んで初めて揃う。
    expect([...wiring.matchAll(/setInterval\(/g)]).toHaveLength(1);
    expect(wiring).toMatch(
      /setInterval\([\s\S]*?UPDATE_CHECK_INTERVAL_MS\s*\)/,
    );
    // 間隔で呼ぶ相手も見る。**間隔だけ正しくて何も探さない**形を残さない。
    expect(wiring).toMatch(/registration\.update\(/);
  });
});

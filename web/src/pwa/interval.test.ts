import { describe, expect, it } from "vitest";
import { UPDATE_CHECK_INTERVAL_MS } from "./interval";

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
});

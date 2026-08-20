import { describe, expect, it } from "vitest";
import { REQUIRED_KEYS } from "../heavy-ui/presses";
import { selectSample } from "../heavy-ui/select";

/**
 * **必須キーを含むケースが 1 件も選ばれないことがありうる。**
 *
 * 実測(2026-08-20)では既定の 100 件でたまたま 8 キーすべてが選ばれていたが、
 * それはコーパスの並びに依存した偶然だった——`del` を含むケースはコーパス
 * 33,567 件のうち 3 件で、その 3 件は 36 件しかないシャードに居るから
 * 全部選ばれていただけである。**偶然を仕様に変える**のがこの選び方で、
 * ここはそれが本当に効いているかを、走行の外から確かめる。
 */

const pool = (length: number, rare: { at: number; key: string }) =>
  Array.from({ length }, (_, i) => ({
    id: i,
    keys: i === rare.at ? ["1", rare.key] : ["1", "add", "2"],
  }));

describe("selectSample", () => {
  it("takes everything when the pool is smaller than the sample", () => {
    const items = pool(36, { at: 7, key: "del" });
    expect(selectSample(items, 100)).toEqual(items);
  });

  it("secures a required key the stride would have walked past", () => {
    // 1000 件から 100 件を等間隔に選ぶと 0, 10, 20, … なので 7 は落ちる。
    const items = pool(1000, { at: 7, key: "del" });
    const sample = selectSample(items, 100);
    expect(sample.map((c) => c.id)).toContain(7);
  });

  it("still returns exactly the requested count", () => {
    const items = pool(1000, { at: 7, key: "del" });
    expect(selectSample(items, 100)).toHaveLength(100);
  });

  it("still reaches the tail of the shard", () => {
    // **必須キーの確保が等間隔の網を食い潰していない。** 先頭だけを通す形に
    // 戻ると、生成の後半に出てくる形をまったく踏まなくなる。
    const items = pool(1000, { at: 7, key: "del" });
    const ids = selectSample(items, 100).map((c) => c.id);
    expect(Math.max(...ids)).toBeGreaterThanOrEqual(900);
  });

  it("secures one case for each required key that the pool carries", () => {
    const items = Array.from({ length: 2000 }, (_, i) => ({
      id: i,
      keys: ["1"],
    }));
    // 必須キーを 1 件ずつ、等間隔の網から外れる位置に置く。
    REQUIRED_KEYS.forEach(({ token }, n) => {
      const at = n * 100 + 3;
      items[at] = { id: at, keys: ["1", token] };
    });
    const sample = selectSample(items, 100);
    for (const { token } of REQUIRED_KEYS) {
      expect(sample.some((c) => c.keys.includes(token))).toBe(true);
    }
    expect(sample).toHaveLength(100);
  });

  it("does not invent a case for a key the pool does not carry", () => {
    // 確保できないものを確保したことにしない。**足りないことは走行の
    // 終わりに `globalTeardown` が言う**——ここで黙って埋めると言わなくなる。
    const items = pool(1000, { at: 7, key: "add" });
    const sample = selectSample(items, 100);
    expect(sample.some((c) => c.keys.includes("del"))).toBe(false);
  });
});

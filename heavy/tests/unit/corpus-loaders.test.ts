import { describe, expect, it } from "vitest";
import { loadCallShards, loadShards } from "../corpus/corpus";

/**
 * **どちらのローダーが `finance-start-000.json` を読むかを見張る。**
 *
 * `CALL_SHARD_PATTERN` がシャード名からローダーを振り分ける
 * (`heavy/tests/corpus/corpus.ts`)。この正規表現が期首のシャードを
 * 拾い損ねると、`loadShards()` 側に落ちて `tolerance`/`kind` の無い
 * シャードとして即座に落ちるか(気づける)、もっと悪いことに**どちらの
 * ローダーにも拾われず、静かに一度も検査されない**(気づけない——コーパスの
 * 総数もカウントも変わらないまま、ファイルだけが盤上から消える)。
 *
 * **本体側のテスト(`calls.spec.ts`)は Playwright で、この境界を直接は
 * 見ない。** あちらは「読めたシャードが参照実装と一致するか」を見るだけで、
 * 「読めるべきシャードが正しいローダーに割り振られているか」は見ない。
 */
describe("corpus-loaders: どのシャードをどのローダーが読むか", () => {
  it("loadCallShards() は finance-start-000.json と finance-000.json を読む", () => {
    const names = loadCallShards().map((s) => s.name);
    expect(names).toContain("finance-start-000.json");
    expect(names).toContain("finance-000.json");
  });

  it("loadShards() は finance-start-000.json も finance-000.json も読まない", () => {
    const names = loadShards().map((s) => s.name);
    expect(names).not.toContain("finance-start-000.json");
    expect(names).not.toContain("finance-000.json");
  });

  // **空でも緑になるのを防ぐ。** 上の `toContain`/`not.toContain` だけだと、
  // どちらのローダーも 0 件しか読まない壊れ方(パターンが全部を弾く、
  // ディレクトリを見つけられない、等)でも `not.toContain` の側は緑になる。
  // 実物の枚数の下限を刺しておく——`loadCallShards()` はいま 3 枚
  // (`data-scale`/`finance`/`finance-start`)、`loadShards()` は 10 枚を
  // 大きく超える。下限は実数より緩く取り、シャードが増えても壊れないように
  // する。
  it("どちらのローダーも空ではない(下限を刺す)", () => {
    expect(loadCallShards().length).toBeGreaterThanOrEqual(3);
    expect(loadShards().length).toBeGreaterThanOrEqual(10);
  });
});

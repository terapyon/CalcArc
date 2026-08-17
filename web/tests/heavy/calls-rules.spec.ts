import { expect, test } from "@playwright/test";
import { differences, normalise } from "./calls";
import { loadCallShards } from "./corpus";

/**
 * **比較の規則そのものを敵対的に確かめる。**
 *
 * 金融とデータスケールの照合は「wasm の構造体」と「参照実装の辞書」を突き合わせる。
 * 綴りが違うので寄せているが、**寄せる作業は食い違いを隠す作業でもある**——
 * 規則を 1 つ緩めるたびに、見えなくなる壊れ方がある。
 *
 * ここは「規則が本当に必要な差だけを黙認しているか」を、
 * **壊れ方を 1 つずつ作って**確かめる場所である。緑になってはいけない形が
 * 緑になったら、判定表の「完全に正しい」が嘘になる。
 */

const NO_INPUT = {};

test("a value that differs from the reference is always reported", () => {
  const diff = differences(
    { totalPayment: "999" },
    { total_payment: "1000" },
    NO_INPUT,
  );
  expect(diff).toHaveLength(1);
  expect(diff[0]?.key).toBe("total_payment");
});

test("a key the reference has but wasm does not is reported", () => {
  // wasm が欄ごと返さなくなっても、残りが合っていれば緑——を防ぐ。
  const diff = differences({}, { total_payment: "1000" }, NO_INPUT);
  expect(diff).toHaveLength(1);
  expect(diff[0]?.actual).toBeUndefined();
});

test("wasm returning null where the reference has a value is reported", () => {
  // **これがいちばん重い壊れ方である。** 計算できたはずのものを計算できなかった、
  // という意味なので、`null` を一律に黙認すると判定が最も重い嘘をつく。
  const diff = differences(
    { totalPayment: null },
    { total_payment: "1000" },
    NO_INPUT,
  );
  expect(diff).toHaveLength(1);
  expect(diff[0]?.actual).toBeNull();
});

test("wasm claiming an error where the reference succeeded is reported", () => {
  const diff = differences(
    { error: "Overflow", totalPayment: "1000" },
    { total_payment: "1000" },
    NO_INPUT,
  );
  expect(diff).toHaveLength(1);
  expect(diff[0]?.key).toBe("error");
});

test("a different error name is reported", () => {
  // エラーになること自体が仕様なので、**名前が違えば食い違いである。**
  const diff = differences(
    { error: "Overflow" },
    { error: "DoesNotClear" },
    NO_INPUT,
  );
  expect(diff).toHaveLength(1);
});

test("the null fields that accompany an error are not counted twice", () => {
  // wasm はエラー時に値の欄を null で埋め、参照はキーごと出さない。
  // 同じ事実の別の書き方なので、ここは食い違いではない。
  const diff = differences(
    { error: "Overflow", totalPayment: null, rowsPaid: null },
    { error: "Overflow" },
    NO_INPUT,
  );
  expect(diff).toEqual([]);
});

test("an input echoed back unchanged is not a difference", () => {
  const diff = differences({ periods: "149" }, {}, { periods: 149 });
  expect(diff).toEqual([]);
});

test("an input echoed back CHANGED is reported", () => {
  // **入力を歪めて返す壊れ方。** 「エコーは無視」を無条件にすると見逃す。
  const diff = differences({ periods: "150" }, {}, { periods: 149 });
  expect(diff).toHaveLength(1);
  expect(diff[0]?.why).toContain("echoed");
});

test("a field wasm invents, which is neither null nor an echo, is reported", () => {
  const diff = differences({ surprise: "42" }, {}, NO_INPUT);
  expect(diff).toHaveLength(1);
});

test("a result that is not an object is reported rather than skipped", () => {
  expect(differences(null, { a: 1 }, NO_INPUT)).toHaveLength(1);
  expect(differences("boom", { a: 1 }, NO_INPUT)).toHaveLength(1);
});

test("a string and a number are not treated as equal", () => {
  // 参照側は金額を文字列で持つ。wasm が数で返していたら、それ自体が食い違い
  // ——JSON にしたとき別物になるので、境界を越えるときに壊れている。
  const diff = differences(
    { totalPayment: 1000 },
    { total_payment: "1000" },
    NO_INPUT,
  );
  expect(diff).toHaveLength(1);
});

test("two wasm keys mapping to one reference key is refused, not silently merged", () => {
  // 片方が黙って上書きされると、比較は「一致した」と読める。
  expect(() =>
    normalise({ monthlyPayment: "1", monthly_payment: "2" }),
  ).toThrow();
});

test("every call shard on disk carries only call cases", () => {
  // `loadCallShards` は schema・空・kind を読んだその場で確かめる。
  // **その検証が実データに対して実際に走っている**ことをここで固定する
  // ——検証があっても呼ばれていなければ何も守らない。
  const shards = loadCallShards();
  expect(shards.length).toBeGreaterThan(0);
  for (const { name, shard } of shards) {
    expect(shard.cases.length, `${name} is empty`).toBeGreaterThan(0);
    for (const testCase of shard.cases) {
      expect(testCase.kind, `${name}: ${testCase.id}`).toBe("call");
    }
    // **`tolerance` を持たない。** 持たせると「緩めれば通る」余地が生まれる。
    expect(
      (shard as unknown as { tolerance?: unknown }).tolerance,
      `${name} carries a tolerance — these are exact integer comparisons`,
    ).toBeUndefined();
  }
});

test("every call case names an op the harness knows how to run", () => {
  // **未知の op は harness が投げる**が、それは走らせてみるまで分からない。
  // シャードの側で先に確かめておけば、原因が「op の綴り」だと即分かる。
  const known = new Set([
    "data_scale",
    "loan_forward",
    "loan_principal",
    "loan_term",
    "loan_bonus_forward",
    "loan_bonus_principal",
    "compound_grow",
    "compound_deposit_for",
    "compound_periods_for",
  ]);
  for (const { name, shard } of loadCallShards()) {
    for (const testCase of shard.cases) {
      expect(
        known.has(testCase.op),
        `${name}: ${testCase.id} ${testCase.op}`,
      ).toBe(true);
    }
  }
});

test("the rename table is applied, so loan_term's period is compared at all", () => {
  // wasm は `months`、参照は `n`。寄せなければ**両方が「片方にしか無いキー」に
  // なり、期間が一度も比較されない。**
  expect(differences({ months: 24 }, { n: 24 }, NO_INPUT)).toEqual([]);
  expect(differences({ months: 25 }, { n: 24 }, NO_INPUT)).toHaveLength(1);
});

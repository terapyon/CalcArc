#!/usr/bin/env node
/**
 * **このコーパスは壊れたものを赤くできるのか、を測る。**
 *
 * 「不一致 0 件」は、それだけでは「見つからなかった」しか言っていない。
 * 外の読み手が知りたいのは「**見つけられるのか**」である。そこで engine に
 * 既知の壊れ方を一時的に入れ、何件が赤くなるかを数える。
 *
 * **期待も一緒に書く。** 捕まるはずの変異が捕まらなければ失敗だが、
 * **捕まらないはずの変異が捕まっても失敗である**——レポートが
 * 「この領域は踏んでいない」と書いているなら、その主張が嘘だったことになる。
 *
 * 変異はコミットしない。各回のあとに原文へ戻し、バイト単位で一致を確かめる。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = dirname(WEB);
const OUT = join(WEB, "detection-power.json");

/**
 * 壊し方の一覧。
 *
 * `expect` は「どのシャードが赤くなるはずか」。`[]` は
 * **どこも赤くならないはず**という主張で、それはレポートの
 * 「この領域は踏んでいない」と同じことを言っている。
 */
const MUTATIONS = [
  {
    id: "display-digits",
    what: "表示の有効桁数を 10 から 9 に減らす",
    file: "crates/calcarc-core/src/numeric/format.rs",
    from: "pub const DISPLAY_DIGITS: usize = 10;",
    to: "pub const DISPLAY_DIGITS: usize = 9;",
    // 許容は表示から導いているので、値を持つシャードは全部反応する。
    expect: "every value shard",
  },
  {
    id: "precedence-collapse",
    what: "× ÷ の優先順位を + − と同じに落とす",
    file: "crates/calcarc-core/src/engine/state.rs",
    from: "BinOp::Mul | BinOp::Div => 2,",
    to: "BinOp::Mul | BinOp::Div => 1,",
    // **括弧を省いたシャードだけが反応するはず。** 全括弧のシャードは
    // 括弧が構造を決めるので、優先順位が変わっても答えが変わらない。
    expect: "precedence only",
  },
  {
    id: "associativity-flip",
    what: "同順位の畳み込みの向きを反転する",
    file: "crates/calcarc-core/src/engine/mod.rs",
    from: "|| (top.precedence() == op.precedence() && !op.is_right_associative())",
    to: "|| (top.precedence() == op.precedence() && op.is_right_associative())",
    // **どこも赤くならないはず。** レポートが「結合方向は踏んでいない」と
    // 書いており、これはその主張そのものである。赤くなったらレポートが嘘。
    expect: "nothing",
  },
  {
    id: "ncr-multiply-first",
    what: "nCr を「掛けてから割る」に戻す(実在したバグ)",
    file: "crates/calcarc-core/src/scientific/mod.rs",
    from: "acc = acc / (i + 1.0) * (n - i);",
    to: "acc = acc * (n - i) / (i + 1.0);",
    // 中心二項係数の帯だけ。答は f64 に収まるのに途中で溢れる。
    expect: "combinatorics only",
  },
];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: WEB,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: "1" },
    ...options,
  });
}

/** `pnpm heavy` を回して、シャードごとの不一致件数を読む。 */
function measure() {
  let output = "";
  try {
    output = run("pnpm", ["heavy"]);
  } catch (error) {
    // 赤くなるのが目的なので、失敗は想定内。出力だけ取る。
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  const caught = {};
  // 「every case in <shard> matches the reference」のテストが落ちたとき、
  // メッセージに「N of M cases disagree」が出る。
  const pattern =
    /every (?:case|call) in ([\w.-]+) matches the reference[\s\S]{0,400}?(\d+) of (\d+) (?:cases|calls) disagree/g;
  for (const match of output.matchAll(pattern)) {
    caught[match[1]] = Number(match[2]);
  }
  return caught;
}

function verdictFor(expectation, caught) {
  const shards = Object.keys(caught);
  const total = Object.values(caught).reduce((a, b) => a + b, 0);
  if (expectation === "nothing") {
    return {
      ok: shards.length === 0,
      why:
        shards.length === 0
          ? "赤くならなかった——レポートの「踏んでいない」が正しい"
          : `赤くなった(${shards.join(", ")})。レポートの「踏んでいない」が嘘である`,
    };
  }
  if (total === 0) {
    return { ok: false, why: "1 件も捕まえられなかった" };
  }
  if (expectation === "precedence only") {
    const others = shards.filter((s) => !s.startsWith("precedence-"));
    return {
      ok: others.length === 0,
      why:
        others.length === 0
          ? "括弧を省いたシャードだけが反応した"
          : `全括弧のシャードまで反応した(${others.join(", ")})`,
    };
  }
  if (expectation === "combinatorics only") {
    const others = shards.filter((s) => !s.startsWith("combinatorics-"));
    return {
      ok: others.length === 0,
      why:
        others.length === 0
          ? "組合せ論のシャードだけが反応した"
          : `他のシャードまで反応した(${others.join(", ")})`,
    };
  }
  return { ok: shards.length >= 3, why: `${shards.length} シャードが反応した` };
}

const results = [];
let failed = 0;

for (const mutation of MUTATIONS) {
  const path = join(ROOT, mutation.file);
  const original = readFileSync(path, "utf-8");
  if (!original.includes(mutation.from)) {
    // **黙って飛ばさない。** 変異が当たらなくなったのに緑で終わると、
    // 「検出力を測った」という記録だけが残って中身が空になる。
    console.error(
      `detection-power: ${mutation.id} の変異元が ${mutation.file} に無い。` +
        "engine が変わったので、変異を書き直すこと。",
    );
    failed += 1;
    results.push({ ...mutation, error: "mutation site not found" });
    continue;
  }
  process.stderr.write(`[${mutation.id}] ${mutation.what} ... `);
  writeFileSync(path, original.replace(mutation.from, mutation.to));
  let caught;
  try {
    caught = measure();
  } finally {
    // **必ず戻す。** 戻したことをバイトで確かめる。
    writeFileSync(path, original);
    if (readFileSync(path, "utf-8") !== original) {
      throw new Error(`detection-power: ${mutation.file} を戻せなかった`);
    }
  }
  const verdict = verdictFor(mutation.expect, caught);
  if (!verdict.ok) {
    failed += 1;
  }
  process.stderr.write(`${verdict.ok ? "ok" : "NG"} — ${verdict.why}\n`);
  results.push({
    id: mutation.id,
    what: mutation.what,
    expect: mutation.expect,
    caught,
    total: Object.values(caught).reduce((a, b) => a + b, 0),
    ok: verdict.ok,
    why: verdict.why,
  });
}

writeFileSync(OUT, `${JSON.stringify({ results }, null, 2)}\n`);
console.error(`detection-power: wrote ${OUT}`);
if (failed > 0) {
  console.error(`detection-power: ${failed} の変異が期待どおりでなかった`);
  process.exit(1);
}

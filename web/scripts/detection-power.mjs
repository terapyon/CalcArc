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
import { fileURLToPath, pathToFileURL } from "node:url";

const WEB = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = dirname(WEB);
const OUT = join(WEB, "detection-power.json");
const RUN_JSON = join(WEB, "heavy-run.json");

/**
 * 壊し方の一覧。
 *
 * `expect` は「どのシャードが赤くなるはずか」。`[]` は
 * **どこも赤くならないはず**という主張で、それはレポートの
 * 「この領域は踏んでいない」と同じことを言っている。
 */
export const MUTATIONS = [
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
    what: "nCr を「掛けてから割る」順に変える(答は収まるのに途中で溢れる)",
    file: "crates/calcarc-core/src/scientific/mod.rs",
    from: "acc = acc / (i + 1.0) * (n - i);",
    to: "acc = acc * (n - i) / (i + 1.0);",
    // 中心二項係数の帯だけ。答は f64 に収まるのに途中で溢れる。
    expect: "combinatorics only",
  },
  {
    id: "eng-exponent-toward-zero",
    what: "工学表記の指数を 0 方向に丸める(`div_euclid` を `/` に戻す)",
    file: "crates/calcarc-core/src/numeric/format.rs",
    from: "let eng_exponent = exponent.div_euclid(3) * 3;",
    to: "let eng_exponent = (exponent / 3) * 3;",
    // **1 未満の値だけが壊れる。** `-1 / 3` は Rust で `0` なので
    // `0.5` が `500e-3` ではなく `0.5` と出る。正の指数は影響を受けない。
    // 値は 1 ビットも変わらないので、**表示のシャード以外は何も気づかない**
    // ——それがこの段階を足した理由そのものである。
    expect: "display only",
  },
  {
    id: "sexagesimal-no-carry",
    what: "60 進の秒の繰り上がりを止める",
    file: "crates/calcarc-core/src/numeric/format.rs",
    from: "if text.parse::<f64>().unwrap_or(0.0) >= 60.0 {",
    to: "if text.parse::<f64>().unwrap_or(0.0) >= 600.0 {",
    // 桁を 1 つ間違えた形。秒は丸めても 60 を超えないので、繰り上がりが
    // **一度も起きなくなる**——`59'60\"` と出る。
    // これも値は変わらないので、表示のシャードにしか見えない。
    expect: "display only",
  },
  {
    id: "complex-multiply-sign",
    what: "複素数の乗算の実部の符号を反転する(i² = +1 にしてしまう)",
    file: "crates/calcarc-core/src/value.rs",
    from: "self.re * rhs.re - self.im * rhs.im,",
    to: "self.re * rhs.re + self.im * rhs.im,",
    // **実数には一切影響しない。** 虚部が両方 0 なら `- 0` も `+ 0` も同じで、
    // 既存 11 シャード 26000 件は 1 件も気づかない。複素数の乗算・除算・
    // 2 乗だけが変わる(`(j2)^2` が `-4` ではなく `4` になる)。
    expect: "complex only",
  },
  {
    id: "polar-angle-flipped",
    what: "極形式の偏角の引数を入れ替える(atan2(re, im) にする)",
    file: "crates/calcarc-core/src/polar.rs",
    from: "theta_rad: self.im.atan2(self.re),",
    to: "theta_rad: self.re.atan2(self.im),",
    // **半径は変わらない。** 角度だけが余角になる(53.13 が 36.87 に)。
    // `▸∠` を押した表示しか見ない欠陥で、直交形式の表示も値も動かない。
    expect: "complex only",
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

/**
 * 読み取り段だけを切り出した純関数。
 *
 * `measure()` から分けたのは、ここだけを単体テストするため。**プロセスを
 * 起動しないのでテストできる。** `run === null` は「heavy-run.json が無い」、
 * つまり `globalTeardown` まで走らなかった(ビルドで倒れた／
 * playwright 自体が起動しなかった)ことの印である。
 */
export function readMeasurement({ buildOk, playwrightExitCode, run }) {
  if (run === null) {
    return {
      buildOk,
      playwrightExitCode,
      runJsonFound: false,
      ranTests: false,
      expected: [],
      shardsSeen: [],
      mismatchesByShard: {},
      totalsByShard: {},
    };
  }
  const mismatchesByShard = {};
  const totalsByShard = {};
  for (const shard of run.shards) {
    mismatchesByShard[shard.name] = shard.mismatches;
    totalsByShard[shard.name] = shard.total;
  }
  return {
    buildOk,
    playwrightExitCode,
    runJsonFound: true,
    ranTests: run.ranTests,
    expected: run.expected,
    shardsSeen: run.shards.map((shard) => shard.name),
    mismatchesByShard,
    totalsByShard,
  };
}

/**
 * **走行を 3 段に分ける。**
 *
 * `pnpm heavy` は `pnpm wasm && playwright test` の合成なので、合成のまま
 * 呼ぶと**ビルド失敗とテスト失敗が同じ非ゼロ終了**になる。分けて呼べば、
 * どちらで倒れたかが別々の事実として残る。
 */
export function measure() {
  let buildOk = true;
  try {
    run("pnpm", ["wasm"]);
  } catch {
    buildOk = false;
  }
  let playwrightExitCode = null;
  if (buildOk) {
    try {
      run("pnpm", ["exec", "playwright", "test", "--config", "playwright.heavy.config.ts"]);
      playwrightExitCode = 0;
    } catch (error) {
      // **赤くなるのが目的なので、失敗は想定内。** 終了コードだけ取る。
      playwrightExitCode = typeof error.status === "number" ? error.status : 1;
    }
  }
  let parsed = null;
  try {
    parsed = JSON.parse(readFileSync(RUN_JSON, "utf-8"));
  } catch {
    parsed = null;
  }
  return readMeasurement({ buildOk, playwrightExitCode, run: parsed });
}

export function verdictFor(expectation, caught) {
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
  if (expectation === "complex only") {
    // **複素数のシャードだけが反応するはず。** 実数の経路が反応したら、
    // 複素数のための変更が実数にも漏れていることになる——それ自体が
    // 報告に値する事実である。
    const others = shards.filter((s) => !s.startsWith("complex-"));
    return {
      ok: others.length === 0,
      why:
        others.length === 0
          ? "複素数のシャードだけが反応した——実数だけのテストには見えない欠陥である"
          : `実数のシャードまで反応した(${others.join(", ")})`,
    };
  }
  if (expectation === "display only") {
    // **表示のシャードだけが反応するはず。** 値は 1 ビットも変わらないので、
    // 他のシャードが反応したらそれは「表示の変異が値にも漏れている」か、
    // 変異の書き方が広すぎるかのどちらかで、どちらも欠陥である。
    const others = shards.filter((s) => !s.startsWith("display-"));
    return {
      ok: others.length === 0,
      why:
        others.length === 0
          ? "表示のシャードだけが反応した——値を見るテストには見えない欠陥である"
          : `値を見るシャードまで反応した(${others.join(", ")})`,
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

function main() {
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
    let measurement;
    try {
      measurement = measure();
    } finally {
      // **必ず戻す。** 戻したことをバイトで確かめる。
      writeFileSync(path, original);
      if (readFileSync(path, "utf-8") !== original) {
        throw new Error(`detection-power: ${mutation.file} を戻せなかった`);
      }
    }
    // **`verdictFor` はまだ `Measurement` を知らない(Task 5 で直す)。**
    // 旧 `measure()` は「実際に不一致が出たシャード」だけを返していたので、
    // ここでも 0 件のシャードを削って同じ形に合わせる。`buildOk` が false や
    // `runJsonFound` が false のとき(ビルドが壊れた・playwright が
    // 起動しなかった)は空の `{}` になり、`verdictFor` にはそれが
    // 「何も引っかからなかった」としか見えない——ビルド失敗を誤って
    // 「反応なし」と判定しうるが、`verdictFor` を直すのは Task 5 の仕事。
    const caught = Object.fromEntries(
      Object.entries(measurement.mismatchesByShard).filter(([, count]) => count > 0),
    );
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

  // **最後に wasm を作り直す。**
  //
  // 原文は毎回戻しているが、**戻したあとに一度もビルドしていない**ので
  // `web/src/wasm/` には最後の変異が入ったままになる。`pnpm heavy` と
  // `pnpm heavy:ui` は先頭で `pnpm wasm` を回すので気づかないが、
  // ビルドを挟まずに playwright を直に叩くと**変異した engine を本物として
  // 測ることになる**——実際にそれを踏んだ(2026-08-17)。極形式の角度が
  // すべて `90 − 期待値` になり、engine の欠陥かと思って調べた。
  //
  // 走行の後始末として作り直しておけば、次に何を回しても原文の engine になる。
  if (MUTATIONS.length > 0) {
    process.stderr.write("原文の wasm を作り直しています ... ");
    run("pnpm", ["wasm"]);
    process.stderr.write("done\n");
  }

  writeFileSync(OUT, `${JSON.stringify({ results }, null, 2)}\n`);
  console.error(`detection-power: wrote ${OUT}`);
  if (failed > 0) {
    console.error(`detection-power: ${failed} の変異が期待どおりでなかった`);
    process.exit(1);
  }
}

// **import されたときは走らない。** テストがこのファイルを読むだけで
// 変異が始まっては困る。
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}

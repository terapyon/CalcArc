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
 * `expectShards` は「どのシャードが赤くなるはずか」を名前で列挙したもの。
 * `[]` は**どこも赤くならないはず**という主張で、それはレポートの
 * 「この領域は踏んでいない」と同じことを言っている。
 *
 * `minRate` は `expectShards` に挙げたシャードごとの下限率(不一致件数 /
 * そのシャードの総件数)。率で持つのは、コーパスが増えても表を書き換えず
 * 済むようにするため——2000 件で 200、4000 件で 400 なら同じ 10% である。
 * 挙げていないシャードは下限 0(=反応しないはず)を意味する。
 *
 * 値は 2026-08-17 の実測から導いた暫定値。Task 7 が実走して取り直す。
 */
export const MUTATIONS = [
  {
    id: "display-digits",
    what: "表示の有効桁数を 10 から 9 に減らす",
    file: "crates/calcarc-core/src/numeric/format.rs",
    from: "pub const DISPLAY_DIGITS: usize = 10;",
    to: "pub const DISPLAY_DIGITS: usize = 9;",
    // **値シャードすべて、ではない。** `cancellation-000.json` は値シャード
    // だが反応しない。名前ではなく実測で書く。
    expectShards: [
      "angle-mode-000.json (values)",
      "combinatorics-000.json (values)",
      "complex-000.json (values)",
      "elementary-000.json (values)",
      "inverse-trig-000.json (values)",
      "precedence-000.json (values)",
      "scientific-000.json (values)",
      "typed-000.json (values)",
      "complex-display-000.json (displays)",
      "display-000.json (displays)",
    ],
    minRate: {
      "angle-mode-000.json (values)": 0.254,
      "combinatorics-000.json (values)": 0.296,
      "complex-000.json (values)": 0.095,
      "elementary-000.json (values)": 0.302,
      "inverse-trig-000.json (values)": 0.183,
      "precedence-000.json (values)": 0.244,
      "scientific-000.json (values)": 0.199,
      "typed-000.json (values)": 0.222,
      "complex-display-000.json (displays)": 0.083,
      "display-000.json (displays)": 0.103,
    },
  },
  {
    id: "precedence-collapse",
    what: "× ÷ の優先順位を + − と同じに落とす",
    file: "crates/calcarc-core/src/engine/state.rs",
    from: "BinOp::Mul | BinOp::Div => 2,",
    to: "BinOp::Mul | BinOp::Div => 1,",
    // **括弧を省いたシャードだけが反応するはず。** 全括弧のシャードは
    // 括弧が構造を決めるので、優先順位が変わっても答えが変わらない。
    expectShards: ["precedence-000.json (values)"],
    minRate: { "precedence-000.json (values)": 0.274 },
  },
  {
    id: "associativity-flip",
    what: "同順位の畳み込みの向きを反転する",
    file: "crates/calcarc-core/src/engine/mod.rs",
    from: "|| (top.precedence() == op.precedence() && !op.is_right_associative())",
    to: "|| (top.precedence() == op.precedence() && op.is_right_associative())",
    // **どこも赤くならないはず。** レポートが「結合方向は踏んでいない」と
    // 書いており、これはその主張そのものである。赤くなったらレポートが嘘。
    expectShards: [],
    minRate: {},
  },
  {
    id: "ncr-multiply-first",
    what: "nCr を「掛けてから割る」順に変える(答は収まるのに途中で溢れる)",
    file: "crates/calcarc-core/src/scientific/mod.rs",
    from: "acc = acc / (i + 1.0) * (n - i);",
    to: "acc = acc * (n - i) / (i + 1.0);",
    // 中心二項係数の帯だけ。答は f64 に収まるのに途中で溢れる。
    expectShards: ["combinatorics-000.json (values)"],
    minRate: { "combinatorics-000.json (values)": 0.0025 },
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
    expectShards: ["display-000.json (displays)"],
    minRate: { "display-000.json (displays)": 0.024 },
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
    expectShards: ["display-000.json (displays)"],
    minRate: { "display-000.json (displays)": 0.0025 },
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
    expectShards: ["complex-000.json (values)"],
    minRate: { "complex-000.json (values)": 0.036 },
  },
  {
    id: "polar-angle-flipped",
    what: "極形式の偏角の引数を入れ替える(atan2(re, im) にする)",
    file: "crates/calcarc-core/src/polar.rs",
    from: "theta_rad: self.im.atan2(self.re),",
    to: "theta_rad: self.re.atan2(self.im),",
    // **半径は変わらない。** 角度だけが余角になる(53.13 が 36.87 に)。
    // `▸∠` を押した表示しか見ない欠陥で、直交形式の表示も値も動かない。
    expectShards: ["complex-display-000.json (displays)"],
    minRate: { "complex-display-000.json (displays)": 0.165 },
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
 * `run` が期待した形をしているか。
 *
 * **壊れた要約は、無い要約と同じだけ何も言っていない。** `schema` が
 * 違う・`shards` や `expected` が配列でない(将来のスキーマ変更、書き込み
 * 途中でのプロセス終了、あるいは単に `heavy-run.json` の中身が `5` だった、
 * 等)場合に `run.shards` をそのまま走査すると `TypeError` が
 * `measure()` を突き抜けて `main()` ごと落ちる。この関数の目的は
 * 「測定が失敗した」を例外にせず構造化された事実(`runJsonFound: false`)
 * にすること――それがこの spec の存在理由なので、ここで例外を許すわけには
 * いかない。
 */
function isWellFormedRun(run) {
  return (
    run !== null &&
    typeof run === "object" &&
    run.schema === 1 &&
    Array.isArray(run.shards) &&
    Array.isArray(run.expected)
  );
}

/**
 * 読み取り段だけを切り出した純関数。
 *
 * `measure()` から分けたのは、ここだけを単体テストするため。**プロセスを
 * 起動しないのでテストできる。** 「見つからなかった」扱いになるのは 2 通り
 * ある――`run === null`(`heavy-run.json` が無い。`globalTeardown` まで
 * 走らなかった)と、`run` はあるが形が壊れている場合(`isWellFormedRun`
 * 参照)。どちらも読み手には同じ「測定に失敗した」でしかないので、
 * 同じ結果を返す。
 */
export function readMeasurement({ buildOk, playwrightExitCode, run }) {
  if (!isWellFormedRun(run)) {
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
 * `execFileSync` が投げた `error` から、playwright の終了コードを取り出す。
 *
 * `error.status` が数値なら「走って、その終了コードで落ちた」――テストが
 * 赤くなるのが目的なので想定内。数値でないのは「そもそも起動できなかった」
 * (`ENOENT` など、spawn 自体の失敗)ということで、これは「走って落ちた」
 * とは別の事実である。ここで安易に `1` を返すと「playwright が終了コード 1
 * で落ちた」と読めてしまい、実際には一度も走っていないのに走ったことになる
 * ――このリポジトリが繰り返し踏んでいる「検査は緑のまま理由だけが嘘になる」
 * 形そのもの。`null` を返して「走らなかった」を保つ。
 *
 * **注意: `null` は 2 つの意味を持つ。** ビルドで止まって一度も呼ばれ
 * なかった場合(`measure()` の `buildOk === false` のときの初期値)と、
 * ここで spawn 自体に失敗した場合の両方が `null` になる。どちらも
 * `heavy-run.json` は書かれないので `runJsonFound: false` に落ち、
 * 判定側(Task 5)はそれで「測定失敗」と読める――が、両者を区別したく
 * なったら `playwrightExitCode` だけでは足りない。
 */
export function exitCodeFrom(error) {
  return typeof error.status === "number" ? error.status : null;
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
      // 赤くなるのが目的なので、失敗そのものは想定内。取り出し方は
      // `exitCodeFrom` を参照。
      playwrightExitCode = exitCodeFrom(error);
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

function sameSet(left, right) {
  if (left.length !== right.length) return false;
  const sorted = [...right].sort();
  return [...left].sort().every((name, i) => name === sorted[i]);
}

/**
 * **測定の健全性を先に見て、そのあとで検出を見る。**
 *
 * 1〜4 の赤は「測れていない」、5 以降の赤は「測った結果が期待と違う」である。
 * この 2 つを同じ言葉で報告すると、レポートが**測定の失敗を検証の成果として
 * 数える**——それがこの段階を足した理由そのものである。
 */
export function verdictFor(mutation, m) {
  const fail = (kind, why) => ({ ok: false, kind, why });
  if (!m.buildOk) {
    return fail("measurement-failed", "wasm のビルドが失敗した——検出の有無は測れていない");
  }
  if (!m.runJsonFound) {
    return fail("measurement-failed", "heavy-run.json が無い——走行がレポート生成に到達していない");
  }
  if (!m.ranTests) {
    return fail("measurement-failed", "テストが 1 本も走っていない");
  }
  const missing = m.expected.filter((name) => !m.shardsSeen.includes(name));
  if (missing.length > 0) {
    return fail(
      "measurement-failed",
      `読み込まれていないシャードがある(${missing.join(", ")})——` +
        "黙っているべきシャードが走っていない走行は、完全一致を語る資格がない",
    );
  }
  const reacted = Object.entries(m.mismatchesByShard)
    .filter(([, count]) => count > 0)
    .map(([name]) => name);
  if (mutation.expectShards.length === 0) {
    if (m.playwrightExitCode === 0 && reacted.length === 0) {
      return { ok: true, kind: "ok", why: "赤くならなかった——レポートの「踏んでいない」が正しい" };
    }
    return fail(
      "claim-was-false",
      `赤くなった(${reacted.join(", ") || "テストが非ゼロで終了"})。レポートの「踏んでいない」が嘘である`,
    );
  }
  if (reacted.length === 0) {
    return fail("caught-nothing", "1 件も捕まえられなかった");
  }
  if (!sameSet(reacted, mutation.expectShards)) {
    return fail(
      "shard-set-mismatch",
      `反応したのは ${reacted.sort().join(", ")}、期待は ${[...mutation.expectShards].sort().join(", ")}`,
    );
  }
  for (const name of mutation.expectShards) {
    const total = m.totalsByShard[name] ?? 0;
    const rate = mutation.minRate?.[name] ?? 0;
    const floor = Math.max(1, Math.ceil(total * rate));
    const caught = m.mismatchesByShard[name] ?? 0;
    if (caught < floor) {
      return fail("below-min-rate", `${name} は ${caught} 件で、下限 ${floor} 件(${total} 件の ${rate})に届かない`);
    }
  }
  return { ok: true, kind: "ok", why: `期待したシャードだけが反応した(${reacted.sort().join(", ")})` };
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
    const verdict = verdictFor(mutation, measurement);
    if (!verdict.ok) {
      failed += 1;
    }
    process.stderr.write(`${verdict.ok ? "ok" : "NG"} — ${verdict.why}\n`);
    results.push({
      id: mutation.id,
      what: mutation.what,
      expectShards: mutation.expectShards,
      mismatchesByShard: measurement.mismatchesByShard,
      totalsByShard: measurement.totalsByShard,
      ok: verdict.ok,
      kind: verdict.kind,
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

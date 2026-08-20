#!/usr/bin/env node
/**
 * **0.3.0 の 3 計算(単位換算・LLM メモリ・データ転送量)の検出力を測る。**
 *
 * `detection-power.mjs` は生成コーパスのシャードが反応したかを見るが、
 * この 3 つには**生成コーパスが無い**(実測 2026-08-20: 18 枚のシャードに
 * convert・llm・transfer は 1 枚も無い)。代わりに `cargo test` を走らせ、
 * **赤くなったテストの名前の集合**を期待と突き合わせる。
 *
 * **変異を当てて戻す手続きは写さない**——`detection-power.mjs` の
 * `runOneMutation` に判定を注入して使う(戻し忘れの経路を 2 つにしない)。
 * このファイルは「測り方」と「判定」だけを持つ。
 */
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exitCodeFrom } from "./detection-power.mjs";

const WEB = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = dirname(WEB);

/**
 * 1 件の変異。`detection-power.mjs` の `MUTATIONS` と同じ 5 項目に、
 * 期待をシャード名でなく**テスト名**で書く `expectTests` を足したもの。
 *
 * @typedef {{
 *   id: string,
 *   what: string,
 *   file: string,
 *   from: string,
 *   to: string,
 *   expectTests: string[],
 * }} ExactMutation
 */

/**
 * `cargo test` 1 回ぶんの測定。
 *
 * **`buildOk` と `failed` を別々に持つ。** ビルドが失敗すると 1 本も
 * 走らないので `failed` は空になり、「捕まえられなかった」と見分けが
 * つかなくなる(`detection-power.mjs` §4.2 が名指しで禁じた形)。
 *
 * @typedef {{ buildOk: boolean, exitCode: number | null, failed: string[] }} CargoMeasurement
 */

/** @typedef {{ ok: boolean, kind: string, why: string }} Verdict */

/**
 * `cargo test` が 1 テストごとに出す `test <名前> ... FAILED` を拾う。
 *
 * **要約行(`test result: FAILED. 25 passed; 2 failed`)を拾わない。**
 * 拾うと赤の件数が毎回 1 多くなり、1 本も赤くならなかった走行が
 * 「1 本捕まえた」に化ける。要約行を外しているのは ` ... ` の区切りで、
 * 要約行にはこれが無い——**行全体を `test <名前> ... FAILED` の形に
 * 合わせる**(前後に何も許さない)ことが、その見分けを持っている。
 *
 * @param {string} stdout
 * @returns {string[]}
 */
export function parseFailedTests(stdout) {
  const failed = [];
  for (const line of stdout.split("\n")) {
    const match = /^test (.+) \.\.\. FAILED$/.exec(line.trim());
    if (match) failed.push(match[1]);
  }
  return failed;
}

/**
 * 走行の生の結果を測定に畳む。
 *
 * @param {{ buildOk: boolean, exitCode: number | null, stdout: string }} raw
 * @returns {CargoMeasurement}
 */
export function readCargoMeasurement({ buildOk, exitCode, stdout }) {
  return { buildOk, exitCode, failed: buildOk ? parseFailedTests(stdout) : [] };
}

/**
 * **両側を主張する。** 期待したテストが赤いこと**と**、期待していない
 * テストが緑のままであること。片側だけだと「何かが赤い」で通り、
 * **どの層が捕まえたか**の地図が描けない(`verdictFor` の `sameSet` と
 * 同じ厳しさ)。
 *
 * @param {ExactMutation} mutation
 * @param {CargoMeasurement} m
 * @returns {Verdict}
 */
export function verdictForTests(mutation, m) {
  /** @type {(kind: string, why: string) => Verdict} */
  const fail = (kind, why) => ({ ok: false, kind, why });
  if (!m.buildOk) {
    return fail("measurement-failed", "cargo がビルドできなかった——検出の有無は測れていない");
  }
  if (m.exitCode === null) return fail("measurement-failed", "cargo を起動できなかった");
  const expected = mutation.expectTests;
  const missing = expected.filter((name) => !m.failed.includes(name));
  const extra = m.failed.filter((name) => !expected.includes(name));
  // **「1 本も赤くならなかった」を別の名前で残す。** 変異が届いていない
  // のと、届いたが別の場所を壊したのとでは、次にやることが違う。
  if (missing.length > 0 && m.failed.length === 0) {
    return fail("caught-nothing", `1 本も赤くならなかった(期待: ${expected.join(", ")})`);
  }
  if (extra.length > 0) {
    return fail("unexpected-red", `期待していないテストが赤い: ${extra.join(", ")}`);
  }
  if (missing.length > 0) {
    return fail("missed", `期待したテストが緑のまま: ${missing.join(", ")}`);
  }
  // `missing` も `extra` も空、すなわち**集合として一致している**。
  // 両側を主張した結果として、ここに来られるのはその場合だけである。
  return { ok: true, kind: "ok", why: `期待どおり ${m.failed.length} 本が赤くなった` };
}

/**
 * 変異を当てた状態で `cargo test` を走らせる。**wasm も playwright も
 * 要らない**(変異は Rust に当てるので、Rust の検査で足りる。計画の裁定 2)。
 *
 * `--no-fail-fast` は**全部のテストを最後まで走らせる**ため。既定では
 * 最初に赤くなったクレートで止まり、**別のクレートが同じ変異を捕まえて
 * いたかどうかが測れない**——それがまさに知りたいことである。
 *
 * @returns {CargoMeasurement}
 */
export function measureCargo() {
  try {
    const stdout = execFileSync("cargo", ["test", "--workspace", "--no-fail-fast"], {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return readCargoMeasurement({ buildOk: true, exitCode: 0, stdout });
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    // **ビルド失敗と「テストが赤い」を混ぜない。** ビルドが失敗すると
    // 1 本も走らないので、`failed` が空になり「捕まえられなかった」に
    // 見える。1 本でも走った証拠(`running N tests` か要約行)を
    // stdout に見つけられたときだけ「ビルドは通った」と読む。
    const buildOk = stdout.includes("running ") || stdout.includes("test result:");
    return readCargoMeasurement({ buildOk, exitCode: exitCodeFrom(error), stdout });
  }
}

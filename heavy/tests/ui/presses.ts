import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { KeyToken } from "../../../web/src/calc";

/**
 * **押したキーを数える。**
 *
 * `reachability.spec.ts` は「盤面から**押せる**」を見ている。ここが足すのは
 * **「実際に押した」**——2 つは別の主張である。押せる場所にあっても、
 * コーパスの代表を選ぶサンプリングが 1 件も選ばなければ、そのキーは走行を
 * 通じて一度も押されない。緑のまま、何も確かめていない。
 *
 * **集計はディスクに置く。プロセス内の配列に頼らない**(`../corpus/report.ts`
 * の `record()` と同じ流儀)。Playwright はテストが 1 本落ちるとワーカーを
 * 再起動するので、モジュールスコープに溜めた数字は**そこで消える**。
 * ここはワーカーごとに 1 ファイルを持ち、押すたびに書き直す。ワーカーが
 * 何回死んでも、既に書かれた分は残る。
 */

/**
 * **パスは呼ばれたときに解く。** モジュールの読み込み時に解くと、
 * `import.meta.url` が `file:` でない環境——vitest は `http:` で読ませる——で
 * **読み込むだけで落ちる**。判定は純関数なので、走行の外(`tests/unit/`)から
 * 確かめられなければならない。
 */
const pressDir = (): string =>
  fileURLToPath(new URL("../../.heavy-ui-presses/", import.meta.url));

const runPath = (): string =>
  fileURLToPath(new URL("../../heavy-ui-run.json", import.meta.url));

/**
 * **押したのは誰か。**
 *
 * `case` はコーパスのケースのキー列に書かれていたから押した。
 * `harness` は駆動側の都合で押した——各ケースの頭の `ac`、`resetDisplayState`
 * が表示状態を既定に戻すための `angle_toggle` / `eng` / `polar_toggle` である。
 *
 * **区別しないと、駆動側の後始末が「そのキーを踏んだ」ことにされる。**
 * `ac` は全ケースの頭で必ず押されるので、区別しなければ `ac` の主張は
 * 何があっても緑になる。実際に区別して数えたところ、`ac` を**キー列に持つ
 * ケースはコーパスに 1 件も無い**(2026-08-20 実測)。
 */
export type PressOrigin = "case" | "harness";

export interface TokenPresses {
  case: number;
  harness: number;
}

export interface PressLedger {
  /** トークンごとの押下回数。押されなかったトークンは**現れない**。 */
  byToken: Record<string, TokenPresses>;
  /** 実際に打鍵したケース数(シャード名ごと)。 */
  casesTyped: Record<string, number>;
}

/**
 * 指示書 §8 が名指しした 9 キー。**表示の見た目ではなくトークンで持つ**
 * ——盤面のラベルは変わりうるが、トークンは engine の語彙である。
 */
export const REQUIRED_KEYS: { token: KeyToken; label: string }[] = [
  { token: "dot", label: "." },
  { token: "exp", label: "EXP" },
  { token: "j", label: "j" },
  { token: "polar_toggle", label: "▸∠" },
  { token: "angle_toggle", label: "Deg/Rad" },
  { token: "eng", label: "ENG" },
  { token: "dms", label: "°'\"" },
  { token: "ac", label: "AC" },
  { token: "del", label: "DEL" },
];

const labelOf = (token: string): string =>
  REQUIRED_KEYS.find((key) => key.token === token)?.label ?? token;

/** ワーカー 1 つ分の台帳。**プロセスが死んでも、書かれた分はディスクに残る。** */
const mine: PressLedger = { byToken: {}, casesTyped: {} };

const myPath = (): string => join(pressDir(), `presses-${process.pid}.json`);

function flush(): void {
  mkdirSync(pressDir(), { recursive: true });
  writeFileSync(myPath(), `${JSON.stringify(mine)}\n`, "utf-8");
}

/**
 * **走行の頭で前回の台帳を消す。**
 *
 * 消さずに走ると、今回 1 件も押していないキーが前回の数字で埋まる——
 * `../corpus/report.ts` の `resetRun()` とまったく同じ理由である。
 * 前回の `heavy-ui-run.json` も消す。走行が落ちたときに古い緑の要約が
 * 残るのでは、書き出しを拒む意味がない。
 */
export function resetPresses(): void {
  rmSync(pressDir(), { recursive: true, force: true });
  mkdirSync(pressDir(), { recursive: true });
  rmSync(runPath(), { force: true });
}

export function recordPress(token: string, origin: PressOrigin): void {
  const entry = mine.byToken[token] ?? { case: 0, harness: 0 };
  entry[origin] += 1;
  mine.byToken[token] = entry;
  flush();
}

/** ケースを 1 件打ち終えるたびに呼ぶ。**選んだ数と打った数を突き合わせるため。** */
export function recordTypedCase(shard: string): void {
  mine.casesTyped[shard] = (mine.casesTyped[shard] ?? 0) + 1;
  flush();
}

/** ワーカーが書いた台帳を全部読んで足す。**読めなければ空**——0 で埋めない。 */
export function readLedger(): PressLedger {
  let names: string[];
  try {
    names = readdirSync(pressDir());
  } catch {
    return { byToken: {}, casesTyped: {} };
  }
  const merged: PressLedger = { byToken: {}, casesTyped: {} };
  for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
    const part = JSON.parse(
      readFileSync(join(pressDir(), name), "utf-8"),
    ) as PressLedger;
    for (const [token, counts] of Object.entries(part.byToken)) {
      const entry = merged.byToken[token] ?? { case: 0, harness: 0 };
      entry.case += counts.case;
      entry.harness += counts.harness;
      merged.byToken[token] = entry;
    }
    for (const [shard, count] of Object.entries(part.casesTyped)) {
      merged.casesTyped[shard] = (merged.casesTyped[shard] ?? 0) + count;
    }
  }
  return merged;
}

/**
 * 走行が「何を打つつもりだったか」。**サンプリングから導く**——
 * 台帳と同じ経路から作ると、両方が同時に痩せても差が出ない。
 */
export interface TypingPlan {
  /** シャード名 → 選んだケース数。 */
  cases: Record<string, number>;
  /**
   * **コーパスに存在する**必須キー(打鍵可能なケースのキー列に 1 度でも
   * 現れるもの)。サンプリングではなくコーパス全体から導く。
   */
  inCorpus: KeyToken[];
  /** **選ばれたケース**が含む必須キー。`inCorpus` を覆っていなければ選び方の欠陥。 */
  inSample: KeyToken[];
  /** 選んだケースの総数。 */
  totalCases: number;
}

/**
 * **打鍵の下限。** サンプリングが選ぶのは 14 シャード 1,266 件
 * (`HEAVY_UI_SAMPLE` 既定 100。うち 2 枚は母集団が 36 件・30 件しかない)。
 *
 * 下限を置くのは、サンプリングが数件まで痩せても「全キーを 1 回ずつ押した」
 * だけで緑になりうるからである。`HEAVY_UI_SAMPLE` を下げた走行では下限も
 * 同じ比で下がる——下げた走行を赤くするためのものではない。
 */
export const MIN_TYPED_CASES = 1000;

export interface Finding {
  kind:
    | "no-presses"
    | "too-few-cases"
    | "never-pressed"
    | "never-typed-by-a-case"
    | "not-in-sample"
    | "planned-but-not-typed";
  message: string;
}

/**
 * **台帳と計画を突き合わせる。純関数**——ディスクを触らないので、走行の外から
 * 「この検査は本当に何かを比べているか」を確かめられる。
 *
 * 4 つを別々に見る。1 つにまとめると、どれが崩れても同じ 1 行しか出ない。
 */
export function auditPresses(
  ledger: PressLedger,
  plan: TypingPlan,
  sampleRatio: number,
): Finding[] {
  const findings: Finding[] = [];
  const total = Object.values(ledger.byToken).reduce(
    (sum, counts) => sum + counts.case + counts.harness,
    0,
  );
  if (total === 0) {
    findings.push({
      kind: "no-presses",
      message:
        "heavy-ui: not a single key press was recorded. Either no test ran, " +
        "or the recording is no longer wired into pressToken. Both look the " +
        "same from here, and both mean this run verified nothing about keys.",
    });
  }

  const floor = Math.round(MIN_TYPED_CASES * sampleRatio);
  const typed = Object.values(ledger.casesTyped).reduce((a, b) => a + b, 0);
  if (typed < floor) {
    findings.push({
      kind: "too-few-cases",
      message:
        `heavy-ui: only ${typed} cases were typed on the keypad, below the ` +
        `floor of ${floor}. A run that types a handful of cases can still ` +
        "press every required key once — the floor is what keeps 'all keys " +
        "were pressed' from being true of a run that verifies almost nothing.",
    });
  }

  for (const shard of Object.keys(plan.cases).sort()) {
    const want = plan.cases[shard] ?? 0;
    const got = ledger.casesTyped[shard] ?? 0;
    if (got < want) {
      findings.push({
        kind: "planned-but-not-typed",
        message:
          `heavy-ui: ${shard} selected ${want} cases but only ${got} were ` +
          "typed. The run stopped part way through that shard, so its " +
          "coverage is smaller than the sampling claims.",
      });
    }
  }

  for (const { token, label } of REQUIRED_KEYS) {
    const counts = ledger.byToken[token];
    const pressed = (counts?.case ?? 0) + (counts?.harness ?? 0);
    if (pressed === 0) {
      findings.push({
        kind: "never-pressed",
        message:
          `heavy-ui: ${label} (${token}) was never pressed on the real ` +
          "keypad during this run. It has a button — reachability.spec.ts " +
          "checks that — but nothing in this run actually pressed it.",
      });
    }
  }

  // **コーパスに在るのに、ケースが 1 度も打たなかったキー。**
  // `inCorpus` はサンプリングではなくコーパスから導くので、選び方が壊れれば
  // ここが赤くなる(選び方から導くと、選ばれなくなった瞬間に期待も消える)。
  for (const token of plan.inCorpus) {
    const byCase = ledger.byToken[token]?.case ?? 0;
    if (byCase === 0) {
      findings.push({
        kind: "never-typed-by-a-case",
        message:
          `heavy-ui: ${labelOf(token)} (${token}) appears in the corpus, but ` +
          "no corpus case pressed it in this run. Presses made by the " +
          "harness itself (the AC before each case, the resets) do not count " +
          "— they exercise the driver, not the corpus.",
      });
    }
    if (!plan.inSample.includes(token)) {
      findings.push({
        kind: "not-in-sample",
        message:
          `heavy-ui: ${labelOf(token)} (${token}) appears in the corpus, but ` +
          "the sampling selected no case containing it. Required keys are " +
          "supposed to be secured before the rest of the sample is spread.",
      });
    }
  }
  return findings;
}

export interface HeavyUiRun {
  schema: 1;
  /** キーが 1 つでも押されたか。false は「テストが 1 本も走っていない」。 */
  pressedAnything: boolean;
  /** 主張が全部通ったか。**spec E のレポートはこれを読む。** */
  ok: boolean;
  totalPresses: number;
  totalTypedCases: number;
  byToken: Record<string, TokenPresses>;
  casesTyped: Record<string, number>;
  required: {
    token: string;
    label: string;
    presses: TokenPresses;
    inCorpus: boolean;
    inSample: boolean;
  }[];
  findings: Finding[];
}

/** **純関数。** 走行の外からテストできる(`buildRun` と同じ理由)。 */
export function buildRun(
  ledger: PressLedger,
  plan: TypingPlan,
  findings: Finding[],
): HeavyUiRun {
  const totalPresses = Object.values(ledger.byToken).reduce(
    (sum, counts) => sum + counts.case + counts.harness,
    0,
  );
  return {
    schema: 1,
    pressedAnything: totalPresses > 0,
    ok: findings.length === 0,
    totalPresses,
    totalTypedCases: Object.values(ledger.casesTyped).reduce(
      (a, b) => a + b,
      0,
    ),
    byToken: ledger.byToken,
    casesTyped: ledger.casesTyped,
    required: REQUIRED_KEYS.map(({ token, label }) => ({
      token,
      label,
      presses: ledger.byToken[token] ?? { case: 0, harness: 0 },
      inCorpus: plan.inCorpus.includes(token),
      inSample: plan.inSample.includes(token),
    })),
    findings,
  };
}

export function writeRunJson(run: HeavyUiRun): void {
  writeFileSync(runPath(), `${JSON.stringify(run, null, 2)}\n`, "utf-8");
}

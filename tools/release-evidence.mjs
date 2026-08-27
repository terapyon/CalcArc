// リリースの証拠を組み立てる(設計書
// `docs/superpowers/specs/2026-08-25-release-gate-design.md` §4)。
//
// **結論は走行そのものから読む。** ステップの出力を人が書き写すと、
// 「緑だったと書いてあるが実は落ちていた」という文書が作れてしまう。この
// スクリプトが受け取るのは `gh api repos/{repo}/actions/runs/{id}/jobs` の
// 応答そのもので、判定はしない——**並べ直すだけ**である。
//
// 純関数 `renderEvidence` と CLI を分けてあるのは、走行に出る前に手元で
// 確かめられるようにするため(`web/tests/unit/release-evidence.test.ts`)。

import { execFileSync } from "node:child_process";

/** 終わっていて、成功ではない結論。**1 つでもあれば証拠を書かない。** */
const BAD_CONCLUSIONS = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
]);

/**
 * 走行に必ず居てほしい**重量級の本体**のジョブ名(設計書 §4、B-4)。
 *
 * **断片一致にしない。** `"Heavy corpus"` で `includes` していた頃は、
 * 11 秒で終わる `Heavy corpus / Version numbers agree` にも当たっていた
 * ——**35 分の本体が走っていなくても在席と認めていた。** 書き手(`release.yml`
 * の `heavy` ジョブ名 + `heavy-corpus.yml` の `corpus` ジョブ名)との一致は
 * `heavy/tests/unit/release-workflow.test.ts` が固定する。
 */
export const HEAVY_BODY_JOB = "Heavy corpus / Corpus vs reference";

/** 重量級が走ったなら在るはずの添付(B-2)。 */
export const HEAVY_REPORT = "heavy-report.md";

/** 終わっていて成功でもない結論。**成功にも進行中にも数えない**(B-3)。 */
const NOT_RUN_CONCLUSIONS = new Set(["skipped", "neutral"]);

/**
 * **知っている結論の全部**(F-2)。ここに無い結論が来たら、証拠を書かずに落ちる。
 *
 * 以前は success / {skipped,neutral} / BAD 4 種の**網羅を仮定して、余りを
 * すべて「進行中」と断定**していた。`stale` や `startup_failure`、そして
 * 将来 GitHub が足す値は、そこへ落ちる——**終わった走行について「進行中」と
 * 語る証拠**が出る。**知らないものは断る**のが、証拠が嘘をつかない側である。
 */
const KNOWN_CONCLUSIONS = new Set([
  "success",
  ...NOT_RUN_CONCLUSIONS,
  ...BAD_CONCLUSIONS,
]);

function duration(job) {
  if (!job.started_at || !job.completed_at) {
    return "—";
  }
  const seconds = Math.round(
    (Date.parse(job.completed_at) - Date.parse(job.started_at)) / 1000,
  );
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "—";
  }
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

/**
 * 走行から返ってくるジョブ 1 件。綴りは
 * `gh api repos/{repo}/actions/runs/{id}/jobs` の応答から写している。
 *
 * @typedef {{
 *   name: string,
 *   status: string,
 *   conclusion: string | null,
 *   started_at?: string | null,
 *   completed_at?: string | null,
 * }} RunJob
 */

/**
 * 証拠の本文を組み立てる。
 *
 * **同じ入力からは同じ文字列が出る。** 走行のたびに変わる値(いまの時刻など)を
 * 混ぜると、作り直したときに内容が変わり、どちらが本物か言えなくなる。
 *
 * @param {{
 *   tag: string,
 *   sha: string,
 *   repo: string,
 *   runId: string,
 *   jobs: RunJob[],
 *   attachments?: string[],
 *   selfName?: string,
 * }} input
 * @returns {string}
 */
export function renderEvidence({
  tag,
  sha,
  repo,
  runId,
  jobs,
  attachments = [],
  selfName = "",
}) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new Error("この走行にはジョブが 1 つも無い。証拠を書かない");
  }
  // **終わっているのに知らない結論なら、そこで止まる**(F-2)。
  const unknown = jobs.filter(
    (job) =>
      job.status === "completed" &&
      !KNOWN_CONCLUSIONS.has(/** @type {string} */ (job.conclusion)),
  );
  if (unknown.length > 0) {
    throw new Error(
      `未知の結論があるので証拠を書かない: ${unknown
        .map((job) => `${job.name} = ${job.conclusion}`)
        .join(", ")}`,
    );
  }
  const bad = jobs.filter((job) => BAD_CONCLUSIONS.has(job.conclusion));
  if (bad.length > 0) {
    throw new Error(
      `緑でない走行から証拠は作れない: ${bad
        .map((job) => `${job.name} = ${job.conclusion}`)
        .join(", ")}`,
    );
  }
  const finished = jobs.filter((job) => job.conclusion === "success");
  // **3 つに分ける**(B-3)。`skipped` と `neutral` は「走らなかった」ので、
  // 成功でも進行中でもない——「進行中」と書けば、そのうち終わるという嘘になる。
  const notRun = jobs.filter((job) => NOT_RUN_CONCLUSIONS.has(job.conclusion));
  const running = jobs.filter(
    (job) =>
      job.conclusion !== "success" && !NOT_RUN_CONCLUSIONS.has(job.conclusion),
  );
  const runUrl = `https://github.com/${repo}/actions/runs/${runId}`;
  const lines = [
    `# ${tag} のリリース証拠`,
    "",
    "| | |",
    "|---|---|",
    `| タグ | \`${tag}\` |`,
    `| コミット | \`${sha}\` |`,
    `| 走行 | ${runUrl} |`,
    "",
    "## 通した検査",
    "",
    "| ジョブ | 結論 | 所要 |",
    "|---|---|---:|",
  ];
  for (const job of jobs) {
    const verdict =
      job.conclusion === "success"
        ? "成功"
        : NOT_RUN_CONCLUSIONS.has(job.conclusion)
          ? `飛ばした(\`${job.conclusion}\`)`
          : "進行中";
    lines.push(`| ${job.name} | ${verdict} | ${duration(job)} |`);
  }
  // **「自分自身である」と断定してよいのは、進行中が本当に自分だけのとき。**
  // 他にも進行中が居るのに名指しすると、その行は嘘になる(B-3)。
  const onlySelfIsRunning =
    running.length === 1 && selfName !== "" && running[0].name === selfName;
  lines.push(
    "",
    `**成功した検査: ${finished.length}**` +
      (running.length > 0
        ? `（進行中 ${running.length}${
            onlySelfIsRunning ? "——この証拠を書いているジョブ自身である" : ""
          }）`
        : ""),
    "",
  );
  if (notRun.length > 0) {
    lines.push(
      `**飛ばした検査: ${notRun.length}。** 走らなかったので、成功にも進行中にも`,
      "数えていない——通した検査の一覧に、この行は含まれない。",
      "",
    );
  }
  // **名前の実在だけでは在席にしない**(F-1)。`skipped` や進行中のジョブを
  // 在席と数えると、表が「飛ばした」と書いている隣で「走行そのものは通って
  // いる」と言う——**同じ文書の中で矛盾する。**
  const heavyRan = jobs.some(
    (job) => job.name === HEAVY_BODY_JOB && job.conclusion === "success",
  );
  if (!heavyRan) {
    lines.push(
      "**重量級コーパスはこの走行に含まれていない。**",
      "通常のリリース経路なら必ず居る——居ないなら、検査を迂回した配信である。",
      "",
    );
  } else if (!attachments.includes(HEAVY_REPORT)) {
    // **添付の実在を証拠の側が見る**(B-2)。走ったのに報告書が無いなら、
    // 「重量級を通した」という主張の裏づけがこの Release に残っていない。
    lines.push(
      `**重量級の報告書が添付されていない**(\`${HEAVY_REPORT}\`)。`,
      "走行そのものは通っているが、**この Release からは中身を読めない。**",
      "",
    );
  }
  if (attachments.length > 0) {
    lines.push("## 添付", "");
    for (const name of attachments) {
      lines.push(`- \`${name}\``);
    }
    lines.push("");
  }
  lines.push(
    "## この文書が言えること",
    "",
    "**上の一覧の検査を通ってから、このコミットが本番へ配信された**——言えるのはそれだけである。",
    "検査していない性質については何も言わない。各検査が何を見ているかは、走行のログと",
    "添付の報告書が持つ。",
    "",
  );
  return lines.join("\n");
}

/** 走行のジョブを GitHub から読む。**この走行のものだけ**を読む。 */
function fetchJobs(repo, runId) {
  const raw = execFileSync(
    "gh",
    ["api", `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const payload = JSON.parse(raw);
  const jobs = payload.jobs ?? [];
  if (
    typeof payload.total_count === "number" &&
    payload.total_count > jobs.length
  ) {
    // **黙って切り取らない。** 100 を超えたら、読めなかったことを言う。
    throw new Error(
      `ジョブが ${payload.total_count} 件あるのに ${jobs.length} 件しか読めていない`,
    );
  }
  return jobs;
}

function main() {
  const repo = process.env.REPO;
  const runId = process.env.RUN_ID;
  const tag = process.env.TAG;
  const sha = process.env.SHA;
  for (const [name, value] of Object.entries({
    REPO: repo,
    RUN_ID: runId,
    TAG: tag,
    SHA: sha,
  })) {
    if (!value) {
      throw new Error(`環境変数 ${name} が空である`);
    }
  }
  const attachments = process.argv.slice(2);
  process.stdout.write(
    renderEvidence({
      tag,
      sha,
      repo,
      runId,
      jobs: fetchJobs(repo, runId),
      attachments,
      // 自分自身のジョブ名。**渡されなければ名指ししない**——
      // 名指しできないことと、嘘を書くことは別である(B-3)。
      selfName: process.env.SELF_JOB_NAME ?? "",
    }),
  );
}

// vitest から import されたときは走らせない(`check-version.mjs` と同じ作法)。
if (process.argv[1]?.endsWith("release-evidence.mjs")) {
  main();
}

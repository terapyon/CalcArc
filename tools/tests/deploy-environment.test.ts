import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * **Cloudflare の秘密は、承認とタグの規則を通った走行にしか渡らない**
 * （2026-11-21）。
 *
 * **秘密は environment（`production` / `staging`）にだけ置く。** その
 * environment の承認者と「どの ref から出してよいか」は **GitHub の設定**が
 * 持ち、**リポジトリからは見えない**——ここで見張れるのは、ワークフローが
 * その environment を**名指ししているか**と、**名指す前に ref を確かめて
 * いるか**だけである。設定の側は `docs/deploy.md` の
 * 「environment と tag ruleset」に、見張れない理由と一緒に書いてある。
 */
const read = (name: string) =>
  readFileSync(
    new URL(`../../.github/workflows/${name}`, import.meta.url),
    "utf8",
  );

/** **コメントを読まない。** 註に綴りが現れた日に、主張が無くなるか偽赤になる。 */
const declarations = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("#"));

/** `jobs:` の下のジョブを、名前と本文（行を落とさない）の組で取る。 */
const jobsOf = (yaml: string) => {
  const body = yaml.split("\njobs:\n")[1] ?? "";
  const parts = body.split(/^ {2}([\w-]+):\n/m);
  const jobs: { id: string; body: string }[] = [];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    jobs.push({ id: parts[i] ?? "", body: parts[i + 1] ?? "" });
  }
  return jobs;
};

const job = (yaml: string, id: string) => {
  const found = jobsOf(yaml).find((j) => j.id === id);
  expect(found, `ジョブ ${id} が無い`).toBeDefined();
  return found?.body ?? "";
};

/** ジョブ直下（4 字下げ）の鍵の値。 */
const keyOf = (body: string, key: string) =>
  body
    .split("\n")
    .filter((line) => line.startsWith(`    ${key}:`))
    .map((line) => line.slice(`    ${key}:`.length).trim());

const WORKFLOWS = [
  "ci.yml",
  "deploy.yml",
  "heavy-corpus.yml",
  "release.yml",
  "staging.yml",
];

describe("本番へ配るジョブは production の environment を持つ", () => {
  const deploy = read("deploy.yml");

  it("`deploy` のジョブが、ちょうど `production` を名指す（等値で見る）", () => {
    expect(keyOf(job(deploy, "deploy"), "environment")).toEqual(["production"]);
  });

  it("`deploy.yml` で environment を持つのは `deploy` だけである", () => {
    const named = jobsOf(deploy)
      .filter((j) => keyOf(j.body, "environment").length > 0)
      .map((j) => j.id);
    expect(named).toEqual(["deploy"]);
  });

  it("`deploy` は `gate` を待つ（並び順は実行順を決めない）", () => {
    expect(keyOf(job(deploy, "deploy"), "needs")).toEqual(["gate"]);
  });
});

describe("`gate` は秘密に触れる前に ref を確かめる", () => {
  const gate = () => job(read("deploy.yml"), "gate");

  it("`v*` タグ以外を落とす", () => {
    expect(declarations(gate())).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: ワークフローの綴りをそのまま持つので、テンプレートリテラルにできない
      "if: ${{ !startsWith(github.ref, 'refs/tags/v') }}",
    );
  });

  it("タグが main の上に在ることを見る（手動起動でも迂回できない）", () => {
    const lines = declarations(gate());
    expect(lines).toContain("git fetch --no-tags origin main");
    expect(lines).toContain(
      'if ! git merge-base --is-ancestor "$GITHUB_SHA" origin/main; then',
    );
    // **浅い clone では祖先を辿れない。** 既定の深さ 1 だと、main の上の
    // タグでも「入っていない」と答える。
    expect(lines).toContain("fetch-depth: 0");
  });

  it("environment を持たず、秘密を読まない", () => {
    // **ここが environment を持つと、承認画面が ref の確認より先に出る。**
    expect(keyOf(gate(), "environment")).toEqual([]);
    expect(gate()).not.toContain("secrets.");
  });
});

describe("staging へ配るジョブは staging の environment を持つ", () => {
  it("`deploy` のジョブが、ちょうど `staging` を名指す", () => {
    expect(keyOf(job(read("staging.yml"), "deploy"), "environment")).toEqual([
      "staging",
    ]);
  });
});

describe("Cloudflare の秘密を読むジョブは、必ず environment を持つ", () => {
  // **秘密をリポジトリ全体から消したあとで、environment の無いジョブが
  // 秘密を読めば、空の値で wrangler が落ちるだけで済む。** ただし**消す前**
  // （または誰かが戻した日）には、そのジョブが承認も ref の規則も通らずに
  // 秘密を受け取る。**読む場所と environment を対にしておく。**
  it.each(WORKFLOWS)("%s", (file) => {
    const bare = jobsOf(read(file))
      .filter((j) => j.body.includes("secrets.CLOUDFLARE_"))
      .filter((j) => keyOf(j.body, "environment").length === 0)
      .map((j) => j.id);
    expect(bare, `${file} で environment を持たずに秘密を読むジョブ`).toEqual(
      [],
    );
  });

  it("秘密を読むジョブを 2 つは見ている（0 件で緑を返さない）", () => {
    const readers = WORKFLOWS.flatMap((file) =>
      jobsOf(read(file))
        .filter((j) => j.body.includes("secrets.CLOUDFLARE_"))
        .map((j) => `${file}:${j.id}`),
    );
    expect(readers).toEqual(["deploy.yml:deploy", "staging.yml:deploy"]);
  });
});

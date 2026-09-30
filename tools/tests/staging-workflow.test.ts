import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * **staging の配信が、本番に届かないことを静的に見張る**
 * （設計書 `docs/superpowers/specs/2026-09-30-staging-url-design.md` §2.4）。
 *
 * **ここは実走しない検査である。** 配信そのものは `staging.yml` の中の
 * スモーク 4 本が見るが、**あれは走った日にしか働かない**——**綴りの誤りは、
 * 走る前に止めたい。**
 */
const read = (name: string) =>
  readFileSync(
    new URL(`../../.github/workflows/${name}`, import.meta.url),
    "utf8",
  );

/** ジョブの steps を、`run` と `uses` と `name` の行として取り出す（`release-workflow.test.ts` と同じ形）。 */
const stepsOf = (yaml: string, jobName: string) => {
  const body = yaml.split(`\n  ${jobName}:\n`)[1] ?? "";
  const untilNextJob = body.split(/\n {2}\w[\w-]*:\n/)[0] ?? "";
  return untilNextJob
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.startsWith("- ") ||
        line.startsWith("run:") ||
        line.startsWith("name:"),
    );
};

/** ジョブの本文を、行を落とさずそのまま取る（`run: |` の中身まで読む）。 */
const jobBody = (yaml: string, jobName: string) => {
  const body = yaml.split(`\n  ${jobName}:\n`)[1] ?? "";
  return body.split(/\n {2}\w[\w-]*:\n/)[0] ?? "";
};

/** **コメントを読まない。** 註に綴りが現れた日に、主張が無くなるか偽赤になる。 */
const declarations = (yaml: string) =>
  yaml
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("#"));

describe("番人 #1 — 配る先は staging である", () => {
  // **★ 否定形にしてはいけない**（レビュー役の阻止 A1、設計書 §2.4 ①）。
  // **`wrangler pages deploy` は `--branch` を省くと git の現在の枝名を使う**
  // ——**main への push で checkout した runner では HEAD が `main`** なので、
  // **省略はそのまま本番配信である。**
  // **「`main` が入っていない」という主張は、省略を緑で通す。**
  const COMMAND =
    "pages deploy web/dist --project-name=calcarc --branch=staging";

  const commandLines = () =>
    declarations(read("staging.yml"))
      .filter((line) => line.startsWith("command:"))
      .map((line) => line.slice("command:".length).trim());

  it("配る命令が、ちょうどこの綴りである（等値で見る）", () => {
    expect(commandLines()).toEqual([COMMAND]);
  });

  it("`${{` を含まない（変数経由は、読んでも何が渡るか分からない）", () => {
    for (const line of commandLines()) {
      expect(line, "配る命令に式が入っている").not.toContain("${{");
    }
  });

  it("`--branch=` がちょうど 1 回である（省略も重複も止める）", () => {
    for (const line of commandLines()) {
      expect(line.match(/--branch=/g) ?? [], "--branch の数").toHaveLength(1);
    }
  });

  it("`pages deploy` の綴りは、この 1 行にしかない", () => {
    // **★ 等値だけでは足りない**（レビュー役の変異 2026-09-30）——
    // **`wrangler-action` に `preCommands:` を足しても、別の段に
    // `- run: npx wrangler pages deploy … --branch=main` を足しても、
    // `command:` の行は正しいまま**である。**どちらも 15 本とも緑だった。**
    // **#1 の目的は「`staging.yml` から本番へ出る道が無い」**ことなので、
    // **綴りの出現そのものを数える。**
    const hits = declarations(read("staging.yml")).filter((line) =>
      line.includes("pages deploy"),
    );
    expect(hits).toEqual([`command: ${COMMAND}`]);
  });

  it("`preCommands` / `postCommands` を持たない", () => {
    // **`wrangler-action` はこの 2 つで任意のコマンドを走らせる。**
    // **`command:` の等値は、その脇道を見ない。**
    for (const key of ["preCommands", "postCommands"]) {
      expect(
        declarations(read("staging.yml")).filter((line) =>
          line.startsWith(`${key}:`),
        ),
        `${key} が在る`,
      ).toEqual([]);
    }
  });

  it("staging に出せるのは main だけである", () => {
    // **`workflow_dispatch` はどの枝からでも起動できる**（レビュー役の条件 B2）。
    // **止めないと、作業枝のビルドが staging に乗る。**
    expect(jobBody(read("staging.yml"), "deploy")).toContain(
      "if: ${{ github.ref != 'refs/heads/main' }}",
    );
  });

  it("本番へ配る命令は、いまも main のままである", () => {
    // **`deploy.yml` は触らない**——あの段は本番配信でしか走らないので、
    // **触ると次の Release で初めて試される。**
    // **★ ただし、ここが見ているのは `command:` の 1 行だけ**である
    // （レビュー役の注記 C1）——**「`deploy.yml` を触っていない」ではない。**
    const production = declarations(read("deploy.yml"))
      .filter((line) => line.startsWith("command:"))
      .map((line) => line.slice("command:".length).trim());
    expect(production).toEqual([
      "pages deploy web/dist --project-name=calcarc --branch=main",
    ]);
  });
});

describe("番人 #2 — 検査を通してから配る", () => {
  it("`ci.yml` を呼んでいる（写していない）", () => {
    // **写しを持たない**（設計書 §2.2）。**写すと片方だけ直る日が来る。**
    expect(declarations(read("staging.yml"))).toContain(
      "uses: ./.github/workflows/ci.yml",
    );
  });

  it("配る段は、検査とマニュアルの後ろに居る", () => {
    const yaml = read("staging.yml");
    const at = (needle: string) => yaml.indexOf(needle);
    expect(at("\n  ci:\n")).toBeGreaterThanOrEqual(0);
    expect(at("\n  manuals:\n")).toBeGreaterThan(at("\n  ci:\n"));
    expect(at("\n  deploy:\n")).toBeGreaterThan(at("\n  manuals:\n"));
    // **`needs` で結ぶ。** 並び順は実行順を決めない。
    expect(yaml).toContain("    needs: ci");
    expect(yaml).toContain("    needs: manuals");
  });
});

describe("番人 #4b — 本番は検索から消えない（リポジトリから入る経路）", () => {
  // **`X-Robots-Tag` / `noindex` はリポジトリの 4 か所から入りうる**——
  // `web/public/_headers`（本番と共用）・`functions/`・**`web/index.html` の
  // `<meta name="robots">`**・**`deploy.yml` の本文**（**staging の追記段が
  // 写されて本番に入る形**）。**どれにも無いことを見る。**
  //
  // **Cloudflare の設定画面から入る経路は、リポジトリからは見えない**
  // （設計書 §6 の未確認）——**あちらは `staging.yml` の 5 本目のスモークが、
  // main への push ごとに見る。**
  const repoFile = (path: string) =>
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

  const filesUnder = (dir: string): string[] => {
    const entries = readdirSync(new URL(`../../${dir}`, import.meta.url), {
      withFileTypes: true,
    });
    return entries.flatMap((entry) =>
      entry.isDirectory()
        ? filesUnder(`${dir}/${entry.name}`)
        : [`${dir}/${entry.name}`],
    );
  };

  /** 検索から消す綴り。**大文字小文字は問わない。** */
  const NOINDEX = /X-Robots-Tag|noindex/i;

  it("本番と共用の `_headers` に、検索から消す綴りが無い", () => {
    expect(repoFile("web/public/_headers")).not.toMatch(NOINDEX);
  });

  it('`web/index.html` に `<meta name="robots">` が無い', () => {
    expect(repoFile("web/index.html")).not.toMatch(NOINDEX);
  });

  it("`deploy.yml` の宣言に、検索から消す綴りが無い", () => {
    // **staging の追記段を写して本番に入れる形を止める。**
    // **註は読まない**（レビュー役の注記 C2）——**`deploy.yml` の註に
    // 「noindex」と書いた日に偽の赤になる。** `_headers`・`index.html`・
    // `functions/` は本文だけのファイルなのでそのまま読む。
    expect(declarations(read("deploy.yml")).join("\n")).not.toMatch(NOINDEX);
  });

  it("`functions/` のどれにも、検索から消す綴りが無い", () => {
    const files = filesUnder("functions");
    // **0 件で緑にしない。** 読めていなければ、この主張は何も言っていない。
    expect(files.length, "functions/ を 1 件も読めていない").toBeGreaterThan(0);
    for (const path of files) {
      expect(repoFile(path), `${path} が noindex を付けている`).not.toMatch(
        NOINDEX,
      );
    }
  });

  it("本番の応答を、main への push ごとに見ている", () => {
    // **設定画面の経路は静的には見えない**ので、**走行が見る**。
    expect(jobBody(read("staging.yml"), "deploy")).toContain(
      'curl -sSI "https://calc.terapyon.net/" | grep -qi x-robots-tag',
    );
  });
});

describe("番人 #4c — staging は配る物にだけ noindex を足す", () => {
  it("追記先が `web/dist/_headers` である（肯定形で見る）", () => {
    // **「`public` でない」ではなく「`dist` である」。** 否定形は、
    // 追記先が 3 つ目の場所へ移った日を緑で通す。
    expect(jobBody(read("staging.yml"), "deploy")).toContain(
      "printf '\\n/*\\n  X-Robots-Tag: noindex\\n' >> web/dist/_headers",
    );
  });

  it("追記の段は 1 つだけである", () => {
    const appends = declarations(read("staging.yml")).filter((line) =>
      line.includes("_headers"),
    );
    expect(appends).toHaveLength(1);
  });
});

describe("番人 #5 — ビルドの段は本番と同じ順である", () => {
  // **staging と本番で作り方が違うと、「本番と同じものを見ている」と言えない。**
  // **写しは避けられない**（`deploy.yml` を触らないと決めたので）——だから
  // **一致を主張にする。**
  const buildSteps = (yaml: string, job: string) => {
    const steps = stepsOf(yaml, job);
    const from = steps.findIndex((line) =>
      line.includes("./.github/actions/setup-wasm-pack"),
    );
    const to = steps.findIndex((line) => line.includes("pnpm check:sw"));
    expect(from, "setup-wasm-pack の段が無い").toBeGreaterThanOrEqual(0);
    expect(to, "check:sw の段が無い").toBeGreaterThan(from);
    return steps
      .slice(from, to + 1)
      .filter((line) => !line.startsWith("name:"));
  };

  // **★ 比べているのは各段の 1 行目だけである**（レビュー役の注記 C3、2026-09-30）
  // ——**`with:` の `path:`、`working-directory:`、`uses:` の SHA は見ていない。**
  // **artifact の `path:` を変える変異は、この番人では鳴らない**（実測）。
  it("`wasm-pack` から `check:sw` までが、`deploy.yml` と同じ並びである", () => {
    const staging = buildSteps(read("staging.yml"), "deploy");
    const production = buildSteps(read("deploy.yml"), "deploy");
    // **刻印の 1 行だけは違う**——staging には `"channel":"staging"` が入る
    // （設計書 §2.4b）。**その行を除いて比べる。**
    const withoutStamp = (steps: string[]) =>
      steps.filter((line) => !line.startsWith("run: |"));
    expect(withoutStamp(staging)).toEqual(withoutStamp(production));
  });

  it("staging の刻印だけが channel を持つ", () => {
    expect(read("staging.yml")).toContain('"channel":"staging"');
    expect(read("deploy.yml")).not.toContain("channel");
  });
});

import { describe, expect, it } from "vitest";
import { MANUALS_JOB, MAY_FAIL, renderEvidence } from "../release-evidence.mjs";

// 走行から返ってくる形の最小限。**実物と形が違えば証拠は何も示さない**ので、
// 綴りは `gh api repos/{repo}/actions/runs/{id}/jobs` の応答から写している。
const job = (
  name: string,
  conclusion: string | null,
  status = "completed",
  over: Record<string, unknown> = {},
) => ({
  name,
  status,
  conclusion,
  started_at: "2026-08-26T00:00:00Z",
  completed_at: "2026-08-26T00:03:12Z",
  html_url: `https://github.com/terapyon/CalcArc/actions/runs/1/job/${name}`,
  ...over,
});

const base = {
  tag: "v0.5.0",
  sha: "0123456789abcdef0123456789abcdef01234567",
  repo: "terapyon/CalcArc",
  runId: "42",
  attachments: ["heavy-report.md", "calcarc-v0.5.0-dist.tar.gz"],
};

describe("renderEvidence", () => {
  it("タグ・コミット・走行を、読む人が突き合わせられる形で出す", () => {
    const out = renderEvidence({
      ...base,
      jobs: [job("Rust core", "success")],
    });
    expect(out).toContain("v0.5.0");
    expect(out).toContain("0123456789abcdef0123456789abcdef01234567");
    expect(out).toContain(
      "https://github.com/terapyon/CalcArc/actions/runs/42",
    );
  });

  it("通した検査を 1 行ずつ並べる", () => {
    const out = renderEvidence({
      ...base,
      jobs: [
        job("Rust core", "success"),
        job("Heavy corpus / Corpus vs reference", "success"),
      ],
    });
    expect(out).toContain("Rust core");
    expect(out).toContain("Heavy corpus / Corpus vs reference");
    expect(out).toContain("成功");
  });

  it("まだ終わっていないジョブを「成功」と書かない", () => {
    // 証拠を書いているジョブ自身は、書いている時点では終わっていない。
    // **それを成功として数えたら、その行は嘘になる。**
    const out = renderEvidence({
      ...base,
      jobs: [job("Rust core", "success"), job("Evidence", null, "in_progress")],
    });
    expect(out).toContain("進行中");
    expect(out).toMatch(/成功した検査: *1/);
  });

  it("落ちた検査があるなら、証拠を書かずに落ちる", () => {
    // **緑でない走行から「緑だった」という文書を作らせない。**
    expect(() =>
      renderEvidence({ ...base, jobs: [job("Rust core", "failure")] }),
    ).toThrow(/failure/);
  });

  it("取り消された検査も同じく通さない", () => {
    expect(() =>
      renderEvidence({ ...base, jobs: [job("E2E", "cancelled")] }),
    ).toThrow(/cancelled/);
  });

  it("添付した物を名前で挙げる", () => {
    const out = renderEvidence({
      ...base,
      jobs: [job("Rust core", "success")],
    });
    expect(out).toContain("heavy-report.md");
    expect(out).toContain("calcarc-v0.5.0-dist.tar.gz");
  });

  it("言える範囲を書く", () => {
    // 「この一覧を通ってから配信された」以上のことを主張しない。
    const out = renderEvidence({
      ...base,
      jobs: [job("Rust core", "success")],
    });
    expect(out).toContain("検査していない性質については何も言わない");
  });

  it("ジョブが 1 つも無い走行から証拠を作らない", () => {
    expect(() => renderEvidence({ ...base, jobs: [] })).toThrow(/ジョブ/);
  });

  it("重量級を通していない走行には、その旨を書く", () => {
    // 緊急経路(検査を迂回した配信)から証拠だけ作られる事故を防ぐ。
    const out = renderEvidence({
      ...base,
      jobs: [job("Rust core", "success")],
    });
    expect(out).toContain("重量級コーパスはこの走行に含まれていない");
  });

  it("同じ入力からは同じ文字列が出る", () => {
    // **走行のたびに変わる値を混ぜない。** 混ぜると、証拠を作り直したときに
    // 内容が変わり、どちらが本物か言えなくなる。
    const args = { ...base, jobs: [job("Rust core", "success")] };
    expect(renderEvidence(args)).toBe(renderEvidence(args));
  });
});

// ---------------------------------------------------------------------------
// Wave B（2026-08-26）。**証拠が嘘をつく側から潰す。**
// ---------------------------------------------------------------------------

describe("renderEvidence — 証拠が嘘をつかないこと", () => {
  const heavyBody = job("Heavy corpus / Corpus vs reference", "success");
  const heavyGate = job("Heavy corpus / Version numbers agree", "success");

  it("B-2: 重量級が走ったのに報告書が添付されていないなら、そう書く", () => {
    // 添付の欠落は 2 段の許容（`if-no-files-found: warn` と
    // `continue-on-error`）で黙って通っていた。**証拠の側も添付の実在を見る。**
    const out = renderEvidence({
      ...base,
      jobs: [heavyBody],
      attachments: ["calcarc-v0.5.0-dist.tar.gz"],
    });
    expect(out).toContain("重量級の報告書が添付されていない");
  });

  it("B-2: 報告書が在るなら、その注記は出さない", () => {
    const out = renderEvidence({
      ...base,
      jobs: [heavyBody],
      attachments: ["heavy-report.md", "calcarc-v0.5.0-dist.tar.gz"],
    });
    expect(out).not.toContain("重量級の報告書が添付されていない");
  });

  it("B-3: skipped を「進行中」と書かない", () => {
    const out = renderEvidence({
      ...base,
      jobs: [heavyBody, job("Deploy / Build and deploy", "skipped")],
    });
    expect(out).toContain("飛ばした");
    expect(out).not.toMatch(/Deploy \/ Build and deploy \| 進行中/);
  });

  it("B-3: skipped を成功に数えない", () => {
    const out = renderEvidence({
      ...base,
      jobs: [heavyBody, job("Deploy / Build and deploy", "skipped")],
    });
    expect(out).toMatch(/成功した検査: *1/);
    expect(out).toMatch(/飛ばした検査: *1/);
  });

  it("B-3: neutral も成功に数えない", () => {
    const out = renderEvidence({
      ...base,
      jobs: [heavyBody, job("CI / Something", "neutral")],
    });
    expect(out).toMatch(/成功した検査: *1/);
  });

  it("B-3: 「この証拠を書いているジョブ自身」は、本当に自分自身のときだけ言う", () => {
    // 進行中が自分以外にも居るなら、その断定は嘘になる。
    const out = renderEvidence({
      ...base,
      jobs: [
        heavyBody,
        job("Evidence and GitHub Release", null, "in_progress"),
        job("CI / X", null, "in_progress"),
      ],
      selfName: "Evidence and GitHub Release",
    });
    expect(out).not.toContain("この証拠を書いているジョブ自身である");
  });

  it("B-3: 自分だけが進行中なら、そう言ってよい", () => {
    const out = renderEvidence({
      ...base,
      jobs: [
        heavyBody,
        job("Evidence and GitHub Release", null, "in_progress"),
      ],
      selfName: "Evidence and GitHub Release",
    });
    expect(out).toContain("この証拠を書いているジョブ自身である");
  });

  it("B-4: 重量級の在席は、11 秒の版数ゲートでは満たされない", () => {
    // `includes("Heavy corpus")` は `Heavy corpus / Version numbers agree`
    // にも当たっていた。**35 分の本体が走ったこと**を見る。
    const out = renderEvidence({ ...base, jobs: [heavyGate] });
    expect(out).toContain("重量級コーパスはこの走行に含まれていない");
  });

  it("B-4: 本体が居れば在席と認める", () => {
    const out = renderEvidence({
      ...base,
      jobs: [heavyBody],
      attachments: ["heavy-report.md"],
    });
    expect(out).not.toContain("重量級コーパスはこの走行に含まれていない");
  });
});

// ---------------------------------------------------------------------------
// Fable のレビュー（2026-08-27）。**実走で見つかった 3 件。**
// ---------------------------------------------------------------------------

describe("renderEvidence — 在席と結論の継ぎ目", () => {
  const heavyBody = (conclusion: string | null, status = "completed") =>
    job("Heavy corpus / Corpus vs reference", conclusion, status);

  it("F-1: 名前が在っても、成功していなければ在席と認めない", () => {
    // **同じ文書の中で矛盾していた。** 表は「飛ばした(skipped)」と正直に
    // 書くのに、その下で「走行そのものは通っている」と言っていた
    // ——在席の判定が**名前の実在だけ**を見ていたため。
    const out = renderEvidence({
      ...base,
      jobs: [heavyBody("skipped")],
      attachments: [],
    });
    expect(out).toContain("重量級コーパスはこの走行に含まれていない");
    expect(out).not.toContain("走行そのものは通っている");
  });

  it("F-1: 進行中でも在席と認めない", () => {
    const out = renderEvidence({
      ...base,
      jobs: [heavyBody(null, "in_progress")],
      attachments: [],
    });
    expect(out).toContain("重量級コーパスはこの走行に含まれていない");
  });

  it("F-1: 成功していれば在席と認める", () => {
    const out = renderEvidence({
      ...base,
      jobs: [heavyBody("success")],
      attachments: ["heavy-report.md"],
    });
    expect(out).not.toContain("重量級コーパスはこの走行に含まれていない");
  });

  it("F-2: 知らない結論は、断って落ちる", () => {
    // **ホワイトリストの向きが逆だった。** 知っている 7 種の網羅を仮定して
    // 余りを「進行中」と断定していたので、`stale` や将来の新しい値が
    // **終わった走行を「進行中」と語る**形になっていた。
    expect(() =>
      renderEvidence({ ...base, jobs: [job("CI / X", "stale")] }),
    ).toThrow(/未知の結論/);
    expect(() =>
      renderEvidence({ ...base, jobs: [job("CI / X", "startup_failure")] }),
    ).toThrow(/未知の結論/);
  });

  it("F-2: まだ終わっていないジョブは、結論が無くても通す", () => {
    // `status` が `completed` でないなら、結論がまだ無いのは正常である。
    const out = renderEvidence({
      ...base,
      jobs: [heavyBody("success"), job("Evidence", null, "in_progress")],
      attachments: ["heavy-report.md"],
    });
    expect(out).toContain("進行中");
  });
});

// ---------------------------------------------------------------------------
// マニュアル（2026-09-11、マニュアルの設計書 §5、裁定 §9 #3「本番は止めない」）。
// **落ちてよいのは `Manuals` の 1 つだけ。** それ以外の赤は今までどおり
// 証拠を書かずに落ちる。
// ---------------------------------------------------------------------------

describe("renderEvidence — マニュアルだけは落ちても証拠を書く", () => {
  const heavyBody = job("Heavy corpus / Corpus vs reference", "success");
  const deploy = job(
    "Deploy / Build and deploy to Cloudflare Pages",
    "success",
  );
  const pdfs = [
    "calcarc-0.5.0-detail-ja.pdf",
    "calcarc-0.5.0-quick-en.pdf",
    "calcarc-0.5.0-quick-ja.pdf",
  ];
  const withManuals = (conclusion: string) => [
    heavyBody,
    deploy,
    job(MANUALS_JOB, conclusion),
  ];

  it("名前は release.yml のジョブの名前そのままである", () => {
    // 呼ばれたワークフローのジョブではないので `A / B` の形にならない。
    expect(MANUALS_JOB).toBe("Manuals");
    expect(MANUALS_JOB).not.toContain(" / ");
  });

  it.each(["failure", "cancelled", "timed_out"])(
    "Manuals が %s でも証拠を書き、作れなかったと言う",
    (conclusion) => {
      const out = renderEvidence({ ...base, jobs: withManuals(conclusion) });
      expect(out).toContain("**マニュアル（PDF）は作れなかった**");
      expect(out).toContain(`\`Manuals\` = \`${conclusion}\``);
      expect(out).toContain("本番へ配った物には影響しない");
      // 表は正直に書き、成功にも進行中にも数えない。
      expect(out).toContain(`| Manuals | 落ちた(\`${conclusion}\`) |`);
      expect(out).toMatch(/成功した検査: *2\*\*\n/);
      expect(out).not.toMatch(/\| Manuals \| 進行中/);
    },
  );

  it("Manuals 以外が落ちたら、今までどおり証拠を書かずに落ちる", () => {
    expect(() =>
      renderEvidence({
        ...base,
        jobs: [heavyBody, job("Deploy / Build and deploy", "failure")],
      }),
    ).toThrow(/Deploy \/ Build and deploy = failure/);
    // **普段の CI の同名のジョブは例外に入らない**——本番の前に居るので、
    // あれが落ちたなら本番へは出ていない。名前の完全一致だけが外れる。
    expect(() =>
      renderEvidence({
        ...base,
        jobs: [heavyBody, job(`CI / ${MANUALS_JOB}`, "failure")],
      }),
    ).toThrow(/CI \/ Manuals = failure/);
  });

  it("Manuals と別のジョブが両方落ちたら、落ちる（落ちた別のジョブを名指す）", () => {
    let message = "";
    try {
      renderEvidence({
        ...base,
        jobs: [
          heavyBody,
          job(MANUALS_JOB, "failure"),
          job("CI / Rust core", "failure"),
        ],
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("緑でない走行から証拠は作れない");
    expect(message).toContain("CI / Rust core = failure");
    // 許したほうを落ちた理由として挙げない。
    expect(message).not.toContain("Manuals = failure");
  });

  it("Manuals の未知の結論は、例外にならず断って落ちる（F-2）", () => {
    expect(() =>
      renderEvidence({ ...base, jobs: withManuals("startup_failure") }),
    ).toThrow(/未知の結論/);
  });

  it("Manuals が成功したのに PDF が添付されていないなら、そう書く", () => {
    const out = renderEvidence({
      ...base,
      jobs: withManuals("success"),
      attachments: ["heavy-report.md", "calcarc-v0.5.0-dist.tar.gz"],
    });
    expect(out).toContain("マニュアル（PDF）は作ったが、添付されていない");
    expect(out).not.toContain("作れなかった");
  });

  it("Manuals が成功して PDF が添付されているなら、冊数と名前を挙げる", () => {
    const out = renderEvidence({
      ...base,
      jobs: withManuals("success"),
      attachments: ["heavy-report.md", "calcarc-v0.5.0-dist.tar.gz", ...pdfs],
    });
    expect(out).toContain("**マニュアル（PDF）: 3 冊**");
    for (const name of pdfs) {
      expect(out).toContain(`\`${name}\``);
    }
    expect(out).not.toContain("添付されていない");
    expect(out).not.toContain("作れなかった");
  });

  it("Manuals が居ない走行では、作っていないと書く", () => {
    const out = renderEvidence({ ...base, jobs: [heavyBody, deploy] });
    expect(out).toContain("マニュアル（PDF）はこの走行で作っていない");
  });

  it("例外はちょうど Manuals の 1 つである", () => {
    expect([...MAY_FAIL]).toEqual([MANUALS_JOB]);
  });
});

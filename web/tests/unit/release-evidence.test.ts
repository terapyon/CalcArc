import { describe, expect, it } from "vitest";
import { renderEvidence } from "../../scripts/release-evidence.mjs";

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

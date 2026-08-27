import { describe, expect, it } from "vitest";
import { spliceEvidence } from "../release-notes.mjs";

// **v0.4.1 の Release の本文そのもの**(`gh api` で取得して貼った)。
// GitHub が自動生成した "What's Changed" で、改行は CRLF、目印は入っていない
// ——**証拠が載らなかったときの実物**である。作り物の fixture では、
// CRLF と自動生成の見出しが同時に来る形を再現できない。
const V041_BODY =
  "## What's Changed\r\n* Make the footer 12px, now that one line fits again by @terapyon in https://github.com/terapyon/CalcArc/pull/66\r\n* リリース方法の変更やテストパッケージの正常化 by @terapyon in https://github.com/terapyon/CalcArc/pull/67\r\n* Build the wasm before asking the type checker about it by @terapyon in https://github.com/terapyon/CalcArc/pull/68\r\n\r\n\r\n**Full Changelog**: https://github.com/terapyon/CalcArc/compare/v0.4.0...v0.4.1\n";

const EVIDENCE = ["# v0.4.1 のリリース証拠", "", "(9 ジョブが成功)"].join("\n");

describe("spliceEvidence", () => {
  it("自動生成の What's Changed を消さない", () => {
    const out = spliceEvidence(V041_BODY, EVIDENCE);
    expect(out).toContain("## What's Changed");
    expect(out).toContain("/pull/66");
    expect(out).toContain("Full Changelog");
  });

  it("証拠を本文に載せる", () => {
    const out = spliceEvidence(V041_BODY, EVIDENCE);
    expect(out).toContain("# v0.4.1 のリリース証拠");
    expect(out).toContain("<!-- release-evidence -->");
  });

  it("再走行で二重に積まない", () => {
    // **走行は再実行される。** 2 度目に目印ごと積み増すと、本文が証拠で
    // 埋まっていく。目印より後ろを捨ててから貼り直す。
    const once = spliceEvidence(V041_BODY, EVIDENCE);
    const twice = spliceEvidence(once, EVIDENCE);
    expect(twice).toBe(once);
    expect(twice.split("<!-- release-evidence -->").length - 1).toBe(1);
    expect(twice.split("## What's Changed").length - 1).toBe(1);
  });

  it("何度掛けても 1 バイトも伸びない", () => {
    // **末尾の空行を落とさないと 1 バイトずつ伸びる**(手作業の版で実測した)。
    // 5 回掛けて長さが動かないことを見る。
    let out = spliceEvidence(V041_BODY, EVIDENCE);
    const first = out.length;
    for (let i = 0; i < 5; i += 1) {
      out = spliceEvidence(out, EVIDENCE);
      expect(out.length).toBe(first);
    }
  });

  it("同じ入力からは同じ文字列が出る", () => {
    expect(spliceEvidence(V041_BODY, EVIDENCE)).toBe(
      spliceEvidence(V041_BODY, EVIDENCE),
    );
  });

  it("証拠が更新されたら、古い証拠は残らない", () => {
    const once = spliceEvidence(V041_BODY, EVIDENCE);
    const updated = spliceEvidence(once, "# 新しい証拠");
    expect(updated).toContain("# 新しい証拠");
    expect(updated).not.toContain("(9 ジョブが成功)");
    expect(updated).toContain("## What's Changed");
  });

  it("本文が空でも先頭に空行を作らない", () => {
    const out = spliceEvidence("", EVIDENCE);
    expect(out.startsWith("<!-- release-evidence -->")).toBe(true);
  });

  it("CRLF の本文でも目印を見失わない", () => {
    // 実物は CRLF である。1 度貼った後の本文は LF 混じりになるので、
    // **行末が混ざった状態でも**目印を見つけられること。
    const once = spliceEvidence(V041_BODY, EVIDENCE);
    expect(once).toContain("\r\n");
    expect(spliceEvidence(once, EVIDENCE)).toBe(once);
  });
});

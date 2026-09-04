import { describe, expect, it } from "vitest";
import {
  citesBaseSpec,
  findCitations,
  readSpecSections,
  readSpecText,
  readTrackedFiles,
} from "../check-citations.mjs";

// **`§` を literal で書けない箇所がある。** 「実在しない節」を素の文字で
// 書くと、下の「実物を見る」テストが**このファイル自身**を違反として拾う
// ——検査を書いた行が検査違反になるのは、検査の側の誤りである
// (`check-boundary.mjs` が同じ罠を踏んで、語ではなく import を見る形に
// 直してある)。**除外を作るのではなく、綴りを避ける。**
const S = "§";

describe("readSpecSections", () => {
  it("`#` 1 つの節と `##` の小節を両方拾う", () => {
    // **base-spec は 2 つの綴りを混ぜている。** `# 43. Accessibility` には
    // 点が付き、`## 9.2 MVP機能` には付かない。
    const sections = readSpecSections(
      [
        "# 43. Accessibility",
        "",
        "## 9.2 MVP機能",
        "",
        "# 44. OSS Policy",
      ].join("\n"),
    );
    expect([...sections].sort()).toEqual(["43", "44", "9.2"]);
  });

  it("見出しでない行の数字は拾わない", () => {
    expect(readSpecSections("44px は下限である\n- 43 件\n").size).toBe(0);
  });
});

describe("findCitations", () => {
  const sections = new Set(["26", "43", "9.2"]);

  it("base-spec に無い節を指していたら見つける", () => {
    const { total, dangling } = findCitations(
      [{ path: "web/a.ts", text: `// base-spec ${S}999 を見よ\n` }],
      sections,
    );
    expect(total).toBe(1);
    expect(dangling).toEqual([
      {
        path: "web/a.ts",
        line: 1,
        section: "999",
        text: `// base-spec ${S}999 を見よ`,
      },
    ]);
  });

  it("実在する節は通す", () => {
    const { total, dangling } = findCitations(
      [{ path: "web/a.ts", text: `/** 読み上げ名(base-spec ${S}43)。 */` }],
      sections,
    );
    expect(total).toBe(1);
    expect(dangling).toEqual([]);
  });

  it("小節まで見る", () => {
    expect(
      findCitations(
        [{ path: "a.md", text: `base-spec ${S}9.2 と base-spec ${S}9.9` }],
        sections,
      ).dangling.map((d) => d.section),
    ).toEqual(["9.9"]);
  });

  it("1 行に 2 つの文書が並んでも、base-spec の側だけを見る", () => {
    // **実物にある形である**——`crates/calcarc-core/src/data_scale/format.rs:1`
    // が `(設計書 ${S}3、base-spec ${S}26 の整数版)` と書いている。
    // 「設計書」がどの spec かは機械には決められないので、見ない。
    const { total, dangling } = findCitations(
      [
        {
          path: "crates/x.rs",
          text: `//! 分離(設計書 ${S}3、base-spec ${S}26 の整数版)。`,
        },
      ],
      sections,
    );
    expect(total).toBe(1);
    expect(dangling).toEqual([]);
  });

  it("逆順でも、近いほうの名乗りを採る", () => {
    // **上のテストは片方の順しか見ていなかった。** base-spec が後ろに在れば
    // 窓で切れるが、**前に在ると窓に残る**。実物にある形である
    // ——`crates/calcarc-core/tests/finance_golden.rs:1` の
    // `(base-spec ${S}35、設計書 ${S}7)`。
    //
    // **これは黙って緑だった**——base-spec に ${S}7 は実在するので、誤って
    // 数えても宙には浮かない。浮くのは base-spec の ${S}7 が改番された日で、
    // そのとき設計書を指した行が赤くなる。
    const { total, dangling } = findCitations(
      [
        {
          path: "crates/x.rs",
          text: `//! 突き合わせる(base-spec ${S}35、設計書 ${S}7)。`,
        },
      ],
      new Set(["35"]),
    );
    expect(total).toBe(1);
    expect(dangling).toEqual([]);
  });

  it(`\`spec ${S}N\` は base-spec のものにしない`, () => {
    // 2026-09-05 の誤警報そのもの
    // (`docs/superpowers/plans/2026-09-03-history.md:1389`)。
    // **`base-spec.md` はここでは引用元ではなく、書き換えの対象である。**
    // `${S}10.2` は `2026-09-03-history-design.md` の節。
    const { total, dangling } = findCitations(
      [
        {
          path: "docs/p.md",
          text: `- [x] **Step 1: \`base-spec.md\` を spec ${S}10.2 の案で置き換える**`,
        },
      ],
      new Set(["43"]),
    );
    expect(total).toBe(0);
    expect(dangling).toEqual([]);
  });

  it("base-spec を名乗らない節は数えない", () => {
    expect(
      findCitations([{ path: "a.md", text: `設計書 ${S}7.1 の実測` }], sections)
        .total,
    ).toBe(0);
  });

  it("窓の外の base-spec には結びつけない", () => {
    // 24 文字より前に在る `base-spec` は、その `${S}N` の典拠とは限らない。
    const far = `base-spec は読んだ。ここから先は別の話であって、設計書 ${S}999`;
    expect(findCitations([{ path: "a.md", text: far }], sections).total).toBe(
      0,
    );
  });

  it("テキストでないものは見ない", () => {
    expect(
      findCitations(
        [{ path: "web/public/icon.png", text: `base-spec ${S}999` }],
        sections,
      ).total,
    ).toBe(0);
  });
});

describe("citesBaseSpec", () => {
  it("`base-spec` の中の `spec` に当たらない", () => {
    // **ここを取り違えると覆いが全部消える**——`base-spec` は `spec` を
    // 含むので、名乗りの一覧から `base-spec` を落として素朴に `spec` だけを
    // 除外すると、正当な引用まで全部落ちる。**落として確かめた**
    // (2026-09-05、17 本中 8 本が赤くなった)。
    expect(citesBaseSpec("読み上げ名(base-spec ")).toBe(true);
    expect(citesBaseSpec("`docs/base-spec.md` の ")).toBe(true);
  });

  it("いちばん近い名乗りだけを見る", () => {
    expect(citesBaseSpec(`(base-spec ${S}35、設計書 `)).toBe(false);
    expect(citesBaseSpec(`(設計書 ${S}3、base-spec `)).toBe(true);
    expect(citesBaseSpec("`base-spec.md` を spec ")).toBe(false);
  });

  it("名乗りが 1 つも無ければ数えない", () => {
    expect(citesBaseSpec("この節の ")).toBe(false);
    expect(citesBaseSpec("")).toBe(false);
  });
});

describe("実物のリポジトリ", () => {
  const sections = readSpecSections(readSpecText());
  const { total, dangling } = findCitations(readTrackedFiles(), sections);

  it("宙に浮いた引用は 1 件も無い", () => {
    expect(
      dangling,
      `base-spec に無い節を指している: ${JSON.stringify(dangling, null, 2)}`,
    ).toEqual([]);
  });

  it("何件見たかを主張する（0 件で緑を返さない）", () => {
    // **これが本題である。** 綴りが変わって 1 件も拾えなくなった日から、
    // 上の「0 件」は何も意味しなくなる。**下限だけを主張する**——実数は
    // main が進むたびに動くので、書けばその日のうちに腐る
    // (2026-09-04 に足した日は 324 件 / 42 節、`main` を取り込んで
    // 数え方を直した 2026-09-05 は 325 件 / 63 節だった)。
    expect(total, "base-spec への引用を 1 件も拾えなかった").toBeGreaterThan(
      200,
    );
    expect(
      sections.size,
      "base-spec の節を 1 つも読めなかった",
    ).toBeGreaterThan(40);
  });

  it(`${S}43 は実在する（2026-09-04 の指摘は空振りだった）`, () => {
    // 「`docs/base-spec.md` に該当節は無い」という指摘が出た。**在る**
    // ——`# 43. Accessibility`。`##` と `${S}` を探すと見つからないだけである。
    expect(sections.has("43")).toBe(true);
    expect(readSpecText()).toContain("# 43. Accessibility");
  });
});

import { describe, expect, it } from "vitest";
import {
  auditPresses,
  buildRun,
  type PressLedger,
  REQUIRED_KEYS,
  type TypingPlan,
} from "../ui/presses";

/**
 * **この検査は本当に何かを比べているか。**
 *
 * `globalTeardown` の主張は 10 分の走行の末尾にしか出てこないので、そこだけで
 * 確かめると「押されていないのに緑」を見逃しても分からない。判定そのものは
 * 純関数なので、ここで**壊した台帳を渡して赤くなることを確かめる。**
 */

const everyRequiredKey = (): PressLedger => ({
  byToken: Object.fromEntries(
    REQUIRED_KEYS.map(({ token }) => [token, { case: 3, harness: 1 }]),
  ),
  casesTyped: { "display-000.json": 700, "typed-000.json": 700 },
});

const plan = (): TypingPlan => ({
  cases: { "display-000.json": 700, "typed-000.json": 700 },
  // `ac` はコーパスのキー列に 1 件も現れない(2026-08-20 実測)ので、
  // ここでも `inCorpus` から外れる。**外れているキーは harness の押下で足りる。**
  inCorpus: REQUIRED_KEYS.map(({ token }) => token).filter((t) => t !== "ac"),
  inSample: REQUIRED_KEYS.map(({ token }) => token).filter((t) => t !== "ac"),
  totalCases: 1400,
});

describe("auditPresses", () => {
  it("says nothing when every required key was pressed by a case", () => {
    expect(auditPresses(everyRequiredKey(), plan(), 1)).toEqual([]);
  });

  it("catches a required key that no case pressed", () => {
    const ledger = everyRequiredKey();
    delete ledger.byToken.dms;
    const kinds = auditPresses(ledger, plan(), 1).map((f) => f.kind);
    expect(kinds).toContain("never-pressed");
    expect(kinds).toContain("never-typed-by-a-case");
  });

  it("does not let the harness's own presses stand in for a case", () => {
    // `AC` は各ケースの頭で harness が押す。区別しなければ、`AC` の主張は
    // **コーパスが `ac` を 1 件も持たなくても緑になる。**
    const ledger = everyRequiredKey();
    ledger.byToken.dms = { case: 0, harness: 12 };
    const findings = auditPresses(ledger, plan(), 1);
    expect(findings.map((f) => f.kind)).toEqual(["never-typed-by-a-case"]);
  });

  it("accepts a harness-only press for a key the corpus does not carry", () => {
    const ledger = everyRequiredKey();
    ledger.byToken.ac = { case: 0, harness: 1400 };
    expect(auditPresses(ledger, plan(), 1)).toEqual([]);
  });

  it("refuses a run that recorded nothing at all", () => {
    // **0 周でも緑になる形を作らない。** 空の台帳は「全部押した」ではなく
    // 「1 つも押していない」である。
    const findings = auditPresses({ byToken: {}, casesTyped: {} }, plan(), 1);
    expect(findings.filter((f) => f.kind === "no-presses")).toHaveLength(1);
    expect(findings.filter((f) => f.kind === "never-pressed")).toHaveLength(
      REQUIRED_KEYS.length,
    );
    expect(findings.filter((f) => f.kind === "too-few-cases")).toHaveLength(1);
  });

  it("refuses a run that pressed every key but typed almost nothing", () => {
    const ledger = everyRequiredKey();
    ledger.casesTyped = { "display-000.json": 9 };
    const kinds = auditPresses(ledger, plan(), 1).map((f) => f.kind);
    expect(kinds).toContain("too-few-cases");
  });

  it("scales the floor with HEAVY_UI_SAMPLE instead of dropping it", () => {
    const ledger = everyRequiredKey();
    ledger.casesTyped = { "display-000.json": 120 };
    // 既定の 1/10 で走らせた走行は下限も 1/10。**消えはしない。**
    expect(
      auditPresses(ledger, { ...plan(), cases: {} }, 0.1).map((f) => f.kind),
    ).toEqual([]);
    ledger.casesTyped = { "display-000.json": 9 };
    expect(
      auditPresses(ledger, { ...plan(), cases: {} }, 0.1).map((f) => f.kind),
    ).toContain("too-few-cases");
  });

  it("catches a shard that stopped part way through", () => {
    const ledger = everyRequiredKey();
    ledger.casesTyped["typed-000.json"] = 40;
    const findings = auditPresses(ledger, plan(), 1);
    const stopped = findings.filter((f) => f.kind === "planned-but-not-typed");
    expect(stopped).toHaveLength(1);
    expect(stopped[0]?.message).toContain("typed-000.json");
  });

  it("catches a sampling that selected no case for a required key", () => {
    // 押下は足りているのに**選び方**が必須キーを落としている、という形。
    const findings = auditPresses(
      everyRequiredKey(),
      { ...plan(), inSample: plan().inSample.filter((t) => t !== "del") },
      1,
    );
    expect(findings.map((f) => f.kind)).toEqual(["not-in-sample"]);
  });
});

describe("buildRun", () => {
  it("keeps the findings and marks the run not ok", () => {
    const ledger = everyRequiredKey();
    delete ledger.byToken.j;
    const findings = auditPresses(ledger, plan(), 1);
    const run = buildRun(ledger, plan(), findings);
    expect(run.ok).toBe(false);
    expect(run.pressedAnything).toBe(true);
    expect(run.totalTypedCases).toBe(1400);
    expect(run.required.find((r) => r.token === "j")?.presses).toEqual({
      case: 0,
      harness: 0,
    });
    expect(run.findings).toHaveLength(findings.length);
  });

  it("reports a run that recorded nothing as not ok", () => {
    // **番兵を 0 に揃えない。** 測れなかった走行と、押さなかった走行を
    // 同じ顔にすると、要約を読む側は区別できない。
    const empty: PressLedger = { byToken: {}, casesTyped: {} };
    const run = buildRun(empty, plan(), auditPresses(empty, plan(), 1));
    expect(run.pressedAnything).toBe(false);
    expect(run.ok).toBe(false);
    expect(run.totalPresses).toBe(0);
  });
});

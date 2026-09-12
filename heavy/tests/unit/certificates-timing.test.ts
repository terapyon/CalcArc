import { describe, expect, it } from "vitest";
import { timingOf } from "../../harness/timing";
import {
  compoundDepositForProbes,
  compoundPeriodsForProbes,
} from "../corpus/certificates";
import type { CallCase } from "../corpus/corpus";

/**
 * **証明書は期首の答を期首で検算する**(設計書 2026-09-10 §4.4)。
 *
 * 以前は正算の入力 `base` を timing 抜きで組んでいた——harness の既定は
 * 期末なので、期首の逆算を**期末の腕で**検算していた。
 */
const depositFor = (timing?: "start"): CallCase =>
  ({
    id: "t-1",
    op: "compound_deposit_for",
    input: {
      principal: "0",
      target: "1000",
      rate: "3.0",
      periods_per_year: 12,
      periods: 12,
      tax: false,
      ...(timing ? { timing } : {}),
    },
    expect: { deposit: "80" },
  }) as unknown as CallCase;

const periodsFor = (timing?: "start"): CallCase =>
  ({
    id: "t-2",
    op: "compound_periods_for",
    input: {
      principal: "0",
      deposit: "100",
      target: "1000",
      rate: "3.0",
      periods_per_year: 12,
      tax: false,
      ...(timing ? { timing } : {}),
    },
    expect: { periods: "3" },
  }) as unknown as CallCase;

describe("timingOf", () => {
  it("reads the end when the case says nothing (the end corpus carries no timing)", () => {
    expect(timingOf({})).toBe("end");
  });
  it("reads start and end as written", () => {
    expect(timingOf({ timing: "start" })).toBe("start");
    expect(timingOf({ timing: "end" })).toBe("end");
  });
  it("refuses a spelling it does not know instead of falling back to the end", () => {
    expect(() => timingOf({ timing: "beginning" })).toThrow(/beginning/);
  });
});

describe("the compound certificates carry the case's timing", () => {
  // **どれも probes が空でないことを先に見る。** ループの中の expect は、
  // probes が 0 本なら 1 度も走らずに緑になる——3 本とも、何も作らない
  // 証明書でも通ってしまう。
  it("probes a start deposit_for at the start", () => {
    const probes = compoundDepositForProbes([depositFor("start")]);
    expect(probes.length).toBeGreaterThan(0);
    for (const probe of probes) {
      expect(probe.input.input.timing).toBe("start");
    }
  });
  it("probes a start periods_for at the start", () => {
    const probes = compoundPeriodsForProbes([periodsFor("start")]);
    expect(probes.length).toBeGreaterThan(0);
    for (const probe of probes) {
      expect(probe.input.input.timing).toBe("start");
    }
  });
  it("adds no timing to an end case (finance-000's probes do not change)", () => {
    const probes = [
      ...compoundDepositForProbes([depositFor()]),
      ...compoundPeriodsForProbes([periodsFor()]),
    ];
    expect(probes.length).toBeGreaterThan(0);
    for (const probe of probes) {
      expect("timing" in probe.input.input).toBe(false);
    }
  });
});

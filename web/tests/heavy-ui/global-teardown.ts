import { auditPresses, buildRun, readLedger, writeRunJson } from "./presses";
import { SAMPLE_RATIO, typingPlan } from "./sampling";

/**
 * **押したキーの主張は、走行そのものに紐づける。**
 *
 * これを別のテストファイルに置くと、ファイルの実行順に依存する——記録より
 * 先に検査が走れば、検査は空の台帳を見て「1 つも押されていない」と言うか、
 * あるいは何も言わずに緑になる。`globalTeardown` はワーカーではなく走行に
 * 紐づいていて、**テストが落ちても必ず 1 度だけ走る**(`../heavy/report.ts` の
 * `writeReport` が同じ理由でそこに居る)。
 */
export default function globalTeardown(): void {
  const ledger = readLedger();
  const plan = typingPlan();
  const findings = auditPresses(ledger, plan, SAMPLE_RATIO);
  // **要約を先に書く。** 投げてから書くと、**失敗した走行ほど何も残らない**
  // ——測定側が一番知りたい場合に、一番分からなくなる。
  writeRunJson(buildRun(ledger, plan, findings));
  for (const finding of findings) {
    console.error(`heavy-ui: ${finding.kind}: ${finding.message}`);
  }
}

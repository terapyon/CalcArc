import { resetPresses } from "./presses";

/**
 * **走行の開始時に、前回の台帳を消す。**
 *
 * 押したキーは `web/.heavy-ui-presses/` にワーカー 1 つ = 1 ファイルで落ちる
 * (`presses.ts` の `recordPress()`)。消さずに走ると、今回 1 度も押していない
 * キーが**前回の走行の数字で緑になる**——`../corpus/global-setup.ts` が
 * `.heavy-summaries/` を消すのとまったく同じ理由である。前回の
 * `heavy/heavy-ui-run.json` も一緒に消す。
 *
 * `testMatch` の既定は `**\/*.@(spec|test).*` なので、このファイルは
 * テストとして拾われない。
 */
export default function globalSetup(): void {
  resetPresses();
}

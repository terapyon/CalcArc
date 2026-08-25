import { resetRun } from "./report";

/**
 * **走行の開始時に、前回の残骸を消す。**
 *
 * 集計は `web/.heavy-summaries/` にシャード 1 枚 = 1 ファイルで落ちる
 * (`report.ts` の `record()`)。消さずに走ると、今回一件も回らなかった
 * シャードが前回の数字で埋まる——**それは緑の顔である**。前回の
 * `web/heavy-report.md` も一緒に消す。書き出しを拒んだときに古い報告書が
 * そのまま残るのでは、拒んだ意味がない。
 *
 * `testMatch` の既定は `**\/*.@(spec|test).*` なので、このファイルは
 * テストとして拾われない。
 */
export default function globalSetup(): void {
  resetRun();
}

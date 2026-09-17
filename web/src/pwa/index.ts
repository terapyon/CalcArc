/**
 * Service Worker の更新購読。**UI Framework に依存しない**——ここに react を
 * import してはならない(base-spec §4.3、datascale/finance の境界と同じ)。
 *
 * `registerType: "prompt"` のまま、prompt の本来の使い方を配線する(設計書 §1)。
 * `SKIP_WAITING` の送信と `controllerchange` の購読はプラグインが持っている
 * ので、自前で postMessage を書かない(設計書 §3)。
 */
import { registerSW } from "virtual:pwa-register";
import { UPDATE_CHECK_INTERVAL_MS } from "./interval";

/** 押されたときに世代を切り替えて再読み込みする。 */
export type ApplyUpdate = () => Promise<void>;

// **間隔の値は `interval.ts` が持つ。** この `index.ts` は `virtual:pwa-register` を
// import するので、**jsdom の検査からは読めない**——値を固定する番人を置けるように、
// 定数だけを別のファイルへ出してある(0.9.3 設計書 §3.2)。
export { UPDATE_CHECK_INTERVAL_MS } from "./interval";

let ready: Promise<ApplyUpdate> | null = null;

/**
 * 更新の検知を購読する。複数回呼んでも登録は 1 度だけ(calc/ と同じ理由)。
 *
 * `onNeedRefresh` は waiting の SW が現れたときに呼ばれる。**呼ばれた時点では
 * 何も切り替わっていない**——切り替えるのは戻り値を呼んだときだけである。
 */
export function watchForUpdate(
  onNeedRefresh: () => void,
): Promise<ApplyUpdate> {
  ready ??= new Promise<ApplyUpdate>((resolve, reject) => {
    // registerSW は同期で updateSW を返すが、**解決は登録の完了を待つ**。
    // 同 tick で resolve すると、あとから来る onRegisterError は解決済みの
    // Promise に対して無効になり、失敗の経路が死ぬ。
    const updateSW = registerSW({
      onNeedRefresh,
      // reload = true。SKIP_WAITING のあと controllerchange で再読み込み。
      onRegisteredSW: (
        _swUrl: string,
        registration?: { update: () => Promise<unknown> },
      ) => {
        // **アプリ自身が定期的に探す**(0.9.3 設計書 §3.2)。**失敗は黙って
        // 次の周期を待つ**——オフラインで確認できないのは普通のことで、
        // 利用者に見せるものではない。
        if (registration) {
          setInterval(() => {
            void registration.update().catch(() => {});
          }, UPDATE_CHECK_INTERVAL_MS);
        }
        resolve(() => updateSW(true));
      },
      onRegisterError: (error: unknown) => {
        ready = null;
        reject(error);
      },
    });
    // Service Worker を持たない環境では、どちらのコールバックも呼ばれず
    // この Promise は未解決のままになる。**それでよい**——onNeedRefresh も
    // 来ないのでトーストは出ず、画面は静かに壊れないまま動く。
  });
  return ready;
}

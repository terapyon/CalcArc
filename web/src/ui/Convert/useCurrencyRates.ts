import { useEffect, useState } from "react";
import { readRates, writeRates } from "../../currency/cache";
import { exchangeRateApi } from "../../currency/provider";
import {
  ALLOWED_CURRENCY_CODES,
  decide,
  shouldWrite,
  validate,
} from "../../currency/rates";
import type { CurrencyRateSet } from "../../currency/types";

/**
 * 盤面から見たレートの状態(U-4 spec §4.2・§5)。
 *
 * **`set` が `null` なら「キャッシュ無し」である**——エラーではなく案内を
 * 出す(§5)。`loading` のあいだは案内も出さない: 開いた直後の一瞬に
 * 「レートがありません」が出て消えるのは、読み手にとって嘘である。
 */
export interface CurrencyRates {
  /** 描いてよいレート。**通信を待たずにキャッシュを先に描く**(§4.2)。 */
  set: CurrencyRateSet | null;
  /** キャッシュを読んでいる最中。 */
  loading: boolean;
  /** 端末がオフライン(§5)。**キャッシュがあればそのまま換算する。** */
  offline: boolean;
}

/**
 * 差し替え可能な外界。**既定は本物**で、テストはここを差し替える
 * (spec §8「`Provider` と `Cache` を差し替えて回す」)。
 */
export interface RateDeps {
  read: () => Promise<CurrencyRateSet | null>;
  write: (set: CurrencyRateSet) => Promise<void>;
  fetchLatest: () => Promise<CurrencyRateSet>;
  now: () => Date;
  online: () => boolean;
  /**
   * 回線の状態が変わったら呼ぶ。返り値は購読の解除。
   *
   * **`online()` を 1 度読むだけでは足りない。** 盤面を開いたまま電車に
   * 入る・機内モードにする、というほうが「開く前から落ちている」より普通で、
   * その変化は読み取りでは拾えない。
   */
  watchOnline: (onChange: () => void) => () => void;
}

const LIVE: RateDeps = {
  read: readRates,
  write: writeRates,
  fetchLatest: () => exchangeRateApi.getLatestRates(),
  now: () => new Date(),
  online: () => globalThis.navigator?.onLine ?? true,
  watchOnline: (onChange) => {
    globalThis.addEventListener?.("online", onChange);
    globalThis.addEventListener?.("offline", onChange);
    return () => {
      globalThis.removeEventListener?.("online", onChange);
      globalThis.removeEventListener?.("offline", onChange);
    };
  },
};

/**
 * **取得を試みたか。モジュールに持つ**(= 同一セッションで 1 回だけ)。
 *
 * **`decide` は 1 回きりの判断である。** `refresh: true` を受けて取りに
 * 行って失敗したあと、**再描画のたびに `decide` を呼ぶと毎回
 * `refresh: true` が返り、取得を繰り返す**(Task 6 の申し送り)。
 * `useRef` では足りない——`ConvertPanel` はカテゴリごとに `key` を与えて
 * 盤面を作り直すので、**為替から離れて戻るたびに ref は新品になる**。
 * 抑制はマウントより長く生きる必要がある。
 *
 * **再読み込みで解ける。** ページを読み直せばモジュールごと作り直され、
 * 次のセッションでは 1 回だけ取りに行く。
 */
let attempted = false;

/**
 * 取得の抑制を解く。**テストのためにある**——「同一セッションで 1 回だけ」を
 * 測るには、セッションを畳んで数え直せる必要がある。
 */
export function resetRateFetchGuard(): void {
  attempted = false;
}

/**
 * レートを読み、必要なら背後で取りに行く(§4.2)。
 *
 * **`enabled` が false のあいだは何もしない。** 起動時に通信しないのは
 * §0.0-2 の約束で、**他の 7 カテゴリを見ているだけで `fetch` が呼ばれては
 * ならない**——キャッシュ(IndexedDB)にも触らない。
 *
 * **取得したものもキャッシュ由来のものも `validate` を通す**(§4.3)。
 * `cache.ts` は形だけしか見ておらず、レートが 10 進として読めるかどうかは
 * ここまで来ないと分からない(Task 6 の申し送り)。
 */
export function useCurrencyRates(
  enabled: boolean,
  deps: RateDeps = LIVE,
): CurrencyRates {
  const [set, setSet] = useState<CurrencyRateSet | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [offline, setOffline] = useState(false);

  // **`deps` は依存に入れない。** 既定は module のスコープに置いた定数で、
  // **描画のたびに作り直されるものではない**(テストは `vi.mock` で
  // `provider` と `cache` を差し替えるので、ここへ毎回別のオブジェクトが
  // 来ることも無い)。入れると `deps` の同一性が変わるたびに効果が走り、
  // **「同一セッションで 1 回だけ」を盤面が持っている意味が無くなる。**
  // biome-ignore lint/correctness/useExhaustiveDependencies: 上のとおり
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function refresh(cached: CurrencyRateSet | null): Promise<void> {
      // **1 セッションに 1 回。** 失敗しても取り直さない——失敗は
      // 致命的ではなく(§5)、古いレートのまま換算が続く。
      if (attempted) return;
      attempted = true;
      let fetched: CurrencyRateSet;
      try {
        fetched = await deps.fetchLatest();
      } catch {
        // **黙って古いレートを使う**(§5・設計書 §35)。キャッシュは捨てない。
        return;
      }
      const valid = validate(fetched, ALLOWED_CURRENCY_CODES);
      if (valid === null) return;
      if (shouldWrite(cached, valid)) await deps.write(valid);
      if (!cancelled) setSet(valid);
    }

    void (async () => {
      // **キャッシュ由来のセットにも `validate` を通す**(§4.3)。
      const stored = validate(await deps.read(), ALLOWED_CURRENCY_CODES);
      if (cancelled) return;
      const online = deps.online();
      setOffline(!online);
      const decision = decide(stored, deps.now());
      if (decision.kind === "use") {
        // **まず画面に出す。通信を待たない**(§4.2)。
        setSet(decision.set);
        setLoading(false);
        if (decision.refresh && online) await refresh(decision.set);
        return;
      }
      // キャッシュ無し。オンラインなら 1 度だけ取りに行く(§4.2)。
      if (online) await refresh(null);
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // **回線の変化を購読する。** 上の効果が読む `deps.online()` は**開いた
  // 瞬間の値**で、そのあと落ちても上がっても動かない。**キャッシュがある
  // 限り換算は続く**ので、ここが決めるのは「いま出している数は取り直せない」
  // と伝えるかどうかだけである(§5 の「オフラインは状態であってエラーでは
  // ない」)。
  //
  // **取りに行き直しはしない。** 取得は「同一セッションで 1 回だけ」で
  // (`attempted`)、オンラインに戻ったことをその抑制を解く合図にはしない
  // ——§4.2 が決めた回数を、回線の上下で増やさない。
  //
  // `deps` を依存に入れないのは上の効果と同じ理由である。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 上のとおり
  useEffect(() => {
    if (!enabled) return;
    return deps.watchOnline(() => setOffline(!deps.online()));
  }, [enabled]);

  return { set, loading, offline };
}

import { useEffect, useState } from "react";
import { type Route, routeFromHash } from "./route";
import styles from "./ui/App.module.css";
import { ConvertPanel } from "./ui/Convert/ConvertPanel";
import { FinancePanel } from "./ui/Finance/FinancePanel";
import { Footer } from "./ui/Footer/Footer";
import { Nav } from "./ui/Nav/Nav";
import { ScalePanel } from "./ui/Scale/ScalePanel";
import { ScientificPanel } from "./ui/ScientificPanel";
import { screenName } from "./ui/screenName";
import { UpdateToast } from "./ui/UpdateToast/UpdateToast";

export function App() {
  const [route, setRoute] = useState<Route>(() =>
    routeFromHash(window.location.hash),
  );

  useEffect(() => {
    // リンクの href がハッシュを変える。クリックハンドラは書かず、ブラウザの
    // 標準動作(履歴・共有・リロード)に任せる——この購読はその結果を
    // React の state に反映するだけ(設計書 §6)。
    const onHashChange = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    // **タブの名前に、いまの画面を出す**(設計書 §3)。書式は
    // `<画面名> | CalcArc` で、**アプリ名は後ろ**——タブが並んだときに
    // 読めるのは先頭だけであり、読み上げも先に画面名を言う。
    //
    // **初期表示でも走る。** effect は最初の描画の後に必ず 1 度走るので、
    // `index.html` の `<title>CalcArc</title>` はそこで置き換わる。
    // ハッシュ無しも知らないハッシュ(`#nope`)も `routeFromHash` が
    // `scientific` へ倒すので `関数電卓 | CalcArc` になる——**互換分岐は
    // 作らない**という `route.ts` の裁定にそのまま乗る。
    //
    // **`index.html` の `og:title` は触らない。** クローラは JS を待たないので、
    // ここで書き換えても OGP には届かない——静的な `CalcArc` のままが正しい。
    document.title = `${screenName(route)} | CalcArc`;
  }, [route]);

  return (
    <>
      <div className={styles.shell}>
        <Nav current={route.module} />
        <main className={styles.main}>
          {route.module === "scientific" && <ScientificPanel />}
          {route.module === "convert" && (
            <ConvertPanel category={route.category} />
          )}
          {route.module === "scale" && <ScalePanel category={route.category} />}
          {route.module === "finance" && <FinancePanel />}
        </main>
        {/* 版数・リンク・免責もモジュールに属さない。シェルが 1 つだけ持つ。 */}
        <Footer />
      </div>
      {/* 更新の知らせはモジュールに属さない。シェルが 1 つだけ持つ。 */}
      <UpdateToast />
    </>
  );
}

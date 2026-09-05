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
          {/*
            **画面の見出しは `App` が持つ。パネル側に置かない**(設計書 §4)。
            置き場所そのものが「`<h1>` はちょうど 1 つ」を保証する
            ——パネル側に置くと、パネルが 2 つ同時に出た日に 2 つになる。

            **文字列は `document.title` の前半と同じ `screenName(route)`**。
            2 つが食い違うと、見出しで確認した名前とタブの名前が違うことになる。

            **視覚的には 0**(設計書 §4.1・§4.1a)。見える見出しは採らなかった
            ——`CalcArc v0.8.0` は全画面で同じ文字列なので現在地を言わないし、
            見える 1 行はだいたい 16px を使い、Finance に残っている縦の余白
            (390×844 で 16.31px)がそれで消える。`visually-hidden` は
            `tokens.css` のグローバルなクラスなので、**CSS Modules の
            `styles.…` ではなく文字列で当てる**(設計書 §4.2)。
            **`display:none` / `visibility:hidden` に取り違えると、
            `screen-identity.spec.ts` の役割クエリが要素を見つけられずに
            赤くなる**(設計書 §4.3 の実測)。

            **`History` の `<h2>履歴` はそのまま。** `<h1>`(画面)→
            `<h2>`(その中の面)という階層になり、いま飛んでいる段が埋まる。
          */}
          <h1 className="visually-hidden">{screenName(route)}</h1>
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

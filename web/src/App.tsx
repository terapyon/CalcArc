import { useEffect, useRef, useState } from "react";
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

/**
 * 切替を知らせる文面。**綴りはここ 1 か所にしか無い**(設計書 §12-2)。
 *
 * **この文面は利用者の裁定ではなく、監視役が選んだ既定である**
 * ——「〜に切り替えました」は §12 の表で「利用者の別案が出たら差し替える」と
 * されている。2 か所に散っていると、差し替えの日に片方だけが古いまま残る。
 * **テストは期待値を自分で持つ**(この関数から組み立てると、両方が同時に
 * 間違っても緑になる)。
 */
function switchAnnouncement(name: string): string {
  return `${name}に切り替えました`;
}

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

  const [announcement, setAnnouncement] = useState("");
  // **初回は鳴らさない。** 読み込んだだけで「切り替えました」は嘘になるし、
  // 読み込み直後の読み上げ(見出し・最初の表示)に重なる。**effect の 1 回目を
  // 飛ばす**ために、直前に知らせた画面名を ref に持つ——`null` の 1 回目は
  // 記録するだけで書かない。`ScientificPanel` の `savedScientific` が
  // 同じ形である(あちらは「復元直後の 1 回目を保存しない」)。
  //
  // **比べるのは route ではなく画面名。** 同じ画面のまま別の理由で route の
  // 参照だけが変わっても鳴らない。
  const announcedScreen = useRef<string | null>(null);
  useEffect(() => {
    const name = screenName(route);
    if (announcedScreen.current === null) {
      announcedScreen.current = name;
      return;
    }
    if (announcedScreen.current === name) return;
    announcedScreen.current = name;
    setAnnouncement(switchAnnouncement(name));
  }, [route]);

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
        {/*
          **画面が変わったことを読み上げに伝える**(設計書 §5)。

          **常設である。** `route` が何であっても在り、空のまま置いておく
          ——**領域と中身を同時に挿入すると読み上げは鳴らない**。
          `UpdateToast` がいままさにその形で(`if (!waiting) return null`)、
          Task 7 で直す。手本は `Readout.tsx:69-90`——条件付き return を
          持たず、空のまま領域を置く。
          **履歴の面を含め、これがこのアプリで唯一いつでも在る live 領域**
          になる(設計書 §1.1: 履歴の面は live 領域が 0 件)。

          **`polite` である。** 画面の切替は**利用者自身が起こした**ことで、
          事故ではない。`assertive` は読み上げ中の発話を割り込んで捨てるので、
          いま読んでいる結果を消してしまう。`UpdateToast.tsx:63` が同じ理由で
          `polite` を選んでいる。

          **`aria-label` を付けて名前で引けるようにする**(既存の `Readout` の
          status と `UpdateToast` がそう)。空の領域は中身から名前が付かない
          ので、名前が無いと役割クエリで一意に取れない。

          **`visually-hidden` は `tokens.css` のグローバルなクラス**なので
          CSS Modules の `styles.…` ではなく文字列で当てる(設計書 §4.2)。
          `position: absolute` なので画面には 1 文字も、1px も増えない。
        */}
        <div
          role="status"
          aria-live="polite"
          aria-label="画面の切り替え"
          className="visually-hidden"
        >
          {announcement}
        </div>
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

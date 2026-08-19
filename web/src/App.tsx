import { useEffect, useState } from "react";
import { type Route, routeFromHash } from "./route";
import styles from "./ui/App.module.css";
import { ConvertPanel } from "./ui/Convert/ConvertPanel";
import { DataScalePanel } from "./ui/DataScale/DataScalePanel";
import { FinancePanel } from "./ui/Finance/FinancePanel";
import { Footer } from "./ui/Footer/Footer";
import { Nav } from "./ui/Nav/Nav";
import { ScientificPanel } from "./ui/ScientificPanel";
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

  return (
    <>
      <div className={styles.shell}>
        <Nav current={route.module} />
        <main className={styles.main}>
          {route.module === "scientific" && <ScientificPanel />}
          {route.module === "convert" && <ConvertPanel />}
          {route.module === "scale" && <DataScalePanel />}
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

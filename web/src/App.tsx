import { useEffect, useState } from "react";
import { DataScalePanel } from "./ui/DataScale/DataScalePanel";
import { LoanPanel } from "./ui/Loan/LoanPanel";
import { type ModuleId, Nav } from "./ui/Nav/Nav";
import { ScientificPanel } from "./ui/ScientificPanel";
import { UpdateToast } from "./ui/UpdateToast/UpdateToast";

// 不明・空ハッシュは "scientific" に倒す(base-spec §6 のデフォルト規定)。
function moduleFromHash(hash: string): ModuleId {
  if (hash === "#data-scale") return "data-scale";
  if (hash === "#loan") return "loan";
  return "scientific";
}

export function App() {
  const [module, setModule] = useState<ModuleId>(() =>
    moduleFromHash(window.location.hash),
  );

  useEffect(() => {
    // リンクの href がハッシュを変える。クリックハンドラは書かず、ブラウザの
    // 標準動作(履歴・共有・リロード)に任せる——この購読はその結果を
    // React の state に反映するだけ(設計書 §6)。
    const onHashChange = () => setModule(moduleFromHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <>
      <Nav current={module} />
      <main>
        {module === "scientific" && <ScientificPanel />}
        {module === "data-scale" && <DataScalePanel />}
        {module === "loan" && <LoanPanel />}
      </main>
      {/* 更新の知らせはモジュールに属さない。シェルが 1 つだけ持つ。 */}
      <UpdateToast />
    </>
  );
}

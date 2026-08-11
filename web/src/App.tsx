import { useEffect, useState } from "react";
import { DataScalePanel } from "./ui/DataScale/DataScalePanel";
import { type ModuleId, Nav } from "./ui/Nav/Nav";
import { ScientificPanel } from "./ui/ScientificPanel";

// 不明・空ハッシュは "scientific" に倒す(base-spec §6 のデフォルト規定)。
function moduleFromHash(hash: string): ModuleId {
  return hash === "#data-scale" ? "data-scale" : "scientific";
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
      {module === "scientific" ? <ScientificPanel /> : <DataScalePanel />}
    </>
  );
}

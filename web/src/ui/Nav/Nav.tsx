import styles from "./Nav.module.css";

// 値は URL の写しである(ドメイン名ではない)。だから改名でこれも動く——
// 内部名を据え置く原則(設計書 §1)の、明示的な例外である。
export type ModuleId = "scientific" | "data-scale" | "finance";

// タブの表示ラベルはモジュールの固有名詞なので英語のまま
// (アクセシブルネームは <nav> 側の aria-label で日本語にする)。
const MODULES: { id: ModuleId; href: string; label: string }[] = [
  { id: "scientific", href: "#scientific", label: "Scientific" },
  { id: "data-scale", href: "#data-scale", label: "Data Scale" },
  { id: "finance", href: "#finance", label: "Finance" },
];

export function Nav({ current }: { current: ModuleId }) {
  return (
    <nav aria-label="計算機の切り替え" className={styles.nav}>
      {MODULES.map((m) => (
        <a
          key={m.id}
          href={m.href}
          aria-current={m.id === current ? "page" : undefined}
          className={styles.tab}
        >
          {m.label}
        </a>
      ))}
    </nav>
  );
}

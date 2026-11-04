import { useLocation } from "react-router-dom";
import { routeOf } from "../lib/routes";

export function Placeholder() {
  const r = routeOf(useLocation().pathname);
  return (
    <main className="content">
      <div className="empty">
        <span className="t">{r?.title ?? "页面"}即将上线</span>
        <span>这一页在第一期后续步骤里做，进度见 docs/ROADMAP.md。</span>
      </div>
    </main>
  );
}

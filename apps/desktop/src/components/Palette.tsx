import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../lib/context";
import { formatMoney } from "../lib/format";
import { ROUTES } from "../lib/routes";
import { useDebounced } from "../lib/useDebounced";
import type { Voucher } from "../shared/api";
import { Icon } from "./Icon";

interface Item {
  key: string;
  label: string;
  end?: string;
  icon: Parameters<typeof Icon>[0]["name"];
  go: () => void;
}

/** Ctrl K 命令面板：跳转页面 + 搜索凭证。 */
export function Palette({ onClose }: { onClose: () => void }) {
  const { api } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const dq = useDebounced(q.trim(), 200);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    if (!dq) return setVouchers([]);
    let live = true;
    api.vouchers({ keyword: dq, limit: 6 }).then((r) => live && setVouchers(r.items)).catch(() => live && setVouchers([]));
    return () => { live = false; };
  }, [dq, api]);

  const pages: Item[] = useMemo(() => {
    const k = q.trim().toLowerCase();
    return ROUTES.filter((r) => !k || r.title.toLowerCase().includes(k) || (r.keywords ?? "").includes(k)).map((r) => ({
      key: "p" + r.path, label: r.title, icon: r.icon, go: () => nav(r.path),
    }));
  }, [q, nav]);

  const results: Item[] = vouchers.map((v) => ({
    key: "v" + v.id,
    label: `${v.display_no} ${v.lines[0]?.summary ?? ""}`,
    end: `凭证，${formatMoney(v.total)}`,
    icon: "ledger",
    go: () => nav(`/ledger?v=${v.id}&period=${v.period}`),
  }));

  const all = [...pages, ...results];
  useEffect(() => setSel(0), [q, vouchers.length]);

  const pick = (i: Item) => { i.go(); onClose(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(all.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter" && all[sel]) pick(all[sel]);
  };

  const row = (i: Item, idx: number) => (
    <button key={i.key} type="button" className={"mi" + (idx === sel ? " on" : "")} onMouseEnter={() => setSel(idx)} onClick={() => pick(i)}>
      <Icon name={i.icon} size={16} />
      <span className="ellipsis">{i.label}</span>
      {i.end && <span className="end">{i.end}</span>}
    </button>
  );

  return (
    <div className="scrim" onKeyDown={onKey}>
      <button className="scrim-btn" type="button" aria-label="关闭搜索" onClick={onClose} />
      <div className="palette" role="dialog" aria-label="搜索或跳转">
        <label className="pal-in">
          <Icon name="search" />
          <input ref={input} type="search" aria-label="搜索或跳转" placeholder="搜索凭证，或输入要跳转的页面"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="pal-list">
          {pages.length > 0 && <div className="mhead">跳转</div>}
          {pages.map((p, i) => row(p, i))}
          {results.length > 0 && <div className="mhead">凭证</div>}
          {results.map((r, i) => row(r, pages.length + i))}
          {all.length === 0 && <div className="mhead">没有匹配的结果</div>}
        </div>
        <div className="pal-foot"><span>↑↓ 选择</span><span>Enter 打开</span><span>Esc 关闭</span></div>
      </div>
    </div>
  );
}

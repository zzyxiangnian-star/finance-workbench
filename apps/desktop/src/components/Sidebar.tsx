import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { useApp } from "../lib/context";
import { ROUTES, type RouteDef } from "../lib/routes";
import { Icon } from "./Icon";
import { Tip } from "./Tip";

const PRESET_USERS = ["李会计", "王主管", "赵出纳"];

function NavItem({ r }: { r: RouteDef }) {
  return (
    <NavLink to={r.path} end={r.path === "/"} className={({ isActive }) => "nav" + (isActive ? " on" : "")}>
      <Icon name={r.icon} />
      <span>{r.title}</span>
    </NavLink>
  );
}

export function Sidebar(props: {
  width: number;
  dark: boolean;
  onToggleDark: () => void;
  onHide: () => void;
  onOpenPalette: () => void;
}) {
  const { user, setUser } = useApp();
  const [menu, setMenu] = useState(false);
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenu(false);
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [menu]);

  const pick = (u: string) => {
    const v = u.trim();
    if (v && !v.startsWith("ai:")) setUser(v);
    setMenu(false);
    setDraft("");
  };

  const top = ROUTES.filter((r) => !r.group && r.path !== "/settings");
  const settings = ROUTES.find((r) => r.path === "/settings")!;

  return (
    <nav className="side" style={{ flex: `0 0 ${props.width}px`, width: props.width }} aria-label="主导航">
      <div className="brandrow">
        <button className="iconbtn tt" type="button" aria-label="收起侧栏" onClick={props.onHide}>
          <Icon name="sidebar" />
          <Tip pos="r">收起侧栏</Tip>
        </button>
        <span className="brand">财务工作台</span>
      </div>
      <button className="sbox" type="button" onClick={props.onOpenPalette}>
        <Icon name="search" size={16} />
        <span>搜索或跳转</span>
        <span className="kbd">Ctrl K</span>
      </button>
      {top.map((r) => <NavItem key={r.path} r={r} />)}
      <div className="navsub">账务</div>
      {ROUTES.filter((r) => r.group === "账务").map((r) => <NavItem key={r.path} r={r} />)}
      <div className="navsub">资料</div>
      {ROUTES.filter((r) => r.group === "资料").map((r) => <NavItem key={r.path} r={r} />)}

      <div className="side-foot">
        <button className="nav" type="button" onClick={props.onToggleDark}>
          <Icon name={props.dark ? "sun" : "moon"} />
          <span>{props.dark ? "浅色模式" : "深色模式"}</span>
        </button>
        <NavItem r={settings} />
        <div className="dd" ref={ref} style={{ display: "block" }}>
          <div className="me click tt" role="button" tabIndex={0} aria-haspopup="menu" aria-expanded={menu}
            onClick={() => setMenu(!menu)} onKeyDown={(e) => e.key === "Enter" && setMenu(!menu)}>
            <span className="avatar">{user.slice(-1)}</span>
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0, lineHeight: 1.3 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{user}</span>
              <span className="cap">当前操作人</span>
            </div>
            <Tip pos="up">切换操作人</Tip>
          </div>
          {menu && (
            <div className="menu l upward" role="menu" style={{ minWidth: 220 }}>
              <div className="mhead">切换操作人</div>
              {PRESET_USERS.map((u) => (
                <button key={u} type="button" className={"mi" + (u === user ? " on" : "")} role="menuitemradio"
                  aria-checked={u === user} onClick={() => pick(u)}>
                  <span>{u}</span>
                  {u === user && <span className="check"><Icon name="check" size={16} /></span>}
                </button>
              ))}
              <div style={{ padding: "6px 4px 2px" }}>
                <input className="input" placeholder="输入其他姓名，回车确认" value={draft}
                  onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && pick(draft)} />
              </div>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

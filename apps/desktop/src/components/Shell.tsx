import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { usePersistent } from "../lib/persist";
import { routeOf } from "../lib/routes";
import { Icon } from "./Icon";
import { Palette } from "./Palette";
import { PaneContext } from "./RightPane";
import { Sidebar } from "./Sidebar";
import { Splitter } from "./Splitter";
import { Tip } from "./Tip";

const L_DEFAULT = 252, R_DEFAULT = 400;

/** 三栏外壳：左导航 | 主区 | 右侧栏。尺寸与原型一致（左 200–380，右 280–620）。 */
export function Shell() {
  const [left, setLeft] = usePersistent("left", L_DEFAULT);
  const [right, setRight] = usePersistent("right", R_DEFAULT);
  const [showLeft, setShowLeft] = usePersistent("showLeft", true);
  const [dark, setDark] = usePersistent("dark", false);
  const [dragging, setDragging] = useState(false);
  const [palette, setPalette] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [hasRight, setHasRightState] = useState(false);
  const [rightEl, setRightEl] = useState<HTMLElement | null>(null);
  const [topEl, setTopEl] = useState<HTMLElement | null>(null);
  const loc = useLocation();
  const title = routeOf(loc.pathname)?.title ?? "财务工作台";

  const setHasRight = useCallback((v: boolean) => setHasRightState(v), []);
  // 记在外壳上。开发模式会把录入页挂载两次，用计数避免第二次恢复把开关又打开。
  const openRef = useRef(rightOpen);
  openRef.current = rightOpen;
  const heldRight = useRef<boolean | null>(null);
  const holdCount = useRef(0);
  const holdRightOpen = useCallback(() => {
    if (holdCount.current === 0) heldRight.current = openRef.current;
    holdCount.current += 1;
    setRightOpen(true);
  }, []);
  const releaseRightOpen = useCallback(() => {
    if (holdCount.current === 0) return;
    holdCount.current -= 1;
    if (holdCount.current > 0) return;
    const prev = heldRight.current;
    heldRight.current = null;
    if (prev !== null) setRightOpen(prev);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.title = `${title} · 财务工作台`;
  }, [title]);

  const showRight = hasRight && rightOpen;

  return (
    <PaneContext.Provider value={{ rightEl, topEl, rightOpen, setRightOpen, holdRightOpen, releaseRightOpen, setHasRight }}>
      <div className={"app" + (dark ? " dark" : "") + (dragging ? " dragging" : "")}>
        {showLeft && (
          <>
            <Sidebar width={left} dark={dark} onToggleDark={() => setDark(!dark)} onHide={() => setShowLeft(false)}
              onOpenPalette={() => setPalette(true)} />
            <Splitter side="l" width={left} min={200} max={380} defaultWidth={L_DEFAULT} onChange={setLeft}
              onDragging={setDragging} label="调整导航栏宽度" />
          </>
        )}
        <div className="main">
          <header className="top">
            {!showLeft && (
              <button className="iconbtn tt" type="button" aria-label="展开侧栏" onClick={() => setShowLeft(true)}>
                <Icon name="sidebar" />
                <Tip>展开侧栏</Tip>
              </button>
            )}
            <h1 className="ptitle">{title}</h1>
            <div ref={setTopEl} style={{ display: "contents" }} />
            {hasRight && (
              <button className={"iconbtn tt" + (rightOpen ? " open" : "")} type="button" aria-label="显示或隐藏右侧面板"
                aria-pressed={rightOpen} onClick={() => setRightOpen(!rightOpen)}>
                <Icon name="panel" />
                <Tip pos="end">{rightOpen ? "隐藏右侧面板" : "显示右侧面板"}</Tip>
              </button>
            )}
          </header>
          <Outlet />
        </div>
        <div style={{ display: showRight ? "contents" : "none" }}>
          <Splitter side="r" width={right} min={280} max={620} defaultWidth={R_DEFAULT} onChange={setRight}
            onDragging={setDragging} label="调整右侧面板宽度" />
          <aside className="rpanel" ref={setRightEl} style={{ flex: `0 0 ${right}px`, width: right }} aria-label="详情" />
        </div>
        {palette && <Palette onClose={() => setPalette(false)} />}
      </div>
    </PaneContext.Provider>
  );
}

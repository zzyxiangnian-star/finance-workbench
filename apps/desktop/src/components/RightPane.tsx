import { createContext, useContext, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** 页面通过 <RightPane> 把内容渲染进外壳的右侧栏，通过 <TopActions> 渲染进顶栏。 */
export interface PaneCtx {
  rightEl: HTMLElement | null;
  topEl: HTMLElement | null;
  rightOpen: boolean;
  setRightOpen: (v: boolean) => void;
  setHasRight: (v: boolean) => void;
}

export const PaneContext = createContext<PaneCtx | null>(null);

function usePane() {
  const c = useContext(PaneContext);
  if (!c) throw new Error("PaneContext 缺失");
  return c;
}

export function useRightPane() {
  const { rightOpen, setRightOpen } = usePane();
  return { open: rightOpen, setOpen: setRightOpen };
}

export function RightPane({ children }: { children: ReactNode }) {
  const { rightEl, setHasRight } = usePane();
  useEffect(() => {
    setHasRight(true);
    return () => setHasRight(false);
  }, [setHasRight]);
  return rightEl ? createPortal(children, rightEl) : null;
}

export function TopActions({ children }: { children: ReactNode }) {
  const { topEl } = usePane();
  return topEl ? createPortal(children, topEl) : null;
}
